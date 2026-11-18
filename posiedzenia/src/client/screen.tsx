import {itemNumber, presentMembers, quorumFor} from '../shared/rules.ts';
import {organMembers} from '../shared/roster.ts';
import type {Meeting} from '../shared/types.ts';
import {useLive, useNow} from './api.ts';
import type {ViewMeeting} from './context.ts';
import {useSession} from './session.ts';
import {Countdown, fmtTime} from './ui.tsx';
import {ResultCard} from './meeting.tsx';
import {brand} from './brand.ts';

// Ekran sali / projektor: duże, czytelne informacje bez elementów sterowania.
export function RoomScreen({id}: {id: string}) {
  const s = useSession();
  const {data, error} = useLive<{meeting: ViewMeeting}>(`/api/meetings/${id}`, 1500);
  const now = useNow(1000);
  if (!data) return <main class="screen"><p>{error || 'Wczytywanie…'}</p></main>;
  const m = data.meeting;
  const total = organMembers(s.roster, m.organ).length, present = presentMembers(m as unknown as Meeting, s.roster).length;
  const open = m.ballots.find(b => b.status === 'otwarte');
  const shown = m.presentation;
  const result = shown?.kind === 'wynik' ? m.ballots.find(b => b.id === shown.id) : null;
  const current = m.agenda.find(i => i.id === (shown?.kind === 'punkt' ? shown.id : m.currentItemId));
  const material = shown?.kind === 'material' ? m.materials.find(x => x.id === shown.id) : null;
  let body;
  if (open) {
    const cast = open.secret ? open.secret.cast : open.voted.length;
    const eligible = open.eligible.length - open.absentDuring.filter(x => !open.voted.includes(x)).length;
    body = <div class="screen-vote"><p class="screen-kicker">Głosowanie nr {open.number} · {open.mode}</p><h1>{open.subject}</h1>
      <p class="screen-big"><Countdown endsAt={open.endsAt} label={false}/></p><p class="screen-sub">Oddano {cast} z {eligible} głosów</p></div>;
  } else if (result) body = <ResultCard b={result} big/>;
  else if (material) body = <div><p class="screen-kicker">Materiał</p><h1>{material.title}</h1><p class="screen-sub">Pełna treść jest dostępna na telefonach uczestników.</p></div>;
  else if (current) body = <div><p class="screen-kicker">Punkt {itemNumber(m.agenda, current.id)}</p><h1>{current.title}</h1>{current.presenter && <p class="screen-sub">Przedstawia: {current.presenter}</p>}</div>;
  else body = <div><h1>{m.title}</h1></div>;
  return <main class="screen">
    <header class="screen-head"><span>{brand.demo && <a class="screen-back" href={`#p-${m.id}`}>← Wróć</a>}{m.title}</span><span>{fmtTime(now)}</span></header>
    <section class="screen-body">{m.status === 'przerwa' ? <h1>Przerwa w obradach</h1> : m.status === 'zakonczone' ? <h1>Posiedzenie zamknięte</h1> : body}</section>
    <footer class="screen-foot">Obecnych {present} z {total} · kworum {quorumFor(total)}{m.chair.current ? ` · prowadzi: ${s.personName(m.chair.current)}` : ''}</footer>
  </main>;
}
