import {useState} from 'preact/hooks';
import {request, upload, useFileUrl, download, type MeetingData} from './api.ts';
import {useSession} from './session.ts';
import {brand} from './brand.ts';
import {Button, CardTitle, ErrorNotice, Field, Fold, Modal, Notice, StateChip, useAction} from './ui.tsx';
import {liveDisplayChip} from './stany.ts';
import {blockingBallot, canShowNow, displayFacts, pageNoun, shownDisplay, showLabel, showVisible} from '../shared/show.ts';
import {canAddDisplay, canShow} from '../shared/role.ts';
import {refusalByName} from '../shared/files.ts';
import type {Actor, DisplayRef} from '../shared/types.ts';

// Pokaz plików (SPEC-4 6.6, B3-08–B3-25). Pakiet D0: zamrożone API i prosta działająca wersja. Zespół F dopracowuje
// układ i napisy z B3 3.11 (`pokaz.css`), montuje `ShowCard` i `DisplayList` w chair.tsx, `ShowStage` w screen.tsx
// i `MemberShow` w meeting.tsx; zespół E montuje `DisplayList` w prep.tsx. `MemberShow` pokazuje się wyłącznie, gdy
// `showVisible(view)` z src/shared/show.ts zwraca `true` (stan wspólny, T-3), i w trakcie głosowania nie pobiera plików.

const filePath = (meetingId: string, fileId: string) => `/api/meetings/${encodeURIComponent(meetingId)}/pokaz/${encodeURIComponent(fileId)}`;
const sendCmd = (meetingId: string, cmd: object) => request<{meeting: MeetingData}>(`/api/meetings/${encodeURIComponent(meetingId)}/command`, {body: cmd});
const inFrame = () => { try { return window.self !== window.top; } catch { return true; } };

/**
 * Ramka PDF z kluczem strony (B3-22): nowa ramka przy każdej stronie, `#page={n}`; na sali bez paska narzędzi.
 * W wersji próbnej plik z adresu `blob:`, a w osadzonej ramce zastępstwo z „Pobierz plik” (7.3, B3-24).
 */
export function PdfFrame(props: {meetingId: string; fileId: string; page: number; pages: number | null; title: string; variant: 'sala' | 'uczestnik'}) {
  const path = filePath(props.meetingId, props.fileId);
  const url = useFileUrl(brand.demo && inFrame() ? null : path);
  const label = `${props.title}, strona ${props.page}${props.pages ? ` z ${props.pages}` : ''}`;
  if (brand.demo && inFrame()) return <div class="pdf-fallback stack"><p>{`Na sali strona ${props.page}.`}</p><div><Button onClick={() => download(path)}>Pobierz plik</Button></div></div>;
  if (!url) return null;
  const hash = props.variant === 'sala' ? `#page=${props.page}&toolbar=0&view=Fit` : `#page=${props.page}&view=FitH`;
  return <iframe key={`${props.fileId}-${props.page}`} class={`pdf-frame pdf-frame--${props.variant}`} src={url + hash} title={label}/>;
}

/** Obraz albo strona pliku pokazu (wspólne dla sali i uczestnika). */
function Shown(props: {meetingId: string; d: DisplayRef; page: number; variant: 'sala' | 'uczestnik'}) {
  const file = props.d.kind === 'obrazy' ? props.d.files[props.page - 1] : props.d.files[0];
  const url = useFileUrl(file && props.d.kind !== 'pdf' ? filePath(props.meetingId, file.fileId) : null);
  if (props.d.kind === 'pdf') return <PdfFrame meetingId={props.meetingId} fileId={props.d.files[0].fileId} page={props.page} pages={props.d.pages} title={props.d.title} variant={props.variant}/>;
  return url ? <img class="show-image" src={url} alt={`${props.d.title}, slajd ${props.page} z ${props.d.files.length}`}/> : null;
}

/** Karta „Pokaz na sali i telefonach” w panelu osoby prowadzącej (6.6); bez przycisku głównego i bez `is-teraz`. */
export function ShowCard(props: {meeting: MeetingData; onChange: (m: MeetingData) => void}) {
  const s = useSession();
  const {busy, error, errorKind, run} = useAction();
  const m = props.meeting;
  const d = shownDisplay(m);
  if (!m.show || !d) return null;
  const actor: Actor = {account: s.account, personId: s.personId, name: s.name};
  const remote = m.mode === 'zdalne';
  const ballot = blockingBallot(m);
  const pages = d.pages ?? 0;
  const go = (cmd: object) => run(async () => props.onChange((await sendCmd(m.id, cmd)).meeting));
  return <section class="oi-card stack show-card" aria-live="polite">
    <CardTitle level={2}>{remote ? 'Pokaz' : 'Pokaz na sali i telefonach'}</CardTitle>
    <p>{showLabel(m)}</p>
    {ballot ? <p>{`Pokaz czeka na zakończenie głosowania nr ${ballot.number}.`}</p>
      : canShow(m, actor) && <div class="actions">
        <Button disabled={m.show.page <= 1} reason="To pierwsza strona." busy={busy} onClick={() => go({type: 'show_page', page: m.show!.page - 1})}>{pageNoun(d.kind) === 'slajd' ? 'Poprzedni slajd' : 'Poprzednia strona'}</Button>
        <Button kind="danger" disabled={!!pages && m.show.page >= pages} reason="To ostatnia strona." busy={busy} onClick={() => go({type: 'show_page', page: m.show!.page + 1})}>{pageNoun(d.kind) === 'slajd' ? 'Następny slajd' : 'Następna strona'}</Button>
        <Button kind="ghost" onClick={() => go({type: 'show_end'})}>Zakończ pokaz</Button>
      </div>}
    {!ballot && m.presentation?.kind !== 'pokaz' && canShow(m, actor) && <div><Button onClick={() => go({type: 'present', kind: 'pokaz', id: m.show!.id})}>{`Wróć do pokazu (strona ${m.show.page})`}</Button></div>}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
  </section>;
}

/** Lista „Do pokazania” przy punkcie (karta punktu w panelu i ustawienia punktu w przygotowaniu, 6.5, 6.6). */
export function DisplayList(props: {meeting: MeetingData; itemId: string | null; mode: 'przygotowanie' | 'obrady'; onChange: (m: MeetingData) => void}) {
  const s = useSession();
  const {busy, error, errorKind, run} = useAction();
  const [adding, setAdding] = useState(false);
  const m = props.meeting;
  const actor: Actor = {account: s.account, personId: s.personId, name: s.name};
  const list = (m.displays ?? []).filter(d => d.itemId === props.itemId);
  const showing = props.mode === 'obrady' && canShow(m, actor) && canShowNow(m);
  return <div class="stack display-list">
    {list.length ? <ul class="oi-list">{list.map(d => <li key={d.id}>
      <p><strong>{d.title}</strong> {d.live && <StateChip state={liveDisplayChip()}/>}</p>
      <p class="small">{displayFacts(d)}</p>
      <div class="actions">
        {showing && <Button small kind="ghost" busy={busy} onClick={() => run(async () => props.onChange((await sendCmd(m.id, {type: 'show', source: 'plik', id: d.id})).meeting))}>{m.mode === 'zdalne' ? 'Pokaż uczestnikom' : 'Pokaż na sali i telefonach'}</Button>}
        {props.mode === 'przygotowanie' && canAddDisplay(s.roster, m, actor) && <Button small kind="ghost" onClick={() => run(async () => props.onChange((await sendCmd(m.id, {type: 'display_remove', id: d.id})).meeting))}>Usuń</Button>}
      </div>
    </li>)}</ul> : <p class="muted">Nie ma plików do pokazania.</p>}
    {canAddDisplay(s.roster, m, actor) && <div><Button kind="ghost" haspopup onClick={() => setAdding(true)}>Dodaj plik do pokazania</Button></div>}
    {adding && <AddDisplay meeting={m} itemId={props.itemId} onClose={() => setAdding(false)} onDone={next => { setAdding(false); props.onChange(next); }}/>}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
  </div>;
}

/** Okno „Dodaj plik do pokazania” (B3-16): odmowy po rozszerzeniu przed wysłaniem, po sprawdzeniu na serwerze (G-34). */
export function AddDisplay(props: {meeting: Pick<MeetingData, 'id'>; itemId: string | null; onClose: () => void; onDone: (m: MeetingData) => void}) {
  const {busy, error, errorKind, run, setError} = useAction();
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  return <Modal title="Dodaj plik do pokazania" onClose={props.onClose}>
    <form class="stack" onSubmit={e => { e.preventDefault(); run(async () => {
      if (!files.length) { setError('Wybierz plik.'); return; }
      const form = new FormData();
      for (const f of files) form.append('file', f);
      form.append('title', title);
      if (props.itemId) form.append('itemId', props.itemId);
      if (files.length > 1) form.append('series', '1');
      form.append('description', description);
      props.onDone((await upload<{meeting: MeetingData}>(`/api/meetings/${encodeURIComponent(props.meeting.id)}/pokaz`, form)).meeting);
    }); }}>
      <Field label="Plik" hint="PDF, JPG, PNG albo WebP do 10 MB. Kilka obrazów naraz to jedna prezentacja ze slajdów.">
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.mp4" multiple onChange={e => {
          const list = [...((e.target as HTMLInputElement).files ?? [])];
          const refusal = list.map(f => refusalByName(f.name)).find(Boolean);
          if (refusal) { setError(refusal); setFiles([]); return; }
          setError(''); setFiles(list);
        }}/>
      </Field>
      <Field label="Tytuł"><input value={title} maxLength={200} onInput={e => setTitle((e.target as HTMLInputElement).value)}/></Field>
      <Field label="Opis pokazu" hint="Opisz krótko slajdy. Opis zobaczą osoby, które nie widzą obrazu."><textarea rows={3} maxLength={2000} value={description} onInput={e => setDescription((e.target as HTMLTextAreaElement).value)}/></Field>
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      {busy && <p role="status">Sprawdzanie pliku…</p>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>Dodaj do pokazania</Button><Button kind="ghost" onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

/** Stan „pokaz” na ekranie sali (B3-08, piąte miejsce kolejności): ramka PDF albo obraz i napis nad stopką. */
export function ShowStage(props: {meeting: MeetingData}) {
  const m = props.meeting;
  const d = shownDisplay(m);
  if (!showVisible(m) || !m.show || !d) return null;
  return <div class="show-stage">
    <Shown meetingId={m.id} d={d} page={m.show.page} variant="sala"/>
    <p class="show-stage__label">{`Pokaz „${d.title}”, ${pageNoun(d.kind)} ${m.show.page}${d.pages ? ` z ${d.pages}` : ''}`}</p>
  </div>;
}

/** Karta „Pokaz na sali” u uczestnika (6.6): tylko przy `showVisible(view)` (T-3), podąża za salą albo przegląda samodzielnie. */
export function MemberShow(props: {meeting: MeetingData}) {
  const m = props.meeting;
  const [own, setOwn] = useState<number | null>(null);
  const d = shownDisplay(m);
  if (!showVisible(m) || !m.show || !d) return null;
  const page = own ?? m.show.page;
  const pages = d.pages ?? d.files.length;
  return <section class="oi-card stack member-show">
    <CardTitle level={2}>{m.mode === 'zdalne' ? 'Pokaz' : 'Pokaz na sali'}</CardTitle>
    <Shown meetingId={m.id} d={d} page={page} variant="uczestnik"/>
    {own === null
      ? <div><Button kind="ghost" onClick={() => setOwn(m.show!.page)}>Przeglądaj samodzielnie</Button></div>
      : <div class="stack"><p>{`Przeglądasz samodzielnie. Na sali ${pageNoun(d.kind)} ${m.show.page} z ${pages}.`}</p>
        <div class="actions">
          <Button small disabled={page <= 1} reason="To pierwsza strona." onClick={() => setOwn(page - 1)}>{pageNoun(d.kind) === 'slajd' ? 'Poprzedni slajd' : 'Poprzednia strona'}</Button>
          <Button small disabled={page >= pages} reason="To ostatnia strona." onClick={() => setOwn(page + 1)}>{pageNoun(d.kind) === 'slajd' ? 'Następny slajd' : 'Następna strona'}</Button>
          <Button small onClick={() => setOwn(null)}>Wróć do strony z sali</Button>
        </div></div>}
    {d.kind === 'pdf' && <div><Button kind="ghost" onClick={() => download(filePath(m.id, d.files[0].fileId))}>Pobierz plik</Button></div>}
    {d.pdf && <div><Button kind="ghost" onClick={() => download(filePath(m.id, d.pdf!.fileId))}>Pobierz wersję PDF</Button></div>}
    {d.description && <Fold title="Opis pokazu"><p>{d.description}</p></Fold>}
    {brand.demo && <Notice>Pliki dodane w wersji próbnej znikają po odświeżeniu strony.</Notice>}
  </section>;
}
