import {useEffect, useState} from 'preact/hooks';
import {request} from './api.ts';
import {useSession} from './session.ts';
import {brand} from './brand.ts';
import {Button, Check, ErrorNotice, Fact, Field, Fold, Modal, Notice, Segments, StateChip, useAction} from './ui.tsx';
import {mailStepChip} from './stany.ts';
import {DEFAULT_INTROS, skippedText, type MailRecipientRow, type MailSettings} from '../shared/mail.ts';
import {generalNow} from './general.ts';
import type {GeneralBundle} from '../shared/settings.ts';
import {dateDots, isoDayOf, plural, timeOf} from '../shared/text.ts';
import type {Meeting} from '../shared/types.ts';

// Poczta na ekranach (SPEC-4 6.7). Pakiet D0: zamrożone API i prosta działająca wersja okna wysyłki (`MailDialog`),
// historii wysyłek (`MailHistory`) i sekcji ustawień „Poczta e-mail” (`MailSettingsSection`). Zespół E dopracowuje
// układ z B2 3.9 i B2-P12 (`poczta.css`), dziennik wysyłek, okno wiadomości próbnej i wstępy; zespół F montuje
// `MailDialog` i `MailHistory` w karcie „Dokumenty posiedzenia” (papers.tsx), zespół E w przygotowaniu (workspace.tsx).
// W trakcie obrad nic tu nie wysyła zapytań (serwer i tak odpowiada 409, T-5).

export type MailDialogKind = 'postep' | 'po_posiedzeniu';
interface Preview { subject: string; text: string; html: string; recipients: MailRecipientRow[]; lastProgressAt: number | null }

/** Okno wysyłki „Wyślij informację o postępie przygotowań” albo „Wyślij powiadomienie o dokumentach” (6.7.1). */
export function MailDialog(props: {meeting: Pick<Meeting, 'id' | 'title'>; kind: MailDialogKind; onClose: () => void; onSent?: (batch: {id: string; recipients: number}) => void}) {
  const [group, setGroup] = useState<'wszyscy' | 'wybrani'>('wszyscy');
  const [ids, setIds] = useState<string[]>([]);
  const [office, setOffice] = useState(false);
  const [intro, setIntro] = useState<string>(() => generalNow()?.general.mail?.intros?.[props.kind] ?? DEFAULT_INTROS[props.kind]);
  const [view, setView] = useState<'html' | 'tekst'>('html');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState('');
  const {busy, error, errorKind, run} = useAction();
  const recipients = {group, ids, office};
  const base = `/api/meetings/${encodeURIComponent(props.meeting.id)}/mail`;
  useEffect(() => {
    const t = setTimeout(() => run(async () => setPreview(await request<Preview>(`${base}/preview`, {body: {kind: props.kind, recipients, intro}}))), preview ? 400 : 0);
    return () => clearTimeout(t);
  }, [group, ids.join(','), office, intro]);
  const sending = preview?.recipients.filter(r => r.state === 'wysle') ?? [];
  const skipped = preview?.recipients.map(skippedText).filter((x): x is string => !!x) ?? [];
  const n = sending.length;
  const title = props.kind === 'postep' ? 'Wyślij informację o postępie przygotowań' : 'Wyślij powiadomienie o dokumentach';
  return <Modal title={title} wide onClose={props.onClose}>
    <div class="stack mail-dialog">
      <Segments label="Do kogo" value={group} options={[['wszyscy', `Członkowie Prezydium (${preview?.recipients.length ?? 0})`], ['wybrani', 'Wybrane osoby']]} onChange={setGroup}/>
      {group === 'wybrani' && preview && <fieldset class="stack"><legend class="sr-only">Wybrane osoby</legend>
        {preview.recipients.map(r => <Check key={r.accountId} checked={ids.includes(r.accountId)} onChange={on => setIds(on ? [...ids, r.accountId] : ids.filter(x => x !== r.accountId))}>{r.name}</Check>)}</fieldset>}
      <Check checked={office} onChange={setOffice}>Także konta biura</Check>
      <p role="status">{`Wiadomość dostanie ${n} ${plural(n, 'osoba', 'osoby', 'osób')}.`}</p>
      {skipped.length > 0 && <ul class="mail-skipped">{skipped.map(t => <li key={t}>{t}</li>)}</ul>}
      <Field label="Wstęp"><textarea rows={3} maxLength={1500} value={intro} onInput={e => setIntro((e.target as HTMLTextAreaElement).value)}/></Field>
      {preview && <>
        <Segments label="Podgląd" value={view} options={[['html', 'Wersja HTML'], ['tekst', 'Wersja tekstowa']]} onChange={setView}/>
        {view === 'html' ? <iframe class="mail-preview" sandbox="" srcdoc={preview.html} title="Podgląd wiadomości"/> : <pre class="mail-preview-text">{preview.text}</pre>}
        {props.kind === 'postep' && preview.lastProgressAt && <p class="small">{`Ostatnią informację o postępie wysłano dziś o godz. ${timeOf(preview.lastProgressAt)}. Kolejną można wysłać po godz. ${timeOf(preview.lastProgressAt + 3600000)}.`}</p>}
      </>}
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      {done ? <p role="status">{done}</p> : <div class="actions">
        <Button kind="primary" busy={busy} disabled={!n} reason="Nikt z wybranych osób nie dostanie tej wiadomości." onClick={() => run(async () => {
          const r = await request<{batch: {id: string; recipients: number}}>(`${base}/send`, {body: {kind: props.kind, recipients, intro}});
          setDone('Wysyłka przyjęta. Stan zobaczysz w historii wysyłek.');
          props.onSent?.(r.batch);
        })}>{`Wyślij do ${n} ${plural(n, 'osoby', 'osób', 'osób')}`}</Button>
        <Button kind="ghost" onClick={props.onClose}>Anuluj</Button>
      </div>}
    </div>
  </Modal>;
}

interface HistoryBatch { id: string; kind: string; created: number; actor: string; subject: string; recipients: number; messages: {name: string; status: string; nextAt: number; sentAt: number | null; error: string}[] }
const kindLabel: Record<string, string> = {postep: 'Informacja o postępie', po_posiedzeniu: 'Dokumenty po posiedzeniu', protokol: 'Protokół do wglądu', komunikacja: 'Materiał dla komunikacji gotowy', zawiadomienie: 'Zawiadomienie'};
const statusText = (m: HistoryBatch['messages'][number]) => m.status === 'wyslana' ? `Wysłano ${m.sentAt ? timeOf(m.sentAt) : ''}`.trim()
  : m.status === 'czeka' || m.status === 'wysylanie' ? `Czeka, kolejna próba o ${timeOf(m.nextAt)}`
  : m.status === 'proba' ? 'Nie wysłano, wersja próbna' : m.status === 'anulowana' ? (m.error || 'Anulowano.') : `Nie wysłano. ${m.error}`.trim();

/** „Historia wysyłek ({n})” posiedzenia (6.7.3); `refresh` zmienia się po wysyłce, żeby wczytać historię jeszcze raz. */
export function MailHistory(props: {meetingId: string; refresh?: number}) {
  const [batches, setBatches] = useState<HistoryBatch[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { request<{batches: HistoryBatch[]}>(`/api/meetings/${encodeURIComponent(props.meetingId)}/mail`).then(r => { setError(''); setBatches(r.batches); }).catch(e => setError(e.message)); }, [props.meetingId, props.refresh]);
  if (error) return <ErrorNotice>{error}</ErrorNotice>;
  if (!batches) return null;
  return <Fold title="Historia wysyłek" count={batches.length}>
    {batches.length ? <ul class="mail-history">{batches.map(b => {
      const sent = b.messages.filter(m => m.status === 'wyslana').length, waiting = b.messages.filter(m => m.status === 'czeka' || m.status === 'wysylanie').length;
      return <li key={b.id}>
        <p>{`${kindLabel[b.kind] ?? b.subject}, ${dateDots(isoDayOf(b.created))}, godz. ${timeOf(b.created)}, ${b.recipients} ${plural(b.recipients, 'osoba', 'osoby', 'osób')}. Wysłano ${sent}.${waiting ? ` Czeka ${waiting}.` : ''}`}</p>
        <ul class="small">{b.messages.map((m, i) => <li key={i}>{m.name}, {statusText(m)}</li>)}</ul>
      </li>;
    })}</ul> : <p class="muted">Nie wysłano jeszcze żadnej wiadomości o tym posiedzeniu.</p>}
  </Fold>;
}

interface MailState { enabled: boolean; passwordSet: boolean; hostAllowed: string | null; paused: {reason?: string} | null; problems: string[]; demo?: string }
/** Sekcja „Poczta e-mail” w ustawieniach ogólnych (6.7.4); te same właściwości co pozostałe sekcje settings.tsx. */
export function MailSettingsSection(props: {bundle: GeneralBundle | null; canEdit: boolean}) {
  const s = useSession();
  const mail: Partial<MailSettings> = props.bundle?.general.mail ?? {};
  const [state, setState] = useState<MailState | null>(null);
  const [to, setTo] = useState('');
  const [steps, setSteps] = useState<{name: string; ok: boolean; skipped?: boolean; text: string}[] | null>(null);
  const [note, setNote] = useState('');
  const {busy, error, errorKind, run} = useAction();
  useEffect(() => { request<MailState>('/api/mail/state').then(setState).catch(() => {}); }, []);
  return <section class="settings-section stack">
    {!props.canEdit && <Notice>Ustawienia poczty zmienia biuro.</Notice>}
    <dl class="facts">
      <Fact label="Stan">{state ? (state.paused ? `Wysyłka wstrzymana. ${state.paused.reason ?? ''}`.trim() : state.enabled ? 'Włączona.' : 'Wyłączona.') : ''}</Fact>
      <Fact label="Serwer poczty">{mail.host || 'nie wpisano'}</Fact>
      <Fact label="Port i szyfrowanie">{mail.port ? `${mail.port}, ${mail.security === 'starttls' ? 'STARTTLS' : 'TLS'}` : 'nie wpisano'}</Fact>
      <Fact label="Login">{mail.user || 'bez logowania'}</Fact>
      <Fact label="Hasło">{state?.passwordSet ? `Ustawione na serwerze aplikacji. Działa tylko z serwerem ${state.hostAllowed ?? ''}.`.trim() : 'Brakuje hasła na serwerze aplikacji.'}</Fact>
      <Fact label="Adres nadawcy">{mail.fromAddress || 'nie wpisano'}</Fact>
      <Fact label="Nazwa nadawcy">{mail.fromName || 'nie wpisano'}</Fact>
      <Fact label="Adres do odpowiedzi">{mail.replyTo || 'nie wpisano'}</Fact>
      <Fact label="Informacje o danych">{mail.privacyUrl || 'nie wpisano'}</Fact>
      <Fact label="Administrator danych">{mail.controller || 'nie wpisano'}</Fact>
    </dl>
    {props.canEdit && s.account.kind === 'biuro' && <form class="stack" onSubmit={e => { e.preventDefault(); run(async () => { const r = await request<{steps: typeof steps; demo?: string}>('/api/mail/test', {body: {to}}); setSteps(r.steps); setNote(r.demo ?? ''); }); }}>
      <Field label="Adres"><input type="email" value={to} onInput={e => setTo((e.target as HTMLInputElement).value)}/></Field>
      <div><Button type="submit" busy={busy}>Wyślij wiadomość próbną</Button></div>
    </form>}
    {steps && <ol class="mail-steps">{steps.map(x => <li key={x.name}>{x.name} <StateChip state={mailStepChip(x)}/>{!x.ok && !x.skipped && x.text !== 'Pominięto' ? ` ${x.text}` : ''}</li>)}</ol>}
    {(note || (steps && brand.demo)) && <p>{note || 'Wersja próbna nie łączy się z serwerem poczty.'}</p>}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
  </section>;
}
