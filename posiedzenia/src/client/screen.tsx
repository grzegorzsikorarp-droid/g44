import {itemNumber, presentMembers, quorumFor} from '../shared/rules.ts';
import {organMembers} from '../shared/roster.ts';
import type {Meeting} from '../shared/types.ts';
import {useLive, useNow} from './api.ts';
import type {ViewMeeting} from './context.ts';
import {useSession} from './session.ts';
import {Countdown, Fact, fmtTime, Tag} from './ui.tsx';
import {ResultCard} from './meeting.tsx';
import {Plate} from './plate.tsx';
import {brand} from './brand.ts';

const modeName = (mode: string) => mode === 'tajne' ? 'tajne' : mode === 'imienne' ? 'imienne' : 'jawne';

// Ekran sali, czyli projektor: duże, czytelne informacje bez elementów sterowania.
export function RoomScreen({id}: {id: string}) {
  const s = useSession();
  const {data, error} = useLive<{meeting: ViewMeeting}>(`/api/meetings/${id}`, 1500);
  const now = useNow(1000);
  if (!data) return <main class="screen"><div class="screen-body"><p class="screen-sub">{error || 'Wczytywanie…'}</p></div></main>;
  const m = data.meeting;
  const total = organMembers(s.roster, m.organ).length, present = presentMembers(m as unknown as Meeting, s.roster).length;
  const open = m.ballots.find(b => b.status === 'otwarte');
  const shown = m.presentation;
  const result = shown?.kind === 'wynik' ? m.ballots.find(b => b.id === shown.id) : null;
  const current = m.agenda.find(i => i.id === (shown?.kind === 'punkt' ? shown.id : m.currentItemId));
  const material = shown?.kind === 'material' ? m.materials.find(x => x.id === shown.id) : null;
  let body;
  if (m.status === 'przerwa') body = <h1>Przerwa w obradach</h1>;
  else if (m.status === 'zakonczone') body = <h1>Posiedzenie zamknięte</h1>;
  else if (open) {
    const cast = open.secret ? open.secret.cast : open.voted.length;
    const eligible = open.eligible.length - open.absentDuring.filter(x => !open.voted.includes(x)).length;
    body = <>
      <div class="oi-btns"><Tag>Głosowanie nr {open.number}</Tag><Tag dark>{modeName(open.mode)}</Tag></div>
      <h1>{open.subject}</h1>
      <p class="screen-big"><Countdown endsAt={open.endsAt} label={false}/></p>
      <p class="screen-sub">Oddano {cast} z {eligible} głosów</p>
    </>;
  } else if (result) body = <ResultCard b={result} big/>;
  else if (material) body = <><Tag>Materiał</Tag><h1>{material.title}</h1><p class="screen-sub">Pełna treść jest dostępna na telefonach uczestników.</p></>;
  else if (current) body = <><Tag>Punkt {itemNumber(m.agenda, current.id)}</Tag><h1>{current.title}</h1>{current.presenter && <p class="screen-sub">Przedstawia {current.presenter}</p>}</>;
  else body = <h1>{m.title}</h1>;
  return <main class="screen">
    <header class="screen-head">
      <Plate/>
      <div class="screen-head-title">{brand.demo && <a class="oi-link screen-back" href={`#p-${m.id}`}>Wróć do posiedzenia</a>}<strong>{m.title}</strong></div>
      <span class="screen-clock">{fmtTime(now)}</span>
    </header>
    <section class="screen-body">{body}</section>
    <footer class="screen-foot">
      <dl class="facts"><Fact label="Obecnych">{present} z {total}</Fact><Fact label="Kworum">{quorumFor(total)}</Fact>{m.chair.current && <Fact label="Prowadzi">{s.personName(m.chair.current)}</Fact>}</dl>
    </footer>
  </main>;
}
