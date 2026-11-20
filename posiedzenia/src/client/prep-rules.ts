import type {Actor, OrganCode, Roster} from '../shared/types.ts';
import type {Comment, Proposal, PrepView, ReadinessCheck} from '../shared/workspace.ts';
import {PREP_LIMITS} from '../shared/workspace.ts';
import {isCommsAccount, isService} from '../shared/role.ts';
import {membership} from '../shared/roster.ts';
import {plural} from '../shared/text.ts';

// Czyste reguły ekranów wspólnego przygotowania (SPEC-4 6.5, 8.1 „Testy zespołów E i F”): liczenie zakładek, zdań
// o gotowości w wierszu punktu, stanów zgłoszeń na ekranie i wątków uwag. Bez JSX i bez zapytań, więc testy
// `tests/e-*.test.ts` importują ten moduł wprost. Reguły uprawnień są wyłącznie w `src/shared/role.ts`; tu tylko to, co
// ekran pokazuje.

/**
 * „Zgłoś sprawę na najbliższe posiedzenie” na liście posiedzeń (B2-W06, 6.1): członek organu albo osoba z głosem doradczym,
 * bez kont biura i komunikacji (ta sama reguła co `mayPropose` w workspace.ts, zbiór czekających organu).
 */
export function mayProposeWaiting(roster: Roster, organ: OrganCode, a: Actor): boolean {
  if (isService(a) || isCommsAccount(a)) return false;
  return (!!a.personId && !!membership(roster, organ, a.personId)) || a.account.kind === 'doradczy';
}

/** Liczba zgłoszeń czekających na decyzję zwołującego (zakładka „Zgłoszenia ({n})”, karta „Zgłoszenia ({n})”). */
export const waitingProposals = (prep: Pick<PrepView, 'proposals'> | null | undefined) => (prep?.proposals ?? []).filter(p => p.state === 'zgloszone').length;

/** Zakładka „Zgłoszenia ({n})” na telefonie: napis i nazwa dostępna „Zgłoszenia, {n} czeka na decyzję” (6.5). */
export function proposalsTab(prep: Pick<PrepView, 'proposals'> | null | undefined): {label: string; name: string} {
  const n = waitingProposals(prep);
  return {label: `Zgłoszenia (${n})`, name: `Zgłoszenia, ${n} ${plural(n, 'czeka', 'czekają', 'czeka')} na decyzję`};
}

const what: Record<ReadinessCheck['key'], (c: ReadinessCheck) => string> = {
  material: () => 'materiału',
  projekt_aktu: c => c.text.replace(/^Brak (projektu \S+)\..*$/s, '$1'),
  referent: () => 'osoby referującej',
  rodzaj_sprawy: () => 'decyzji o rodzaju sprawy',
  protokol: () => 'protokołu',
};
const list = (parts: string[]) => parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} i ${parts.at(-1)}`;
/** Zdanie o gotowości w wierszu punktu (6.5): „Gotowe.” albo „Brakuje projektu uchwały.”; bez sprawdzeń pusty napis. */
export function readinessSentence(checks: ReadinessCheck[] | undefined): string {
  if (!checks?.length) return '';
  const gaps = checks.filter(c => !c.ok).map(c => what[c.key](c));
  return gaps.length ? `Brakuje ${list(gaps)}.` : 'Gotowe.';
}

/** Uwagi przy punkcie (bez usuniętych w liczbie): pierwsze uwagi wątków z odpowiedziami w kolejności czasu. */
export function itemThreads(comments: Comment[], itemId: string): {root: Comment; replies: Comment[]}[] {
  const mine = comments.filter(c => c.target.kind === 'punkt' && c.target.itemId === itemId);
  return mine.filter(c => !c.parentId).sort((a, b) => a.at - b.at)
    .map(root => ({root, replies: mine.filter(r => r.parentId === root.id).sort((a, b) => a.at - b.at)}));
}
/** Liczba uwag przy punkcie („Uwagi {n}.”, „Uwagi ({n})”): bez usuniętych. */
export const itemCommentCount = (comments: Comment[], itemId: string) =>
  comments.filter(c => c.target.kind === 'punkt' && c.target.itemId === itemId && !c.deleted).length;

/** Zdanie faktów wiersza punktu po zdaniu o gotowości: „Uwagi {n}.” (bez dodatków D-10 i D-11). */
export const commentsSentence = (n: number) => n ? `Uwagi ${n}.` : '';

/** Poprawkę uwagi zgłasza autor przez 15 minut i tylko przed pierwszą odpowiedzią (G-31). */
export function canEditComment(c: Comment, all: Comment[], accountId: string, now: number): boolean {
  return c.accountId === accountId && !c.deleted && now - c.at <= PREP_LIMITS.editMinutes * 60000 && !all.some(x => x.parentId === c.id);
}

/**
 * Stan zgłoszenia na ekranie (6.5, DB-14): „Czeka na decyzję zwołującego” tylko u osób przygotowujących, które nie
 * rozstrzygają (biuro, wiceprzewodniczący, który nie zwołuje); osoba zgłaszająca i zwołujący widzą „Zgłoszone”.
 */
export const waitsForConvener = (p: Pick<Proposal, 'state'>, preparer: boolean, decides: boolean) => p.state === 'zgloszone' && preparer && !decides;

/** Podpis decyzji przy zgłoszeniu: „Powód „…”.” (odrzucenie i odłożenie) i osoba albo konto biura. */
export function decisionText(p: Proposal): string {
  if (!p.decision) return '';
  const reason = p.decision.reason ? `Powód „${p.decision.reason.replace(/\.$/, '')}”. ` : '';
  return `${reason}${p.decision.by}`.trim();
}

