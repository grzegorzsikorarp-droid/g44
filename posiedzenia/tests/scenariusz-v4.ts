import {apply} from '../src/shared/meeting.ts';
import {cascadeEnv, type CascadeEnv} from '../src/shared/cascade.ts';
import {defaultGeneral, type CaseType} from '../src/shared/settings.ts';
import {defaultDocTypes} from '../src/shared/doctypes.ts';
import {seedSite} from '../src/server/seed.ts';
import {commsLevels} from '../src/shared/comms.ts';
import type {Account, DocType, Meeting} from '../src/shared/types.ts';
import {actor, context, newMeeting, presidium, roster} from './helpers.ts';

// Scenariusz testów wersji 4 (etap D.1): posiedzenie Prezydium zamknięte poleceniami domeny, z uchwałami w trzech
// trybach i różnymi poziomami w materiale dla komunikacji (K4-1 pkt 8, K4-5, K4-6). Pola, które w etapie D.2 ustawią
// polecenia domeny (rodzaj sprawy w trakcie obrad, pliki pokazane, `closedComms` przy zamknięciu, `frozen.v4`), test
// wpisuje wprost w dane.

export type Ctx = ReturnType<typeof context>;
export const chair = actor('si');
export const office = actor(null, 'biuro', true);
export const NOW = Date.parse('2026-11-20T15:00:00Z');
export const caseTypes: CaseType[] = [
  {id: 'patronat', name: 'Patronat', docType: 'uchwala', organs: ['prezydium'], financial: false, keywords: ['patronat'], titlePattern: '', order: 10, active: true, comms: 'tytul'},
  {id: 'pomoc', name: 'Pomoc w przypadkach losowych', docType: 'uchwala', organs: ['prezydium'], financial: false, keywords: ['zapomoga'], titlePattern: '', order: 20, active: true, comms: 'pomin'},
  {id: 'stanowiska', name: 'Stanowiska', docType: 'stanowisko', organs: ['prezydium'], financial: false, keywords: ['stanowisko'], titlePattern: '', order: 30, active: true},
];
export const accounts: Account[] = [
  {id: 'u-gosc', username: 'gosc', kind: 'gosc', personId: null, displayName: 'Jan Gościnny', label: 'radca prawny', admin: false, mustChange: false, disabled: false},
];
export function envWith(docTypes: DocType[] = defaultDocTypes, types: CaseType[] = caseTypes): CascadeEnv {
  return cascadeEnv({roster, bundle: {general: {...defaultGeneral(seedSite), caseTypes: types}, docTypes, revision: 1}, organ: 'prezydium', accounts});
}
const item = (m: Meeting, kind: string) => m.agenda.find(i => i.kind === kind)!;
export const last = (m: Meeting) => m.ballots.at(-1)!;
export function voteAll(m: Meeting, ctx: Ctx, choice: 'za' | 'przeciw' = 'za') {
  const id = last(m).id;
  for (const p of last(m).eligible) m = apply(m, {type: 'vote', ballotId: id, choice}, actor(p), ctx.tick());
  return m;
}
export const announce = (m: Meeting, ctx: Ctx) => apply(m, {type: 'announce', ballotId: last(m).id}, chair, ctx.tick());

/** Posiedzenie otwarte z kworum i przyjętym porządkiem; `v4` oznacza otwarcie w wersji 4 (DB-4). */
export function openedMeeting(o: {v4?: boolean} = {}) {
  const ctx = context();
  let m = newMeeting(ctx);
  m = apply(m, {type: 'details', noticeDate: '2026-11-10', protocolNumber: '12/IX/2026', convener: 'si'}, office, ctx);
  const resolutions = item(m, 'uchwaly');
  for (const title of ['Uchwała nr 108/IX/2026 w sprawie patronatu nad konferencją', 'Uchwała nr 109/IX/2026 w sprawie zapomogi', 'Uchwała nr 110/IX/2026 w sprawie wpisu', 'Uchwała nr 111/IX/2026 w sprawie wpisu']) {
    m = apply(m, {type: 'item_add', title, parentId: resolutions.id}, office, ctx.tick());
  }
  const current = item(m, 'wolne_wnioski');
  m = apply(m, {type: 'item_add', title: 'Wniosek Anny Testowej o zapomogę', parentId: current.id}, office, ctx.tick());
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  if (o.v4) m = {...m, frozen: {...m.frozen!, v4: true, term: {name: 'IX kadencja 2024–2028', number: 'IX'}}};
  for (const p of presidium.filter(p => p !== 'si')) m = apply(m, {type: 'presence', who: p, present: true}, actor(p), ctx.tick());
  m = apply(m, {type: 'presence_confirm_all'}, chair, ctx.tick());
  m = apply(m, {type: 'quorum'}, chair, ctx.tick());
  m = apply(m, {type: 'item_start', itemId: item(m, 'porzadek').id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: item(m, 'porzadek').id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  m = announce(voteAll(m, ctx), ctx);
  return {ctx, m};
}
const sub = (m: Meeting, prefix: string) => m.agenda.find(i => i.title.startsWith(prefix))!;
/**
 * Pełny scenariusz: uchwała 108 jawna (rodzaj „Patronat”, „Tytuł”), 109 imienna (rodzaj „Pomoc w przypadkach losowych”,
 * „Nie trafia”), 110 tajna i 111 jawna (bez rodzaju sprawy, „Tylko liczba”), podpunkt bez rodzaju sprawy z osobą spoza
 * składu i pokazanym plikiem, zamknięcie i poziomy utrwalone przy zamknięciu.
 */
export function closedMeeting(o: {v4?: boolean; env?: CascadeEnv} = {}) {
  let {ctx, m} = openedMeeting(o);
  const env = o.env ?? envWith();
  m = {...m, agenda: m.agenda.map(i => i.title.startsWith('Uchwała nr 108') ? {...i, caseType: 'patronat', comms: {sentence: 'Patronat nad konferencją dla pielęgniarek i położnych.', stamp: {at: ctx.now, by: 'Biuro', accountId: 'u-biuro'}}}
    : i.title.startsWith('Uchwała nr 109') ? {...i, caseType: 'pomoc'}
    : i.title.startsWith('Wniosek Anny') ? {...i, presenters: [{name: 'Ewa Zewnętrzna', role: '', kind: 'referuje' as const}]} : i)};
  const vote = (prefix: string, mode: 'jawne' | 'imienne' | 'tajne') => {
    const it = sub(m, prefix);
    m = apply(m, {type: 'item_start', itemId: it.id, reason: 'Kolejność w scenariuszu testu.'}, chair, ctx.tick());
    if (mode !== 'jawne') {
      m = apply(m, {type: 'mode_motion', itemId: it.id, mode, minutes: 2, proposedBy: 'kn'}, chair, ctx.tick());
      m = announce(voteAll(m, ctx), ctx);
    }
    m = apply(m, {type: 'ballot_open', itemId: it.id, purpose: 'uchwala', subject: it.title, mode, minutes: 2}, chair, ctx.tick());
    if (mode === 'tajne') {
      const b = last(m);
      const choices: ('za' | 'przeciw')[] = ['za', 'za', 'za', 'za', 'za', 'przeciw', 'za'];
      b.eligible.forEach((_, i) => ctx.castSecret(b.id, choices[i % choices.length]));
      // Karty pobrane w kolejności odwrotnej do składu (listy w dokumentach mają być w kolejności składu, T-7).
      m = {...m, ballots: m.ballots.map(x => x.id === b.id ? {...x, secret: {...x.secret!, issued: [...x.eligible].reverse()}} : x)};
      m = apply(m, {type: 'ballot_close', ballotId: b.id}, chair, ctx.tick());
      m = {...m, ballots: m.ballots.map(x => x.id === b.id ? {...x, secret: {...x.secret!, cast: x.eligible.length}} : x)};
    } else m = voteAll(m, ctx);
    m = announce(m, ctx);
  };
  vote('Uchwała nr 108', 'jawne');
  vote('Uchwała nr 109', 'imienne');
  vote('Uchwała nr 110', 'tajne');
  vote('Uchwała nr 111', 'jawne');
  const wniosek = sub(m, 'Wniosek Anny');
  m = apply(m, {type: 'item_start', itemId: wniosek.id, reason: 'Kolejność w scenariuszu testu.'}, chair, ctx.tick());
  // Plik pokazany w punkcie (polecenie `show` dochodzi w etapie D.2).
  const shownAt = ctx.tick().now;
  m = {...m, displays: [{id: 'd1', title: 'Pismo Jana Próbnego.pdf', kind: 'pdf', files: [{fileId: 'f1', name: 'pismo.pdf', type: 'pdf', size: 2400000}], pages: 3, itemId: wniosek.id, addedAt: shownAt, addedBy: 'Biuro', accountId: 'u-biuro'}],
    log: [...m.log, {at: shownAt, text: 'Pokazano plik „Pismo Jana Próbnego.pdf” (PDF, 3 strony) w punkcie 6.1.', by: 'Sebastian Irzykowski', tag: 'pokaz', itemId: wniosek.id, displayId: 'd1', accountId: 'u-si'}]};
  m = apply(m, {type: 'close', reason: 'Koniec czasu.'}, chair, ctx.tick());
  // Poziomy utrwalone przy zamknięciu (DB-41; zapisze je polecenie `close` w etapie D.2).
  m = {...m, closedComms: commsLevels({...m, status: 'trwa'}, env), commsInputs: 0};
  return {ctx, m, env};
}
