import {useState} from 'preact/hooks';
import type {Meeting} from '../shared/types.ts';
import {request, useLive} from './api.ts';
import {useSession} from './session.ts';
import {Button, Chip, Field, fmtDate, fmtDateTime, Modal, Notice, useAction} from './ui.tsx';

interface Summary {
  id: string; kind: Meeting['kind']; title: string; date: string; time: string; place: string; mode: Meeting['mode'];
  status: Meeting['status']; endsAt: number | null; openBallots: number; ballots: number; current: string | null;
}
export const statusLabel: Record<Meeting['status'], [string, string]> = {
  przygotowanie: ['W przygotowaniu', 'plain'], trwa: ['Trwa', 'live'], przerwa: ['Przerwa', 'warn'], zakonczone: ['Zakończone', 'done'],
};

export function Home() {
  const s = useSession();
  const {data, error} = useLive<{meetings: Summary[]}>('/api/meetings', 5000);
  const [creating, setCreating] = useState<Meeting['kind'] | null>(null);
  const organizer = s.isOrganizer('prezydium');
  const list = data?.meetings ?? [];
  const live = list.filter(m => m.status === 'trwa' || m.status === 'przerwa');
  const prep = list.filter(m => m.status === 'przygotowanie').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const done = list.filter(m => m.status === 'zakonczone');
  return <div class="home">
    <section class="home-head">
      <div><h1>Posiedzenia i głosowania</h1><p class="muted">Prezydium Okręgowej Rady Pielęgniarek i Położnych w Słupsku · IX kadencja 2024–2028</p></div>
      {organizer && <div class="actions">
        <Button kind="primary" onClick={() => setCreating('posiedzenie')}>Nowe posiedzenie</Button>
        <Button onClick={() => setCreating('procedura')}>Głosowanie między posiedzeniami</Button>
      </div>}
    </section>
    {error && <Notice tone="error">{error}</Notice>}
    {!data && !error && <p class="muted">Wczytywanie…</p>}
    {data && !list.length && <div class="empty card"><h2>Nie ma jeszcze posiedzeń</h2><p class="muted">{organizer ? 'Utwórz pierwsze posiedzenie przyciskiem powyżej.' : 'Gdy biuro przygotuje posiedzenie, pojawi się tutaj.'}</p></div>}
    {live.length > 0 && <Group title="Trwa teraz" items={live}/>}
    {prep.length > 0 && <Group title="W przygotowaniu" items={prep}/>}
    {done.length > 0 && <Group title="Zakończone" items={done}/>}
    {creating && <CreateMeeting kind={creating} onClose={() => setCreating(null)}/>}
  </div>;
}

function Group(props: {title: string; items: Summary[]}) {
  return <section class="group"><h2 class="group-title">{props.title}</h2><div class="cards">{props.items.map(m => <MeetingCard m={m}/>)}</div></section>;
}

function MeetingCard({m}: {m: Summary}) {
  const [label, tone] = statusLabel[m.status];
  return <a class={'card meeting-card' + (m.status === 'trwa' ? ' is-live' : '')} href={`#/p/${m.id}`}>
    <div class="meeting-card-top"><Chip tone={tone}>{label}</Chip><span class="muted small">{m.kind === 'posiedzenie' ? (m.mode === 'zdalne' ? 'Posiedzenie zdalne' : 'Posiedzenie stacjonarne') : 'Głosowanie między posiedzeniami'}</span></div>
    <h3>{m.title}</h3>
    <p class="muted">{m.kind === 'posiedzenie' ? `${fmtDate(m.date)}, godz. ${m.time}` : m.endsAt ? `Głosowanie do ${fmtDateTime(m.endsAt)}` : 'Termin do ustalenia'}{m.place && m.kind === 'posiedzenie' ? ` · ${m.place}` : ''}</p>
    {m.status !== 'przygotowanie' && m.current && m.kind === 'posiedzenie' && m.status !== 'zakonczone' && <p class="small">Teraz: {m.current}</p>}
    {m.openBallots > 0 && <p class="small strong live-text">Trwa głosowanie</p>}
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
        location.hash = `#/p/${meeting.id}`;
      });
    }}>
      {procedure && <Notice>§ 14 ust. 5 Regulaminu: Prezydium może podejmować uchwały między posiedzeniami zdalnie. Członkowie głosują w wyznaczonym czasie, a w tym czasie działa wspólny kanał wiadomości.</Notice>}
      <Field label="Tytuł"><input name="title" required maxLength={200} defaultValue={procedure ? 'Głosowanie między posiedzeniami Prezydium ORPiP' : 'Posiedzenie Prezydium ORPiP'}/></Field>
      {procedure
        ? <Field label="Koniec głosowania" hint="Głosowanie zakończy się wcześniej, gdy zagłosują wszyscy uprawnieni. Termin można zmienić przed rozpoczęciem."><input name="endsAt" type="datetime-local" required defaultValue={local(tomorrow)}/></Field>
        : <>
          <div class="row"><Field label="Data"><input name="date" type="date" required defaultValue={tomorrow.toISOString().slice(0, 10)}/></Field><Field label="Godzina"><input name="time" type="time" required defaultValue="10:00"/></Field></div>
          <Field label="Miejsce"><input name="place" maxLength={200} defaultValue="Siedziba OIPiP, ul. Poniatowskiego 4, Słupsk"/></Field>
          <Field label="Tryb" hint="Posiedzenie zdalne wymaga dwustronnej komunikacji w czasie rzeczywistym (§ 14 ust. 5) — dodasz odnośnik do połączenia."><select name="mode"><option value="stacjonarne">Stacjonarne</option><option value="zdalne">Zdalne</option></select></Field>
        </>}
      {error && <Notice tone="error">{error}</Notice>}
      <div class="actions"><Button onClick={props.onClose}>Anuluj</Button><Button kind="primary" type="submit" disabled={busy}>Utwórz</Button></div>
    </form>
  </Modal>;
}
