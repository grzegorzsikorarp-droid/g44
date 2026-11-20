import type {AgendaItem, Ballot, CommsLevel, Meeting} from './types.ts';
import {lawOf} from './law.ts';
import {commsReleasedOk, organRoster} from './role.ts';
import {organOf, organVerb, personName} from './roster.ts';
import {ballotDocType, materialTypeOf, quorumOf, resultLabel} from './rules.ts';
import {COMMS_LEVELS, commsLevelLabel, docCommsLevel, stricterComms, type CaseType} from './settings.ts';
import {shownInItem} from './show.ts';
import {actNumber, longDate, paperDay} from './papers.ts';
import type {CascadeEnv} from './cascade.ts';
import type {Adoption} from './catalog.ts';
import {isoDayOf, plural, timeOf} from './text.ts';

// Materiał dla komunikacji (plik .md) po każdym posiedzeniu (SPEC-4 6.10, DB-10, DB-32, DB-41–DB-43, B1-31–B1-37, K4-1,
// K4-5, K4-6, K4-32). Powstaje na nowo przy każdym pobraniu z danych posiedzenia i poziomów utrwalonych przy zamknięciu
// (`closedComms`); nie jest przechowywany. Każde zdanie pochodzi z danych: bez ocen, bez streszczeń, bez cytatów osób.
// Z imienia i nazwiska tylko osoby z funkcją w organie (otwierający, prowadzący, osoby przy punktach z `personId` ze
// składu zapisanego przy otwarciu) i z głosem doradczym; sprawy bez rodzaju sprawy tylko w liczbie; głosowania tajne
// tylko wynikiem; nic sprzed ogłoszenia wyniku.

export {commsReleasedOk};

/** Rodzaje punktów porządkowych (U-24a): otwarcie, porządek, zamknięcie i rodzaje wymienione w regulaminie. */
export function orderingKinds(organ: Meeting['organ']): Set<AgendaItem['kind']> {
  return new Set<AgendaItem['kind']>(['otwarcie', 'porzadek', 'zamkniecie', ...Object.keys(lawOf(organ).agenda.listed) as AgendaItem['kind'][]]);
}
export interface CommsCeiling {
  level: CommsLevel;
  source: 'porzadkowy' | 'rodzaj_sprawy' | 'rodzaj_dokumentu' | 'aplikacja';
  caseType?: CaseType; docTypeName?: string;
}
/**
 * Poziom 1 dla punktu (U-24, U-25, U-24a): punkt porządkowy „Tytuł”; sprawa i podpunkt z rodzajem sprawy według rodzaju
 * sprawy, a przy „Jak rodzaj dokumentu” według rodzaju dokumentu tej sprawy; sprawa bez rodzaju sprawy zawsze „Tylko
 * liczba” (sufit, którego rodzaj dokumentu nie podnosi).
 */
export function commsCeiling(m: Pick<Meeting, 'organ'>, item: AgendaItem | undefined, env: Pick<CascadeEnv, 'general' | 'docTypes'>): CommsCeiling {
  if (item && !item.parentId && orderingKinds(m.organ).has(item.kind)) return {level: 'tytul', source: 'porzadkowy'};
  const caseType = item?.caseType ? env.general.caseTypes.find(c => c.id === item.caseType) : undefined;
  if (!caseType) return {level: 'liczba', source: 'aplikacja'};
  if (caseType.comms) return {level: caseType.comms, source: 'rodzaj_sprawy', caseType};
  const doc = env.docTypes.find(d => d.id === caseType.docType);
  return {level: doc ? docCommsLevel(doc) : 'liczba', source: 'rodzaj_dokumentu', caseType, docTypeName: doc?.name};
}
/**
 * Poziom skuteczny punktu: w przygotowaniu i w trakcie poziom 1 zaostrzony poziomem przy punkcie (U-26); po zamknięciu
 * poziom utrwalony w `closedComms` (DB-41) zaostrzony późniejszą zmianą przy punkcie. Akt poza punktem: „Tylko liczba”.
 */
export function commsLevelOfItem(m: Pick<Meeting, 'organ' | 'status' | 'closedComms'>, item: AgendaItem | undefined, env: Pick<CascadeEnv, 'general' | 'docTypes'>): CommsLevel {
  if (!item) return 'liczba';
  const fixed = m.status === 'zakonczone' ? m.closedComms?.[item.id] : undefined;
  const base = fixed ?? commsCeiling(m, item, env).level;
  return item.comms?.level ? stricterComms(base, item.comms.level) : base;
}
/** Poziomy skuteczne wszystkich punktów (do zamknięcia: `closedComms`, i do karty dokumentów). */
export function commsLevels(m: Meeting, env: Pick<CascadeEnv, 'general' | 'docTypes'>): Record<string, CommsLevel> {
  return Object.fromEntries(m.agenda.map(i => [i.id, commsLevelOfItem(m, i, env)]));
}
/** Wartości do wyboru przy punkcie: nie bardziej otwarte niż poziom 1, a po zamknięciu niż poziom utrwalony (G-22). */
export function commsChoices(m: Meeting, item: AgendaItem, env: Pick<CascadeEnv, 'general' | 'docTypes'>): CommsLevel[] {
  const ceiling = m.status === 'zakonczone' ? (m.closedComms?.[item.id] ?? commsCeiling(m, item, env).level) : commsCeiling(m, item, env).level;
  return COMMS_LEVELS.slice(COMMS_LEVELS.indexOf(ceiling));
}
/** Linia źródła wiersza „W materiale dla komunikacji” (6.5 wiersz 15). */
export function commsSourceText(m: Meeting, item: AgendaItem, env: Pick<CascadeEnv, 'general' | 'docTypes'>): string {
  const c = commsCeiling(m, item, env);
  if (item.comms?.level && item.comms.level !== c.level) return `Zmienione dla tego punktu. Z rodzaju sprawy ${commsLevelLabel[c.level]}.`;
  if (c.source === 'rodzaj_sprawy') return `Wynika z rodzaju sprawy »${c.caseType!.name}«.`;
  if (c.source === 'rodzaj_dokumentu') return `Wynika z rodzaju sprawy »${c.caseType!.name}«, który przyjmuje wartość z rodzaju dokumentu »${c.docTypeName ?? c.caseType!.docType}«.`;
  if (c.source === 'aplikacja') return 'Ustalone w aplikacji. Sprawa bez rodzaju sprawy ma w materiale dla komunikacji tylko liczbę.';
  return 'Ustalone w aplikacji.';
}

const announced = (b: Ballot) => b.status === 'zamkniete' && !!b.announcedAt && !b.aborted && !!b.result;
const NOT_ACT = new Set<Ballot['purpose']>(['porzadek', 'zmiana_porzadku', 'protokol', 'tryb', 'reasumpcja', 'wniosek', 'proba']);
/** Tekst z danych w Markdown: znaki składni poprzedzone ukośnikiem, bez nowych wierszy (B1-32). */
const md = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/([\\`*_[\]<>|#])/g, '\\$1');
/** Wartość YAML jako napis JSON (zawsze poprawny YAML). */
const y = (v: unknown) => JSON.stringify(v);
const MONTH_ADJ = ['styczniowe', 'lutowe', 'marcowe', 'kwietniowe', 'majowe', 'czerwcowe', 'lipcowe', 'sierpniowe', 'wrześniowe', 'październikowe', 'listopadowe', 'grudniowe'];
/** Czas lokalny z przesunięciem strefy, np. 2026-11-20T15:00:00+01:00. */
function localIso(ts: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Warsaw', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'longOffset'}).formatToParts(ts).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${(p.timeZoneName ?? '').replace('GMT', '') || '+00:00'}`;
}
const htmlLines = (h: string) => h.replace(/<\/(p|h\d|li|tr)>/g, '\n').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
/** Biernik liczby aktów danego rodzaju: „1 uchwałę”, „3 uchwały”, „5 uchwał”. */
function actsAccusative(n: number, doc: string) {
  const forms: Record<string, [string, string, string]> = {
    uchwala: ['uchwałę', 'uchwały', 'uchwał'], stanowisko: ['stanowisko', 'stanowiska', 'stanowisk'], oswiadczenie: ['oświadczenie', 'oświadczenia', 'oświadczeń'],
    apel: ['apel', 'apele', 'apeli'], rezolucja: ['rezolucję', 'rezolucje', 'rezolucji'], deklaracja: ['deklarację', 'deklaracje', 'deklaracji'],
  };
  const f = forms[doc] ?? ['akt', 'akty', 'aktów'];
  return `${n} ${plural(n, f[0], f[1], f[2])}`;
}

export interface CommsOptions {
  /** Chwila wygenerowania (YAML `wygenerowano`). */
  at: number;
  /** Przyjęcie protokołu tego posiedzenia (z `protocolAdoptions`). */
  adoption?: Adoption | null;
  /** Następne posiedzenie organu w przygotowaniu; zdanie o nim tylko przy wpisanej dacie zawiadomienia (K4-32). */
  next?: Pick<Meeting, 'date' | 'noticeDate'> | null;
  /** Treść wersji materiału (przy poziomie „Pełna treść” cytat treści przyjętego aktu). */
  materialHtml?: (materialId: string, version: number) => string | null;
}

/**
 * Plik Markdown dla komunikacji (B1-32 z poprawkami 6.10). Rzuca błąd przed zamknięciem posiedzenia
 * („Materiał dla komunikacji powstaje po zamknięciu posiedzenia.”).
 */
export function commsMarkdown(m: Meeting, env: CascadeEnv, o: CommsOptions): string {
  if (m.status !== 'zakonczone') throw Object.assign(new Error('Materiał dla komunikacji powstaje po zamknięciu posiedzenia.'), {status: 409});
  const {roster} = env;
  const organ = organOf(roster, m.organ);
  const law = lawOf(m.organ);
  const name = organ?.name ?? 'Prezydium';
  // Krótka nazwa organu po pełnej nazwie w tytule: „Prezydium” z `Organ.forms` (nigdy skrót, JEZYK.md).
  const short = (organ?.forms?.member ?? 'członek Prezydium').replace(/^członek\s+/, '') || 'Prezydium';
  const membersWord = organ?.forms?.members ?? `członków ${short}`;
  const members = organRoster(roster, m);
  const memberIds = new Set(members.map(x => x.personId));
  const day = paperDay(m);
  const working = m.kind === 'posiedzenie' && !!m.working;
  const kindWord = m.kind === 'procedura' ? 'Głosowanie między posiedzeniami' : working ? 'Spotkanie robocze' : 'Posiedzenie';
  const present = members.filter(ms => m.presenceLog.some(e => e.who === ms.personId && !e.guest && e.type === 'przybycie'));
  const who = (id: string) => `${personName(roster, id)}${members.find(x => x.personId === id)?.label ? `, ${members.find(x => x.personId === id)!.label}` : ''}`;
  const levelOf = (it: AgendaItem | undefined) => commsLevelOfItem(m, it, env);
  const itemOf = (b: Ballot) => m.agenda.find(i => i.id === b.itemId);
  const types = m.frozen?.docTypes ?? env.docTypes;
  const itemBallot = (it: AgendaItem | undefined) => it ? m.ballots.find(x => x.itemId === it.id && !NOT_ACT.has(x.purpose)) : undefined;
  const docOf = (it: AgendaItem | undefined, b?: Ballot) => ((b ?? itemBallot(it)) ? ballotDocType(m, (b ?? itemBallot(it))!) : undefined) ?? it?.docType ?? (it?.caseType ? env.general.caseTypes.find(c => c.id === it.caseType)?.docType : undefined)
    ?? (it ? m.materials.find(x => it.materialIds.includes(x.id))?.type : undefined);
  const groupName = (it: AgendaItem | undefined, b?: Ballot) => {
    const ct = it?.caseType ? env.general.caseTypes.find(c => c.id === it.caseType) : undefined;
    if (ct) return ct.name;
    return docOf(it, b) === 'uchwala' ? 'Uchwały bez rodzaju sprawy' : 'Sprawy bez rodzaju sprawy';
  };
  const check: string[] = [];
  const acts = m.ballots.filter(b => announced(b) && !NOT_ACT.has(b.purpose) && !(b.supersededBy && m.ballots.some(x => x.id === b.supersededBy && announced(x))))
    .sort((a, b) => a.number - b.number);
  const adopted = acts.filter(b => b.result!.adopted);
  const hiddenActs = adopted.filter(b => levelOf(itemOf(b)) === 'pomin');
  const anyHidden = acts.some(b => levelOf(itemOf(b)) === 'pomin');
  const counts = new Map<string, number>();
  for (const b of adopted) { const d = ballotDocType(m, b) ?? 'inny'; counts.set(d, (counts.get(d) ?? 0) + 1); }
  const out: string[] = [];
  const photos = m.photos?.url ?? '';
  out.push('---', `dokument: ${y('Materiał dla komunikacji')}`, `stan: ${y(o.adoption ? `protokół przyjęty ${isoDayOf(o.adoption.at)}` : working ? 'notatka ze spotkania roboczego' : 'przed przyjęciem protokołu')}`,
    `wygenerowano: ${y(localIso(o.at))}`, `organ: ${y(name)}`, `rodzaj: ${y(kindWord.toLowerCase())}`, `data: ${y(day)}`, `data_slownie: ${y(longDate(day))}`,
    `miesiac_przymiotnik: ${y(MONTH_ADJ[Number(day.slice(5, 7)) - 1])}`, `godziny: ${y(m.openedAt ? `${timeOf(m.openedAt)}–${m.closedAt ? timeOf(m.closedAt) : ''}` : '')}`,
    `tryb: ${y(m.mode)}`, `miejsce: ${y(m.mode === 'zdalne' ? 'posiedzenie zdalne' : m.place)}`, `numer_protokolu: ${y(m.protocolNumber ?? '')}`,
    `sklad: ${members.length}`, `obecni_czlonkowie: ${present.length}`, `wymagane_kworum: ${quorumOf(law, members.length)}`,
    `podjete_akty: ${y([...counts].map(([d, n]) => `${types.find(x => x.id === d)?.name ?? d} ${n}`).join(', '))}`,
    `zdjecia: ${y(photos)}`, `zrodlo: ${y('Zapis posiedzenia w aplikacji. Bez ocen i bez cytatów.')}`, '---', '');
  out.push(`# ${kindWord} ${md(name)} z dnia ${longDate(day)}`, '');
  const adoptionText = o.adoption ? `${longDate(isoDayOf(o.adoption.at))} ${o.adoption.kind === 'procedura' ? 'w głosowaniu między posiedzeniami' : 'na posiedzeniu'} z dnia ${longDate(o.adoption.date)}, w głosowaniu nr ${o.adoption.ballotNumber}` : '';
  out.push(`Materiał przygotowany automatycznie z zapisu posiedzenia. ${working ? 'Ze spotkania roboczego sporządza się notatkę zamiast protokołu.' : o.adoption ? `Protokół przyjęto ${adoptionText}.` : 'Protokół nie został jeszcze przyjęty.'}`, '');

  // Najważniejsze w trzech zdaniach (reguła wyboru, nie ocena ważności).
  const verb = organVerb(organ ?? {forms: {gender: 'n'}} as never, {m: 'podjął', f: 'podjęła', n: 'podjęło'});
  const titled = adopted.filter(b => ['pelna', 'tytul'].includes(levelOf(itemOf(b))))
    .sort((a, b) => (levelOf(itemOf(a)) === 'pelna' ? 0 : 1) - (levelOf(itemOf(b)) === 'pelna' ? 0 : 1) || a.number - b.number);
  const s1 = m.kind === 'procedura'
    ? `Głosowanie między posiedzeniami ${name} zakończyło się ${longDate(m.closedAt ? isoDayOf(m.closedAt) : day)}.`
    : `${kindWord} ${name} odbyło się ${longDate(day)} w trybie ${m.mode === 'zdalne' ? 'zdalnym' : 'stacjonarnym'}, obecnych było ${present.length} z ${members.length} członków.`;
  const hiddenNote = hiddenActs.length ? `, w tym ${hiddenActs.length} w sprawach, których ten materiał nie opisuje` : '';
  const s2 = working ? `Bez kworum ${short} nie ${organVerb(organ ?? {forms: {gender: 'n'}} as never, {m: 'podejmował', f: 'podejmowała', n: 'podejmowało'})} uchwał, a obrady trwały jako spotkanie robocze.`
    : adopted.length ? `${short} ${verb} ${[...counts].map(([d, n]) => actsAccusative(n, d)).join(' i ')}${titled.length ? ` (${titled.slice(0, 3).map(b => md(b.material?.title ?? b.subject)).join('; ')})` : ''}${hiddenNote}.`
    : `${short} nie ${verb} uchwał ani innych aktów.`;
  const left = m.agenda.filter(i => i.status === 'oczekuje' && i.kind !== 'zamkniecie');
  const deferred = m.agenda.filter(i => i.status === 'odroczony' || i.status === 'wycofany');
  const s3 = m.kind === 'procedura' ? `Głosowań ${acts.length}.`
    : left.length ? `Nie rozpatrzono ${left.length} ${plural(left.length, 'punktu', 'punktów', 'punktów')} porządku obrad${deferred.length ? `, a ${deferred.length} ${plural(deferred.length, 'punkt odroczono albo wycofano', 'punkty odroczono albo wycofano', 'punktów odroczono albo wycofano')}` : ''}.`
    : deferred.length ? `${deferred.length} ${plural(deferred.length, 'punkt odroczono albo wycofano', 'punkty odroczono albo wycofano', 'punktów odroczono albo wycofano')}.` : 'Rozpatrzono wszystkie punkty porządku obrad.';
  out.push('## Najważniejsze w trzech zdaniach', '', `1. ${md(s1)}`, `2. ${s2}`, `3. ${md(s3)}`, '');
  if (m.commsNote?.text.trim()) out.push('## Opis posiedzenia', '', md(m.commsNote.text), '', `Opis wpisano ${longDate(isoDayOf(m.commsNote.at))}`, '');
  else check.push('Nie wpisano opisu posiedzenia.');

  // Prowadzenie i uczestnicy: funkcje w organie i głos doradczy; goście tylko liczbą.
  out.push('## Prowadzenie i uczestnicy', '');
  const opening = m.chair.changes[0];
  if (opening) out.push(`- ${m.kind === 'procedura' ? 'Głosowaniem zarządza' : working ? 'Spotkanie otwiera' : 'Posiedzenie otwiera'} ${md(who(opening.to))}.`);
  const others = [...new Set(m.chair.changes.slice(1).map(c => c.to))].filter(id => id !== opening?.to);
  if (others.length) out.push(`- Obrady prowadziły także inne osoby, czyli ${others.map(id => md(who(id))).join('; ')}.`);
  if (m.kind === 'posiedzenie') out.push(`- Obecnych ${membersWord} ${present.length} z ${members.length}, wymagane kworum ${quorumOf(law, members.length)} (${law.quorum.basis}).`);
  const accounts = env.accounts ?? [];
  const invited = m.invited.map(id => accounts.find(a => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a);
  const came = (id: string) => m.presenceLog.some(e => e.who === id && e.guest && e.type === 'przybycie');
  const advisory = invited.filter(a => a.kind === 'doradczy' && came(a.id));
  const guests = invited.filter(a => a.kind === 'gosc' && came(a.id));
  if (advisory.length) out.push(`- Z głosem doradczym ${advisory.map(a => md(`${a.displayName}${a.label ? `, ${a.label}` : ''}`)).join('; ')}.`);
  if (guests.length) { out.push(`- Goście na zaproszenie ${guests.length}.`); check.push('Materiał nie podaje imion i nazwisk gości. Jeśli wizyta ma trafić do relacji, ustal to z biurem.'); }
  out.push('');

  // Porządek obrad: punkty porządkowe z tytułami, sprawy według poziomu, sprawy bez rodzaju sprawy tylko liczbą (K4-1).
  const advisoryPersons = new Set(accounts.filter(a => a.kind === 'doradczy' && a.personId).map(a => a.personId!));
  const people = (it: AgendaItem) => it.presenters.filter(x => x.kind === 'referuje' && x.personId && (memberIds.has(x.personId) || advisoryPersons.has(x.personId)))
    .map(x => `${personName(roster, x.personId!) || x.name}${x.role ? `, ${x.role}` : ''}`);
  const stateWord = (it: AgendaItem) => it.status === 'odroczony' ? 'odroczono' : it.status === 'wycofany' ? 'wycofano' : it.status === 'oczekuje' ? (it.kind === 'zamkniecie' ? 'zamknięto' : 'nie rozpatrzono') : 'rozpatrzono';
  const shownLine = (it: AgendaItem, lvl: CommsLevel) => {
    const shown = shownInItem(m, it.id);
    if (!shown.length) return null;
    return lvl === 'pelna' ? `Pokazano ${shown.length === 1 ? 'plik' : 'pliki'} ${shown.map(d => `„${md(d.title)}”`).join(', ')}.` : `Pokazano ${shown.length} ${plural(shown.length, 'plik', 'pliki', 'plików')}.`;
  };
  const sentenceOf = (it: AgendaItem | undefined) => it?.comms?.sentence?.trim() || '';
  let noCase = 0, hiddenItems = 0;
  if (m.kind === 'posiedzenie') {
    out.push('## Porządek obrad', '');
    let n = 0;
    const groupLines = (subs: AgendaItem[], indent: string) => {
      const groups = new Map<string, AgendaItem[]>();
      const lines: string[] = [];
      for (const s of subs) {
        const lvl = levelOf(s);
        if (!s.caseType && !(orderingKinds(m.organ).has(s.kind) && !s.parentId)) noCase++;
        if (lvl === 'pomin') { hiddenItems++; continue; }
        if (lvl === 'liczba') { const g = groupName(s); groups.set(g, [...(groups.get(g) ?? []), s]); continue; }
        lines.push(`${indent}- ${md(s.title)} (${stateWord(s)})`);
        const ppl = people(s);
        if (ppl.length) lines.push(`${indent}  - Według porządku obrad referuje ${ppl.map(md).join('; ')}.`);
        const sh = shownLine(s, lvl);
        if (sh) lines.push(`${indent}  - ${sh}`);
        if (sentenceOf(s)) lines.push(`${indent}  - Zdanie dla komunikacji ${md(sentenceOf(s))}`);
      }
      for (const [g, list] of groups) {
        lines.push(`${indent}- ${md(g)}, ${list.length} (${[...new Set(list.map(stateWord))].join(', ')})`);
        const shownCount = list.reduce((k, s) => k + shownInItem(m, s.id).length, 0);
        if (shownCount) lines.push(`${indent}  - Pokazano ${shownCount} ${plural(shownCount, 'plik', 'pliki', 'plików')}.`);
      }
      return lines;
    };
    for (const top of m.agenda.filter(i => !i.parentId)) {
      const lvl = levelOf(top);
      const subs = m.agenda.filter(i => i.parentId === top.id);
      if (lvl === 'pomin') { hiddenItems++; hiddenItems += subs.length; continue; }
      n++;
      if (lvl === 'liczba') {
        if (!top.caseType) noCase++;
        out.push(`${n}. ${md(groupName(top))}, 1 (${stateWord(top)})`);
      } else {
        out.push(`${n}. ${md(top.title.replace(/:$/, ''))} (${stateWord(top)})`);
        const ppl = orderingKinds(m.organ).has(top.kind) ? [] : people(top);
        if (ppl.length) out.push(`   - Według porządku obrad referuje ${ppl.map(md).join('; ')}.`);
        const sh = shownLine(top, lvl);
        if (sh) out.push(`   - ${sh}`);
        if (sentenceOf(top) && !orderingKinds(m.organ).has(top.kind)) out.push(`   - Zdanie dla komunikacji ${md(sentenceOf(top))}`);
      }
      out.push(...groupLines(subs, '   '));
    }
    if (hiddenItems) out.push(`- Sprawy, których ten materiał nie opisuje, ${hiddenItems}`);
    out.push('');
  } else {
    for (const it of m.agenda) { if (!it.caseType) noCase++; if (levelOf(it) === 'pomin') hiddenItems++; }
  }

  // Podjęte akty według poziomów; „Nie trafia” tylko w sumach (K4-6), a przy nich grupy „Tylko liczba” bez numerów.
  out.push('## Podjęte akty', '');
  if (!acts.length) out.push('W tym posiedzeniu nie głosowano nad aktami.', '');
  const resultText = (b: Ballot) => `${resultLabel(b, materialTypeOf(m, b))}${b.mode === 'tajne' ? ' w głosowaniu tajnym' : b.mode === 'imienne' ? ' w głosowaniu imiennym' : ''}. Za ${b.result!.za}, przeciw ${b.result!.przeciw}, wstrzymało się ${b.result!.wstrzymuje}.`;
  const grouped = new Map<string, Ballot[]>();
  for (const b of acts) {
    const it = itemOf(b), lvl = levelOf(it);
    if (lvl === 'pomin') continue;
    if (lvl === 'liczba') { const g = groupName(it, b); grouped.set(g, [...(grouped.get(g) ?? []), b]); continue; }
    out.push(`### ${md(b.material?.title ?? b.subject)}`, '', md(resultText(b)), '');
    if (sentenceOf(it)) out.push(`Zdanie dla komunikacji ${md(sentenceOf(it))}`, '');
    else check.push(`${b.material?.title ?? b.subject} nie ma zdania dla komunikacji. Wyjaśnienie, czego dotyczy, ustal z biurem albo z osobą referującą.`);
    if (lvl === 'pelna' && b.material) {
      const lines = htmlLines(o.materialHtml?.(b.material.id, b.material.version) ?? '');
      if (lines.length) out.push('Treść przyjęta w głosowaniu', '', ...lines.map(l => `> ${md(l)}`), '');
    }
  }
  for (const [g, list] of grouped) {
    const ok = list.filter(b => b.result!.adopted), no = list.filter(b => !b.result!.adopted);
    const d = ballotDocType(m, list[0]) ?? 'inny';
    const nums = anyHidden ? [] : ok.map(b => actNumber(m, b)).filter(Boolean);
    out.push(`### ${md(g)}`, '', `Podjęto ${actsAccusative(ok.length, d)}${nums.length ? `, ${nums.length === 1 ? 'nr' : 'numery'} ${nums.map(md).join(', ')}` : ''}.${no.length ? ` Nie podjęto ${actsAccusative(no.length, d)}.` : ''}`, '');
    for (const b of list) {
      const sentence = sentenceOf(itemOf(b));
      if (!sentence) continue;
      const number = anyHidden ? '' : actNumber(m, b);
      out.push(number ? `${md(`${types.find(x => x.id === d)?.name ?? 'Akt'} nr ${number}`)}. ${md(sentence)}` : md(sentence), '');
    }
  }
  if (acts.some(b => b.mode === 'tajne')) check.push('W głosowaniach tajnych materiał podaje tylko wynik.');
  if (noCase) check.push('Sprawy bez rodzaju sprawy mają w materiale tylko liczbę. Ustaw rodzaj sprawy albo dopisz zdanie dla komunikacji, a materiał się zaktualizuje.');

  // Liczby: z aktami „Nie trafia” (K4-6).
  const votes = m.ballots.filter(b => b.purpose !== 'proba' && announced(b)).length;
  out.push('## Liczby', '', `- Głosowań ${votes}, w tym nad aktami ${acts.length}.`, `- Podjętych aktów ${adopted.length}.`);
  if (m.kind === 'posiedzenie') out.push(`- Punktów porządku obrad ${m.agenda.filter(i => !i.parentId).length}, podpunktów ${m.agenda.filter(i => i.parentId).length}.`);
  out.push('');

  // Terminy: termin protokołu albo przyjęcie; następne posiedzenie tylko po wpisaniu daty zawiadomienia (K4-32).
  out.push('## Terminy', '');
  if (working) out.push('- Ze spotkania roboczego sporządza się notatkę.');
  else if (o.adoption) out.push(`- Protokół przyjęto ${adoptionText}.`);
  else if (m.closedAt) {
    const [yy, mo, dd] = isoDayOf(m.closedAt).split('-').map(Number);
    const deadline = new Date(Date.UTC(yy, mo - 1, dd + law.minutes.deadlineDays)).toISOString().slice(0, 10);
    out.push(`- Protokół sporządza się do ${longDate(deadline)} (${law.minutes.deadlineDays} dni od zakończenia obrad, ${law.minutes.deadlineBasis}). Przyjmuje go następne posiedzenie ${short} (${law.minutes.adoptionBasis}).`);
  }
  if (o.next?.noticeDate && o.next.date) out.push(`- Następne posiedzenie ${short} jest w przygotowaniu na ${longDate(o.next.date)} Termin może się zmienić.`);
  out.push('');
  out.push('## Zdjęcia', '', photos ? `- Album ze zdjęciami ${photos}` : '- Odnośnika do zdjęć jeszcze nie wpisano.', '');
  if (photos) check.push('Odnośnik do albumu otwiera album każdemu, kto go zna.');
  else check.push('Brak odnośnika do zdjęć.');
  if (!o.adoption && !working) check.push(`Protokół nie został jeszcze przyjęty. Przyjmie go następne posiedzenie (${law.minutes.adoptionBasis}). Fakty pochodzą z zapisu aplikacji.`);
  check.push('Funkcje osób pochodzą ze składu w aplikacji. Przed publikacją sprawdź je na stronie internetowej.');
  check.push(`Osoby przy punktach pochodzą z porządku obrad. Materiał wymienia tylko ${membersWord} i osoby z głosem doradczym.`);
  out.push('## Do sprawdzenia przed publikacją', '', ...check.map(c => `- ${md(c)}`), '');
  return out.join('\n');
}

/**
 * Chwila ostatniej zmiany materiału (B1-36): zamknięcie, zmiana poziomu albo zdania przy punkcie, opis, odnośnik do zdjęć,
 * przyjęcie protokołu.
 */
export function commsChangedAt(m: Meeting, adoption: Adoption | null): number {
  const times = [m.closedAt ?? 0, m.photos?.at ?? 0, m.commsNote?.at ?? 0, adoption?.at ?? 0, ...m.agenda.map(i => i.comms?.stamp.at ?? 0)];
  return Math.max(...times);
}
/** Stan udostępnienia materiału kontu „Komunikacja” (DB-42, `ArchiveInfo.commsRelease`). */
export function commsRelease(m: Meeting): 'brak' | 'udostepniony' | 'zmieniony' {
  if (!m.commsReleased) return 'brak';
  return commsReleasedOk(m) ? 'udostepniony' : 'zmieniony';
}
