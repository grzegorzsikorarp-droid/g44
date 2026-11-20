import {useEffect, useState} from 'preact/hooks';
import {download, request, type MeetingData} from './api.ts';
import {useSession} from './session.ts';
import {useDocTypes} from './doctypes.ts';
import {MailDialog, MailHistory} from './mail.tsx';
import {Button, CardTitle, ErrorNotice, Fact, Modal, StateChip, useAction} from './ui.tsx';
import {checkChip, commsReleaseChip, paperStateChip, protocolChip} from './stany.ts';
import {meetingPapers, paperNameAccusative, type PaperEntry} from '../shared/papers.ts';
import {photosLinkText} from '../shared/catalog.ts';
import {canDownloadComms, canDownloadPaper, canReleaseComms, canSendAfter, seesPhotosLink} from '../shared/role.ts';
import {dateDots, isoDayOf, timeOf} from '../shared/text.ts';
import type {Actor, Meeting, PaperFormat} from '../shared/types.ts';

// Karta „Dokumenty posiedzenia” (SPEC-4 6.8). Pakiet D0: zamrożone API (`PapersCard`, `ReleaseDialog`, wariant `compact`
// dla dodatku D-18) i prosta działająca wersja: lista dokumentów z `meetingPapers` (bez zapytania), przyciski formatów,
// teczka, odnośnik do zdjęć, stan protokołu, materiał dla komunikacji z udostępnieniem i powiadomienie e-mailem. Zespół F
// dodaje okna „Protokół sporządzony”, „Dołącz plik”, „Odnośnik do zdjęć”, „Opis dla komunikacji”, punkty w materiale
// i `archiwum.css`, a montuje kartę w `Summary` (meeting.tsx); zespół E w procedure.tsx. Głosowanie otwarte każdy
// dokument podaje tylko zdaniem „Głosowanie nr {n} trwa.” (T-7) — robi to generator dokumentu na serwerze.

const formatLabel: Record<PaperFormat, string> = {html: 'Drukuj', docx: 'Word', md: 'Markdown', csv: 'CSV', zip: 'ZIP'};
const formatName: Record<PaperFormat, string> = {html: '', docx: 'Word', md: 'Markdown', csv: 'CSV', zip: 'ZIP'};
const docPath = (m: Pick<Meeting, 'id'>, p: PaperEntry, f: PaperFormat) => `/api/meetings/${encodeURIComponent(m.id)}/dokumenty/${encodeURIComponent(p.id)}${f === 'html' ? '' : `?format=${f}`}`;

function PaperRow(props: {meeting: MeetingData; paper: PaperEntry}) {
  const {meeting: m, paper: p} = props;
  const accusative = paperNameAccusative(m as Meeting, p.id);
  return <li class="paper-row">
    <span class="paper-name">{p.name} <StateChip state={paperStateChip(p.state, timeOf(Date.now()))}/></span>
    {p.note ? <span class="muted">{p.note}</span> : <span class="actions">{p.formats.filter(f => f !== 'zip').map(f => f === 'html'
      ? <a key={f} class="link" href={docPath(m, p, f)} target="_blank" rel="noopener" aria-label={`Drukuj ${accusative}`}>{formatLabel[f]}</a>
      : <button key={f} type="button" class="link" aria-label={`Pobierz ${accusative} w formacie ${formatName[f]}`} onClick={() => download(docPath(m, p, f))}>{formatLabel[f]}</button>)}</span>}
  </li>;
}

/** Okno „Udostępnić materiał komunikacji?” z podglądem pliku (DB-42). */
export function ReleaseDialog(props: {meeting: Pick<MeetingData, 'id'>; onClose: () => void; onDone: (m: MeetingData) => void}) {
  const {busy, error, errorKind, run} = useAction();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { request<{text: string}>(`/api/katalog/${encodeURIComponent(props.meeting.id)}/komunikacja.json`).then(r => setText(r.text)).catch(e => setText((e as Error).message)); }, [props.meeting.id]);
  return <Modal title="Udostępnić materiał komunikacji?" wide onClose={props.onClose}>
    <div class="stack">
      <textarea class="comms-preview" readOnly rows={12} aria-label="Materiał dla komunikacji" value={text ?? ''}/>
      <p>Konto komunikacji pobierze ten plik i może go wkleić do zewnętrznego czatu. Sprawdź, czy tytuły, zdania i opis nie zawierają danych osób spoza organu.</p>
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions">
        <Button kind="primary" busy={busy} onClick={() => run(async () => props.onDone((await request<{meeting: MeetingData}>(`/api/meetings/${encodeURIComponent(props.meeting.id)}/command`, {body: {type: 'comms_release'}})).meeting))}>Udostępnij</Button>
        <Button kind="ghost" onClick={props.onClose}>Anuluj</Button>
      </div>
    </div>
  </Modal>;
}

/**
 * Karta „Dokumenty posiedzenia”. `compact` (dodatek D-18, panel prowadzenia obrad): sama lista dokumentów w stanie
 * „stan na”, bez części „Protokół”, „Pliki po posiedzeniu”, „Zdjęcia”, „Materiał dla komunikacji” i „Powiadomienie e-mailem”.
 */
export function PapersCard(props: {meeting: MeetingData; compact?: boolean; onChange?: (m: MeetingData) => void}) {
  const s = useSession();
  const docTypes = useDocTypes();
  const [release, setRelease] = useState(false);
  const [mail, setMail] = useState(false);
  const [sent, setSent] = useState(0);
  const m = props.meeting;
  const actor: Actor = {account: s.account, personId: s.personId, name: s.name};
  const papers = meetingPapers(m as Meeting, {roster: s.roster, docTypes}, actor, Date.now());
  const closed = m.status === 'zakonczone';
  const a = m.archive;
  const head = !closed ? `Posiedzenie trwa. Dokumenty pokazują stan na godz. ${timeOf(Date.now())}.`
    : m.working ? `Spotkanie robocze zamknięte ${dateDots(isoDayOf(m.closedAt!))} o godz. ${timeOf(m.closedAt!)}. Bez kworum, z notatką zamiast protokołu.`
    : `Posiedzenie zamknięte ${dateDots(isoDayOf(m.closedAt!))} o godz. ${timeOf(m.closedAt!)}. Dokumenty z zapisu aplikacji.`;
  return <section class="oi-card stack papers-card" id="dokumenty-posiedzenia">
    <CardTitle level={2}>{props.compact ? `Dokumenty (stan na godz. ${timeOf(Date.now())})` : 'Dokumenty posiedzenia'}</CardTitle>
    {!props.compact && <p>{head}</p>}
    {!props.compact && a && canDownloadPaper(s.roster, m as Meeting, actor, 'protokol') && <div class="stack">
      <p><strong>Protokół</strong> <StateChip state={protocolChip(a.protocol.state)}/></p>
      <p>{a.protocol.text}</p>
      {(a.checks ?? []).map(c => <p key={c}><StateChip state={checkChip()}/> {c}</p>)}
    </div>}
    <ul class="paper-list">{papers.filter(p => !props.compact || p.state === 'stan_na').map(p => <PaperRow key={p.id} meeting={m} paper={p}/>)}</ul>
    {!props.compact && closed && canDownloadPaper(s.roster, m as Meeting, actor, 'teczka') && <div class="stack">
      <div><Button onClick={() => download(`/api/meetings/${encodeURIComponent(m.id)}/teczka.zip`)}>Pobierz teczkę posiedzenia (.zip)</Button></div>
      <p class="small">Wszystkie dokumenty, materiały i pliki pokazane na posiedzeniu w jednym pliku. Pobranie zapisze się w historii zmian.</p>
    </div>}
    {!props.compact && closed && seesPhotosLink(s.roster, m as Meeting, actor) && <dl class="facts"><Fact label="Zdjęcia">{m.photos
      ? <a href={m.photos.url} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">{photosLinkText(m.photos.url)} <span class="small">(otwiera się w nowej karcie)</span></a>
      : 'Odnośnika do zdjęć jeszcze nie wpisano.'}</Fact></dl>}
    {!props.compact && closed && canDownloadComms(s.roster, m as Meeting, actor) && <div class="stack">
      <p><strong>Materiał dla komunikacji</strong> {a?.commsRelease && <StateChip state={commsReleaseChip(a.commsRelease)}/>}</p>
      {a?.commsChangedAt && <p class="small">{`Zmienił się ${dateDots(isoDayOf(a.commsChangedAt))}, godz. ${timeOf(a.commsChangedAt)}.`}</p>}
      {a?.commsRelease === 'zmieniony' && <p>Zmienił się po udostępnieniu. Konto komunikacji go nie pobierze, dopóki nie udostępnisz go ponownie.</p>}
      <div class="actions">
        <Button onClick={() => download(`/api/katalog/${encodeURIComponent(m.id)}/komunikacja.md`)}>Materiał dla komunikacji (.md)</Button>
        {canReleaseComms(s.roster, m as Meeting, actor) && a?.commsRelease !== 'udostepniony' && <Button haspopup onClick={() => setRelease(true)}>{a?.commsRelease === 'zmieniony' ? 'Udostępnij ponownie' : 'Udostępnij komunikacji'}</Button>}
      </div>
    </div>}
    {!props.compact && closed && canSendAfter(s.roster, m as Meeting, actor) && s.mail?.enabled && <div class="stack">
      <div><Button haspopup onClick={() => setMail(true)}>Wyślij powiadomienie o dokumentach</Button></div>
      <MailHistory meetingId={m.id} refresh={sent}/>
    </div>}
    {release && <ReleaseDialog meeting={m} onClose={() => setRelease(false)} onDone={next => { setRelease(false); props.onChange?.(next); }}/>}
    {mail && <MailDialog meeting={m} kind="po_posiedzeniu" onClose={() => setMail(false)} onSent={() => setSent(x => x + 1)}/>}
  </section>;
}
