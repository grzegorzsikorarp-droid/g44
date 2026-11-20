import {useLayoutEffect, useRef, useState} from 'preact/hooks';
import {PROCEDURE_MIN_HOURS} from '../shared/law.ts';
import {awaitingVote, itemNumber, materialTypeOf, unannounced} from '../shared/rules.ts';
import {organMembers} from '../shared/roster.ts';
import {canManageProcedure, canStartProcedure, organRoster, procedureStarter} from '../shared/role.ts';
import {compositionBasisText, organSettingsOf} from '../shared/settings.ts';
import {dateDots, dateDotsOf, hoursText, timeOf} from '../shared/text.ts';
import type {AgendaItem, Meeting, ModeDecision, VoteMode} from '../shared/types.ts';
import {useNow} from './api.ts';
import {useMeeting, type ViewBallot} from './context.ts';
import {useSession} from './session.ts';
import {useGeneral} from './general.ts';
import {useDocTypes} from './doctypes.ts';
import {Button, CardTitle, Confirm, Countdown, Fact, Field, fmtDateTime, fmtTime, Modal, Notice, plural, Segments, TitleLead} from './ui.tsx';
import {modeName} from './stany.ts';
import {RejectedVote, ResultCard, VoteCard} from './meeting.tsx';
import {AgendaEditor, DateRowEditor, DeleteMeeting, DeputyCard, DocTypeEditor, DuplicateButton, ItemMaterials, MaterialsEditor, MeetingHistory, PrepLayout,
  PresentersRowEditor, ReviewCard, useActor, useCommand} from './prep.tsx';
import {MaterialLink} from './reader.tsx';
import {Messages} from './messages.tsx';
import {appRuleWhy, dateHintText, RowEditor, SettingRow, SettingsList, TextRowEditor, type EditorCtl} from './cascade-ui.tsx';

// Głosowanie między posiedzeniami (§ 14 ust. 5 Regulaminu Okręgowej Rady; wersja 3, rozdz. 5.5). Rozpoczyna je
// przewodniczący albo zastępca wyznaczony na to głosowanie, a zarządza osoba, która je rozpoczęła, i przewodniczący
// (DA-12). Termin krótszy niż 24 godziny wymaga powodu (DA-21), a tryb tajny albo imienny danych uchwały (G-13).

// Numery spraw w zdaniu: „1”, „1 i 3”, „1, 2 i 3”.
const joinNumbers = (list: string[]) => list.length > 1 ? `${list.slice(0, -1).join(', ')} i ${list[list.length - 1]}` : list[0] ?? '';
const sameTitle = (a: string, b: string) => {
  const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').toLowerCase();
  return norm(a) === norm(b);
};
/** Czas trwania w bierniku: „3 godziny”, „1 godzinę”, „40 minut”. */
function durationText(ms: number) {
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `${hours} ${plural(hours, 'godzinę', 'godziny', 'godzin')}`;
  const minutes = Math.max(1, Math.round(ms / 60000));
  return `${minutes} ${plural(minutes, 'minutę', 'minuty', 'minut')}`;
}
const shortTermText = (ms: number) => `Głosowanie potrwa ${durationText(ms)}. Najkrótszy czas to ${PROCEDURE_MIN_HOURS} godziny, żeby każdy członek mógł spokojnie oddać głos (§ 14 ust. 5). Powód trafi do dokumentu z przebiegu głosowania.`;
const minimum = PROCEDURE_MIN_HOURS * 3600000;

export function ProcedureView() {
  const {m} = useMeeting();
  const s = useSession();
  const actor = useActor();
  if (m.status === 'przygotowanie') {
    if (!s.isOrganizer(m.organ)) return <div class="member"><Notice>Głosowanie jeszcze się nie rozpoczęło. Przygotowuje je biuro, przewodniczący albo wiceprzewodniczący.</Notice><Acts/></div>;
    return <PrepLayout
      main={<>
        <section class="oi-card"><CardTitle level={2}>Sprawy do głosowania</CardTitle><p class="muted small">Każda sprawa (np. uchwała) to osobne głosowanie. Dołącz do niej materiał, aby członkowie mogli go przeczytać przed oddaniem głosu.</p><AgendaEditor panel={(it, close) => <ActSettings it={it} close={close}/>}/></section>
        <section class="oi-card"><CardTitle level={2}>{`Materiały (${m.materials.length})`}</CardTitle><MaterialsEditor/></section>
        <MeetingHistory/>
      </>}
      review={<><ReviewCard/><Start/></>}
      settings={<><ProcedureSettings/><Messages/></>}
      end={<><DuplicateButton/><DeleteMeeting/></>}/>;
  }
  const manager = canManageProcedure(s.roster, m as Meeting, actor);
  return <div class="procedure">
    <div class="procedure-main">
      {m.status === 'trwa' && m.endsAt && <VotingWindow endsAt={m.endsAt}/>}
      {m.status === 'zakonczone' && (m.ended?.how === 'przerwij'
        ? <Notice tone="ok" label="Głosowanie przerwane">{`Głosowanie przerwano ${fmtDateTime(m.ended.at)}. Powód „${m.ended.reason ?? ''}”. Rozstrzygnięcie nie zapadło.`}</Notice>
        // F2, DA-12: wyniki, których osoba jeszcze nie widzi, ogłasza osoba zarządzająca głosowaniem albo przewodniczący.
        : m.ballots.some(b => b.resultHidden) || (!manager && unannounced(m).length)
          ? <Notice tone="ok">Głosowanie zakończone. Wyniki ogłasza osoba zarządzająca głosowaniem albo przewodniczący.</Notice>
          : <Notice tone="ok">Głosowanie zakończone. Wyniki są poniżej, a zestawienie do protokołu otwiera przycisk „Projekt protokołu”.</Notice>)}
      {m.status === 'zakonczone' && <DuplicateButton/>}
      <RejectedVote ballots={m.ballots}/>
      <Acts/>
    </div>
    <aside class="procedure-side"><ProcedureSettings/><Messages/></aside>
  </div>;
}

/** Zmiana składu po rozpoczęciu (DA-13): uwaga dla osoby zarządzającej i przewodniczącego. */
function CompositionNote() {
  const {m} = useMeeting();
  const s = useSession();
  if (!m.frozen) return null;
  const frozen = m.frozen.members;
  const current = organMembers(s.roster, m.organ);
  const changed = current.filter(c => { const f = frozen.find(x => x.personId === c.personId); return !f || f.func !== c.func; });
  const removed = frozen.filter(f => !current.some(c => c.personId === f.personId));
  if (!changed.length && !removed.length) return null;
  const organ = s.roster.organs.find(o => o.code === m.organ);
  const name = organ?.forms.genitive ?? 'Prezydium';
  const latest = [...changed].sort((a, b) => (b.since ?? '').localeCompare(a.since ?? ''))[0];
  const what = latest?.since && latest.basis ? `zmieniono ${dateDots(latest.since)} (${compositionBasisText(latest.basis, s.roster)})` : 'zmieniono po rozpoczęciu głosowania';
  return <div class="oi-note oi-note--wazne notice"><span class="oi-label">Ważne</span><div class="notice-text">{`Skład ${name} ${what}. Głosowanie trwa według składu z chwili rozpoczęcia. Jeśli osoba spoza obecnego składu nie powinna głosować, przerwij głosowanie i rozpocznij nowe.`}</div></div>;
}

// Karta „Głosowanie trwa”: termin, pozostały czas, zasady rozstrzygnięcia, uwaga o zmianie terminu, a za kreską
// zmiana terminu i zakończenie przed terminem (F7) tylko dla osoby zarządzającej i przewodniczącego (DA-12).
function VotingWindow({endsAt}: {endsAt: number}) {
  const {m} = useMeeting();
  const s = useSession();
  const actor = useActor();
  const [ask, setAsk] = useState<'termin' | 'koniec' | null>(null);
  const quorum = m.effective?.meeting.quorum.value;
  const total = quorum?.total ?? organRoster(s.roster, m).length;
  const required = quorum?.required ?? Math.ceil(total / 2);
  const manager = canManageProcedure(s.roster, m as Meeting, actor);
  const changed = m.deadlineChanges?.at(-1);
  return <section class="oi-card is-teraz window" aria-labelledby="glosowanie-trwa">
    <span class="oi-label" id="glosowanie-trwa">Głosowanie trwa</span>
    <p class="window-due">{`do ${fmtDateTime(endsAt)}`}</p>
    <p class="window-left">zostało <Countdown endsAt={endsAt} label={false} long/></p>
    {/* Uwaga stoi w karcie z czerwonym paskiem, więc ma pasek w kolorze tekstu (oi-note--wazne), nie drugi czerwony. */}
    {changed && <div class="oi-note oi-note--wazne notice"><div class="notice-text">{`Termin zmieniono o godz. ${fmtTime(changed.at)}. Głosowanie potrwa do ${fmtDateTime(changed.to)}.`}</div></div>}
    <p class="muted small">{`Uprawnionych do głosowania ${total}. Rozstrzygnięcie zapada przy udziale co najmniej ${required} głosujących `}<span class="oi-nowrap">(§ 8 ust. 2)</span>{' zwykłą większością głosów. Głosowanie kończy się wcześniej, gdy zagłosują wszyscy.'}</p>
    {manager && <CompositionNote/>}
    {manager
      ? <div class="window-end actions">
        <Button small haspopup onClick={() => setAsk('termin')}>Zmień termin</Button>
        <Button small haspopup onClick={() => setAsk('koniec')}>Zakończ przed terminem</Button>
      </div>
      : <p class="small window-end">Wyniki ogłasza osoba zarządzająca głosowaniem albo przewodniczący.</p>}
    {ask === 'termin' && <DeadlineDialog endsAt={endsAt} onClose={() => setAsk(null)}/>}
    {ask === 'koniec' && <EndDialog onClose={() => setAsk(null)}/>}
  </section>;
}

// Data i godzina do pola datetime-local w strefie przeglądarki.
const localInput = (ts?: number) => ts ? new Date(ts - new Date(ts).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';

// Przedłużenie albo skrócenie terminu: nowy termin co najmniej 5 minut od teraz (procedure_deadline). Termin krótszy
// niż 24 godziny od rozpoczęcia wymaga powodu (DA-21, G-18).
function DeadlineDialog(props: {endsAt: number; onClose: () => void}) {
  const {m, send, busy} = useMeeting();
  const now = useNow(15000);
  const [value, setValue] = useState(localInput(props.endsAt));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const chosen = value ? new Date(value).getTime() : NaN;
  const short = Number.isFinite(chosen) && !!m.openedAt && chosen - m.openedAt < minimum;
  const missing = short && !reason.trim();
  return <Modal title="Zmienić termin głosowania?" onClose={props.onClose} closeButton={false} confirm initialFocus=".deadline-field input">
    <form class="stack" onSubmit={async e => {
      e.preventDefault();
      if (!Number.isFinite(chosen) || chosen < now + 5 * 60000) { setError('Ustaw nowy termin co najmniej 5 minut od teraz.'); return; }
      if (chosen === props.endsAt) { setError('To jest obecny termin głosowania.'); return; }
      if (missing) return;
      if (await send({type: 'procedure_deadline', endsAt: chosen, ...(short ? {reason: reason.replace(/\s+/g, ' ').trim()} : {})})) props.onClose();
    }}>
      <p>{`Obecny termin to ${fmtDateTime(props.endsAt)}. Nowy termin obejmie wszystkie trwające głosowania, a członkowie zobaczą uwagę o zmianie i wiadomość w kanale.`}</p>
      <div class="deadline-field"><Field label="Nowy termin" hint="Co najmniej 5 minut od teraz. Termin można przedłużyć albo skrócić." error={error || undefined}>
        <input type="datetime-local" required value={value} onInput={e => { setError(''); setValue((e.target as HTMLInputElement).value); }}/>
      </Field></div>
      {short && <>
        <p>{shortTermText(chosen - m.openedAt!)}</p>
        <Field label="Powód krótszego terminu"><input value={reason} maxLength={500} required onInput={e => setReason((e.target as HTMLInputElement).value)}/></Field>
      </>}
      <div class="actions confirm-actions"><Button kind="primary" type="submit" busy={busy} disabled={missing} reason={missing ? 'Wpisz powód krótszego terminu.' : undefined}>Ustaw nowy termin</Button><Button onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

// Zakończenie przed terminem: policzenie głosów albo przerwanie bez rozstrzygnięcia z powodem (procedure_end).
function EndDialog(props: {onClose: () => void}) {
  const {m, send, busy} = useMeeting();
  const [how, setHow] = useState<'policz' | 'przerwij'>('policz');
  const [reason, setReason] = useState('');
  const open = m.ballots.filter(b => b.status === 'otwarte');
  const eligible = [...new Set(open.flatMap(b => b.eligible))];
  const missing = eligible.filter(p => open.some(b => awaitingVote(b).includes(p))).length;
  const countText = missing === 0 ? 'Zagłosowali wszyscy uprawnieni. Wszystkie trwające głosowania zostaną zamknięte i policzone.'
    : `Bez głosu ${plural(missing, 'jest', 'są', 'jest')} jeszcze ${missing} ${plural(missing, 'osoba', 'osoby', 'osób')} z ${eligible.length} uprawnionych. Wszystkie trwające głosowania zostaną zamknięte i policzone, a ${missing === 1 ? 'ta osoba nie będzie już mogła' : 'te osoby nie będą już mogły'} oddać głosu.`;
  const missingReason = how === 'przerwij' && !reason.trim();
  return <Modal title="Zakończyć głosowanie przed terminem?" onClose={props.onClose} closeButton={false} confirm initialFocus=".confirm-cancel">
    <form class="stack" onSubmit={async e => {
      e.preventDefault();
      if (missingReason) return;
      if (await send({type: 'procedure_end', how, reason: how === 'przerwij' ? reason.replace(/\s+/g, ' ').trim() : undefined})) props.onClose();
    }}>
      <Segments label="Sposób zakończenia" value={how} options={[['policz', 'Zakończ i policz głosy'], ['przerwij', 'Przerwij bez rozstrzygnięcia']]} onChange={setHow}/>
      <p>{how === 'policz' ? countText : `Wszystkie trwające głosowania zostaną przerwane bez wyniku. Rozstrzygnięcie nie zapadnie, a oddane głosy nie zostaną policzone. Powód trafi do protokołu.`}</p>
      {how === 'przerwij' && <Field label="Powód" hint="Np. błąd w treści uchwały."><input value={reason} maxLength={500} required onInput={e => setReason((e.target as HTMLInputElement).value)}/></Field>}
      <div class="oi-note oi-note--wazne"><span class="oi-label">Ważne</span><p>Zakończenia głosowania nie można cofnąć.</p></div>
      <div class="actions confirm-actions">
        <Button kind="danger" type="submit" class="confirm-ok" busy={busy} disabled={missingReason} reason={how === 'przerwij' ? (missingReason ? 'Wpisz powód.' : '') : undefined}>{how === 'policz' ? 'Zakończ i policz głosy' : 'Przerwij głosowanie'}</Button>
        <Button class="confirm-cancel" onClick={props.onClose}>Anuluj</Button>
      </div>
    </form>
  </Modal>;
}

// Karta sprawy: etykieta z trybem, jeden tytuł, jeden odnośnik do materiału, głos, lista osób bez głosu i wynik.
// „Ogłoś wynik głosowania” ma tylko osoba zarządzająca głosowaniem i przewodniczący (DA-12).
function Acts() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const actor = useActor();
  const manager = canManageProcedure(s.roster, m as Meeting, actor);
  const staff = manager || s.isOrganizer(m.organ);
  const member = s.isMember(m.organ);
  const acts = m.agenda.filter(i => !i.parentId);
  const first = unannounced(m)[0];
  return <div class="acts">{acts.map(it => {
    const b = m.ballots.find(x => x.itemId === it.id);
    const mode = b?.mode ?? it.mode ?? 'jawne';
    const mats = b ? m.materials.filter(x => x.id === b.material?.id) : m.materials.filter(x => it.materialIds.includes(x.id));
    return <section key={it.id} class="oi-card act" aria-labelledby={`sprawa-${it.id}`}>
      <span class="oi-label">Głosowanie {modeName(mode)} w sprawie {itemNumber(m.agenda, it.id)}</span>
      <h2 class="item-title" id={`sprawa-${it.id}`}><TitleLead text={it.title}/></h2>
      {mats.length > 0
        ? <div class="material-list">{mats.map(x => {
          const version = b?.material?.id === x.id ? b.material.version : x.version;
          return <MaterialLink key={x.id} id={x.id} version={version} meta={`wersja ${version}`}
            label={sameTitle(x.title, it.title) ? (x.type === 'uchwala' ? 'Treść uchwały' : 'Treść materiału') : x.title}/>;
        })}</div>
        : <p class="muted small">Bez dołączonego materiału.</p>}
      {b?.status === 'otwarte' && member && <VoteCard b={b} embedded/>}
      {b?.status === 'otwarte' && staff && <Pending b={b}/>}
      {b?.status === 'otwarte' && b.mode !== 'jawne' && <div class="act-foot">
        {b.modeBasis && <dl class="facts vote-context"><Fact label="Podstawa trybu">{b.modeBasis}</Fact></dl>}
        {b.secret && <div class="fingerprint"><span class="kicker">Odcisk klucza głosowania</span><code>{b.secret.fingerprint}</code><span class="muted small">Głosowanie tajne. Widać tylko, kto pobrał kartę. Ten sam odcisk członkowie widzą na telefonach.</span></div>}
      </div>}
      {b?.status === 'zamkniete' && <>
        <ResultCard b={b} kind={materialTypeOf(m, b)}/>
        {manager && !b.announcedAt && !b.aborted && <div><Button kind={first?.id === b.id ? 'primary' : 'secondary'} busy={busy} onClick={() => send({type: 'announce', ballotId: b.id})}>Ogłoś wynik głosowania</Button></div>}
      </>}
    </section>;
  })}</div>;
}

// Osoby, które jeszcze nie głosowały albo nie pobrały karty (widok zarządzającego i biura).
function Pending({b}: {b: ViewBallot}) {
  const s = useSession();
  const awaiting = awaitingVote(b);
  return <div class="act-pending">
    <h3 class="card-sub">{b.secret ? 'Jeszcze nie pobrali karty' : 'Jeszcze nie głosowali'}</h3>
    {awaiting.length > 0 ? <ul>{awaiting.map(p => <li key={p}>{s.personName(p)}</li>)}</ul> : <p class="small">Zagłosowali wszyscy uprawnieni.</p>}
  </div>;
}

const modeLabel: Record<VoteMode, string> = {jawne: 'Jawne', imienne: 'Imienne', tajne: 'Tajne'};

/** „Ustawienia sprawy {n}” (rozdz. 5.5): nazwa, co jest głosowane, materiał, tryb głosowania z danymi uchwały i osoby. */
function ActSettings(props: {it: AgendaItem; close: () => void}) {
  const {m} = useMeeting();
  const cmd = useCommand();
  const types = useDocTypes();
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus(); }, []);
  const {it} = props;
  const e = m.effective?.items[it.id];
  const no = itemNumber(m.agenda, it.id);
  const act = it.modeAct;
  const decisionText = !act ? '' : act.kind === 'uchwala'
    ? `Na podstawie uchwały Prezydium nr ${act.number} z dnia ${dateDots(act.date)} (§ 11 ust. 2).`
    : `Na podstawie głosowania nr ${act.number} na posiedzeniu Prezydium z dnia ${dateDots(act.date)} (§ 11 ust. 2).`;
  const docValue = e?.docType.value ?? null;
  return <section class="item-settings" aria-labelledby={`ustawienia-punktu-${it.id}`}>
    <div class="item-settings__head">
      <h3 id={`ustawienia-punktu-${it.id}`} tabIndex={-1} ref={heading}>{`Ustawienia sprawy ${no}`}</h3>
      <Button kind="ghost" quiet small onClick={props.close}>Zamknij ustawienia sprawy</Button>
    </div>
    <SettingsList label={`Ustawienia sprawy ${no}`}>
      <SettingRow label="Nazwa sprawy" value={it.title} at="punkt" source="" genitive="nazwy sprawy" actionLabel={`Zmień nazwę sprawy ${no}`}
        editor={(close, ctl) => <TextRowEditor close={close} ctl={ctl} label="Nazwa sprawy" initial={it.title} max={400} required onSave={title => cmd({type: 'item_edit', itemId: it.id, title})}/>}/>
      <SettingRow label="Co jest głosowane" value={docValue ? types.find(t => t.id === docValue)?.name ?? docValue : 'Wynika z materiału'} at="punkt" genitive="tego, co jest głosowane" actionLabel={`Zmień, co jest głosowane w sprawie ${no}`}
        {...(e && (it.docType || e.docType.via) ? {effective: e.docType} : {source: ''})}
        editor={(close, ctl) => <DocTypeEditor close={close} ctl={ctl} initial={it.docType ?? ''} empty="Wynika z materiału" onSave={v => cmd({type: 'item_edit', itemId: it.id, docType: v || null})}/>}/>
      <SettingRow label="Materiał" at="punkt" source="" value={<ItemMaterials it={it} missing={null}/>}/>
      <SettingRow label="Tryb głosowania" at="punkt" source={decisionText} genitive="trybu głosowania" actionLabel={`Zmień tryb głosowania w sprawie ${no}`}
        state={it.mode && it.mode !== 'jawne' ? 'zmieniona' : 'odziedziczona'}
        value={modeLabel[it.mode ?? 'jawne']}
        editor={(close, ctl) => <ModeEditor close={close} ctl={ctl} it={it} onSave={(mode, decision) => cmd({type: 'item_mode', itemId: it.id, mode, ...(decision ? {decision} : {})})}/>}/>
      <SettingRow label="Prowadzą i referują" at="punkt" source="" value={it.presenters.length ? it.presenters.map(p => `${p.name}${p.role ? `, ${p.role}` : ''}`).join('; ') : 'Nikogo nie wpisano.'}
        genitive="osób przy sprawie" actionLabel={`Zmień osoby przy sprawie ${no}`}
        editor={(close, ctl) => <PresentersRowEditor close={close} ctl={ctl} it={it} no={no} onSave={presenters => cmd({type: 'item_edit', itemId: it.id, presenters})}/>}/>
    </SettingsList>
  </section>;
}

// Tryb tajny albo imienny wymaga danych uchwały albo głosowania, w którym Prezydium go uchwaliło (G-13, § 11 ust. 2).
function ModeEditor(props: {close: (s?: string) => void; ctl: EditorCtl; it: AgendaItem; onSave: (mode: VoteMode, decision?: ModeDecision) => Promise<unknown>}) {
  const act = props.it.modeAct;
  const [mode, setMode] = useState<VoteMode>(props.it.mode ?? 'jawne');
  const [kind, setKind] = useState<ModeDecision['kind']>(act?.kind ?? 'uchwala');
  const [number, setNumber] = useState(act ? String(act.number) : '');
  const [date, setDate] = useState(act?.date ?? '');
  const special = mode !== 'jawne';
  const decision: ModeDecision | undefined = special ? (kind === 'uchwala' ? {kind, number: number.trim(), date} : {kind, number: Number(number), date}) : undefined;
  const reason = special && (!number.trim() || !date || (kind === 'glosowanie' && !(Number(number) > 0)))
    ? 'Wpisz, kiedy Prezydium uchwaliło tajność albo głosowanie imienne. Podaj numer uchwały albo głosowania i datę.' : undefined;
  const dirty = mode !== (props.it.mode ?? 'jawne') || (special && JSON.stringify(decision) !== JSON.stringify(act));
  return <RowEditor close={props.close} ctl={props.ctl} dirty={dirty} reason={reason} onSave={() => props.onSave(mode, decision)}>
    <Segments label="Tryb głosowania" value={mode} options={[['jawne', 'Jawne'], ['imienne', 'Imienne'], ['tajne', 'Tajne']]} onChange={setMode}/>
    {special && <div class="basis-fields">
      <Notice tone="warn" label="Ważne">Tajność albo głosowanie imienne uchwala Prezydium (§ 11 ust. 2). Wpisz, kiedy to postanowiło.</Notice>
      <Segments label="Podstawa" value={kind} options={[['uchwala', 'Uchwała Prezydium'], ['glosowanie', 'Głosowanie na posiedzeniu']]} onChange={setKind}/>
      <div class="row">
        <Field label={kind === 'uchwala' ? 'Numer uchwały' : 'Numer głosowania'} hint={kind === 'uchwala' ? 'Np. 98/IX/2026.' : 'Np. 3.'}>
          <input value={number} maxLength={60} inputMode={kind === 'glosowanie' ? 'numeric' : undefined} onInput={e => setNumber((e.target as HTMLInputElement).value)}/>
        </Field>
        <Field label="Data" hint={dateHintText(date) || undefined}><input type="date" value={date} onInput={e => setDate((e.target as HTMLInputElement).value)}/></Field>
      </div>
    </div>}
  </RowEditor>;
}

/**
 * Ustawienia głosowania między posiedzeniami (rozdz. 5.5): kto zarządza, koniec głosowania, reasumpcja (niedostępna),
 * kanał wiadomości, dane do protokołu i zastępstwo przewodniczącego. Po rozpoczęciu tylko do odczytu.
 */
function ProcedureSettings() {
  const {m} = useMeeting();
  const s = useSession();
  const cmd = useCommand();
  const bundle = useGeneral();
  const prep = m.status === 'przygotowanie';
  const editable = prep && s.isOrganizer(m.organ);
  const hours = bundle ? organSettingsOf(bundle.general, m.organ).procedureHours : 24;
  const starter = procedureStarter(m);
  const members = organRoster(s.roster, m);
  const starterLabel = starter ? `${s.personName(starter)}, ${members.find(x => x.personId === starter)?.label ?? ''}.` : '';
  const ends = m.endsAt ?? 0;
  const asDefault = Math.abs(ends - (m.createdAt + hours * 3600000)) < 60000;
  const messages = m.effective?.meeting.messages;
  const details = (patch: Record<string, unknown>) => cmd({type: 'details', ...patch});
  return <section class="oi-card meeting-settings" aria-labelledby="ustawienia-glosowania">
    <h2 class="oi-card__title" id="ustawienia-glosowania"><span class="oi-mark" aria-hidden="true"/><span>{m.frozen ? 'Ustawienia głosowania zapisane przy rozpoczęciu' : 'Ustawienia głosowania'}</span></h2>
    {m.frozen && <p class="small">{m.frozen.legacy ? 'Zapisano przy przejściu na wersję 3.' : `Zapisano ${dateDotsOf(m.frozen.at)} o godz. ${timeOf(m.frozen.at)}. Zmiana ustawień ogólnych nie wpływa na to głosowanie.`}</p>}
    <SettingsList label="Ustawienia głosowania">
      <SettingRow label="Zarządza głosowaniem" at="posiedzenie" source="" value={prep || !starter
        ? 'Rozpoczyna przewodniczący albo zastępca, którego przewodniczący wyznaczył na to głosowanie. Ta osoba i przewodniczący kończą głosowanie i ogłaszają wyniki.'
        : starterLabel}/>
      <SettingRow id="ust-termin" label="Koniec głosowania" at="posiedzenie" state={asDefault || !prep ? 'odziedziczona' : 'zmieniona'} genitive="końca głosowania" actionLabel="Zmień koniec głosowania"
        value={m.endsAt ? fmtDateTime(m.endsAt) : 'Nie ustalono'}
        source={!prep ? '' : asDefault ? `Jak w ustawieniach ogólnych, ${hoursText(hours)} od utworzenia.` : `Zmienione dla tego głosowania. W ustawieniach ogólnych ${hoursText(hours)} od utworzenia.`}
        hint={prep && m.endsAt && m.endsAt - Date.now() < minimum ? 'Głosowanie potrwa krócej niż 24 godziny. Przy rozpoczęciu trzeba będzie podać powód.' : undefined}
        editor={editable ? (close, ctl) => <EndsEditor close={close} ctl={ctl} initial={m.endsAt} onSave={v => details({endsAt: v})}/> : undefined}/>
      <SettingRow label="Reasumpcja" at="posiedzenie" state="niedostepne" value="Niedostępna" source="Wniosek o reasumpcję zgłasza się wyłącznie na posiedzeniu, na którym odbyło się głosowanie (§ 12 ust. 2)."/>
      {messages && <SettingRow label="Kanał wiadomości" at="posiedzenie" state="aplikacja" value="Widoczny zawsze." effective={messages} why={appRuleWhy}/>}
      <SettingRow label="Tytuł" at="posiedzenie" source="" value={m.title} genitive="tytułu" actionLabel="Zmień tytuł"
        editor={editable ? (close, ctl) => <TextRowEditor close={close} ctl={ctl} label="Tytuł" initial={m.title} max={200} required onSave={v => details({title: v})}/> : undefined}/>
      <SettingRow label="Data powiadomienia członków" at="posiedzenie" source="" value={m.noticeDate ? dateDots(m.noticeDate) : 'Nie wpisano'} genitive="daty powiadomienia członków" actionLabel="Zmień datę powiadomienia członków"
        hint="Kiedy członkowie dostali powiadomienie o głosowaniu. Data trafi do protokołu."
        editor={editable ? (close, ctl) => <DateRowEditor close={close} ctl={ctl} label="Data powiadomienia członków" initial={m.noticeDate} onSave={v => details({noticeDate: v})}/> : undefined}/>
      <SettingRow label="Numer protokołu" at="posiedzenie" source="" value={m.protocolNumber || 'Nie wpisano'} genitive="numeru protokołu" actionLabel="Zmień numer protokołu"
        editor={editable ? (close, ctl) => <TextRowEditor close={close} ctl={ctl} label="Numer protokołu" hint="Np. 12/IX/2026." initial={m.protocolNumber ?? ''} max={60} onSave={v => details({protocolNumber: v})}/> : undefined}/>
      <SettingRow label="Protokolant" at="posiedzenie" source="" value={m.recorder || 'Nie wpisano'} genitive="protokolanta" actionLabel="Zmień protokolanta"
        editor={editable ? (close, ctl) => <TextRowEditor close={close} ctl={ctl} label="Protokolant" initial={m.recorder ?? ''} max={120} onSave={v => details({recorder: v})}/> : undefined}/>
    </SettingsList>
    {prep && <DeputyCard/>}
  </section>;
}

function EndsEditor(props: {close: (s?: string) => void; ctl: EditorCtl; initial?: number; onSave: (v: number) => Promise<unknown>}) {
  const [value, setValue] = useState(localInput(props.initial));
  const chosen = value ? new Date(value).getTime() : NaN;
  return <RowEditor close={props.close} ctl={props.ctl} dirty={chosen !== props.initial} reason={Number.isFinite(chosen) ? undefined : 'Ustaw koniec głosowania.'} onSave={() => props.onSave(chosen)}>
    <Field label="Koniec głosowania" hint={Number.isFinite(chosen) && chosen - Date.now() < minimum ? 'Głosowanie potrwa krócej niż 24 godziny. Przy rozpoczęciu trzeba będzie podać powód.' : 'Członkowie widzą licznik pozostałego czasu.'}>
      <input type="datetime-local" value={value} onInput={e => setValue((e.target as HTMLInputElement).value)}/>
    </Field>
  </RowEditor>;
}

// Rozpoczęcie: tylko przewodniczący albo zastępca wyznaczony na to głosowanie (DA-12). Termin krótszy niż 24 godziny
// wymaga powodu, który trafia do dokumentu z przebiegu głosowania (DA-21).
function Start() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const actor = useActor();
  const now = useNow(30000);
  const [confirm, setConfirm] = useState(false);
  const acts = m.agenda.filter(i => !i.parentId);
  const subs = m.agenda.filter(i => i.parentId).map(i => itemNumber(m.agenda, i.id));
  const bare = acts.filter(i => !i.materialIds.length).map(i => itemNumber(m.agenda, i.id));
  if (!canStartProcedure(s.roster, m as Meeting, actor)) return <section class="oi-card"><CardTitle level={2}>Rozpoczęcie głosowania</CardTitle>
    <p class="muted small">Rozpoczyna przewodniczący albo zastępca, którego przewodniczący wyznaczył na to głosowanie. Wtedy członkowie dostaną dostęp do kart.</p></section>;
  const warnings = [
    bare.length === 1 ? `Sprawa ${bare[0]} nie ma dołączonego materiału. Członkowie nie przeczytają jej treści przed głosowaniem.`
      : bare.length > 1 ? `Sprawy ${joinNumbers(bare)} nie mają dołączonego materiału. Członkowie nie przeczytają ich treści przed głosowaniem.` : '',
  ].filter(Boolean);
  // Podpunkt nie zostałby poddany pod głosowanie (głosowania otwierają się tylko dla spraw głównych).
  const blocked = !acts.length ? 'Dodaj co najmniej jedną sprawę do głosowania.'
    : subs.length === 1 ? `Sprawa ${subs[0]} jest podpunktem i nie zostałaby poddana pod głosowanie. Usuń ją i dodaj jako osobną sprawę.`
    : subs.length > 1 ? `Sprawy ${joinNumbers(subs)} są podpunktami i nie zostałyby poddane pod głosowanie. Usuń je i dodaj jako osobne sprawy.` : '';
  const short = !!m.endsAt && m.endsAt - now < minimum;
  const note = warnings.length > 0 && <Notice tone="warn">{warnings.map(w => <p key={w}>{w}</p>)}</Notice>;
  return <section class="oi-card is-teraz">
    <CardTitle level={2}>Rozpoczęcie głosowania</CardTitle>
    <p class="small">{`Wszystkie sprawy (${acts.length}) zostaną otwarte jednocześnie do ${m.endsAt ? fmtDateTime(m.endsAt) : 'ustalonego terminu'}.`}</p>
    {note}
    <Button kind="primary" wide haspopup busy={busy} disabled={!!blocked} reason={blocked} onClick={() => setConfirm(true)}>Rozpocznij głosowanie</Button>
    {confirm && <Confirm title="Rozpocząć głosowanie?" confirm="Rozpocznij głosowanie" onClose={() => setConfirm(false)} onConfirm={reason => send({type: 'open', ...(short ? {reason} : {})})}
      field={short ? {label: 'Powód krótszego terminu', required: true} : undefined}
      text={<><p>Po rozpoczęciu nie można zmieniać spraw ani materiałów, nad którymi się głosuje. Członkowie zagłosują na swoich telefonach, a w kanale wiadomości pojawi się informacja o głosowaniu i terminie.</p>{note}
        {short && m.endsAt && <p>{shortTermText(m.endsAt - now)}</p>}</>}/>}
  </section>;
}
