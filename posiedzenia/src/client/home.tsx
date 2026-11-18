import {useState} from 'preact/hooks';
import type {Meeting} from '../shared/types.ts';
import {request, useLive} from './api.ts';
import {useSession} from './session.ts';
import {Button, Chip, Field, fmtDate, fmtDateTime, Modal, Notice, plural, SectionHead, Tag, useAction} from './ui.tsx';
import {brand} from './brand.ts';
import {go} from './route.ts';

interface Summary {
  id: string; kind: Meeting['kind']; title: string; date: string; time: string; place: string; mode: Meeting['mode'];
  status: Meeting['status']; endsAt: number | null; openBallots: number; ballots: number; current: string | null;
}
export const statusLabel: Record<Meeting['status'], [string, 'trwa' | 'otwarte' | 'zamkniete']> = {
  przygotowanie: ['W przygotowaniu', 'zamkniete'], trwa: ['Trwa', 'trwa'], przerwa: ['Przerwa', 'otwarte'], zakonczone: ['Zakończone', 'zamkniete'],
};
const count = (n: number) => `${n} ${plural(n, 'pozycja', 'pozycje', 'pozycji')}`;

export function Home() {
  const s = useSession();
  const {data, error} = useLive<{meetings: Summary[]}>('/api/meetings', 5000);
  const [creating, setCreating] = useState<Meeting['kind'] | null>(null);
  const organizer = s.isOrganizer('prezydium');
  const list = data?.meetings ?? [];
  const live = list.filter(m => m.status === 'trwa' || m.status === 'przerwa');
  const prep = list.filter(m => m.status === 'przygotowanie').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const done = list.filter(m => m.status === 'zakonczone');
  return <>
    <header class="oi-hero page-head">
      <div class="page oi-hero__in">
        <Tag>Posiedzenia i głosowania</Tag>
        <h1>Posiedzenia <b>Prezydium</b></h1>
        <p class="oi-hero__lead">{brand.organ}{brand.term ? `, ${brand.term}` : ''}.</p>
        {organizer && <div class="actions">
          <Button kind="primary" onClick={() => setCreating('posiedzenie')}>Nowe posiedzenie</Button>
          <Button onClick={() => setCreating('procedura')}>Głosowanie między posiedzeniami</Button>
        </div>}
      </div>
    </header>
    <div class="page groups">
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <p class="muted">Wczytywanie…</p>}
      {data && !list.length && <section class="oi-card"><h2 class="oi-card__title"><span class="oi-mark" aria-hidden="true"/><span>Nie ma jeszcze posiedzeń</span></h2><p class="muted">{organizer ? 'Utwórz pierwsze posiedzenie przyciskiem „Nowe posiedzenie”.' : 'Gdy biuro przygotuje posiedzenie, pojawi się tutaj.'}</p></section>}
      {live.length > 0 && <Group title="Trwa teraz" items={live}/>}
      {prep.length > 0 && <Group title="W przygotowaniu" items={prep}/>}
      {done.length > 0 && <Group title="Zakończone" items={done}/>}
    </div>
    {creating && <CreateMeeting kind={creating} onClose={() => setCreating(null)}/>}
  </>;
}

function Group(props: {title: string; items: Summary[]}) {
  return <section><SectionHead count={count(props.items.length)}>{props.title}</SectionHead><div class="cards">{props.items.map(m => <MeetingCard m={m}/>)}</div></section>;
}

function MeetingCard({m}: {m: Summary}) {
  const [label, tone] = statusLabel[m.status];
  const kind = m.kind === 'posiedzenie' ? (m.mode === 'zdalne' ? 'Posiedzenie zdalne' : 'Posiedzenie stacjonarne') : 'Głosowanie między posiedzeniami';
  return <a class="oi-card oi-card--aktywna meeting-card" href={`#p-${m.id}`}>
    <span class="oi-label">{kind}</span>
    <h3 class="oi-card__title"><span class="oi-mark" aria-hidden="true"/><span>{m.title}</span></h3>
    <span class="oi-card__meta">{m.kind === 'posiedzenie' ? `${fmtDate(m.date)}, godz. ${m.time}` : m.endsAt ? `Głosowanie do ${fmtDateTime(m.endsAt)}` : 'Termin do ustalenia'}{m.place && m.kind === 'posiedzenie' ? `, ${m.place}` : ''}</span>
    <div class="oi-card__foot">
      <div class="oi-btns"><Chip tone={tone}>{label}</Chip>{m.openBallots > 0 && <Chip tone="otwarte">Trwa głosowanie</Chip>}</div>
      {m.status !== 'przygotowanie' && m.current && m.kind === 'posiedzenie' && m.status !== 'zakonczone' && <p class="small">Teraz procedowany punkt {m.current}</p>}
    </div>
  </a>;
}

function CreateMeeting(props: {kind: Meeting['kind']; onClose: () => void}) {
  const {busy, error, run} = useAction();
  const tomorrow = new Date(Date.now() + 86400000);
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const procedure = props.kind === 'procedura';
  return <Modal title={procedure ? 'Głosowanie między posiedzeniami' : 'Nowe posiedzenie Prezydium'} onClose={props.onClose}>
    <form class="stack" onSubmit={e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run(async () => {
        const body = procedure
          ? {kind: 'procedura', title: f.get('title'), endsAt: new Date(String(f.get('endsAt'))).getTime(), date: String(f.get('endsAt')).slice(0, 10)}
          : {kind: 'posiedzenie', title: f.get('title'), date: f.get('date'), time: f.get('time'), place: f.get('place'), mode: f.get('mode')};
        const {meeting} = await request<{meeting: Meeting}>('/api/meetings', {body});
        go(`#p-${meeting.id}`);
      });
    }}>
      {procedure && <Notice>Zgodnie z § 14 ust. 5 Regulaminu Prezydium może podejmować uchwały między posiedzeniami zdalnie. Członkowie głosują w wyznaczonym czasie, a w tym czasie działa wspólny kanał wiadomości.</Notice>}
      <Field label="Tytuł"><input name="title" required maxLength={200} defaultValue={procedure ? brand.procedureTitle : brand.meetingTitle}/></Field>
      {procedure
        ? <Field label="Koniec głosowania" hint="Głosowanie zakończy się wcześniej, gdy zagłosują wszyscy uprawnieni. Termin można zmienić przed rozpoczęciem."><input name="endsAt" type="datetime-local" required defaultValue={local(tomorrow)}/></Field>
        : <>
          <div class="row"><Field label="Data"><input name="date" type="date" required defaultValue={tomorrow.toISOString().slice(0, 10)}/></Field><Field label="Godzina"><input name="time" type="time" required defaultValue="10:00"/></Field></div>
          <Field label="Miejsce"><input name="place" maxLength={200} defaultValue={brand.place}/></Field>
          <Field label="Tryb" hint="Posiedzenie zdalne wymaga dwustronnej komunikacji w czasie rzeczywistym (§ 14 ust. 5). Odnośnik do połączenia dodasz w danych posiedzenia."><select name="mode"><option value="stacjonarne">Stacjonarne</option><option value="zdalne">Zdalne</option></select></Field>
        </>}
      {error && <Notice tone="error">{error}</Notice>}
      <div class="actions"><Button kind="primary" type="submit" disabled={busy}>Utwórz</Button><Button onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}
