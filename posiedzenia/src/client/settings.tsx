import type {ComponentChildren} from 'preact';
import {useState} from 'preact/hooks';
import {APP_RULES, HOUSE_RULES, agendaBasis, houseRule, lawOf, shareText, type AppRuleId, type HouseRuleId} from '../shared/law.ts';
import {itemKindLabel} from '../shared/agenda.ts';
import {sortedDocTypes} from '../shared/doctypes.ts';
import {quorumOf} from '../shared/rules.ts';
import {organMembers, organOfCode} from '../shared/roster.ts';
import {settingsAccess} from '../shared/role.ts';
import {compositionBasisText, FUNCS, funcLabel, MOTION_MINUTES, organSettingsOf, PROCEDURE_HOURS, VOTE_MINUTES,
  type CompositionChange, type GeneralBundle, type MeetingTemplate, type SettingsChange, type TemplateItem} from '../shared/settings.ts';
import {dateDots, hoursText, minutesText, plural} from '../shared/text.ts';
import type {CompositionBasis, Effective, Func, ItemKind, MeetingMode, OrganCode} from '../shared/types.ts';
import {request} from './api.ts';
import {brand} from './brand.ts';
import {setGeneral, useGeneral} from './general.ts';
import {useSession} from './session.ts';
import {Button, CardTitle, Confirm, ErrorNotice, Fact, Field, Fold, Modal, Notice, SectionHead, Segments, Tag, useAction, useMedia} from './ui.tsx';
import {appRuleWhy, basisReason, BasisFields, dateHintText, HistoryFold, HistoryTable, MinutesRowEditor, OrganFact, RowEditor, SettingRow, SettingsList, sourceLineText, TextRowEditor, type EditorCtl} from './cascade-ui.tsx';
import {AccountsPanel} from './accounts.tsx';
import {KindsSection} from './rodzaje.tsx';
import {DocTypeSelect, usePeople} from './people.tsx';

// Ustawienia ogólne (wersja 3, poziom 1 kaskady; specyfikacja rozdz. 5.2): dziewięć sekcji w czterech grupach.
// Biuro zmienia ustawienia, przewodniczący i wiceprzewodniczący je oglądają, administrator zarządza kontami.
// Wartości z regulaminu stoją z paragrafem, bez pól do zmiany. Każda zmiana trafia do historii zmian.
// Nazwy sekcji i grup nie zawierają słowa „Izba”, bo te same pliki budują wersję próbną.

export type SectionId = 'siedziba' | 'regulamin' | 'sklad' | 'konta' | 'wzory' | 'rodzaje' | 'glosowanie' | 'protokol' | 'historia';
interface SectionInfo { id: SectionId; name: string; desc: string }
const groups: {name: string; sections: SectionInfo[]}[] = [
  {name: 'Podstawy', sections: [
    {id: 'siedziba', name: 'Siedziba i kadencja', desc: 'Domyślne miejsce posiedzeń i kadencja.'},
    {id: 'regulamin', name: 'Regulamin i zasady', desc: 'Zasady z regulaminu, np. kworum, większość i terminy, oraz zasady przyjęte dla aplikacji.'},
    {id: 'sklad', name: 'Skład', desc: 'Członkowie, funkcje i liczba miejsc z podstawą każdej zmiany. Od składu zależy kworum.'},
  ]},
  {name: 'Ludzie i dostęp', sections: [
    {id: 'konta', name: 'Konta i role', desc: 'Imienne konta, hasła tymczasowe i rola administratora.'},
  ]},
  {name: 'Posiedzenia', sections: [
    {id: 'wzory', name: 'Wzory posiedzeń', desc: 'Punkty porządku obrad i ustawienia, od których zaczyna się nowe posiedzenie.'},
    {id: 'rodzaje', name: 'Rodzaje spraw i dokumentów', desc: 'Co jest głosowane, formuły wyniku i sprawy, które aplikacja rozpoznaje w projekcie porządku obrad.'},
    {id: 'glosowanie', name: 'Głosowanie i obrady', desc: 'Domyślne czasy głosowań i czas głosowania między posiedzeniami.'},
    {id: 'protokol', name: 'Protokół i zawiadomienie', desc: 'Protokolant, wykaz aktów i terminy.'},
  ]},
  {name: 'Ślad', sections: [
    {id: 'historia', name: 'Historia zmian', desc: 'Wszystkie zmiany ustawień z datą, godziną i kontem.'},
  ]},
];
const allSections = groups.flatMap(g => g.sections);
export const isSectionId = (id: string): id is SectionId => allSections.some(s => s.id === id);
export const sectionName = (id: SectionId) => allSections.find(s => s.id === id)!.name;

/** Sekcje, które widzi konto (rozdz. 5.2): administrator bez roli biura tylko regulamin, konta i historię. */
export function visibleSections(access: ReturnType<typeof settingsAccess>): SectionId[] {
  if (access.general) return allSections.map(s => s.id).filter(id => id !== 'konta' || access.accounts);
  return access.accounts ? ['regulamin', 'konta', 'historia'] : [];
}

const ORGAN: OrganCode = 'prezydium';
const law = lawOf(ORGAN);

/** Zmiana ustawień ogólnych przez biuro; nowy pakiet trafia do sesji (general.ts). */
async function saveSetting(change: SettingsChange) {
  const r = await request<{general: GeneralBundle}>('/api/settings', {body: {change}});
  setGeneral(r.general);
  return r;
}
const lowerFirst = (t: string) => t.charAt(0).toLocaleLowerCase('pl') + t.slice(1);
const prawo = (basis: string): Effective<unknown> => ({value: null, source: 'prawo', level: 0, basis});
const zasada = (rule: HouseRuleId): Effective<unknown> => ({value: null, source: 'zasada', level: 0, rule});
const aplikacja = (rule: AppRuleId): Effective<unknown> => ({value: null, source: 'aplikacja', level: 0, appRule: rule});
const general = (value: unknown): Effective<unknown> => ({value, source: 'ogolne', level: 1});
/** Linia źródła z dwóch warstw: „Ustalone regulaminem, § 9 ust. 1; zasada przyjęta przez Izbę 20.11.2026.” */
const both = (basis: string, rule: HouseRuleId) => `${sourceLineText(prawo(basis), 'ogolne').replace(/\.$/, '')}; ${lowerFirst(sourceLineText(zasada(rule), 'ogolne'))}`;
const lawWhy = 'Tę wartość ustala regulamin, a nie aplikacja. Zmienić ją może tylko zmiana regulaminu.';

export function SettingsPage(props: {section: SectionId | null}) {
  const s = useSession();
  const bundle = useGeneral();
  const actor = {account: s.account, personId: s.personId, name: s.name};
  const access = settingsAccess(s.roster, actor);
  const sections = visibleSections(access);
  const wide = useMedia('(min-width: 961px)', true);
  const current = props.section && sections.includes(props.section) ? props.section : null;
  const shown = current ?? (wide ? sections[0] : null);
  const reader = access.general === 'czyta';
  return <>
    <header class="oi-hero page-head page-head--niski">
      <div class="page page--kolumna oi-hero__in">
        <Tag>Ustawienia</Tag>
        <h1>Ustawienia <b>ogólne</b></h1>
        {(wide || !current) && <p class="oi-hero__lead">{`Tu ${brand.officeLower} ustala, jak aplikacja przygotowuje posiedzenia. Każde nowe posiedzenie zaczyna od tych ustawień i od wybranego wzoru posiedzenia, a w przygotowaniu można je zmienić dla jednego posiedzenia. Wartości ustalone regulaminem są widoczne, ale nie można ich zmienić.`}</p>}
      </div>
    </header>
    <div class="page page--kolumna settings-page">
      {reader && <Notice>Ustawienia zmienia biuro. Ten widok pokazuje, od czego zaczyna się każde posiedzenie.</Notice>}
      {/* Sekcja stoi w tym samym miejscu drzewa na komputerze i na telefonie, więc przy zmianie szerokości okna
          (np. przez próg 961 px) nie montuje się od nowa, a rozwinięte wyjaśnienia zostają rozwinięte (W-W-18). */}
      <div class={wide ? 'settings-layout' : 'settings-narrow'}>
        {wide ? <SectionNav sections={sections} current={shown}/> : null}
        {shown
          ? <div class="settings-content">{!wide && <a class="oi-link settings-back" href="#ustawienia">Wszystkie ustawienia</a>}<Section id={shown} bundle={bundle} canEdit={access.general === 'zmienia'}/></div>
          : <SectionCards sections={sections}/>}
      </div>
    </div>
  </>;
}

function SectionNav(props: {sections: SectionId[]; current: SectionId | null}) {
  return <nav class="settings-nav" aria-label="Sekcje ustawień">
    {groups.map(g => {
      const list = g.sections.filter(x => props.sections.includes(x.id));
      if (!list.length) return null;
      return <div class="settings-nav__group" key={g.name}>
        <span class="kicker">{g.name}</span>
        <ul>{list.map(x => <li key={x.id}><a href={`#ustawienia-${x.id}`} aria-current={props.current === x.id ? 'page' : undefined}>{x.name}</a></li>)}</ul>
      </div>;
    })}
  </nav>;
}

function SectionCards(props: {sections: SectionId[]}) {
  return <div class="settings-cards">{groups.map(g => {
    const list = g.sections.filter(x => props.sections.includes(x.id));
    if (!list.length) return null;
    return <section key={g.name} class="settings-group">
      <SectionHead>{g.name}</SectionHead>
      <ul class="cards">{list.map(x => <li key={x.id}><a class="oi-card oi-card--aktywna settings-card" href={`#ustawienia-${x.id}`}>
        <h3 class="oi-card__title"><span class="oi-mark" aria-hidden="true"/><span>{x.name}</span></h3>
        <span class="oi-card__meta">{x.desc}</span>
      </a></li>)}</ul>
    </section>;
  })}</div>;
}

function Section(props: {id: SectionId; bundle: GeneralBundle | null; canEdit: boolean}) {
  const info = allSections.find(x => x.id === props.id)!;
  const needsBundle = props.id !== 'regulamin' && props.id !== 'konta' && props.id !== 'historia';
  let body: ComponentChildren;
  if (needsBundle && !props.bundle) body = <p class="muted">Wczytywanie…</p>;
  else switch (props.id) {
    case 'siedziba': body = <SiteSection bundle={props.bundle!} canEdit={props.canEdit}/>; break;
    case 'regulamin': body = <RulesSection bundle={props.bundle}/>; break;
    case 'sklad': body = <CompositionSection bundle={props.bundle!} canEdit={props.canEdit}/>; break;
    case 'konta': body = <AccountsPanel/>; break;
    case 'wzory': body = <TemplatesSection bundle={props.bundle!} canEdit={props.canEdit}/>; break;
    case 'rodzaje': body = <><OrganFact organ={ORGAN}/><KindsSection bundle={props.bundle!} canEdit={props.canEdit}/></>; break;
    case 'glosowanie': body = <VotingSection bundle={props.bundle!} canEdit={props.canEdit}/>; break;
    case 'protokol': body = <MinutesSection bundle={props.bundle!} canEdit={props.canEdit}/>; break;
    case 'historia': body = <HistoryTable label="Historia zmian" version={props.bundle?.revision}/>; break;
  }
  return <section class="settings-section" aria-labelledby={`sekcja-${info.id}`}>
    <div class="oi-section-head"><span class="oi-mark" aria-hidden="true"/><h2 id={`sekcja-${info.id}`}>{info.name}</h2></div>
    <p class="settings-lead">{info.desc}</p>
    {body}
  </section>;
}

function SiteSection(props: {bundle: GeneralBundle; canEdit: boolean}) {
  const {roster} = useSession();
  const site = props.bundle.general.site;
  const organ = organOfCode(roster, ORGAN);
  return <>
    <SettingsList label="Siedziba i kadencja">
      <SettingRow label="Domyślne miejsce posiedzeń" value={site.place || 'Nie wpisano'} effective={general(site.place)} at="ogolne" genitive="domyślnego miejsca posiedzeń"
        hint="Proponowane jako miejsce każdego nowego posiedzenia stacjonarnego."
        editor={props.canEdit ? (close, ctl) => <TextRowEditor close={close} ctl={ctl} label="Domyślne miejsce posiedzeń" initial={site.place} max={200} required
          onSave={value => saveSetting({area: 'siedziba', key: 'place', value})}/> : undefined}/>
      <SettingRow label="Kadencja" value={`${site.term}, numer ${site.termNumber}`} effective={general(site.term)} at="ogolne" genitive="kadencji"
        action="Zmień kadencję" actionLabel="Zmień kadencję" hint={`Kadencja trwa 4 lata (§ 2 ust. 2 ${organ.forms.regulation}).`}
        editor={props.canEdit ? (close, ctl) => <TermEditor close={close} ctl={ctl} term={site.term} number={site.termNumber}/> : undefined}/>
    </SettingsList>
    <HistoryFold area="siedziba" version={props.bundle.revision}/>
  </>;
}

// Blok „Zmień kadencję”: nazwa i numer kadencji jednym zapisem (w historii po jednym wpisie na zmienione pole).
function TermEditor(props: {close: (s?: string) => void; ctl: EditorCtl; term: string; number: string}) {
  const [term, setTerm] = useState(props.term);
  const [number, setNumber] = useState(props.number);
  const t = term.replace(/\s+/g, ' ').trim(), n = number.replace(/\s+/g, ' ').trim();
  return <RowEditor close={props.close} ctl={props.ctl} dirty={t !== props.term || n !== props.number}
    reason={!t ? 'Wpisz nazwę kadencji.' : !n ? 'Wpisz numer kadencji.' : undefined}
    onSave={async () => {
      if (t !== props.term) await saveSetting({area: 'siedziba', key: 'term', value: t});
      if (n !== props.number) await saveSetting({area: 'siedziba', key: 'termNumber', value: n});
    }}>
    <div class="row">
      <Field label="Nazwa kadencji" hint="Np. IX kadencja 2024–2028."><input value={term} maxLength={200} onInput={e => setTerm((e.target as HTMLInputElement).value)}/></Field>
      <Field label="Numer kadencji" hint="Np. IX."><input value={number} maxLength={10} onInput={e => setNumber((e.target as HTMLInputElement).value)}/></Field>
    </div>
  </RowEditor>;
}

function RulesSection(props: {bundle: GeneralBundle | null}) {
  const {roster} = useSession();
  const organ = organOfCode(roster, ORGAN), rada = organOfCode(roster, 'rada');
  const people = usePeople();
  const total = organMembers(roster, ORGAN).length;
  const required = quorumOf(law, total);
  const seats = props.bundle ? organSettingsOf(props.bundle.general, ORGAN).seats?.count ?? null : null;
  const advisory = people.filter(a => a.kind === 'doradczy');
  const act = organ.forms.regulationAct;
  // Nazwa aktu w mianowniku z nazwy w dopełniaczu („Regulaminu Okręgowej Rady …” daje „Regulamin Okręgowej Rady …”).
  const regulationName = organ.forms.regulation.replace(/^Regulaminu\b/, 'Regulamin');
  const rule = (id: HouseRuleId) => houseRule(id).text;
  const houseTitle = `Zasady przyjęte${brand.houseBy ? ` ${brand.houseBy}` : ''}`;
  return <>
    <dl class="facts settings-facts">
      <Fact label="Organ">{organ.name}</Fact>
      <Fact label="W aplikacji">Tak</Fact>
      <Fact label="Regulamin">{regulationName}{act && <span class="fact-note">{act.charAt(0).toLocaleUpperCase('pl') + act.slice(1)}</span>}{law.appliedVia && <span class="fact-note">{`Do Prezydium stosowany przez ${law.appliedVia}.`}</span>}</Fact>
    </dl>
    <SettingsList label="Regulamin i zasady">
      <SettingRow label="Wymagane kworum" state="regulamin" at="ogolne" effective={prawo(law.quorum.basis)}
        value={<>{`Co najmniej połowa członków, dziś ${required} z ${total}.`}{seats && seats !== total ? ` Liczba miejsc ustalona uchwałą ${seats}. Kworum liczy się z aktualnego składu.` : ''}</>}
        why={`${organ.name} podejmuje uchwały przy obecności co najmniej połowy członków. Ten próg ustala regulamin, a nie aplikacja.`}/>
      <SettingRow label="Kto stwierdza kworum" state="zasada" at="ogolne" effective={zasada('K18')} value="Osoba prowadząca obrady na podstawie listy obecności" why={rule('K18')}/>
      <SettingRow label="Większość" state="regulamin" at="ogolne" effective={prawo(law.majority.basis)}
        why={`${organ.name} podejmuje uchwały zwykłą większością głosów (${law.majority.basis}). Ten próg ustala regulamin, a nie aplikacja.`}
        value="Zwykła większość głosów. Uchwała jest podjęta, gdy głosów „za” jest więcej niż „przeciw”."/>
      <SettingRow label="Tryb głosowania" state="regulamin" at="ogolne" effective={prawo(law.modes.basis)}
        why={`Głosowanie jest jawne (§ 11 ust. 1). Tajność albo głosowanie imienne uchwala ${organ.name} w danej sprawie (§ 11 ust. 2), a nie ustawienie w aplikacji.`}
        value="Jawne. Tajność albo głosowanie imienne uchwala Prezydium."/>
      <SettingRow label="Głosowanie elektroniczne" state="regulamin" at="ogolne" effective={prawo(law.modes.electronicBasis)} why={lawWhy}
        value="Dopuszczalne, także tajne i imienne, z zachowaniem charakteru głosowania"/>
      <SettingRow label="Reasumpcja" state="regulamin" at="ogolne" effective={prawo('§ 12 ust. 1–5')}
        why={`O reasumpcji rozstrzyga ${organ.name} na pisemny wniosek co najmniej ${shareText(law.reasumption.share)} członków biorących udział w posiedzeniu (§ 12 ust. 5). Wniosek zgłasza się wyłącznie na posiedzeniu, na którym odbyło się głosowanie (§ 12 ust. 2). Te warunki ustala regulamin, a nie aplikacja.`}
        value={`Gdy wynik głosowania budzi uzasadnione wątpliwości. Tylko głosowanie jawne, tylko na tym samym posiedzeniu, jeden raz, na pisemny wniosek co najmniej ${shareText(law.reasumption.share)} członków biorących udział w posiedzeniu`}/>
      <SettingRow label="Zwołuje" state="regulamin" at="ogolne" why={lawWhy}
        source={`${sourceLineText(prawo('§ 14 ust. 3 i § 16 ust. 2'), 'ogolne')} Zakres zastępstwa ustala ${rada.name} (§ 16 ust. 1).`}
        value={`${organ.forms.chairman}. W zastępstwie wiceprzewodniczący, którego przewodniczący wyznaczył.`}/>
      <SettingRow label="Zawiadomienie" state="regulamin" at="ogolne" effective={prawo(law.notice.basis)}
        why={`Zwołujący przesyła zawiadomienie o terminie, miejscu i porządku obrad co najmniej ${law.notice.minDays} dni przed posiedzeniem (${law.notice.basis}). Krótszy termin trafia do protokołu, ale nie może być ustawieniem.`}
        value={`Termin, miejsce i porządek obrad co najmniej ${law.notice.minDays} dni przed posiedzeniem`}/>
      <SettingRow label="Głos doradczy" state="regulamin" at="ogolne" effective={prawo(law.advisory.basis)} why={lawWhy}
        value="Przewodniczący Okręgowej Komisji Rewizyjnej, przewodniczący Okręgowego Sądu Pielęgniarek i Położnych, Okręgowy Rzecznik Odpowiedzialności Zawodowej"
        extra={advisory.length > 0 && <ul class="setting-list">{advisory.map(a => <li key={a.id}>{a.displayName}{a.label ? `, ${a.label}` : ''}</li>)}</ul>}/>
      <SettingRow label="Przewodniczy" state="regulamin" at="ogolne" source={both('§ 9 ust. 1 i § 16 ust. 2', 'D1')} why={lawWhy}
        value="Przewodniczący lub wiceprzewodniczący. Pierwszeństwo ma przewodniczący, potem zastępca, którego przewodniczący wyznaczył."/>
      <SettingRow label="Zastępca przewodniczącego" state="regulamin" at="ogolne" source={both('§ 16 ust. 2', 'D1')} why={rule('D1')}
        value="Wyznacza przewodniczący. Zastępca otwiera posiedzenie albo przejmuje prowadzenie bez potwierdzenia przez biuro."/>
      {law.remote.allowed
        ? <SettingRow label="Posiedzenie zdalne" state="regulamin" at="ogolne" effective={prawo('§ 14 ust. 5 zdanie pierwsze')} why={lawWhy}
          value="Dopuszczalne przy dwustronnej komunikacji w czasie rzeczywistym, swobodnym wypowiadaniu się i głosowaniu, bezpiecznej komunikacji i bez dostępu osób nieuprawnionych"/>
        : <SettingRow label="Posiedzenie zdalne" state="niedostepne" at="ogolne" value="Niedostępne" source={law.remote.reason}/>}
      {law.betweenMeetings.allowed
        ? <SettingRow label="Głosowanie między posiedzeniami" state="regulamin" at="ogolne" effective={prawo('§ 14 ust. 5 zdanie drugie')} why={lawWhy}
          value="Dopuszczalne. Rozpoczyna przewodniczący albo zastępca, którego przewodniczący wyznaczył na to głosowanie."/>
        : <SettingRow label="Głosowanie między posiedzeniami" state="niedostepne" at="ogolne" value="Niedostępne" source={law.betweenMeetings.reason}/>}
      <SettingRow label="Protokół" state="regulamin" at="ogolne" effective={prawo('§ 13 ust. 1–3')}
        why={`Protokół sporządza się w terminie ${law.minutes.deadlineDays} dni od zakończenia obrad (${law.minutes.deadlineBasis}), a ${organ.name} przyjmuje go na następnym posiedzeniu (${law.minutes.adoptionBasis}). Te terminy ustala regulamin, a nie aplikacja.`}
        value={`Sporządza się w ${law.minutes.deadlineDays} dni. Podpisują przewodniczący obrad, sekretarz lub zastępujący go członek Prezydium oraz protokolant, jeżeli został wyznaczony. Przyjmuje go następne posiedzenie.`}/>
      <SettingRow label="Kto sporządza protokół" state="regulamin" at="ogolne" effective={prawo(law.minutes.preparedByBasis)} why={lawWhy} value="Sekretarz"/>
      <SettingRow label="Zakres spraw" state="regulamin" at="ogolne" effective={prawo('§ 14 ust. 1')} why={lawWhy}
        value={`Sprawy przekazane Prezydium uchwałą ${rada.forms.genitive}`}/>
    </SettingsList>
    <Fold title={`${houseTitle} (${HOUSE_RULES.length})`}>
      <ul class="rule-list">{HOUSE_RULES.map(r => <li key={r.id}><strong>{r.title}</strong><span class="muted small">{dateDots(r.date)}</span><p>{r.text}</p></li>)}</ul>
    </Fold>
    <Fold title={`Zasady przyjęte dla aplikacji (${APP_RULES.length})`}>
      <ul class="rule-list">{APP_RULES.map(r => <li key={r.id}><strong>{r.title}</strong><p>{r.text}</p></li>)}</ul>
    </Fold>
  </>;
}

const compositionOps: [CompositionChange['op'], string][] = [['dodaj', 'Nowa osoba w składzie'], ['funkcja', 'Zmiana funkcji'], ['koniec', 'Koniec członkostwa'], ['liczba', 'Liczba miejsc']];

function CompositionSection(props: {bundle: GeneralBundle; canEdit: boolean}) {
  const {roster} = useSession();
  const [open, setOpen] = useState(false);
  const members = organMembers(roster, ORGAN);
  const seats = organSettingsOf(props.bundle.general, ORGAN).seats;
  const total = members.length;
  const person = (id: string) => roster.persons.find(p => p.id === id)?.name ?? id;
  return <>
    <OrganFact organ={ORGAN}/>
    <section class="oi-card">
      <CardTitle level={3}>Skład Prezydium</CardTitle>
      <dl class="facts">
        <Fact label="Liczba członków">{String(total)}</Fact>
        <Fact label="Liczba miejsc ustalona uchwałą">{seats ? `${seats.count}, ${compositionBasisText({kind: 'uchwala', act: seats.act}, roster)}` : 'Nie wpisano'}</Fact>
        <Fact label="Wymagane kworum">{`${quorumOf(law, total)} z ${total}`}</Fact>
      </dl>
      <div class="oi-table-wrap"><table class="oi-table settings-table" role="table" aria-label="Skład Prezydium">
        <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Osoba</th><th scope="col" role="columnheader">Funkcja</th><th scope="col" role="columnheader">Od</th><th scope="col" role="columnheader">Podstawa</th><th scope="col" role="columnheader">Prowadzi obrady</th></tr></thead>
        <tbody role="rowgroup">{members.map(ms => <tr role="row" key={ms.personId}>
          <th scope="row" role="rowheader">{person(ms.personId)}</th>
          <td role="cell" data-label="Funkcja">{ms.label}</td>
          <td role="cell" data-label="Od" class="oi-nowrap">{ms.since ? dateDots(ms.since) : '–'}</td>
          <td role="cell" data-label="Podstawa">{ms.basis ? compositionBasisText(ms.basis, roster) : '–'}</td>
          <td role="cell" data-label="Prowadzi obrady">{law.chair.funcs.includes(ms.func) ? 'Tak' : 'Nie'}</td>
        </tr>)}</tbody>
      </table></div>
      <p class="muted small">Kolumna „Prowadzi obrady” wynika z funkcji (§ 9 ust. 1). Nie da się jej zmienić osobno.</p>
      {props.canEdit && <div><Button haspopup onClick={() => setOpen(true)}>Zmień skład</Button></div>}
    </section>
    <HistoryFold area="sklad" version={props.bundle.revision}/>
    {open && <CompositionDialog onClose={() => setOpen(false)}/>}
  </>;
}

const todayIso = () => new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit'}).format(Date.now());
const emptyAct = {organ: 'rada' as const, number: '', date: ''};

// Okno „Zmiana składu Prezydium” (rozdz. 5.2 sekcja 3): rodzaj zmiany, osoba, funkcja, data i podstawa (DA-13, G-5).
function CompositionDialog(props: {onClose: () => void}) {
  const {roster} = useSession();
  const {busy, error, errorKind, run} = useAction();
  const rada = organOfCode(roster, 'rada');
  const members = organMembers(roster, ORGAN);
  const others = roster.persons.filter(p => !members.some(ms => ms.personId === p.id)).sort((a, b) => a.sortName.localeCompare(b.sortName, 'pl'));
  const [op, setOp] = useState<CompositionChange['op']>('dodaj');
  const [personId, setPersonId] = useState('');
  const [name, setName] = useState('');
  const [func, setFunc] = useState<Func>('czlonek');
  const [label, setLabel] = useState('');
  const [count, setCount] = useState('');
  const [since, setSince] = useState(todayIso());
  const [basis, setBasis] = useState<CompositionBasis>({kind: 'uchwala', act: {...emptyAct}});
  const onlyAct = op === 'liczba';
  const changeOp = (next: CompositionChange['op']) => { setOp(next); setPersonId(''); if (next === 'liczba') setBasis({kind: 'uchwala', act: {...emptyAct}}); };
  const newPerson = op === 'dodaj' && personId === 'nowa';
  const after = op === 'dodaj' ? members.length + 1 : op === 'koniec' && personId ? members.length - 1 : members.length;
  const n = Number(count);
  const reason = op === 'liczba' ? (!Number.isInteger(n) || n < 1 || n > 50 ? 'Wpisz liczbę miejsc od 1 do 50.' : null)
    : op === 'dodaj' ? (!personId ? 'Wybierz osobę z listy.' : newPerson && name.trim().length < 3 ? 'Wpisz imię i nazwisko.' : null)
    : !personId ? 'Wybierz osobę z listy.' : null;
  const problem = reason ?? (!since ? 'Wpisz datę, od której zmiana obowiązuje.' : since > todayIso() ? 'Zmianę składu wpisz w dniu, od którego obowiązuje, albo później.' : basisReason(basis, onlyAct));
  const chairFunc = (op === 'dodaj' || op === 'funkcja') && law.chair.funcs.includes(func);
  const hint = basis.kind === 'uchwala'
    ? `Liczbę członków Prezydium ustala ${rada.name} i może ją zmieniać w kadencji (§ 4 ust. 2). Odwołanie stwierdza uchwałą (§ 5 ust. 5).`
    : basis.kind === 'rezygnacja' ? 'Członek Prezydium traci funkcję także wskutek rezygnacji (§ 5 ust. 4). Uchwała nie jest potrzebna.'
    : `Wygaśnięcie mandatu stwierdza uchwałą ${rada.name} (§ 31 ust. 2 Regulaminu wyborów do organów izb oraz trybu odwoływania ich członków). Numer uchwały można dopisać później.`;
  const save = () => run(async () => {
    const change: CompositionChange = {organ: ORGAN, op, since, basis};
    if (op === 'liczba') change.count = n;
    else {
      if (newPerson) change.name = name; else change.personId = personId;
      if (op !== 'koniec') { change.func = func; change.label = label; }
    }
    const r = await request<{general: GeneralBundle}>('/api/composition', {body: change});
    setGeneral(r.general);
    window.dispatchEvent(new Event('posiedzenia:sesja'));
    props.onClose();
  });
  return <Modal title="Zmiana składu Prezydium" onClose={props.onClose} wide>
    <form class="stack" onSubmit={e => { e.preventDefault(); if (!problem) save(); }}>
      <Segments column label="Rodzaj zmiany" value={op} options={compositionOps} onChange={changeOp}/>
      {op === 'dodaj' && <Field label="Osoba"><select value={personId} onChange={e => setPersonId((e.target as HTMLSelectElement).value)}>
        <option value="">Wybierz osobę…</option>
        {others.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value="nowa">Osoba spoza listy</option>
      </select></Field>}
      {newPerson && <Field label="Imię i nazwisko"><input value={name} maxLength={120} onInput={e => setName((e.target as HTMLInputElement).value)}/></Field>}
      {(op === 'funkcja' || op === 'koniec') && <Field label="Osoba"><select value={personId} onChange={e => setPersonId((e.target as HTMLSelectElement).value)}>
        <option value="">Wybierz osobę…</option>
        {members.map(ms => <option key={ms.personId} value={ms.personId}>{roster.persons.find(p => p.id === ms.personId)?.name}, {ms.label}</option>)}
      </select></Field>}
      {(op === 'dodaj' || op === 'funkcja') && <div class="row row-top">
        <Field label="Funkcja"><select value={func} onChange={e => setFunc((e.target as HTMLSelectElement).value as Func)}>{FUNCS.map(f => <option key={f} value={f}>{funcLabel(f, ORGAN)}</option>)}</select></Field>
        <Field label="Nazwa funkcji" hint="Np. I Wiceprzewodnicząca. Tak funkcja pojawi się na ekranach i w protokole."><input value={label} maxLength={120} onInput={e => setLabel((e.target as HTMLInputElement).value)}/></Field>
      </div>}
      {op === 'liczba' && <Field label="Liczba miejsc w Prezydium"><input type="number" min={1} max={50} step={1} value={count} onInput={e => setCount((e.target as HTMLInputElement).value)}/></Field>}
      <Field label="Obowiązuje od" hint={dateHintText(since) || 'Najpóźniej dziś.'}><input type="date" value={since} max={todayIso()} onInput={e => setSince((e.target as HTMLInputElement).value)}/></Field>
      <BasisFields value={basis} onChange={setBasis} kinds={onlyAct ? ['uchwala'] : undefined} hint={hint}/>
      {op !== 'liczba' && <p class="strong">{`Po zmianie Prezydium będzie liczyć ${after} ${after === 1 ? 'członka' : 'członków'}. Wymagane kworum ${quorumOf(law, after)}.`}</p>}
      {chairFunc && <Notice tone="warn">Ta osoba będzie mogła otwierać i prowadzić posiedzenia (§ 9 ust. 1).</Notice>}
      <p class="muted small">Zmiana nie dotyczy posiedzeń już otwartych ani trwającego głosowania między posiedzeniami. Ich skład zapisano przy otwarciu.</p>
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions confirm-actions"><Button kind="primary" type="submit" busy={busy} disabled={!!problem} reason={problem ?? ''}>Zapisz zmianę składu</Button><Button onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

const kinds: ItemKind[] = ['otwarcie', 'porzadek', 'protokol', 'sprawozdania', 'uchwaly', 'wolne_wnioski', 'zamkniecie', 'sprawa'];
const modeName = (v: unknown) => v === 'zdalne' ? 'Zdalne' : 'Stacjonarne';

function TemplatesSection(props: {bundle: GeneralBundle; canEdit: boolean}) {
  const organ = organSettingsOf(props.bundle.general, ORGAN);
  const [selected, setSelected] = useState(organ.templates[0]?.id ?? '');
  const [dialog, setDialog] = useState<'nowy' | 'nazwa' | 'usun' | null>(null);
  const t = organ.templates.find(x => x.id === selected) ?? organ.templates[0];
  if (!t) return <p class="muted">Nie ma wzorów posiedzeń.</p>;
  const save = (next: MeetingTemplate) => saveSetting({area: 'wzory', organ: ORGAN, template: next});
  const count = t.items.length + t.items.reduce((n, i) => n + (i.children?.length ?? 0), 0);
  const describe = (x: MeetingTemplate) => `${x.name}, ${x.items.length} ${plural(x.items.length, 'punkt', 'punkty', 'punktów')}`;
  const own = (v: number | undefined, base: number): Effective<unknown> => v !== undefined
    ? {value: v, source: 'szablon', level: 1, via: {kind: 'wzor', name: t.name}, inherited: base, inheritedSource: 'ogolne'}
    : {value: base, source: 'ogolne', level: 1};
  const defaultOf = <K extends 'time' | 'mode' | 'recorder'>(key: K, base: string): Effective<unknown> => t.defaults?.[key]
    ? {value: t.defaults[key], source: 'szablon', level: 1, via: {kind: 'wzor', name: t.name}, inherited: base, inheritedSource: 'ogolne'}
    : {value: base, source: 'ogolne', level: 1};
  const withSettings = (patch: Partial<NonNullable<MeetingTemplate['settings']>>) => {
    const settings = {...(t.settings ?? {}), ...patch};
    for (const k of Object.keys(settings) as (keyof typeof settings)[]) if (settings[k] === undefined) delete settings[k];
    return {...t, settings};
  };
  const withDefaults = (patch: Partial<NonNullable<MeetingTemplate['defaults']>>) => {
    const defaults = {...(t.defaults ?? {}), ...patch};
    for (const k of Object.keys(defaults) as (keyof typeof defaults)[]) if (!defaults[k]) delete defaults[k];
    return {...t, defaults};
  };
  const restored = (v: string) => `Przywrócono ${v} z ustawień ogólnych.`;
  return <>
    <OrganFact organ={ORGAN}/>
    {organ.templates.length > 1
      ? <Segments column label="Wzór posiedzenia" value={t.id} options={organ.templates.map(x => [x.id, describe(x)] as [string, string])} onChange={setSelected}/>
      : <dl class="facts"><Fact label="Wzór posiedzenia">{describe(t)}</Fact></dl>}
    <section class="oi-card template-card">
      <CardTitle level={3}>{`Wzór „${t.name}”`}</CardTitle>
      <p class="small">Tak zaczyna się każde nowe posiedzenie utworzone z tego wzoru.</p>
      <h4 class="card-sub">{`Punkty (${count})`}</h4>
      <TemplateItems template={t} canEdit={props.canEdit} bundle={props.bundle} onSave={save}/>
      <h4 class="card-sub">Ustawienia wzoru</h4>
      <SettingsList label="Ustawienia wzoru">
        <SettingRow label="Czas głosowania w sprawie" value={minutesText(t.settings?.voteMinutes ?? organ.voteMinutes)} effective={own(t.settings?.voteMinutes, organ.voteMinutes)} at="wzor"
          show={v => minutesText(Number(v))} genitive="czasu głosowania w sprawie"
          editor={props.canEdit ? (close, ctl) => <MinutesRowEditor close={close} ctl={ctl} label="Czas głosowania w sprawie" initial={t.settings?.voteMinutes ?? organ.voteMinutes} options={VOTE_MINUTES} onSave={v => save(withSettings({voteMinutes: v}))}/> : undefined}
          onReset={props.canEdit ? async () => { await save(withSettings({voteMinutes: undefined})); return restored(minutesText(organ.voteMinutes, 'biernik')); } : undefined}/>
        <SettingRow label="Czas głosowań nad wnioskami" value={minutesText(t.settings?.motionMinutes ?? organ.motionMinutes)} effective={own(t.settings?.motionMinutes, organ.motionMinutes)} at="wzor"
          show={v => minutesText(Number(v))} genitive="czasu głosowań nad wnioskami"
          editor={props.canEdit ? (close, ctl) => <MinutesRowEditor close={close} ctl={ctl} label="Czas głosowań nad wnioskami" initial={t.settings?.motionMinutes ?? organ.motionMinutes} options={MOTION_MINUTES} onSave={v => save(withSettings({motionMinutes: v}))}/> : undefined}
          onReset={props.canEdit ? async () => { await save(withSettings({motionMinutes: undefined})); return restored(minutesText(organ.motionMinutes, 'biernik')); } : undefined}/>
        {/* Godzina i tryb nie są ustawieniami ogólnymi: bez własnej wartości wzoru nowe posiedzenie zaczyna się o 10:00, stacjonarnie. */}
        <SettingRow label="Godzina posiedzenia" value={t.defaults?.time ?? '10:00'} at="wzor" genitive="godziny posiedzenia" actionLabel="Zmień godzinę posiedzenia"
          state={t.defaults?.time ? 'zmieniona' : 'odziedziczona'}
          source={t.defaults?.time ? 'Zmienione dla tego wzoru. Bez własnej wartości nowe posiedzenie zaczyna się o 10:00.' : 'Bez własnej wartości. Nowe posiedzenie zacznie się o 10:00.'}
          editor={props.canEdit ? (close, ctl) => <TimeEditor close={close} ctl={ctl} initial={t.defaults?.time ?? '10:00'} onSave={v => save(withDefaults({time: v}))}/> : undefined}
          resetLabel="Przywróć godzinę 10:00"
          onReset={props.canEdit ? async () => { await save(withDefaults({time: undefined})); return 'Przywrócono godzinę 10:00.'; } : undefined}/>
        <SettingRow label="Tryb" value={modeName(t.defaults?.mode)} at="wzor" genitive="trybu"
          state={t.defaults?.mode ? 'zmieniona' : 'odziedziczona'}
          source={t.defaults?.mode ? 'Zmienione dla tego wzoru. Bez własnej wartości nowe posiedzenie jest stacjonarne.' : 'Bez własnej wartości. Nowe posiedzenie będzie stacjonarne.'}
          editor={props.canEdit ? (close, ctl) => <ModeEditor close={close} ctl={ctl} initial={t.defaults?.mode ?? 'stacjonarne'} onSave={v => save(withDefaults({mode: v}))}/> : undefined}
          resetLabel="Przywróć tryb stacjonarny"
          onReset={props.canEdit ? async () => { await save(withDefaults({mode: undefined})); return 'Przywrócono tryb stacjonarny.'; } : undefined}/>
        <SettingRow label="Protokolant" value={t.defaults?.recorder || organ.recorder || 'Nie wpisano'} effective={defaultOf('recorder', organ.recorder)} at="wzor"
          show={v => v ? String(v) : 'brak'} genitive="protokolanta" actionLabel="Zmień protokolanta"
          editor={props.canEdit ? (close, ctl) => <TextRowEditor close={close} ctl={ctl} label="Protokolant" initial={t.defaults?.recorder ?? ''} max={120} hint="Puste pole oznacza protokolanta z ustawień ogólnych." onSave={v => save(withDefaults({recorder: v}))}/> : undefined}
          onReset={props.canEdit ? async () => { await save(withDefaults({recorder: undefined})); return restored('protokolanta'); } : undefined}/>
      </SettingsList>
    </section>
    {props.canEdit && <div class="actions">
      <Button haspopup onClick={() => setDialog('nowy')}>Dodaj wzór</Button>
      <Button haspopup onClick={() => setDialog('nazwa')}>Zmień nazwę wzoru</Button>
      {organ.templates.length > 1 && <Button kind="ghost" quiet haspopup onClick={() => setDialog('usun')}>Usuń wzór</Button>}
    </div>}
    <p class="muted small">Zmiana punktów, godziny, trybu i protokolanta nie zmienia posiedzeń, które są już w przygotowaniu. Zmiana czasów głosowań działa w nich do otwarcia.</p>
    <HistoryFold area="wzory" version={props.bundle.revision}/>
    {dialog === 'nowy' && <TemplateNameDialog title="Nowy wzór posiedzenia" confirm="Dodaj wzór" initial={`${t.name} (kopia)`} text="Nowy wzór będzie kopią bieżącego wzoru z jego punktami i ustawieniami."
      onClose={() => setDialog(null)} onSave={async name => { const copy = structuredClone(t) as Partial<MeetingTemplate>; delete copy.id; const r = await save({...copy, name} as MeetingTemplate);
        setSelected(organSettingsOf(r.general.general, ORGAN).templates.at(-1)?.id ?? selected); }}/>}
    {dialog === 'nazwa' && <TemplateNameDialog title="Zmienić nazwę wzoru?" confirm="Zapisz nazwę" initial={t.name} onClose={() => setDialog(null)} onSave={name => save({...t, name})}/>}
    {dialog === 'usun' && <Confirm title="Usunąć wzór posiedzenia?" kind="danger" confirm="Usuń wzór" onClose={() => setDialog(null)}
      text={<p>{`Wzór „${t.name}” zniknie z ustawień. Posiedzenia już utworzone z tego wzoru zostaną bez zmian i dostaną ustawienia ogólne.`}</p>}
      onConfirm={() => { saveSetting({area: 'wzory', organ: ORGAN, remove: t.id}).then(() => setSelected('')).catch(() => {}); }}/>}
  </>;
}

function TemplateNameDialog(props: {title: string; confirm: string; initial: string; text?: string; onClose: () => void; onSave: (name: string) => Promise<unknown>}) {
  const {busy, error, errorKind, run} = useAction();
  const [name, setName] = useState(props.initial);
  return <Modal title={props.title} onClose={props.onClose}>
    <form class="stack" onSubmit={e => { e.preventDefault(); run(async () => { await props.onSave(name.replace(/\s+/g, ' ').trim()); props.onClose(); }); }}>
      {props.text && <p class="small">{props.text}</p>}
      <Field label="Nazwa wzoru"><input value={name} maxLength={80} required onInput={e => setName((e.target as HTMLInputElement).value)}/></Field>
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>{props.confirm}</Button><Button onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

function TimeEditor(props: {close: (s?: string) => void; ctl: EditorCtl; initial: string; onSave: (v: string) => Promise<unknown>}) {
  const [value, setValue] = useState(props.initial);
  return <RowEditor close={props.close} ctl={props.ctl} dirty={value !== props.initial} onSave={() => props.onSave(value)} reason={/^\d{2}:\d{2}$/.test(value) ? undefined : 'Wpisz godzinę.'}>
    <Field label="Godzina posiedzenia"><input type="time" value={value} onInput={e => setValue((e.target as HTMLInputElement).value)}/></Field>
  </RowEditor>;
}
function ModeEditor(props: {close: (s?: string) => void; ctl: EditorCtl; initial: MeetingMode; onSave: (v: MeetingMode) => Promise<unknown>}) {
  const [value, setValue] = useState<MeetingMode>(props.initial);
  const options: [MeetingMode, string][] = law.remote.allowed ? [['stacjonarne', 'Stacjonarne'], ['zdalne', 'Zdalne']] : [['stacjonarne', 'Stacjonarne']];
  return <RowEditor close={props.close} ctl={props.ctl} dirty={value !== props.initial} onSave={() => props.onSave(value)}>
    <Segments label="Tryb" value={value} options={options} onChange={setValue}/>
  </RowEditor>;
}

type Path = [number] | [number, number];
// Punkty wzoru: obowiązkowe bez działań, wymienione w regulaminie bez „Usuń”, dodane przez biuro ze wszystkimi działaniami.
function TemplateItems(props: {template: MeetingTemplate; canEdit: boolean; bundle: GeneralBundle; onSave: (t: MeetingTemplate) => Promise<unknown>}) {
  const t = props.template;
  const {busy, error, errorKind, run} = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const key = (p: Path) => p.join('.');
  const update = (fn: (items: TemplateItem[]) => void) => run(async () => { const items = structuredClone(t.items); fn(items); await props.onSave({...t, items}); });
  const listOf = (items: TemplateItem[], p: Path) => p.length === 1 ? items : items[p[0]].children!;
  const move = (p: Path, d: -1 | 1) => update(items => {
    const list = listOf(items, p), i = p[p.length - 1], j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
  });
  const remove = (p: Path) => update(items => { listOf(items, p).splice(p[p.length - 1], 1); });
  const caseName = (id?: string) => props.bundle.general.caseTypes.find(c => c.id === id)?.name;
  const docName = (id?: string) => props.bundle.docTypes.find(d => d.id === id)?.name;
  const row = (it: TemplateItem, p: Path, no: string, siblings: number) => {
    const mandatory = law.agenda.mandatory.includes(it.kind), listed = it.kind in law.agenda.listed;
    const line = mandatory ? `Punkt obowiązkowy, ${agendaBasis(law, it.kind)}.` : listed ? `Z regulaminu, ${agendaBasis(law, it.kind)}.` : 'Dodany przez biuro.';
    // Rodzaj punktu nie powtarza tytułu, który brzmi tak samo (np. „Zamknięcie posiedzenia”).
    const kindLabel = itemKindLabel[it.kind];
    const sameAsTitle = kindLabel.toLocaleLowerCase('pl').replace(/\.$/, '') === it.title.trim().toLocaleLowerCase('pl').replace(/\.$/, '');
    const facts = [!sameAsTitle && kindLabel, caseName(it.caseType) && `rodzaj sprawy »${caseName(it.caseType)}«`, docName(it.docType) && `głosuje się ${docName(it.docType)?.toLocaleLowerCase('pl')}`,
      it.presenterFunc && `referuje ${funcLabel(it.presenterFunc, ORGAN).toLocaleLowerCase('pl')}`].filter(Boolean).join(', ');
    const i = p[p.length - 1];
    const k = key(p);
    return <li key={k} class={'edit-row template-row' + (p.length > 1 ? ' is-sub' : '') + (mandatory ? ' is-regulamin' : '')}>
      <span class="agenda-no">{no}</span>
      {editing === k
        ? <TemplateItemForm item={it} bundle={props.bundle} sub={p.length > 1} onCancel={() => setEditing(null)}
          onSave={next => run(async () => { const items = structuredClone(t.items); listOf(items, p)[i] = {...next, ...(it.children ? {children: it.children} : {})}; await props.onSave({...t, items}); setEditing(null); })}/>
        : <>
          <div class="edit-main"><span class="edit-title">{it.title}</span>{facts && <span class="edit-meta">{facts}.</span>}<span class="edit-meta template-src">{line}</span></div>
          {props.canEdit && !mandatory && <span class="edit-tools">
            <Button small quiet kind="ghost" onClick={() => setEditing(k)} label={`Zmień punkt wzoru ${no}`}>Zmień</Button>
            <Button small quiet kind="ghost" busy={busy} disabled={i === 0} onClick={() => move(p, -1)} label={`Przesuń punkt wzoru ${no} wyżej`}>Wyżej</Button>
            <Button small quiet kind="ghost" busy={busy} disabled={i === siblings - 1} onClick={() => move(p, 1)} label={`Przesuń punkt wzoru ${no} niżej`}>Niżej</Button>
            {!listed && <Button small quiet kind="ghost" busy={busy} onClick={() => remove(p)} label={`Usuń punkt wzoru ${no}`}>Usuń</Button>}
          </span>}
        </>}
    </li>;
  };
  return <div class="stack">
    <ol class="edit-list template-items">{t.items.flatMap((it, i) => [row(it, [i], String(i + 1), t.items.length),
      ...(it.children ?? []).map((c, j) => row(c, [i, j], `${i + 1}.${j + 1}`, it.children!.length))])}</ol>
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
    {props.canEdit && <form class="add-form" onSubmit={e => {
      e.preventDefault();
      const name = title.replace(/\s+/g, ' ').trim();
      if (!name) return;
      update(items => { const end = items.findIndex(x => x.kind === 'zamkniecie'); items.splice(end < 0 ? items.length : end, 0, {title: name, kind: 'sprawa'}); });
      setTitle('');
    }}>
      <Field label="Nowy punkt wzoru" hint="Punkt stanie przed zamknięciem posiedzenia."><input value={title} maxLength={400} onInput={e => setTitle((e.target as HTMLInputElement).value)}/></Field>
      <Button type="submit" busy={busy}>Dodaj punkt</Button>
    </form>}
  </div>;
}

function TemplateItemForm(props: {item: TemplateItem; bundle: GeneralBundle; sub: boolean; onSave: (item: TemplateItem) => void; onCancel: () => void}) {
  const [title, setTitle] = useState(props.item.title);
  const [kind, setKind] = useState<ItemKind>(props.item.kind);
  const [caseType, setCaseType] = useState(props.item.caseType ?? '');
  const [docType, setDocType] = useState(props.item.docType ?? '');
  const [presenter, setPresenter] = useState<Func | ''>(props.item.presenterFunc ?? '');
  const cases = props.bundle.general.caseTypes.filter(c => c.active && c.organs.includes(ORGAN));
  return <form class="edit-form" onSubmit={e => {
    e.preventDefault();
    const out: TemplateItem = {title: title.replace(/\s+/g, ' ').trim(), kind};
    if (caseType) out.caseType = caseType;
    if (docType) out.docType = docType;
    if (presenter) out.presenterFunc = presenter;
    props.onSave(out);
  }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); props.onCancel(); } }}>
    <Field label="Nazwa punktu"><input value={title} maxLength={400} required onInput={e => setTitle((e.target as HTMLInputElement).value)}/></Field>
    {!props.sub && <Field label="Rodzaj punktu"><select value={kind} onChange={e => setKind((e.target as HTMLSelectElement).value as ItemKind)}>{kinds.map(k => <option key={k} value={k}>{itemKindLabel[k]}</option>)}</select></Field>}
    <Field label="Rodzaj sprawy"><select value={caseType} onChange={e => setCaseType((e.target as HTMLSelectElement).value)}><option value="">Bez rodzaju sprawy</option>{cases.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
    <DocTypeSelect types={sortedDocTypes(props.bundle.docTypes)} value={docType} onChange={setDocType} empty="Bez wskazania" label="Co jest głosowane"/>
    <Field label="Domyślnie referuje"><select value={presenter} onChange={e => setPresenter((e.target as HTMLSelectElement).value as Func | '')}><option value="">Bez wskazania</option>{FUNCS.map(f => <option key={f} value={f}>{funcLabel(f, ORGAN)}</option>)}</select></Field>
    <div class="actions"><Button kind="primary" small type="submit">Zapisz punkt</Button><Button small kind="ghost" quiet onClick={props.onCancel}>Anuluj</Button></div>
  </form>;
}

function VotingSection(props: {bundle: GeneralBundle; canEdit: boolean}) {
  const organ = organSettingsOf(props.bundle.general, ORGAN);
  const save = (key: 'voteMinutes' | 'motionMinutes' | 'procedureHours', value: number) => saveSetting({area: 'organ', organ: ORGAN, key, value});
  return <>
    <OrganFact organ={ORGAN}/>
    <SettingsList label="Głosowanie i obrady">
      <SettingRow label="Czas głosowania w sprawie" value={minutesText(organ.voteMinutes)} effective={general(organ.voteMinutes)} at="ogolne" genitive="czasu głosowania w sprawie"
        hint="Osoba prowadząca obrady może zmienić czas przy każdym głosowaniu. Wzór posiedzenia może mieć własny czas."
        editor={props.canEdit ? (close, ctl) => <MinutesRowEditor close={close} ctl={ctl} label="Czas głosowania w sprawie" initial={organ.voteMinutes} options={VOTE_MINUTES} onSave={v => save('voteMinutes', v)}/> : undefined}/>
      <SettingRow label="Czas głosowań nad wnioskami" value={minutesText(organ.motionMinutes)} effective={general(organ.motionMinutes)} at="ogolne" genitive="czasu głosowań nad wnioskami"
        hint="Dotyczy wniosku o głosowanie tajne albo imienne, wniosku o reasumpcję i zmiany porządku obrad."
        editor={props.canEdit ? (close, ctl) => <MinutesRowEditor close={close} ctl={ctl} label="Czas głosowań nad wnioskami" initial={organ.motionMinutes} options={MOTION_MINUTES} onSave={v => save('motionMinutes', v)}/> : undefined}/>
      <SettingRow label="Czas trwania głosowania między posiedzeniami" value={hoursText(organ.procedureHours)} effective={general(organ.procedureHours)} at="ogolne" genitive="czasu trwania głosowania między posiedzeniami"
        hint="Od 24 do 336 godzin. Krótszy termin można ustawić dla jednego głosowania, podając powód."
        editor={props.canEdit ? (close, ctl) => <HoursEditor close={close} ctl={ctl} initial={organ.procedureHours} onSave={v => save('procedureHours', v)}/> : undefined}/>
      <SettingRow label="Najkrótszy czas głosowania między posiedzeniami" state="aplikacja" at="ogolne" value={hoursText(24)} effective={aplikacja('czas_procedury')} why={appRuleWhy}/>
      <SettingRow label="Tryb głosowania" state="regulamin" at="ogolne" value="Jawne" effective={prawo('§ 11 ust. 1')} why={lawWhy}/>
      <SettingRow label="Potwierdzanie obecności na posiedzeniu stacjonarnym" state="zasada" at="ogolne" effective={zasada('F9')}
        value="Potwierdza osoba prowadząca obrady albo biuro. Odrzuca osoba prowadząca obrady."
        why="Biuro prowadzi listę obecności, ale jej brak nie zatrzymuje obrad. Obecność osoby prowadzącej i osoby, która przejmuje prowadzenie, zapisuje się razem z tą czynnością. W trakcie głosowania wyjście osoby uprawnionej zapisuje osoba prowadząca obrady."/>
      <SettingRow label="Projekt porządku obrad na żywo" state="zasada" at="ogolne" effective={zasada('D2')} value="Członkowie i ekran sali widzą każdą zmianę od razu"
        why="W punkcie „Przyjęcie porządku obrad” i przez całe spotkanie robocze, dopóki porządek nie jest przyjęty. Na ekranie sali stoi napis „Projekt porządku obrad”, bo spotkanie robocze niczego nie przyjmuje (§ 8 ust. 2)."/>
      <SettingRow label="Wynik głosowania" state="zasada" at="ogolne" effective={zasada('F2')} value="Widoczny po ogłoszeniu" why={houseRule('F2').text}/>
    </SettingsList>
    <HistoryFold area="organ" version={props.bundle.revision} keys={k => k !== 'recorder'}/>
  </>;
}

function HoursEditor(props: {close: (s?: string) => void; ctl: EditorCtl; initial: number; onSave: (v: number) => Promise<unknown>}) {
  const [value, setValue] = useState(String(props.initial));
  const n = Number(value);
  const bad = !Number.isInteger(n) || n < PROCEDURE_HOURS.min || n > PROCEDURE_HOURS.max;
  return <RowEditor close={props.close} ctl={props.ctl} dirty={n !== props.initial} onSave={() => props.onSave(n)} reason={bad ? 'Ustaw od 24 do 336 godzin.' : undefined}>
    <Field label="Czas trwania głosowania między posiedzeniami (godzin)" hint="Najwyżej 336 godzin, czyli 14 dni.">
      <input type="number" min={PROCEDURE_HOURS.min} max={PROCEDURE_HOURS.max} step={1} value={value} onInput={e => setValue((e.target as HTMLInputElement).value)}/>
    </Field>
  </RowEditor>;
}

function MinutesSection(props: {bundle: GeneralBundle; canEdit: boolean}) {
  const organ = organSettingsOf(props.bundle.general, ORGAN);
  const m = law.minutes;
  return <>
    <OrganFact organ={ORGAN}/>
    <SettingsList label="Protokół i zawiadomienie">
      <SettingRow label="Kto sporządza" state="regulamin" at="ogolne" value="Sekretarz" effective={prawo(m.preparedByBasis)} why={lawWhy}/>
      <SettingRow label="Podpisy" state="regulamin" at="ogolne" effective={prawo(m.signaturesBasis)} why={lawWhy}
        value="Przewodniczący obrad, sekretarz lub zastępujący go członek Prezydium oraz protokolant, jeżeli został wyznaczony"/>
      <SettingRow label="Termin sporządzenia" state="regulamin" at="ogolne" value={`${m.deadlineDays} dni od zakończenia obrad`} effective={prawo(m.deadlineBasis)} why={lawWhy}/>
      <SettingRow label="Przyjęcie" state="regulamin" at="ogolne" value="Na następnym posiedzeniu" effective={prawo(m.adoptionBasis)} why={lawWhy}/>
      <SettingRow label="Najkrótszy termin zawiadomienia" state="regulamin" at="ogolne" value={`${law.notice.minDays} dni przed posiedzeniem`} effective={prawo(law.notice.basis)} why={lawWhy}/>
      <SettingRow label="Adresaci zawiadomienia" state="regulamin" at="ogolne" value="Członkowie Prezydium i osoby z głosem doradczym" effective={prawo('§ 7 ust. 1–2')} why={lawWhy}/>
      <SettingRow label="Protokolant domyślny" value={organ.recorder || 'Nie wpisano'} effective={general(organ.recorder)} at="ogolne" genitive="protokolanta domyślnego" actionLabel="Zmień protokolanta domyślnego"
        hint="Proponowany w każdym nowym posiedzeniu, chyba że wzór posiedzenia ma własnego. Można go zmienić."
        editor={props.canEdit ? (close, ctl) => <TextRowEditor close={close} ctl={ctl} label="Protokolant domyślny" initial={organ.recorder} max={120} onSave={value => saveSetting({area: 'organ', organ: ORGAN, key: 'recorder', value})}/> : undefined}/>
    </SettingsList>
    <p><a class="oi-link" href="#ustawienia-rodzaje">Które rodzaje stoją w wykazie aktów protokołu</a></p>
    <HistoryFold area="organ" version={props.bundle.revision} keys={k => k === 'recorder'}/>
  </>;
}
