import {useEffect, useRef, useState} from 'preact/hooks';
import type {Meeting} from '../shared/types.ts';
import {request, useLive} from './api.ts';
import {useSession} from './session.ts';
import {Button, ErrorNotice, Field, fmtDateTime, fmtShort, LinkButton, Modal, Notice, plural, SectionHead, StateChip, useAction} from './ui.tsx';
import {meetingState} from './stany.ts';
import {Segments} from './prep.tsx';
import {brand} from './brand.ts';
import {go} from './route.ts';

interface Summary {
  id: string; kind: Meeting['kind']; title: string; date: string; time: string; place: string; mode: Meeting['mode'];
  status: Meeting['status']; endsAt: number | null; openBallots: number; ballots: number; current: string | null; currentNumber: string | null;
}

// Znacznik zapisany po zalogowaniu (app.tsx). Przy pierwszym wczytaniu listy członek Prezydium przechodzi
// do jedynego trwającego posiedzenia albo głosowania, a znacznik znika. Bez pamięci karty listy nic nie zmienia.
const FRESH = 'posiedzenia:po-logowaniu';
function takeFresh() {
  try { const fresh = sessionStorage.getItem(FRESH) !== null; sessionStorage.removeItem(FRESH); return fresh; } catch { return false; }
}

// Licznik sekcji: „1 posiedzenie”, „2 posiedzenia, 1 głosowanie”.
function counts(items: Summary[]) {
  const sittings = items.filter(m => m.kind === 'posiedzenie').length, votes = items.length - sittings;
  return [
    sittings ? `${sittings} ${plural(sittings, 'posiedzenie', 'posiedzenia', 'posiedzeń')}` : '',
    votes ? `${votes} ${plural(votes, 'głosowanie', 'głosowania', 'głosowań')}` : '',
  ].filter(Boolean).join(', ');
}

// Dzień posiedzenia albo terminu głosowania w strefie Europe/Warsaw: „2026-11-19”.
const warsawDay = (ts: number) => new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit'}).format(ts);
function dateParts(iso: string) {
  const parts = new Intl.DateTimeFormat('pl-PL', {timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}).formatToParts(Date.parse(iso + 'T12:00:00Z'));
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return {day: part('day'), month: `${part('month')} ${part('year')}`, weekday: part('weekday')};
}
const quote = (text: string) => `„${text.replace(/„/g, '»').replace(/”/g, '«')}”`;

export function Home() {
  const s = useSession();
  const {data, error} = useLive<{meetings: Summary[]}>('/api/meetings', 5000);
  const [creating, setCreating] = useState<Meeting['kind'] | null>(null);
  const organizer = s.isOrganizer('prezydium');
  const list = data?.meetings ?? [];
  const live = list.filter(m => m.status === 'trwa' || m.status === 'przerwa');
  const prep = list.filter(m => m.status === 'przygotowanie').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const done = list.filter(m => m.status === 'zakonczone');
  // Znacznik zużywa się przy pierwszym pokazaniu listy, a decyzja zapada po pierwszym wczytaniu danych.
  const fresh = useRef<boolean | null>(null);
  if (fresh.current === null) fresh.current = takeFresh();
  useEffect(() => {
    if (!data || !fresh.current) return;
    fresh.current = false;
    if (!s.isMember('prezydium')) return;
    const now = data.meetings.filter(m => m.status === 'trwa' || m.status === 'przerwa');
    if (now.length === 1) go(`#p-${now[0].id}`);
  }, [data]);
  return <>
    <header class="oi-hero page-head page-head--niski">
      <div class="page page--kolumna oi-hero__in">
        <h1>Posiedzenia <b>Prezydium</b></h1>
        <p class="oi-hero__lead">{brand.organ}{brand.term ? `, ${brand.term}` : ''}.</p>
        {organizer && <div class="actions">
          <Button kind="primary" haspopup onClick={() => setCreating('posiedzenie')}>Przygotuj posiedzenie</Button>
          <Button haspopup onClick={() => setCreating('procedura')}>Przygotuj głosowanie między posiedzeniami</Button>
        </div>}
      </div>
    </header>
    <div class="page page--kolumna groups">
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {!data && !error && <p class="muted">Wczytywanie…</p>}
      {data && !list.length && <section class="oi-card"><h2 class="oi-card__title"><span class="oi-mark" aria-hidden="true"/><span>Nie ma jeszcze posiedzeń</span></h2><p class="muted">{organizer ? 'Utwórz pierwsze posiedzenie przyciskiem „Przygotuj posiedzenie”.' : 'Gdy biuro przygotuje posiedzenie, pojawi się tutaj.'}</p></section>}
      {live.length > 0 && <div class="live-bands">{live.map(m => <LiveBand key={m.id} m={m}/>)}</div>}
      {prep.length > 0 && <Group title={organizer ? 'W przygotowaniu' : 'Zaplanowane'} items={prep} organizer={organizer}/>}
      {done.length > 0 && <Group title="Zakończone" items={done} organizer={organizer}/>}
    </div>
    {creating && <CreateMeeting kind={creating} onClose={() => setCreating(null)}/>}
  </>;
}

// Trwające posiedzenie albo głosowanie: pas z etykietą, zdaniem o bieżącym punkcie i przyciskiem głównym.
function LiveBand({m}: {m: Summary}) {
  const procedure = m.kind === 'procedura';
  const text = procedure
    ? `${m.title}. Głosowanie do ${m.endsAt ? fmtDateTime(m.endsAt) : '–'}.`
    : `${m.title}, ${fmtShort(m.date)}.${m.current ? ` Bieżący punkt ${m.currentNumber} ${quote(m.current)}.` : ''}`;
  return <div class="oi-note live-band">
    <div class="live-band__text"><span class="oi-label">{procedure ? 'Trwa głosowanie między posiedzeniami' : 'Trwa posiedzenie'}</span><p>{text}</p></div>
    <LinkButton primary href={`#p-${m.id}`}>{procedure ? 'Przejdź do głosowania' : 'Przejdź do obrad'}</LinkButton>
  </div>;
}

function Group(props: {title: string; items: Summary[]; organizer: boolean}) {
  return <section>
    <SectionHead count={counts(props.items)}>{props.title}</SectionHead>
    <ul class="register">{props.items.map(m => <li key={m.id}><MeetingRow m={m} organizer={props.organizer}/></li>)}</ul>
  </section>;
}

// Wiersz rejestru: blok daty, rodzaj, tytuł i opis, a z prawej znacznik stanu i napis działania.
function MeetingRow({m, organizer}: {m: Summary; organizer: boolean}) {
  const procedure = m.kind === 'procedura';
  const kind = procedure ? 'Głosowanie między posiedzeniami' : m.mode === 'zdalne' ? 'Posiedzenie zdalne' : 'Posiedzenie stacjonarne';
  const iso = procedure && m.endsAt ? warsawDay(m.endsAt) : m.date;
  const day = dateParts(iso);
  const meta = procedure ? (m.endsAt ? `Głosowanie do ${fmtDateTime(m.endsAt)}` : 'Termin do ustalenia') : `godz. ${m.time}${m.place ? `, ${m.place}` : ''}`;
  const action = m.status === 'zakonczone' ? 'Zobacz wyniki'
    : m.status === 'przygotowanie' ? (organizer ? 'Otwórz przygotowanie' : procedure ? 'Zobacz sprawy i materiały' : 'Zobacz porządek i materiały')
    : procedure ? 'Przejdź do głosowania' : 'Przejdź do obrad';
  return <a class="oi-card oi-card--aktywna meeting-row" href={`#p-${m.id}`}>
    <time class="row-date" dateTime={iso}><span class="row-date__day">{day.day}</span><span class="row-date__month">{day.month}</span><span class="row-date__weekday">{day.weekday}</span></time>
    <div class="row-main"><span class="kicker">{kind}</span><h3 class="oi-card__title row-title">{m.title}</h3><span class="row-meta">{meta}</span></div>
    <div class="row-side"><StateChip state={meetingState(m.status, !organizer)}/><span class="row-act">{action}</span></div>
  </a>;
}

function CreateMeeting(props: {kind: Meeting['kind']; onClose: () => void}) {
  const {busy, error, errorKind, run} = useAction();
  const [mode, setMode] = useState<Meeting['mode']>('stacjonarne');
  const tomorrow = new Date(Date.now() + 86400000);
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const procedure = props.kind === 'procedura';
  return <Modal title={procedure ? 'Nowe głosowanie między posiedzeniami' : 'Nowe posiedzenie Prezydium'} onClose={props.onClose}>
    <form class="stack" onSubmit={e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run(async () => {
        const body = procedure
          ? {kind: 'procedura', title: f.get('title'), endsAt: new Date(String(f.get('endsAt'))).getTime(), date: String(f.get('endsAt')).slice(0, 10)}
          : {kind: 'posiedzenie', title: f.get('title'), date: f.get('date'), time: f.get('time'), place: f.get('place'), mode};
        const {meeting} = await request<{meeting: Meeting}>('/api/meetings', {body});
        go(`#p-${meeting.id}`);
      });
    }}>
      {procedure && <Notice>{`Prezydium może podejmować uchwały także między posiedzeniami, w głosowaniu zdalnym (§ 14 ust. 5 ${brand.regulation}). Członkowie głosują w wyznaczonym czasie i mogą wtedy pisać we wspólnym kanale wiadomości.`}</Notice>}
      <Field label="Tytuł"><input name="title" required maxLength={200} defaultValue={procedure ? brand.procedureTitle : brand.meetingTitle}/></Field>
      {procedure
        ? <Field label="Koniec głosowania" hint="Głosowanie zakończy się wcześniej, gdy zagłosują wszyscy uprawnieni. Termin można zmienić przed rozpoczęciem."><input name="endsAt" type="datetime-local" required defaultValue={local(tomorrow)}/></Field>
        : <>
          <div class="row"><Field label="Data"><input name="date" type="date" required defaultValue={tomorrow.toISOString().slice(0, 10)}/></Field><Field label="Godzina"><input name="time" type="time" required defaultValue="10:00"/></Field></div>
          <Field label="Miejsce"><input name="place" maxLength={200} defaultValue={brand.place}/></Field>
          <Segments label="Tryb" value={mode} options={[['stacjonarne', 'Stacjonarne'], ['zdalne', 'Zdalne']]} onChange={setMode}
            hint="Posiedzenie zdalne wymaga dwustronnej komunikacji w czasie rzeczywistym (§ 14 ust. 5). Odnośnik do połączenia dodasz w danych posiedzenia."/>
        </>}
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>{procedure ? 'Utwórz głosowanie' : 'Utwórz posiedzenie'}</Button><Button onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}
