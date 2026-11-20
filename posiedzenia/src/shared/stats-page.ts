import type {StatsResult} from './stats.ts';
import {statsSourceLines} from './stats.ts';
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
