import {useEffect, useRef, useState} from 'preact/hooks';
import {download, request, upload, type MeetingData} from './api.ts';
import {useSession} from './session.ts';
import {useDocTypes} from './doctypes.ts';
import {generalNow} from './general.ts';
import {MailDialog, MailHistory} from './mail.tsx';
import {Button, CardTitle, Check, ErrorNotice, Field, Fold, Modal, Notice, plural, Segments, StateChip, useAction} from './ui.tsx';
import {checkChip, commsReleaseChip, paperStateChip, protocolChip} from './stany.ts';
import {changedText, checkBallotNumber, FILED_LABELS, filedGroups, filedLine, formatButtons, paperPath, paperRows, releaseButton, releaseText} from './papers-rules.ts';
import {meetingPapers, paperNameAccusative, type PaperEntry} from '../shared/papers.ts';
import {photosLinkText, photosUrlCheck, type CatalogRow} from '../shared/catalog.ts';
import {commsChoices, commsSourceText, commsLevels, orderingKinds} from '../shared/comms.ts';
import {cascadeEnv} from '../shared/cascade.ts';
import {defaultGeneral, commsLevelLabel} from '../shared/settings.ts';
import {defaultSite} from '../shared/meeting.ts';
import {canDownloadComms, canDownloadPaper, canEditComms, canFile, canFixProtocolOf, canReleaseComms, canSendAfter, canSetPhotos, isSecretary, isService, organRoster, seesPhotosLink} from '../shared/role.ts';
import {itemNumber, orderedAgenda} from '../shared/rules.ts';
import {personName} from '../shared/roster.ts';
import {dateDots, isoDayOf, timeOf} from '../shared/text.ts';
import {typo} from '../shared/typo.ts';
import type {Actor, CommsLevel, FiledKind, Meeting, PaperFormat} from '../shared/types.ts';
import './style/archiwum.css';

// Karta „Dokumenty posiedzenia” (SPEC-4 6.8, DB-7). Lista dokumentów powstaje w kliencie z widoku (`meetingPapers`), bez
// zapytania; przyciski formatów mają napis formatu i pełną nazwę dostępną (6.0). Części: protokół ze stanem i wierszami
// „Do sprawdzenia”, dokumenty, teczka, pliki po posiedzeniu, zdjęcia, materiał dla komunikacji z udostępnieniem (DB-42),
// opis dla komunikacji (DB-43), punkty w materiale, powiadomienie e-mailem (okno i historia zespołu E). Głosowanie otwarte
// każdy dokument podaje tylko zdaniem „Głosowanie nr {n} trwa.” (T-7); robi to generator dokumentu.
// Wariant `compact` to dodatek D-18 (panel prowadzenia obrad): sama lista dokumentów w stanie „stan na”.

const enc = encodeURIComponent;
const cmdPath = (id: string) => `/api/meetings/${enc(id)}/command`;
const sendCmd = (id: string, body: object) => request<{meeting: MeetingData}>(cmdPath(id), {body});
const dayTime = (at: number) => `${dateDots(isoDayOf(at))}, godz. ${timeOf(at)}`;
const actorOf = (s: {account: Actor['account']; personId: string | null; name: string}): Actor => ({account: s.account, personId: s.personId, name: s.name});
const todayIso = () => isoDayOf(Date.now());

/** Kopiowanie do schowka z zastępstwem przez zaznaczenie pola (ramka sandbox bez uprawnień schowka). */
async function copyText(text: string, field: HTMLTextAreaElement | null): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* zastępstwo niżej */ }
  try { field?.focus(); field?.select(); return document.execCommand('copy'); } catch { return false; }
}

function PaperRow(props: {meeting: MeetingData; paper: PaperEntry; signature: PaperEntry | null}) {
  const {meeting: m, paper: p} = props;
  // Nazwa aktu stoi w mianowniku, więc w nazwie przycisku idzie w cudzysłowie („Pobierz „Uchwała nr …” w formacie Word”).
  const accusative = p.id.startsWith('akt-') ? `„${p.name}”` : paperNameAccusative(m as unknown as Meeting, p.id);
  const button = (f: {format: PaperFormat; label: string; name: string; paperId: string}) => f.format === 'html'
    ? <a key={f.paperId + f.format} class="link link-cel" href={paperPath(m.id, f.paperId, 'html')} target="_blank" rel="noopener" aria-label={f.name}>{f.label}</a>
    : <button key={f.paperId + f.format} type="button" class="link link-cel" aria-label={f.name} onClick={() => download(paperPath(m.id, f.paperId, f.format))}>{f.label}</button>;
  const chip = paperStateChip(p.state, timeOf(Date.now()));
  return <li class="paper-row">
    <span class="paper-name">{p.name}{chip && <> <StateChip state={chip}/></>}</span>
    {p.note ? <span class="muted small">{p.note}</span> : <span class="paper-formats">
      {formatButtons(p, accusative).map(button)}
      {props.signature && <a class="link link-cel" href={paperPath(m.id, props.signature.id, 'html')} target="_blank" rel="noopener" aria-label="Drukuj listę obecności do podpisu">Wersja do podpisu</a>}
    </span>}
  </li>;
}

/** Okno „Udostępnić materiał komunikacji?” z podglądem pliku (DB-42). */
export function ReleaseDialog(props: {meeting: Pick<MeetingData, 'id'>; onClose: () => void; onDone: (m: MeetingData) => void}) {
  const {busy, error, errorKind, run} = useAction();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { request<{text: string}>(`/api/katalog/${enc(props.meeting.id)}/komunikacja.json`).then(r => setText(r.text)).catch(e => setText((e as Error).message)); }, [props.meeting.id]);
  return <Modal title="Udostępnić materiał komunikacji?" wide onClose={props.onClose}>
    <div class="stack">
      <textarea class="comms-preview" readOnly rows={12} aria-label="Materiał dla komunikacji" value={text ?? 'Wczytywanie…'}/>
      <p>{typo('Konto komunikacji pobierze ten plik i może go wkleić do zewnętrznego czatu. Sprawdź, czy tytuły, zdania i opis nie zawierają danych osób spoza organu.')}</p>
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions">
        <Button kind="primary" busy={busy} onClick={() => run(async () => props.onDone((await sendCmd(props.meeting.id, {type: 'comms_release'})).meeting))}>Udostępnij</Button>
        <Button kind="ghost" onClick={props.onClose}>Anuluj</Button>
      </div>
    </div>
  </Modal>;
}

/** Podgląd materiału dla komunikacji (B1-37): pole tylko do odczytu i „Kopiuj”. */
export function CommsPreview(props: {meetingId: string; onClose: () => void}) {
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { request<{text: string}>(`/api/katalog/${enc(props.meetingId)}/komunikacja.json`).then(r => setText(r.text)).catch(e => setText((e as Error).message)); }, [props.meetingId]);
  return <Modal title="Materiał dla komunikacji" wide onClose={props.onClose}>
    <div class="stack">
      <textarea ref={field} class="comms-preview" readOnly rows={16} aria-label="Treść materiału dla komunikacji" value={text ?? 'Wczytywanie…'}/>
      <div class="actions">
        <Button onClick={async () => setCopied(await copyText(text ?? '', field.current) ? 'Skopiowano.' : 'Tekst jest zaznaczony. Skopiuj go skrótem klawiszowym.')}>Kopiuj</Button>
        <span role="status" class="small">{copied}</span>
      </div>
    </div>
  </Modal>;
}

/**
 * Okno „Protokół sporządzony” (6.8, DB-6, S-3): data sporządzenia bez wartości domyślnej, osoba ze składu posiedzenia
 * (sekretarz na pierwszym miejscu), nieobowiązkowy plik i „Powiadom członków e-mailem” (wiadomość „Protokół do wglądu”).
 */
function MinutesReadyDialog(props: {meeting: MeetingData; onClose: () => void; onDone: (m: MeetingData, note: string) => void}) {
  const s = useSession();
  const {busy, error, errorKind, run, setError} = useAction();
  const m = props.meeting;
  const mm = m as unknown as Meeting;
  const actor = actorOf(s);
  const members = organRoster(s.roster, mm);
  const secretaries = members.filter(x => x.func === 'sekretarz');
  const ordered = [...secretaries, ...members.filter(x => x.func !== 'sekretarz')];
  const mine = isSecretary(s.roster, mm, s.personId) && s.personId ? s.personId : null;
  const [date, setDate] = useState(m.minutesReady?.date ?? '');
  const [author, setAuthor] = useState(m.minutesReady?.author.personId ?? mine ?? secretaries[0]?.personId ?? '');
  const [file, setFile] = useState<File | null>(null);
  const mailOn = !!s.mail?.enabled;
  const [notify, setNotify] = useState(mailOn && !m.minutesReady);
  const [preview, setPreview] = useState<{text: string; skipped: string[]} | string | null>(null);
  const office = isService(actor);
  const loadPreview = () => {
    if (preview !== null) return;
    request<{text: string; recipients: {name: string; state: string}[]}>(`/api/meetings/${enc(m.id)}/mail/preview`, {body: {kind: 'protokol', recipients: {group: 'wszyscy'}}})
      .then(r => setPreview({text: r.text, skipped: r.recipients.filter(x => x.state !== 'wysle').map(x => x.state === 'wylaczone' ? `${x.name} ma wyłączone te wiadomości.` : `${x.name} nie ma potwierdzonego adresu e-mail.`)}))
      .catch(e => setPreview((e as Error).message));
  };
  return <Modal title="Protokół sporządzony" onClose={props.onClose}>
    <form class="stack" onSubmit={e => { e.preventDefault(); run(async () => {
      if (!date) { setError('Wpisz datę sporządzenia protokołu.'); return; }
      let next = (await sendCmd(m.id, {type: 'minutes_ready', date, authorPersonId: author})).meeting;
      if (file) {
        const form = new FormData();
        form.append('file', file); form.append('kind', 'protokol_sporzadzony');
        next = (await upload<{meeting: MeetingData}>(`/api/meetings/${enc(m.id)}/zlozone`, form)).meeting;
      }
      let note = 'Zapisano.';
      if (notify && mailOn) {
        const r = await request<{batch: {id: string; recipients: number}}>(`/api/meetings/${enc(m.id)}/mail/send`, {body: {kind: 'protokol', recipients: {group: 'wszyscy'}}});
        const n = r.batch.recipients;
        note = `Zapisano. Wiadomość wysłano do ${n} ${plural(n, 'osoby', 'osób', 'osób')}.`;
      }
      props.onDone(next, note);
    }); }}>
      {office && <p>{typo('Wpisujesz czynność innej osoby. Podaj datę i osobę z dokumentu.')}</p>}
      <Field label="Data sporządzenia"><input type="date" required value={date} max={todayIso()} onInput={e => setDate((e.target as HTMLInputElement).value)}/></Field>
      <Field label="Kto sporządził protokół" hint={typo('Wybierz członka Prezydium, jeśli zastępował sekretarza.')}>
        <select value={author} onChange={e => setAuthor((e.target as HTMLSelectElement).value)}>
          {ordered.map(x => <option key={x.personId} value={x.personId}>{`${personName(s.roster, x.personId)}, ${x.label}`}</option>)}
        </select>
      </Field>
      <Field label="Plik protokołu (nieobowiązkowy)" hint="DOCX albo PDF do 10 MB."><input type="file" accept=".docx,.pdf" onChange={e => setFile((e.target as HTMLInputElement).files?.[0] ?? null)}/></Field>
      {mailOn && <Check checked={notify} onChange={setNotify}>Powiadom członków e-mailem</Check>}
      {mailOn && notify && <Fold title="Podgląd wiadomości" onToggle={on => { if (on) loadPreview(); }}>
        {preview === null ? <p class="muted small">Wczytywanie…</p>
          : typeof preview === 'string' ? <p class="small">{preview}</p>
          : <div class="stack-tight"><pre class="mail-preview-text">{preview.text}</pre>{preview.skipped.map(x => <p key={x} class="small">{x}</p>)}</div>}
      </Fold>}
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>Zapisz</Button><Button kind="ghost" onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

const FILED_OPTIONS: [Exclude<FiledKind, 'protokol_sporzadzony'>, string][] = [
  ['protokol_podpisany', 'Protokół podpisany (skan)'], ['zawiadomienie', 'Zawiadomienie'], ['akt_podpisany', 'Akt podpisany (skan)'], ['inny', 'Inny dokument'],
];
/** Okno „Dołącz plik” (6.8, B1-14): nowy plik tego samego rodzaju zastępuje poprzedni, który zostaje w historii. */
function FiledDialog(props: {meeting: MeetingData; onClose: () => void; onDone: (m: MeetingData) => void}) {
  const {busy, error, errorKind, run, setError} = useAction();
  const m = props.meeting;
  const [kind, setKind] = useState<Exclude<FiledKind, 'protokol_sporzadzony'>>('protokol_podpisany');
  const [ballot, setBallot] = useState('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const ballots = m.ballots.filter(b => b.status === 'zamkniete' && b.result?.adopted && b.purpose !== 'proba');
  return <Modal title="Dołącz plik" onClose={props.onClose}>
    <form class="stack" onSubmit={e => { e.preventDefault(); run(async () => {
      if (!file) { setError('Wybierz plik.'); return; }
      const form = new FormData();
      form.append('file', file); form.append('kind', kind);
      if (kind === 'akt_podpisany' && ballot) form.append('ballotId', ballot);
      if (kind === 'inny') form.append('title', title);
      props.onDone((await upload<{meeting: MeetingData}>(`/api/meetings/${enc(m.id)}/zlozone`, form)).meeting);
    }); }}>
      <Segments label="Rodzaj" value={kind} options={FILED_OPTIONS} onChange={setKind} column/>
      {kind === 'akt_podpisany' && <Field label="Głosowanie"><select value={ballot} required onChange={e => setBallot((e.target as HTMLSelectElement).value)}>
        <option value="">Wybierz głosowanie</option>
        {ballots.map(b => <option key={b.id} value={b.id}>{`Nr ${b.number}, ${b.subject}`}</option>)}
      </select></Field>}
      {kind === 'inny' && <Field label="Tytuł"><input value={title} maxLength={200} onInput={e => setTitle((e.target as HTMLInputElement).value)}/></Field>}
      <Field label="Plik" hint="PDF, DOCX, JPG albo PNG do 10 MB."><input type="file" accept=".pdf,.docx,.jpg,.jpeg,.png" onChange={e => setFile((e.target as HTMLInputElement).files?.[0] ?? null)}/></Field>
      <p class="small">{typo('Nowy plik zastąpi poprzedni plik tego rodzaju. Poprzedni zostanie w historii.')}</p>
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>Dołącz plik</Button><Button kind="ghost" onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

/**
 * Okno „Odnośnik do zdjęć” (6.8, B1-29, G-23): tylko https; adres spoza Zdjęć Google daje ostrzeżenie i „Zapisz mimo to”.
 * Na stronie posiedzenia polecenie `photos_set`, a u konta „Komunikacja” trasa katalogu (`viaCatalog`).
 */
export function PhotosDialog(props: {meetingId: string; url: string | null; viaCatalog?: boolean; onClose: () => void; onDone: (m: MeetingData | null) => void}) {
  const {busy, error, errorKind, run, setError} = useAction();
  const [url, setUrl] = useState(props.url ?? '');
  const [warning, setWarning] = useState('');
  const save = (value: string, confirm: boolean) => run(async () => {
    const check = photosUrlCheck(value);
    if (!check.ok) { setError(check.error); return; }
    if (check.warning && !confirm) { setWarning(check.warning); return; }
    const body = {url: check.url, ...(confirm ? {confirm: true} : {})};
    const r = props.viaCatalog ? await request<{meeting?: MeetingData}>(`/api/katalog/${enc(props.meetingId)}/zdjecia`, {body})
      : await sendCmd(props.meetingId, {type: 'photos_set', ...body});
    props.onDone(r.meeting ?? null);
  });
  return <Modal title="Odnośnik do zdjęć" onClose={props.onClose}>
    <form class="stack" onSubmit={e => { e.preventDefault(); save(url, false); }}>
      <Field label="Adres albumu" hint={typo('Wklej odnośnik do albumu w Zdjęciach Google. Aplikacja go nie otwiera i nie sprawdza. Album udostępniony przez link otworzy każdy, kto zna adres.')}>
        <input type="url" inputMode="url" value={url} maxLength={500} onInput={e => { setUrl((e.target as HTMLInputElement).value); setWarning(''); }}/>
      </Field>
      {warning && <Notice tone="warn">{warning}</Notice>}
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions">
        {warning ? <Button kind="primary" busy={busy} onClick={() => save(url, true)}>Zapisz mimo to</Button> : <Button kind="primary" type="submit" busy={busy}>Zapisz</Button>}
        {props.url && <Button kind="ghost" busy={busy} onClick={() => save('', false)}>Usuń odnośnik</Button>}
        <Button kind="ghost" onClick={props.onClose}>Anuluj</Button>
      </div>
    </form>
  </Modal>;
}

/** Okno „Opis dla komunikacji” (DB-43): do 1500 znaków, zwykły tekst, z podpisem. */
function CommsNoteDialog(props: {meeting: MeetingData; onClose: () => void; onDone: (m: MeetingData) => void}) {
  const {busy, error, errorKind, run} = useAction();
  const [text, setText] = useState(props.meeting.commsNote?.text ?? '');
  return <Modal title="Opis dla komunikacji" onClose={props.onClose}>
    <form class="stack" onSubmit={e => { e.preventDefault(); run(async () => props.onDone((await sendCmd(props.meeting.id, {type: 'comms_note', text})).meeting)); }}>
      <Field label="Opis dla komunikacji" hint={typo('Krótki opis posiedzenia dla komunikacji. Bez danych osób spoza organu.')}>
        <textarea rows={6} maxLength={1500} value={text} onInput={e => setText((e.target as HTMLTextAreaElement).value)}/>
      </Field>
      <p class="small muted" aria-live="off">{`${text.length} z 1500 znaków`}</p>
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>Zapisz</Button><Button kind="ghost" onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

/** Poprawka „Dotyczy protokołu” w głosowaniu po zamknięciu (G-38, K4-4): tylko przewodniczący, z powodem. */
function FixDialog(props: {meeting: MeetingData; ballotNumber: number; onClose: () => void; onDone: (m: MeetingData) => void}) {
  const {busy, error, errorKind, run, setError} = useAction();
  const [rows, setRows] = useState<CatalogRow[] | null>(null);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const b = props.meeting.ballots.find(x => x.number === props.ballotNumber);
  useEffect(() => { request<{rows: CatalogRow[]}>('/api/katalog').then(r => setRows(r.rows.filter(x => x.id !== props.meeting.id && x.protocol.state !== 'przyjety' && x.protocol.state !== 'notatka'))).catch(e => setError((e as Error).message)); }, []);
  return <Modal title={`Popraw, którego protokołu dotyczy głosowanie nr ${props.ballotNumber}`} onClose={props.onClose}>
    <form class="stack" onSubmit={e => { e.preventDefault(); run(async () => {
      if (!b) return;
      props.onDone((await sendCmd(props.meeting.id, {type: 'ballot_protocol_fix', ballotId: b.id, protocolOf: target, reason})).meeting);
    }); }}>
      <Field label="Dotyczy protokołu"><select value={target} required onChange={e => setTarget((e.target as HTMLSelectElement).value)}>
        <option value="">Wybierz posiedzenie</option>
        {(rows ?? []).map(r => <option key={r.id} value={r.id}>{`${r.kind === 'procedura' ? 'Głosowanie między posiedzeniami' : 'Posiedzenie'} z dnia ${dateDots(r.day)}`}</option>)}
      </select></Field>
      <Field label="Powód" hint="Powód trafi do dziennika."><input value={reason} required maxLength={500} onInput={e => setReason((e.target as HTMLInputElement).value)}/></Field>
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>Zapisz</Button><Button kind="ghost" onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

/** Wiersz „Punkty w materiale dla komunikacji” (6.8): poziom nie bardziej otwarty niż utrwalony i zdanie, zapis w wierszu. */
function CommsItemRow(props: {meeting: MeetingData; itemId: string; level: CommsLevel; options: CommsLevel[]; source: string; onDone: (m: MeetingData) => void}) {
  const {busy, error, errorKind, run} = useAction();
  const m = props.meeting;
  const it = m.agenda.find(i => i.id === props.itemId)!;
  const [level, setLevel] = useState<CommsLevel>(props.level);
  const [sentence, setSentence] = useState(it.comms?.sentence ?? '');
  const [saved, setSaved] = useState('');
  const changed = level !== props.level || sentence !== (it.comms?.sentence ?? '');
  const nr = itemNumber(m.agenda, it.id);
  return <li class="comms-item">
    <p class="comms-item__title"><strong>{`${nr}. `}</strong>{it.title}</p>
    <Segments label={`W materiale dla komunikacji, punkt ${nr}`} value={level} options={props.options.map(o => [o, commsLevelLabel[o]] as [CommsLevel, string])} onChange={v => { setLevel(v); setSaved(''); }}
      hint={typo(props.source)}/>
    <Field label={`Zdanie dla komunikacji, punkt ${nr}`}><input value={sentence} maxLength={300} onInput={e => { setSentence((e.target as HTMLInputElement).value); setSaved(''); }}/></Field>
    <div class="actions">
      <Button small busy={busy} disabled={!changed} onClick={() => run(async () => { const r = await sendCmd(m.id, {type: 'item_edit', itemId: it.id, comms: {level, sentence}}); setSaved(`Zapisano o godz. ${timeOf(Date.now())}.`); props.onDone(r.meeting); })}>Zapisz</Button>
      <span role="status" class="small save-status">{saved}</span>
    </div>
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
  </li>;
}

/**
 * Karta „Dokumenty posiedzenia”. `compact` (dodatek D-18, panel prowadzenia obrad): sama lista dokumentów w stanie
 * „stan na”, bez części „Protokół”, „Pliki po posiedzeniu”, „Zdjęcia”, „Materiał dla komunikacji” i „Powiadomienie e-mailem”.
 */
export function PapersCard(props: {meeting: MeetingData; compact?: boolean; onChange?: (m: MeetingData) => void}) {
  const s = useSession();
  const docTypes = useDocTypes();
  const [dialog, setDialog] = useState<null | 'release' | 'mail' | 'minutes' | 'filed' | 'photos' | 'note' | 'preview' | {fix: number} | {remove: string}>(null);
  const [sent, setSent] = useState(0);
  const [status, setStatus] = useState('');
  const m = props.meeting;
  const mm = m as unknown as Meeting;
  const actor = actorOf(s);
  const papers = meetingPapers(mm, {roster: s.roster, docTypes}, actor, Date.now());
  const closed = m.status === 'zakonczone';
  const a = m.archive;
  const done = (next: MeetingData | null, note = '') => { setDialog(null); if (note) setStatus(note); if (next) props.onChange?.(next); };
  const head = !closed ? `Posiedzenie trwa. Dokumenty pokazują stan na godz. ${timeOf(Date.now())}.`
    : m.working ? `Spotkanie robocze zamknięte ${dateDots(isoDayOf(m.closedAt!))} o godz. ${timeOf(m.closedAt!)}. Bez kworum, z notatką zamiast protokołu.`
    : `Posiedzenie zamknięte ${dateDots(isoDayOf(m.closedAt!))} o godz. ${timeOf(m.closedAt!)}. Dokumenty z zapisu aplikacji.`;
  const rows = paperRows(papers.filter(p => !props.compact || p.state === 'stan_na'));
  const protocolSeen = !props.compact && !!a && canDownloadPaper(s.roster, mm, actor, 'protokol');
  const filing = closed && canFile(s.roster, mm, actor);
  const fixer = canFixProtocolOf(s.roster, mm, actor);
  const {current, replaced} = filedGroups(m.filed);
  const commsEdit = closed && canEditComms(s.roster, mm, actor);
  // Punkty w materiale dla komunikacji: każdy punkt poza porządkowymi, a podpunkty punktów porządkowych tak (6.5 wiersz 15).
  const env = cascadeEnv({roster: s.roster, bundle: generalNow() ?? {general: defaultGeneral(defaultSite), docTypes, revision: 0}, organ: m.organ});
  const ordering = orderingKinds(m.organ);
  const commsItems = commsEdit ? orderedAgenda(m.agenda).filter(it => (!ordering.has(it.kind) || it.parentId) && commsChoices(mm, it, env).length > 0) : [];
  const levels = commsEdit ? commsLevels(mm, env) : {};
  return <section class={'oi-card stack papers-card' + (props.compact ? ' papers-card--compact' : '')} id="dokumenty-posiedzenia" aria-labelledby="dokumenty-tytul">
    <CardTitle level={2}><span id="dokumenty-tytul">{props.compact ? `Dokumenty (stan na godz. ${timeOf(Date.now())})` : 'Dokumenty posiedzenia'}</span></CardTitle>
    {!props.compact && <p>{typo(head)}</p>}
    {!props.compact && a?.legacyPrepMessages && <Notice tone="warn" label="Ważne">{typo('Dokument z przebiegu zawiera wiadomości napisane przed rozpoczęciem głosowania. Sprawdź je przed sporządzeniem protokołu.')}</Notice>}
    {protocolSeen && <div class="papers-part stack-tight">
      <div class="papers-part__head"><span class="kicker">Protokół</span><StateChip state={protocolChip(a!.protocol.state)}/></div>
      {a!.protocol.text && <p>{typo(a!.protocol.text)}</p>}
      {filing && !m.working && !m.minutesReady && <div><Button haspopup onClick={() => setDialog('minutes')}>Protokół sporządzony</Button></div>}
      {filing && !m.working && m.minutesReady && <div><Button kind="ghost" small haspopup onClick={() => setDialog('minutes')}>Popraw dane sporządzenia</Button></div>}
      {(a!.checks ?? []).map(c => { const n = checkBallotNumber(c); return <div key={c} class="papers-check">
        <p><StateChip state={checkChip()}/> {typo(c)}</p>
        {n !== null && (fixer ? <Button kind="ghost" small haspopup label={`Popraw, którego protokołu dotyczy głosowanie nr ${n}`} onClick={() => setDialog({fix: n})}>Popraw</Button> : <p class="small">Poprawkę wpisuje przewodniczący.</p>)}
      </div>; })}
    </div>}
    <ul class="paper-list">{rows.map(r => <PaperRow key={r.paper.id} meeting={m} paper={r.paper} signature={r.signature}/>)}</ul>
    {!props.compact && rows.some(r => r.paper.formats.includes('html')) && <p class="small muted">{typo('Numery stron drukują Chrome i Edge. W innej przeglądarce pobierz wersję Word.')}</p>}
    {!props.compact && closed && canDownloadPaper(s.roster, mm, actor, 'teczka') && <div class="stack-tight">
      <div><Button onClick={() => download(`/api/meetings/${enc(m.id)}/teczka.zip`)}>Pobierz teczkę posiedzenia (.zip)</Button></div>
      <p class="small">{typo('Wszystkie dokumenty, materiały i pliki pokazane na posiedzeniu w jednym pliku. Pobranie zapisze się w historii zmian.')}</p>
    </div>}
    {protocolSeen && closed && <div class="papers-part stack-tight">
      <span class="kicker">{`Pliki po posiedzeniu (${current.length})`}</span>
      {current.length ? <ul class="filed-list">{current.map(f => <li key={f.id}>
        <span>{typo(filedLine(f))}</span>
        <span class="actions">
          <button type="button" class="link link-cel" aria-label={`Pobierz plik „${f.fileName}”`} onClick={() => download(`/api/meetings/${enc(m.id)}/files/${enc(f.fileId)}`)}>Pobierz</button>
          {filing && <button type="button" class="link link-cel" aria-haspopup="dialog" aria-label={`Usuń plik „${f.fileName}”`} onClick={() => setDialog({remove: f.id})}>Usuń</button>}
        </span>
      </li>)}</ul> : <p class="muted small">Nie dołączono jeszcze plików.</p>}
      {replaced.length > 0 && <Fold title={`Wcześniejsze pliki (${replaced.length})`}><ul class="filed-list">{replaced.map(f => <li key={f.id}>
        <span>{typo(filedLine(f))} <span class="small muted">{`zastąpiony ${dateDots(isoDayOf(f.replacedAt!))}`}</span></span>
      </li>)}</ul></Fold>}
      {filing && <div><Button haspopup onClick={() => setDialog('filed')}>Dołącz plik</Button></div>}
    </div>}
    {!props.compact && closed && seesPhotosLink(s.roster, mm, actor) && <div class="papers-part stack-tight">
      <span class="kicker">Zdjęcia</span>
      {m.photos ? <p><a class="oi-link" href={m.photos.url} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">{photosLinkText(m.photos.url)}</a> <span class="small">(otwiera się w nowej karcie)</span></p>
        : <p class="muted small">Odnośnika do zdjęć jeszcze nie wpisano.</p>}
      {canSetPhotos(s.roster, mm, actor) && <div><Button kind="ghost" small haspopup onClick={() => setDialog('photos')}>{m.photos ? 'Zmień odnośnik' : 'Wpisz odnośnik do zdjęć'}</Button></div>}
    </div>}
    {!props.compact && closed && canDownloadComms(s.roster, mm, actor) && <div class="papers-part stack-tight">
      <div class="papers-part__head"><span class="kicker">Materiał dla komunikacji</span>{a?.commsRelease && <StateChip state={commsReleaseChip(a.commsRelease)}/>}</div>
      <p class="small">{a?.commsChangedAt ? typo(changedText(a.commsChangedAt)) : ''}{a?.commsRelease ? ` ${typo(releaseText(a.commsRelease, m.commsReleased?.at))}` : ''}</p>
      <div class="actions">
        <Button onClick={() => download(`/api/katalog/${enc(m.id)}/komunikacja.md`)}>Materiał dla komunikacji (.md)</Button>
        <Button kind="ghost" haspopup onClick={() => setDialog('preview')}>Podgląd</Button>
        {canReleaseComms(s.roster, mm, actor) && releaseButton(a?.commsRelease) && <Button haspopup onClick={() => setDialog('release')}>{releaseButton(a?.commsRelease)!}</Button>}
      </div>
    </div>}
    {!props.compact && commsEdit && <div class="papers-part stack-tight">
      <span class="kicker">Opis dla komunikacji</span>
      {m.commsNote ? <><p class="pre-line">{m.commsNote.text}</p><p class="small muted">{typo(`Opis wpisano ${dateDots(isoDayOf(m.commsNote.at))}, ${m.commsNote.by}.`)}</p></> : <p class="muted small">Nie wpisano.</p>}
      <div><Button kind="ghost" small haspopup onClick={() => setDialog('note')}>{m.commsNote ? 'Zmień opis' : 'Wpisz opis'}</Button></div>
    </div>}
    {!props.compact && commsEdit && commsItems.length > 0 && <Fold title={`Punkty w materiale dla komunikacji (${commsItems.length})`}>
      <ul class="comms-items">{commsItems.map(it => <CommsItemRow key={it.id} meeting={m} itemId={it.id} level={levels[it.id] ?? 'liczba'}
        options={commsChoices(mm, it, env)} source={commsSourceText(mm, it, env)} onDone={next => props.onChange?.(next)}/>)}</ul>
    </Fold>}
    {!props.compact && closed && canSendAfter(s.roster, mm, actor) && s.mail?.enabled && <div class="papers-part stack-tight">
      <span class="kicker">Powiadomienie e-mailem</span>
      <div><Button haspopup onClick={() => setDialog('mail')}>Wyślij powiadomienie o dokumentach</Button></div>
      <MailHistory meetingId={m.id} refresh={sent}/>
    </div>}
    <p role="status" class="small save-status">{status}</p>
    {dialog === 'release' && <ReleaseDialog meeting={m} onClose={() => setDialog(null)} onDone={next => done(next, `Udostępniono o godz. ${timeOf(Date.now())}.`)}/>}
    {dialog === 'mail' && <MailDialog meeting={m} kind="po_posiedzeniu" onClose={() => setDialog(null)} onSent={() => setSent(x => x + 1)}/>}
    {dialog === 'minutes' && <MinutesReadyDialog meeting={m} onClose={() => setDialog(null)} onDone={(next, note) => { done(next, note); setSent(x => x + 1); }}/>}
    {dialog === 'filed' && <FiledDialog meeting={m} onClose={() => setDialog(null)} onDone={next => done(next, `Zapisano o godz. ${timeOf(Date.now())}.`)}/>}
    {dialog === 'photos' && <PhotosDialog meetingId={m.id} url={m.photos?.url ?? null} onClose={() => setDialog(null)} onDone={next => done(next, `Zapisano o godz. ${timeOf(Date.now())}.`)}/>}
    {dialog === 'note' && <CommsNoteDialog meeting={m} onClose={() => setDialog(null)} onDone={next => done(next, `Zapisano o godz. ${timeOf(Date.now())}.`)}/>}
    {dialog === 'preview' && <CommsPreview meetingId={m.id} onClose={() => setDialog(null)}/>}
    {dialog && typeof dialog === 'object' && 'fix' in dialog && <FixDialog meeting={m} ballotNumber={dialog.fix} onClose={() => setDialog(null)} onDone={next => done(next, `Zapisano o godz. ${timeOf(Date.now())}.`)}/>}
    {dialog && typeof dialog === 'object' && 'remove' in dialog && <RemoveFiled meeting={m} id={dialog.remove} onClose={() => setDialog(null)} onDone={next => done(next, `Zapisano o godz. ${timeOf(Date.now())}.`)}/>}
  </section>;
}

/** Usunięcie pliku po posiedzeniu (6.8): plik znika z dokumentów, wpis zostaje w dzienniku. */
function RemoveFiled(props: {meeting: MeetingData; id: string; onClose: () => void; onDone: (m: MeetingData) => void}) {
  const {busy, error, errorKind, run} = useAction();
  const f = (props.meeting.filed ?? []).find(x => x.id === props.id);
  if (!f) return null;
  return <Modal title={`Usunąć plik „${f.fileName}”?`} onClose={props.onClose} confirm closeButton={false} initialFocus=".confirm-cancel">
    <div class="stack">
      <p>{typo(`${FILED_LABELS[f.kind]}. Plik zniknie z dokumentów posiedzenia. Wpis zostanie w dzienniku.`)}</p>
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions confirm-actions">
        <Button kind="danger" class="confirm-ok" busy={busy} onClick={() => run(async () => props.onDone((await request<{meeting: MeetingData}>(`/api/meetings/${enc(props.meeting.id)}/zlozone/${enc(f.id)}`, {method: 'DELETE'})).meeting))}>Usuń plik</Button>
        <Button class="confirm-cancel" onClick={props.onClose}>Anuluj</Button>
      </div>
    </div>
  </Modal>;
}
