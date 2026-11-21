import {useEffect, useState} from 'preact/hooks';
import {request} from './api.ts';
import {useSession} from './session.ts';
import {brand} from './brand.ts';
import {Button, Check, ErrorNotice, Fact, Field, Fold, Modal, Notice, Segments, StateChip, useAction} from './ui.tsx';
import {mailStepChip} from './stany.ts';
import {DEFAULT_INTROS, skippedText, type MailIntroKind, type MailRecipientRow, type MailSettings} from '../shared/mail.ts';
import {generalNow, setGeneral} from './general.ts';
import type {GeneralBundle, SettingsChange} from '../shared/settings.ts';
import {dateDots, isoDayOf, plural, timeOf} from '../shared/text.ts';
import type {Meeting} from '../shared/types.ts';
import {RowEditor, SettingRow, SettingsList, TextRowEditor, type EditorCtl} from './cascade-ui.tsx';
import './style/poczta.css';

// Poczta na ekranach (SPEC-4 6.7, B2 3.9, B2-P12, B2-P13). API zamrożone (pakiet D0): okno wysyłki (`MailDialog`),
// historia wysyłek (`MailHistory`) i sekcja ustawień „Poczta e-mail” (`MailSettingsSection`). Każdą wiadomość wysyła
// człowiek po podglądzie; treść, temat i adresatów liczy serwer z `src/shared/mail-templates.ts` i `mailRecipients`, więc
// podgląd jest tym, co wyjdzie. Podgląd HTML stoi w `<iframe sandbox srcdoc>` bez skryptów. W trakcie obrad nic tu nie
// wysyła zapytań (komponenty montuje się tylko w przygotowaniu i po zamknięciu, T-5). Zespół F montuje `MailDialog`
// i `MailHistory` w karcie „Dokumenty posiedzenia” (papers.tsx).

export type MailDialogKind = 'postep' | 'po_posiedzeniu';
interface Preview { subject: string; text: string; html: string; recipients: MailRecipientRow[]; lastProgressAt: number | null }
const osob = (n: number) => plural(n, 'osoba', 'osoby', 'osób');

/** Okno wysyłki „Wyślij informację o postępie przygotowań” albo „Wyślij powiadomienie o dokumentach” (6.7.1). */
export function MailDialog(props: {meeting: Pick<Meeting, 'id' | 'title'>; kind: MailDialogKind; onClose: () => void; onSent?: (batch: {id: string; recipients: number}) => void}) {
  const [group, setGroup] = useState<'wszyscy' | 'wybrani'>('wszyscy');
  const [ids, setIds] = useState<string[]>([]);
  const [office, setOffice] = useState(false);
  const [intro, setIntro] = useState<string>(() => generalNow()?.general.mail?.intros?.[props.kind] ?? DEFAULT_INTROS[props.kind]);
  const [view, setView] = useState<'html' | 'tekst'>('html');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [everyone, setEveryone] = useState<MailRecipientRow[] | null>(null);
  const [done, setDone] = useState('');
  const {busy, error, errorKind, run} = useAction();
  const recipients = {group, ids, office};
  const base = `/api/meetings/${encodeURIComponent(props.meeting.id)}/mail`;
  useEffect(() => {
    const t = setTimeout(() => run(async () => {
      const r = await request<Preview>(`${base}/preview`, {body: {kind: props.kind, recipients, intro}});
      setPreview(r);
      if (group === 'wszyscy' && !office) setEveryone(r.recipients);
    }), preview ? 400 : 0);
    return () => clearTimeout(t);
  }, [group, ids.join(','), office, intro]);
  const sending = preview?.recipients.filter(r => r.state === 'wysle') ?? [];
  const skipped = preview?.recipients.map(skippedText).filter((x): x is string => !!x) ?? [];
  const n = sending.length;
  const members = everyone?.length ?? preview?.recipients.length ?? 0;
  const title = props.kind === 'postep' ? 'Wyślij informację o postępie przygotowań' : 'Wyślij powiadomienie o dokumentach';
  return <Modal title={title} wide onClose={props.onClose}>
    <div class="stack mail-dialog">
      <Segments label="Do kogo" value={group} options={[['wszyscy', `Członkowie Prezydium (${members})`], ['wybrani', 'Wybrane osoby']]} onChange={setGroup}/>
      {group === 'wybrani' && everyone && <fieldset class="stack-tight mail-people"><legend class="sr-only">Wybrane osoby</legend>
        {everyone.map(r => <Check key={r.accountId} checked={ids.includes(r.accountId)} onChange={on => setIds(on ? [...ids, r.accountId] : ids.filter(x => x !== r.accountId))}>{r.name}</Check>)}</fieldset>}
      <Check checked={office} onChange={setOffice}>Także konta biura</Check>
      <p role="status" class="mail-count">{preview ? `Wiadomość dostanie ${n} ${osob(n)}.` : ''}</p>
      {skipped.length > 0 && <ul class="mail-skipped small">{skipped.map(t => <li key={t}>{t}</li>)}</ul>}
      <Field label="Wstęp" hint="Do 1500 znaków, zwykły tekst."><textarea rows={4} maxLength={1500} value={intro} onInput={e => setIntro((e.target as HTMLTextAreaElement).value)}/></Field>
      {preview && <>
        <Segments label="Podgląd" value={view} options={[['html', 'Wersja HTML'], ['tekst', 'Wersja tekstowa']]} onChange={setView}/>
        {sending.length > 0 && <p class="small muted">{`Podgląd dla ${sending.map(r => r.name).join(', ')}`}</p>}
        <p class="small"><strong>{preview.subject}</strong></p>
        {view === 'html' ? <iframe class="mail-preview" sandbox="" srcdoc={preview.html} title="Podgląd wiadomości"/> : <pre class="mail-preview-text">{preview.text}</pre>}
        {props.kind === 'postep' && preview.lastProgressAt && <p class="small">{`Ostatnią informację o postępie wysłano dziś o godz. ${timeOf(preview.lastProgressAt)}. Kolejną można wysłać po godz. ${timeOf(preview.lastProgressAt + 3600000)}.`}</p>}
      </>}
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      {done ? <><p role="status" class="save-status">{done}</p><div class="actions"><Button onClick={props.onClose}>Zamknij</Button></div></> : <div class="actions">
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

interface HistoryMessage { name: string; status: string; nextAt: number; sentAt: number | null; error: string; id?: string; attempts?: number; address?: string }
interface HistoryBatch { id: string; kind: string; created: number; actor: string; subject: string; recipients: number; messages: HistoryMessage[] }
const kindLabel: Record<string, string> = {postep: 'Informacja o postępie', po_posiedzeniu: 'Dokumenty po posiedzeniu', protokol: 'Protokół do wglądu', komunikacja: 'Materiał dla komunikacji gotowy', zawiadomienie: 'Zawiadomienie', kod: 'Kod potwierdzenia', zmiana_adresu: 'Zmiana adresu', proba: 'Wiadomość próbna'};
const waits = (m: HistoryMessage) => m.status === 'czeka' || m.status === 'wysylanie';
const failed = (m: HistoryMessage) => m.status === 'blad' || m.status === 'anulowana' || m.status === 'proba';
/** Stan jednej osoby (6.7.3), bez adresu. */
export const messageStatusText = (m: HistoryMessage) => m.status === 'wyslana' ? `Wysłano ${m.sentAt ? timeOf(m.sentAt) : ''}`.trim()
  : waits(m) ? `Czeka, kolejna próba o ${timeOf(m.nextAt)}`
  : m.status === 'proba' ? 'Nie wysłano, wersja próbna' : `Nie wysłano. ${m.error || (m.status === 'anulowana' ? 'Anulowano.' : '')}`.trim();
/** Wiersz wysyłki (6.7.3): „{rodzaj}, {dd.mm.rrrr}, godz. {g}, {n} osób. Wysłano {k}. Czeka {m}, kolejna próba o godz. {g}.” albo „Nie wysłano {m}.” */
export function batchText(b: HistoryBatch) {
  const sent = b.messages.filter(m => m.status === 'wyslana').length;
  const waiting = b.messages.filter(waits);
  const notSent = b.messages.filter(failed).length;
  const next = waiting.length ? Math.min(...waiting.map(m => m.nextAt)) : 0;
  return `${kindLabel[b.kind] ?? b.subject}, ${dateDots(isoDayOf(b.created))}, godz. ${timeOf(b.created)}, ${b.recipients} ${osob(b.recipients)}. Wysłano ${sent}.`
    + (waiting.length ? ` Czeka ${waiting.length}, kolejna próba o godz. ${timeOf(next)}.` : '') + (notSent ? ` Nie wysłano ${notSent}.` : '');
}

/** „Historia wysyłek ({n})” posiedzenia (6.7.3); `refresh` zmienia się po wysyłce, żeby wczytać historię jeszcze raz. */
export function MailHistory(props: {meetingId: string; refresh?: number}) {
  const [batches, setBatches] = useState<HistoryBatch[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { request<{batches: HistoryBatch[]}>(`/api/meetings/${encodeURIComponent(props.meetingId)}/mail`).then(r => { setError(''); setBatches(r.batches); }).catch(e => setError((e as Error).message)); }, [props.meetingId, props.refresh]);
  if (error) return <ErrorNotice>{error}</ErrorNotice>;
  if (!batches) return null;
  return <Fold title="Historia wysyłek" count={batches.length}>
    {batches.length ? <ul class="mail-history">{batches.map(b => <li key={b.id}>
      <p>{batchText(b)}</p>
      <ul class="small mail-people-list">{b.messages.map((m, i) => <li key={i}>{`${m.name}, ${messageStatusText(m)}`}</li>)}</ul>
    </li>)}</ul> : <p class="muted">Nie wysłano jeszcze żadnej wiadomości o tym posiedzeniu.</p>}
  </Fold>;
}

interface MailState { enabled: boolean; off?: boolean; passwordSet: boolean; hostAllowed: string | null; appUrl?: string; paused: {reason?: string; at?: number} | null; problems: string[]; demo?: string }
type MailKey = Exclude<keyof MailSettings, 'intros'>;
async function saveMail(change: SettingsChange) {
  const r = await request<{general: GeneralBundle}>('/api/settings', {body: {change}});
  setGeneral(r.general);
  return r;
}
const shown = (v: string) => v || 'Nie wpisano.';
/** Po włączeniu albo wyłączeniu wysyłki sesja wczytuje się ponownie (`session.mail.enabled` steruje przyciskami wysyłki, 2.5). */
const refreshSession = () => window.dispatchEvent(new Event('posiedzenia:sesja'));
const SOURCE = 'Ustawienie ogólne.';

function PortEditor(props: {close: (s?: string) => void; ctl: EditorCtl; port: number; security: MailSettings['security']}) {
  const [security, setSecurity] = useState(props.security);
  const [port, setPort] = useState(String(props.port || (props.security === 'starttls' ? 587 : 465)));
  return <RowEditor close={props.close} ctl={props.ctl} dirty={security !== props.security || Number(port) !== props.port}
    onSave={async () => { if (security !== props.security) await saveMail({area: 'poczta', key: 'security', value: security}); if (Number(port) !== props.port) await saveMail({area: 'poczta', key: 'port', value: Number(port)}); }}>
    <Segments label="Szyfrowanie" value={security} options={[['tls', 'TLS, port 465'], ['starttls', 'STARTTLS, port 587']]} onChange={v => { setSecurity(v); setPort(v === 'tls' ? '465' : '587'); }}/>
    <Field label="Port"><input inputMode="numeric" value={port} maxLength={5} onInput={e => setPort((e.target as HTMLInputElement).value.replace(/\D/g, ''))}/></Field>
  </RowEditor>;
}
function IntroEditor(props: {close: (s?: string) => void; ctl: EditorCtl; kind: MailIntroKind; initial: string}) {
  const [text, setText] = useState(props.initial);
  return <RowEditor close={props.close} ctl={props.ctl} dirty={text !== props.initial} onSave={() => saveMail({area: 'poczta', intro: props.kind, text})}>
    <Field label="Wstęp" hint="Do 1500 znaków, zwykły tekst."><textarea rows={4} maxLength={1500} value={text} onInput={e => setText((e.target as HTMLTextAreaElement).value)}/></Field>
  </RowEditor>;
}

/** Okno wiadomości próbnej (B2-P13): pole „Adres” i kroki „Połączenie”, „Szyfrowanie”, „Logowanie”, „Wysłanie”. */
function TestDialog(props: {onClose: () => void}) {
  const [to, setTo] = useState('');
  const [steps, setSteps] = useState<{name: string; ok: boolean; skipped?: boolean; text: string}[] | null>(null);
  const [note, setNote] = useState('');
  const {busy, error, errorKind, run} = useAction();
  return <Modal title="Wyślij wiadomość próbną" onClose={props.onClose}>
    <form class="stack" onSubmit={e => { e.preventDefault(); setSteps(null); run(async () => { const r = await request<{steps: NonNullable<typeof steps>; demo?: string}>('/api/mail/test', {body: {to: to.trim()}}); setSteps(r.steps); setNote(r.demo ?? ''); }); }}>
      <Field label="Adres"><input type="email" required spellcheck={false} value={to} maxLength={254} onInput={e => setTo((e.target as HTMLInputElement).value)}/></Field>
      {/* W-W4-17: przed wysłaniem „Anuluj”, po wyniku tylko „Zamknij” w nagłówku okna. */}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>Wyślij</Button>{!steps && <Button kind="ghost" onClick={props.onClose}>Anuluj</Button>}</div>
    </form>
    {steps && <ol class="mail-steps" aria-label="Kroki wiadomości próbnej">{steps.map(x => <li key={x.name}>
      <span class="mail-step__name">{x.name}</span><StateChip state={mailStepChip(x)}/><span class="mail-step__text">{x.skipped || x.text === 'Pominięto' ? '' : x.text}</span>
    </li>)}</ol>}
    {steps && (note || brand.demo) && <p>{note || 'Wersja próbna nie łączy się z serwerem poczty.'}</p>}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
  </Modal>;
}

interface LogBatch { id: string; kind: string; created: number; actor: string; subject: string; recipients: number; messages: (HistoryMessage & {id: string})[] }
/** „Dziennik wysyłek” (B2-P14): biuro bez adresów, z ponowieniem i anulowaniem; administrator z adresami. Wczytuje się po rozwinięciu. */
function MailLog(props: {canAct: boolean}) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<LogBatch[] | null>(null);
  const [error, setError] = useState('');
  const {busy, run} = useAction();
  const load = () => request<{batches: LogBatch[]}>('/api/mail/log?limit=50').then(r => { setError(''); setLog(r.batches); }).catch(e => setError((e as Error).message));
  useEffect(() => { if (open) load(); }, [open]);
  return <Fold title="Dziennik wysyłek" onToggle={setOpen}>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {!log && !error && <p class="muted">Wczytywanie…</p>}
    {log && (log.length ? <ul class="mail-history">{log.map(b => <li key={b.id}>
      <p>{batchText(b)}</p>
      <ul class="small mail-people-list">{b.messages.map(m => <li key={m.id}>
        <span>{`${m.name}${m.address ? ` (${m.address})` : ''}, ${messageStatusText(m)}`}</span>
        {props.canAct && (m.status === 'blad' || waits(m)) && <span class="actions">
          {m.status === 'blad' && <Button small kind="ghost" quiet busy={busy} label={`Ponów wysyłkę do ${m.name}`} onClick={() => run(async () => { await request(`/api/mail/messages/${m.id}/retry`, {method: 'POST'}); await load(); })}>Ponów</Button>}
          <Button small kind="ghost" quiet busy={busy} label={`Anuluj wysyłkę do ${m.name}`} onClick={() => run(async () => { await request(`/api/mail/messages/${m.id}/cancel`, {method: 'POST'}); await load(); })}>Anuluj</Button>
        </span>}
      </li>)}</ul>
    </li>)}</ul> : <p class="muted">Nie wysłano jeszcze żadnej wiadomości.</p>)}
  </Fold>;
}

/** Sekcja „Poczta e-mail” w ustawieniach ogólnych (6.7.4, B2-P12); te same właściwości co pozostałe sekcje settings.tsx. */
export function MailSettingsSection(props: {bundle: GeneralBundle | null; canEdit: boolean}) {
  const s = useSession();
  const mail: Partial<MailSettings> = props.bundle?.general.mail ?? {};
  const [state, setState] = useState<MailState | null>(null);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState('');
  const {busy, error, errorKind, run} = useAction();
  const loadState = () => request<MailState>('/api/mail/state').then(setState).catch(() => {});
  useEffect(() => { loadState(); }, [props.bundle?.revision]);
  const office = props.canEdit && s.account.kind === 'biuro';
  const text = (key: MailKey, label: string, genitive: string, hint?: string) => <SettingRow label={label} at="ogolne" source={SOURCE} value={shown(String(mail[key] ?? ''))} genitive={genitive}
    editor={office ? (close, ctl) => <TextRowEditor close={close} ctl={ctl} label={label} initial={String(mail[key] ?? '')} max={300} hint={hint} onSave={v => saveMail({area: 'poczta', key, value: v.trim()})}/> : undefined}/>;
  const stateText = !state ? 'Wczytywanie…' : state.paused ? `Wysyłka wstrzymana. ${state.paused.reason ?? ''}`.trim() : state.enabled ? 'Włączona.' : 'Wyłączona.';
  const intros = mail.intros ?? {};
  return <div class="stack mail-settings">
    {!props.canEdit && <Notice>Ustawienia poczty zmienia biuro.</Notice>}
    <p>Aplikacja wysyła wiadomości o przygotowaniu i dokumentach posiedzeń. Każdą wysyła człowiek, po podglądzie.</p>
    <dl class="facts">
      <Fact label="Stan"><span class="mail-state">{stateText}{state?.paused && office && <Button small busy={busy} onClick={() => run(async () => { await request('/api/mail/resume', {method: 'POST'}); await loadState(); setNote('Wznowiono wysyłkę.'); })}>Wznów wysyłkę</Button>}</span></Fact>
    </dl>
    <SettingsList label="Poczta e-mail">
      {text('host', 'Serwer poczty', 'serwera poczty')}
      <SettingRow label="Port i szyfrowanie" at="ogolne" source={SOURCE} value={mail.port ? `${mail.port}, ${mail.security === 'starttls' ? 'STARTTLS' : 'TLS'}` : 'Nie wpisano.'} genitive="portu i szyfrowania"
        editor={office ? (close, ctl) => <PortEditor close={close} ctl={ctl} port={mail.port ?? 465} security={mail.security ?? 'tls'}/> : undefined}/>
      {text('user', 'Login', 'loginu')}
      <SettingRow label="Hasło" at="ogolne" source="" value={state?.passwordSet ? `Ustawione na serwerze aplikacji. Działa tylko z serwerem ${state.hostAllowed ?? ''}.`.replace(' .', '.') : 'Brakuje hasła na serwerze aplikacji.'}/>
      {text('fromAddress', 'Adres nadawcy', 'adresu nadawcy')}
      {text('fromName', 'Nazwa nadawcy', 'nazwy nadawcy')}
      {text('replyTo', 'Adres do odpowiedzi', 'adresu do odpowiedzi')}
      {text('privacyUrl', 'Informacje o danych', 'adresu informacji o przetwarzaniu danych', 'Adres zaczynający się od https://.')}
      {text('controller', 'Administrator danych', 'administratora danych')}
    </SettingsList>
    <Fold title="Wstępy wiadomości (2)">
      <SettingsList label="Wstępy wiadomości">
        {(['postep', 'po_posiedzeniu'] as MailIntroKind[]).map(k => <SettingRow key={k} label={k === 'postep' ? 'Informacja o postępie' : 'Dokumenty po posiedzeniu'} at="ogolne" source={SOURCE}
          value={intros[k] ?? DEFAULT_INTROS[k]} genitive={`wstępu wiadomości ${k === 'postep' ? '„Informacja o postępie”' : '„Dokumenty po posiedzeniu”'}`}
          editor={office ? (close, ctl) => <IntroEditor close={close} ctl={ctl} kind={k} initial={intros[k] ?? DEFAULT_INTROS[k]}/> : undefined}/>)}
      </SettingsList>
    </Fold>
    {office && <div class="actions">
      <Button haspopup onClick={() => setTesting(true)}>Wyślij wiadomość próbną</Button>
      {mail.enabled
        ? <Button busy={busy} onClick={() => run(async () => { await saveMail({area: 'poczta', key: 'enabled', value: false}); await loadState(); refreshSession(); setNote('Wyłączono wysyłkę.'); })}>Wyłącz wysyłkę</Button>
        : <Button kind="primary" busy={busy} onClick={() => run(async () => { await saveMail({area: 'poczta', key: 'enabled', value: true}); await loadState(); refreshSession(); setNote('Włączono wysyłkę.'); })}>Włącz wysyłkę</Button>}
    </div>}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
    <p role="status" class="save-status">{note}</p>
    {office && <MailLog canAct/>}
    {testing && <TestDialog onClose={() => setTesting(false)}/>}
  </div>;
}
