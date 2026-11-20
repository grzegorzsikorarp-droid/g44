import {useEffect, useRef, useState} from 'preact/hooks';
import type {Meeting, MeetingMode} from '../shared/types.ts';
import {lawOf} from '../shared/law.ts';
import {organSettingsOf, type MeetingTemplate} from '../shared/settings.ts';
import {organOfCode} from '../shared/roster.ts';
import {hoursText, isoDayOf} from '../shared/text.ts';
import {request, useLive} from './api.ts';
import {useSession} from './session.ts';
import {useGeneral} from './general.ts';
import {dateHintText, OrganFact, sourceLineText} from './cascade-ui.tsx';
import {Button, Chip, ErrorNotice, Fact, Field, fmtDateTime, fmtShort, LinkButton, Modal, Notice, plural, SectionHead, Segments, StateChip, useAction} from './ui.tsx';
import {meetingState} from './stany.ts';
import {brand} from './brand.ts';
import {go} from './route.ts';
import {mayProposeWaiting} from './prep-rules.ts';
import {ProposalDialog, WaitingDialog, waitingSentence} from './workspace.tsx';
import type {Proposal} from '../shared/workspace.ts';

interface Summary {
  id: string; kind: Meeting['kind']; title: string; date: string; time: string; place: string; mode: Meeting['mode'];
  status: Meeting['status']; endsAt: number | null; openBallots: number; ballots: number; current: string | null; currentNumber: string | null;
  /** Spotkanie robocze bez kworum (F5). */
  working?: boolean;
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
  const actor = {account: s.account, personId: s.personId, name: s.name};
  const recent = [...done].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  return <>
    <header class="oi-hero page-head page-head--niski">
      <div class="page page--kolumna oi-hero__in">
        <h1>Posiedzenia <b>Prezydium</b></h1>
        <p class="oi-hero__lead">{brand.organ}{brand.term ? `, ${brand.term}` : ''}.</p>
        {s.can.catalog && <MeetingsTabs current="biezace"/>}
        {/* Gdy trwa posiedzenie albo głosowanie, przyciskiem głównym ekranu jest przejście do niego (pas pod nagłówkiem). */}
        {organizer && <div class="actions">
          <Button kind={live.length ? 'secondary' : 'primary'} haspopup onClick={() => setCreating('posiedzenie')}>Przygotuj posiedzenie</Button>
          {lawOf(ORGAN).betweenMeetings.allowed && <Button haspopup onClick={() => setCreating('procedura')}>Przygotuj głosowanie między posiedzeniami</Button>}
        </div>}
      </div>
    </header>
    <div class="page page--kolumna groups">
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {!data && !error && <p class="muted">Wczytywanie…</p>}
      {data && !list.length && <section class="oi-card"><h2 class="oi-card__title"><span class="oi-mark" aria-hidden="true"/><span>Nie ma jeszcze posiedzeń</span></h2><p class="muted">{organizer ? 'Utwórz pierwsze posiedzenie przyciskiem „Przygotuj posiedzenie”.' : 'Gdy biuro przygotuje posiedzenie, pojawi się tutaj.'}</p></section>}
      {live.length > 0 && <div class="live-bands">{live.map((m, i) => <LiveBand key={m.id} m={m} primary={i === 0}/>)}</div>}
      {prep.length > 0 && <Group title={organizer ? 'W przygotowaniu' : 'Zaplanowane'} items={prep} organizer={organizer}/>}
      {done.length > 0 && <Group title="Zakończone" items={s.can.catalog ? recent.slice(0, 3) : done} organizer={organizer}
        more={s.can.catalog ? <a class="oi-link" href="#odbyte">{`Wszystkie odbyte posiedzenia (${done.length})`}</a> : undefined}/>}
      {data && !prep.length && <Waiting organizer={organizer} proposer={mayProposeWaiting(s.roster, ORGAN, actor)}/>}
    </div>
    {creating && <CreateMeeting kind={creating} onClose={() => setCreating(null)}/>}
  </>;
}

// Trwające posiedzenie albo głosowanie: pas z etykietą, zdaniem o bieżącym punkcie i przyciskiem. Przycisk główny
// ma tylko pierwszy pas, kolejne mają obrys (najwyżej jeden przycisk główny w kolumnie).
function LiveBand({m, primary}: {m: Summary; primary: boolean}) {
  const procedure = m.kind === 'procedura';
  const text = procedure
    ? `${m.title}. Trwa do ${m.endsAt ? fmtDateTime(m.endsAt) : '–'}.`
    : `${m.title}, ${fmtShort(m.date)}.${m.current ? ` Bieżący punkt ${m.currentNumber} ${quote(m.current)}.` : ''}`;
  return <div class="oi-note live-band">
    <div class="live-band__text"><span class="oi-label">{procedure ? 'Trwa głosowanie między posiedzeniami' : m.working ? 'Trwa spotkanie robocze' : 'Trwa posiedzenie'}</span><p>{text}</p></div>
    <LinkButton primary={primary} href={`#p-${m.id}`}>{procedure ? 'Przejdź do głosowania' : 'Przejdź do obrad'}</LinkButton>
  </div>;
}

function Group(props: {title: string; items: Summary[]; organizer: boolean; more?: preact.ComponentChildren}) {
  return <section>
    <SectionHead count={counts(props.items)}>{props.title}</SectionHead>
    <ul class="register">{props.items.map(m => <li key={m.id}><MeetingRow m={m} organizer={props.organizer}/></li>)}</ul>
    {props.more && <p class="group-more">{props.more}</p>}
  </section>;
}

/**
 * Zakładki strony „Posiedzenia” (6.1, DB-8): „Bieżące” (`#`) i „Odbyte” (`#odbyte`). Zespół F montuje je w nagłówku
 * strony „Odbyte posiedzenia” (catalog.tsx) z `current="odbyte"`. Konto „Komunikacja” ich nie ma.
 */
export function MeetingsTabs(props: {current: 'biezace' | 'odbyte'}) {
  return <nav class="oi-seg meetings-tabs" aria-label="Posiedzenia">
    <a class="oi-opt" href="#" aria-current={props.current === 'biezace' ? 'page' : undefined}>Bieżące</a>
    <a class="oi-opt" href="#odbyte" aria-current={props.current === 'odbyte' ? 'page' : undefined}>Odbyte</a>
  </nav>;
}

/**
 * Gdy żadne posiedzenie nie jest w przygotowaniu (6.1, B2-W06): osoby z prawem zgłoszenia mają cichy przycisk „Zgłoś sprawę
 * na najbliższe posiedzenie”, a osoby przygotowujące fakt „Zgłoszenia czekające na posiedzenie {n}” z „Pokaż”. Zbiór
 * czekających wczytuje się raz przy wejściu na listę, bez odpytywania.
 */
function Waiting(props: {organizer: boolean; proposer: boolean}) {
  const [list, setList] = useState<Proposal[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [showing, setShowing] = useState(false);
  const [saved, setSaved] = useState('');
  const load = () => request<{prep: {proposals: Proposal[]}}>(`/api/organs/${ORGAN}/czekajace`).then(r => setList(r.prep.proposals.filter(p => p.state === 'zgloszone'))).catch(() => setList([]));
  useEffect(() => { if (props.organizer) load(); }, [props.organizer]);
  if (!props.organizer && !props.proposer) return null;
  return <section class="waiting stack-tight">
    {props.organizer && list && <p class="waiting-fact">{waitingSentence(list.length)}{list.length > 0 && <> <Button kind="ghost" small quiet haspopup onClick={() => setShowing(true)}>Pokaż</Button></>}</p>}
    {props.proposer && <div><Button kind="ghost" quiet haspopup onClick={() => setAsking(true)}>Zgłoś sprawę na najbliższe posiedzenie</Button></div>}
    <p role="status" class="save-status">{saved}</p>
    {asking && <ProposalDialog organ={ORGAN} onClose={() => setAsking(false)} onDone={() => { setAsking(false); setSaved(`Zapisano o godz. ${new Intl.DateTimeFormat('pl-PL', {timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit'}).format(Date.now())}.`); if (props.organizer) load(); }}/>}
    {showing && list && <WaitingDialog proposals={list} onClose={() => setShowing(false)}/>}
  </section>;
}

// Wiersz rejestru: blok daty, rodzaj, tytuł i opis, a z prawej znacznik stanu i napis działania.
function MeetingRow({m, organizer}: {m: Summary; organizer: boolean}) {
  const procedure = m.kind === 'procedura';
  const kind = procedure ? 'Głosowanie między posiedzeniami' : m.mode === 'zdalne' ? 'Posiedzenie zdalne' : 'Posiedzenie stacjonarne';
  const iso = procedure && m.endsAt ? warsawDay(m.endsAt) : m.date;
  const day = dateParts(iso);
  const meta = procedure ? (m.endsAt ? `${m.status === 'trwa' ? 'Trwa do' : 'Głosowanie do'} ${fmtDateTime(m.endsAt)}` : m.status === 'przygotowanie' ? 'Termin liczy się od rozpoczęcia' : 'Termin do ustalenia') : `godz. ${m.time}${m.place ? `, ${m.place}` : ''}`;
  const action = m.status === 'zakonczone' ? 'Zobacz wyniki'
    : m.status === 'przygotowanie' ? (organizer ? 'Otwórz przygotowanie' : procedure ? 'Zobacz sprawy i materiały' : 'Zobacz porządek i materiały')
    : procedure ? 'Przejdź do głosowania' : 'Przejdź do obrad';
  return <a class="oi-card oi-card--aktywna meeting-row" href={`#p-${m.id}`}>
    <time class="row-date" dateTime={iso}><span class="row-date__day">{day.day}</span><span class="row-date__month">{day.month}</span><span class="row-date__weekday">{day.weekday}</span></time>
    <div class="row-main"><span class="kicker">{kind}</span><h3 class="oi-card__title row-title">{m.title}</h3><span class="row-meta">{meta}</span></div>
    <div class="row-side"><span class="row-chips"><StateChip state={meetingState(m.status, !organizer)}/>{m.working && <Chip>Spotkanie robocze</Chip>}</span><span class="row-act">{action}</span></div>
  </a>;
}

// Okno „Nowe posiedzenie” (wersja 3, rozdz. 5.3): organ jako fakt, rodzaj, wzór posiedzenia, tytuł, termin, miejsce
// i tryb. Wartości domyślne pochodzą z ustawień ogólnych i wzoru posiedzenia (useGeneral), a regulamin decyduje, czy
// organ ma głosowania między posiedzeniami i posiedzenia zdalne.
function CreateMeeting(props: {kind: Meeting['kind']; onClose: () => void}) {
  const {roster} = useSession();
  const bundle = useGeneral();
  const {busy, error, errorKind, run} = useAction();
  const law = lawOf(ORGAN);
  const organ = organOfCode(roster, ORGAN);
  const settings = bundle ? organSettingsOf(bundle.general, ORGAN) : null;
  const templates = settings?.templates ?? [];
  const sitePlace = bundle?.general.site.place ?? brand.place;
  const [kind, setKind] = useState<Meeting['kind']>(props.kind === 'procedura' && law.betweenMeetings.allowed ? 'procedura' : 'posiedzenie');
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const template = templates.find(t => t.id === templateId) ?? templates[0];
  const [mode, setMode] = useState<MeetingMode>(template?.defaults?.mode ?? 'stacjonarne');
  const [time, setTime] = useState(template?.defaults?.time ?? '10:00');
  const [date, setDate] = useState(() => isoDayOf(Date.now() + (law.notice.minDays + 1) * 86400000));
  const [place, setPlace] = useState(sitePlace);
  const [touched, setTouched] = useState({mode: false, time: false});
  const procedure = kind === 'procedura';
  const [title, setTitle] = useState<string | null>(null);
  const defaultTitle = procedure ? `Głosowanie między posiedzeniami ${organ.forms.genitive}` : `Posiedzenie ${organ.forms.genitive}`;
  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find(x => x.id === id);
    if (!touched.mode) setMode(t?.defaults?.mode ?? 'stacjonarne');
    if (!touched.time) setTime(t?.defaults?.time ?? '10:00');
  };
  const noticeDay = date ? isoDayOf(Date.parse(date + 'T12:00:00Z') - law.notice.minDays * 86400000) : '';
  const tooSoon = !procedure && !!date && noticeDay < isoDayOf(Date.now());
  const count = (t: MeetingTemplate) => t.items.length + t.items.reduce((n, i) => n + (i.children?.length ?? 0), 0);
  const describe = (t: MeetingTemplate) => `${t.name}, ${count(t)} ${plural(count(t), 'punkt', 'punkty', 'punktów')}`;
  const kinds: [Meeting['kind'], string][] = law.betweenMeetings.allowed ? [['posiedzenie', 'Posiedzenie'], ['procedura', 'Głosowanie między posiedzeniami']] : [['posiedzenie', 'Posiedzenie']];
  const modes: [MeetingMode, string][] = law.remote.allowed ? [['stacjonarne', 'Stacjonarne'], ['zdalne', 'Zdalne']] : [['stacjonarne', 'Stacjonarne']];
  const placeSource = place.trim() === sitePlace.trim() && sitePlace ? sourceLineText({value: sitePlace, source: 'ogolne', level: 1}, 'posiedzenie') : '';
  return <Modal title={procedure ? 'Nowe głosowanie między posiedzeniami' : 'Nowe posiedzenie'} onClose={props.onClose}>
    <form class="stack" onSubmit={e => {
      e.preventDefault();
      run(async () => {
        const body = procedure
          ? {kind: 'procedura', organ: ORGAN, title: (title ?? defaultTitle).trim() || defaultTitle}
          : {kind: 'posiedzenie', organ: ORGAN, template: template?.id, title: (title ?? defaultTitle).trim() || defaultTitle, date, time, place, mode};
        const {meeting} = await request<{meeting: Meeting}>('/api/meetings', {body});
        go(`#p-${meeting.id}`);
      });
    }}>
      <OrganFact organ={ORGAN}/>
      <Segments label="Rodzaj" value={kind} options={kinds} onChange={setKind}
        hint={law.betweenMeetings.allowed ? undefined : law.betweenMeetings.reason}/>
      {procedure && <Notice>{`Prezydium może podejmować uchwały także między posiedzeniami, w głosowaniu zdalnym (§ 14 ust. 5 ${organ.forms.regulation}). Członkowie głosują w wyznaczonym czasie i mogą wtedy pisać we wspólnym kanale wiadomości.`}</Notice>}
      {!procedure && template && (templates.length > 1
        ? <Segments column label="Wzór posiedzenia" value={template.id} options={templates.map(t => [t.id, describe(t)] as [string, string])} onChange={pickTemplate}/>
        : <dl class="facts"><Fact label="Wzór posiedzenia">{describe(template)}</Fact></dl>)}
      <Field label="Tytuł"><input name="title" maxLength={200} value={title ?? defaultTitle} onInput={e => setTitle((e.target as HTMLInputElement).value)}/></Field>
      {procedure
        // DA-21: domyślny termin liczy się od rozpoczęcia głosowania, więc okno pokazuje go jako fakt. Własny termin
        // wpisuje się w ustawieniach głosowania w przygotowaniu.
        ? <dl class="facts"><Fact label="Koniec głosowania">{`${hoursText(settings?.procedureHours ?? 24)} od rozpoczęcia`}<span class="fact-note">Jak w ustawieniach ogólnych. Głosowanie zakończy się wcześniej, gdy zagłosują wszyscy uprawnieni. Inny termin możesz wpisać w ustawieniach głosowania przed rozpoczęciem.</span></Fact></dl>
        : <>
          <div class="row row-top">
            <Field label="Data" hint={[dateHintText(date), tooSoon ? `Do tej daty nie zdążysz wysłać zawiadomienia na ${law.notice.minDays} dni przed posiedzeniem (${law.notice.basis}). Krótszy termin trafi do protokołu.` : ''].filter(Boolean).join(' ') || undefined}>
              <input name="date" type="date" required value={date} onInput={e => setDate((e.target as HTMLInputElement).value)}/>
            </Field>
            <Field label="Godzina"><input name="time" type="time" required value={time} onInput={e => { setTouched(t => ({...t, time: true})); setTime((e.target as HTMLInputElement).value); }}/></Field>
          </div>
          <Field label="Miejsce" hint={placeSource || undefined}><input name="place" maxLength={200} value={place} onInput={e => setPlace((e.target as HTMLInputElement).value)}/></Field>
          <Segments label="Tryb" value={mode} options={modes} onChange={v => { setTouched(t => ({...t, mode: true})); setMode(v); }}
            hint={law.remote.allowed ? 'Posiedzenie zdalne wymaga dwustronnej komunikacji w czasie rzeczywistym (§ 14 ust. 5). Odnośnik do połączenia dodasz w danych posiedzenia.' : law.remote.reason}/>
        </>}
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>{procedure ? 'Utwórz głosowanie' : 'Utwórz posiedzenie'}</Button><Button onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

const ORGAN = 'prezydium' as const;
