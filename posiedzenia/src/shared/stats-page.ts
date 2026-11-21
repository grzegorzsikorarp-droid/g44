import type {StatsResult} from './stats.ts';
import {rosterTurnout, statsSourceLines, turnout} from './stats.ts';
import {plural} from './text.ts';
import {t as tx} from './papers.ts';
import {dateDots} from './text.ts';

/**
 * Treść wydruku „Moich statystyk” (6.3): linia źródła, liczby i posiedzenia po kolei z tych samych danych co ekran.
 * Jedna funkcja dla serwera i wersji próbnej (etap D.3; wcześniej w `app.ts`). Moduł ładują tylko strony statystyk (B4-21).
 */
export function statsPageBody(r: StatsResult, now: number): string {
  const p = r.persons[0];
  const lines = statsSourceLines(r, now).map(l => `<p class="muted">${tx(l)}</p>`).join('');
  if (!p) return `<h1>${tx('Moje')} <b>${tx('statystyki')}</b></h1><p>${tx('W tym okresie nie zakończyło się żadne posiedzenie Prezydium.')}</p>${lines}`;
  const row = (label: string, value: string | number) => `<tr><th scope="row">${tx(label)}</th><td>${tx(String(value))}</td></tr>`;
  const facts = `<table class="facts">${row('Okres', `${dateDots(r.range.from)}–${dateDots(r.range.to)}`)}${row('Posiedzenia', p.meetings.held)}${row('Obecność przez całe obrady', p.meetings.cala)}${row('Obecność częściowa', p.meetings.czesciowa)}${row('Nieobecność', p.meetings.nieobecnosc)}${row('Głosowania na posiedzeniach, prawo głosu', p.sessionVotes.eligible)}${row('Głos oddany albo karta pobrana', p.sessionVotes.cast)}</table>`;
  const list = p.rows.map(x => `<tr><th scope="row">${tx(dateDots(x.day))}</th><td>${tx(x.title)}</td><td>${tx(x.attendance ? ({cala: 'obecność przez całe obrady', czesciowa: 'obecność częściowa', nieobecnosc: 'nieobecność'} as const)[x.attendance.kind] : '')}</td><td>${tx(String(x.ballots.filter(b => b.cast).length))} ${tx('z')} ${tx(String(x.ballots.filter(b => b.eligible).length))}</td></tr>`).join('');
  return `<h1>${tx('Moje')} <b>${tx('statystyki')}</b></h1><p>${tx(p.name)}</p>${facts}<div class="table-wrap" role="region" tabindex="0" aria-label="${tx('Posiedzenia po kolei')}"><table><thead><tr><th scope="col">${tx('Dzień')}</th><th scope="col">${tx('Posiedzenie')}</th><th scope="col">${tx('Obecność')}</th><th scope="col">${tx('Udział w głosowaniach')}</th></tr></thead><tbody>${list}</tbody></table></div>${lines}`;
}

/**
 * Dodatek D-13 (B4-23, B4-27, 6.4): wydruk „Statystyk składu”. Wariant `sprawozdanie` („Drukuj wersję do sprawozdania”)
 * ma tylko obecność, frekwencję i udział, bez kolumny głosowań imiennych. Bez uwag „Do sprawdzenia” (B4-25).
 */
export function rosterPageBody(r: StatsResult, now: number, variant: 'pelny' | 'sprawozdanie' = 'pelny'): string {
  const lines = statsSourceLines(r, now).map(l => `<p class="muted">${tx(l)}</p>`).join('');
  const head = `<h1>${tx('Statystyki')} <b>${tx('składu')}</b></h1><p>${tx(`Okres ${dateDots(r.range.from === '0000-01-01' ? '' : r.range.from) || 'kadencji'}${r.range.to === '9999-12-31' ? '' : `–${dateDots(r.range.to)}`}.`)}</p>`;
  if (!r.persons.length || !r.counted.meetings && !r.counted.procedures) return `${head}<p>${tx('W tym okresie nie zakończyło się żadne posiedzenie Prezydium.')}</p>${lines}`;
  const t = rosterTurnout(r);
  const summary = `<p>${tx(`Frekwencja ${t.percent === null ? '–' : `${t.percent}%`} (${t.present} z ${t.places}) na ${r.counted.meetings} ${plural(r.counted.meetings, 'posiedzeniu', 'posiedzeniach', 'posiedzeniach')} Prezydium.${r.counted.procedures ? ` Do tego ${r.counted.procedures} ${plural(r.counted.procedures, 'głosowanie', 'głosowania', 'głosowań')} między posiedzeniami.` : ''}`)}</p>`;
  const full = variant === 'pelny';
  const cols = ['Imię i nazwisko', 'Funkcja', 'Posiedzenia', 'Cała', 'Częściowa', 'Nieobecność', 'Frekwencja', 'Głosowania', ...(full ? ['Imienne za, przeciw, wstrzymanie się'] : []), 'Między posiedzeniami'];
  const body = r.persons.map(p => {
    const f = turnout(p);
    const cells = [p.label, p.meetings.held, p.meetings.cala, p.meetings.czesciowa, p.meetings.nieobecnosc, f === null ? '–' : `${f}% (${p.meetings.cala + p.meetings.czesciowa} z ${p.meetings.held})`,
      `${p.sessionVotes.cast} z ${p.sessionVotes.eligible}`, ...(full ? [`${p.sessionVotes.imienne.za}, ${p.sessionVotes.imienne.przeciw}, ${p.sessionVotes.imienne.wstrzymuje}`] : []), `${p.procedureVotes.cast} z ${p.procedureVotes.eligible}`];
    return `<tr><th scope="row">${tx(p.name)}</th>${cells.map(c => `<td>${tx(String(c))}</td>`).join('')}</tr>`;
  }).join('');
  const note = full ? `<p class="muted">${tx('Rozkład głosów tylko z głosowań imiennych. Głosowania tajne liczą się wyłącznie jako pobranie karty.')}</p>`
    : `<p class="muted">${tx('Wersja do sprawozdania z obecnością, frekwencją i udziałem w głosowaniach, bez głosów.')}</p>`;
  return `${head}${summary}<div class="table-wrap" role="region" tabindex="0" aria-label="${tx('Statystyki składu')}"><table><thead><tr>${cols.map(c => `<th scope="col">${tx(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>${note}${lines}`;
}
