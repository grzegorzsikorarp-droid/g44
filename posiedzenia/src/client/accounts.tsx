import {useEffect, useState} from 'preact/hooks';
import type {Account} from '../shared/types.ts';
import {organOf} from '../shared/roster.ts';
import {request} from './api.ts';
import {useSession} from './session.ts';
import {Button, CardTitle, Check, Chip, Fact, Field, Fold, Modal, Notice, Tag, useAction} from './ui.tsx';
import {brand} from './brand.ts';

const kinds: Record<Account['kind'], string> = {czlonek: 'Członek organu', doradczy: 'Głos doradczy', gosc: 'Gość', biuro: 'Biuro'};
const ascii = (s: string) => s.toLowerCase().replace(/[ąćęłńóśźż]/g, c => 'acelnoszz'['ąćęłńóśźż'.indexOf(c)]).replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
function temporaryPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(bytes, b => chars[b % chars.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

export function Accounts() {
  const s = useSession();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const {busy, error, run} = useAction();
  const [creating, setCreating] = useState<{kind: Account['kind']; personId?: string} | null>(null);
  const [issued, setIssued] = useState<{name: string; username: string; password: string} | null>(null);
  const [copied, setCopied] = useState(false);
  const [reset, setReset] = useState<Account | null>(null);
  useEffect(() => { request<{accounts: Account[]}>('/api/accounts').then(r => setAccounts(r.accounts)).catch(() => setAccounts([])); }, []);
  const patch = (body: object) => run(async () => { const r = await request<{accounts: Account[]}>('/api/accounts', {method: 'PATCH', body}); setAccounts(r.accounts); });
  const presidium = s.roster.memberships.filter(m => m.organ === 'prezydium');
  const council = s.roster.memberships.filter(m => m.organ === 'rada' && !presidium.some(p => p.personId === m.personId));
  const byPerson = (id: string) => accounts?.find(a => a.personId === id);
  const others = accounts?.filter(a => !a.personId) ?? [];
  const councilName = (organOf(s.roster, 'rada')?.name ?? 'Okręgowa Rada').replace(/^Okręgowa Rada/, 'Okręgowej Rady');
  const address = brand.demo ? 'adres pełnej aplikacji' : location.origin;
  const row = (personId: string, label: string) => {
    const a = byPerson(personId);
    return <li class="account-row">
      <div><strong>{s.personName(personId)}</strong><small>{label}</small></div>
      {a ? <AccountState a={a} self={a.id === s.account.id} busy={busy} onPatch={patch} onReset={() => setReset(a)}/> : <Button small kind="primary" onClick={() => setCreating({kind: 'czlonek', personId})}>Utwórz konto</Button>}
    </li>;
  };
  return <>
    <header class="oi-hero page-head">
      <div class="page oi-hero__in">
        <a class="oi-link back" href="#">Wróć do listy posiedzeń</a>
        <Tag>Administracja</Tag>
        <h1>Konta <b>użytkowników</b></h1>
        <p class="oi-hero__lead">Każda osoba ma własne konto, bo udział w posiedzeniu jest osobisty (§ 19 ust. 2). Przekaż login i hasło tymczasowe. Przy pierwszym logowaniu osoba ustawi własne hasło. Zablokowanie konta albo nowe hasło tymczasowe kończy jego sesje.</p>
      </div>
    </header>
    <div class="page stack">
      {error && <Notice tone="error">{error}</Notice>}
      {!accounts && <p class="muted">Wczytywanie…</p>}
      {accounts && <>
        <section class="oi-card"><CardTitle>{brand.organ || 'Prezydium'}</CardTitle><ul class="account-list">{presidium.map(m => row(m.personId, m.label))}</ul></section>
        <section class="oi-card">
          <CardTitle>Biuro, głos doradczy i goście</CardTitle>
          <p class="muted small">Głos doradczy mają przewodniczący okręgowej komisji rewizyjnej, przewodniczący okręgowego sądu oraz okręgowy rzecznik (§ 7 ust. 2). Biuro przygotowuje posiedzenia i prowadzi listę obecności, ale nie głosuje.</p>
          <div class="actions"><Button small onClick={() => setCreating({kind: 'doradczy'})}>Dodaj konto z głosem doradczym</Button><Button small onClick={() => setCreating({kind: 'gosc'})}>Dodaj konto gościa</Button><Button small onClick={() => setCreating({kind: 'biuro'})}>Dodaj konto biura</Button></div>
          <ul class="account-list">{others.map(a => <li class="account-row"><div><strong>{a.displayName}</strong><small>{kinds[a.kind]}{a.label ? `, ${a.label}` : ''}</small></div><AccountState a={a} self={a.id === s.account.id} busy={busy} onPatch={patch} onReset={() => setReset(a)}/></li>)}</ul>
        </section>
        {council.length > 0 && <Fold title={`Pozostali członkowie ${councilName} (etap 2)`}><ul class="account-list">{council.map(m => row(m.personId, m.label))}</ul></Fold>}
      </>}
    </div>
    {creating && <CreateAccount kind={creating.kind} personId={creating.personId} onClose={() => setCreating(null)} onCreated={(list, info) => { setAccounts(list); setCreating(null); setCopied(false); setIssued(info); }}/>}
    {issued && <Modal title="Dane do przekazania" onClose={() => setIssued(null)}>
      <p>Przekaż osobie <strong>{issued.name}</strong> poniższe dane, najlepiej osobiście lub SMS-em. Przy pierwszym logowaniu ustawi własne hasło.</p>
      <dl class="facts credentials oi-note oi-note--wazne"><Fact label="Adres">{address}</Fact><Fact label="Login"><code>{issued.username}</code></Fact><Fact label="Hasło tymczasowe"><code>{issued.password}</code></Fact></dl>
      <div class="actions">
        <Button kind="primary" onClick={() => setIssued(null)}>Gotowe</Button>
        <Button onClick={() => { navigator.clipboard?.writeText(`Posiedzenia Prezydium, ${address}\nLogin ${issued.username}\nHasło tymczasowe ${issued.password}`).then(() => setCopied(true)).catch(() => {}); }}>{copied ? 'Skopiowano' : 'Kopiuj dane'}</Button>
      </div>
    </Modal>}
    {reset && <ResetPassword a={reset} onClose={() => setReset(null)} onDone={(list, password) => { setAccounts(list); setCopied(false); setIssued({name: reset.displayName, username: reset.username, password}); setReset(null); }}/>}
  </>;
}

function AccountState(props: {a: Account; self: boolean; busy: boolean; onPatch: (body: object) => void; onReset: () => void}) {
  const {a} = props;
  return <div class="account-state">
    <code class="small">{a.username}</code>
    {a.disabled ? <Chip>Zablokowane</Chip> : a.mustChange ? <Chip tone="otwarte">Czeka na pierwsze logowanie</Chip> : <Chip>Aktywne</Chip>}
    {a.admin && <Tag dark>Administrator</Tag>}
    <Button small kind="ghost" disabled={props.busy} onClick={props.onReset}>Nowe hasło</Button>
    {!props.self && <Button small kind="ghost" disabled={props.busy} onClick={() => props.onPatch({id: a.id, disabled: !a.disabled})}>{a.disabled ? 'Odblokuj' : 'Zablokuj'}</Button>}
    {!props.self && <Button small kind="ghost" disabled={props.busy} onClick={() => props.onPatch({id: a.id, admin: !a.admin})}>{a.admin ? 'Odbierz administratora' : 'Nadaj administratora'}</Button>}
  </div>;
}

function CreateAccount(props: {kind: Account['kind']; personId?: string; onClose: () => void; onCreated: (list: Account[], info: {name: string; username: string; password: string}) => void}) {
  const s = useSession();
  const {busy, error, run} = useAction();
  const name = props.personId ? s.personName(props.personId) : '';
  const [password] = useState(temporaryPassword);
  return <Modal title={props.personId ? `Konto, ${name}` : `Nowe konto, ${kinds[props.kind].toLowerCase()}`} onClose={props.onClose}>
    <form class="stack" onSubmit={e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const displayName = props.personId ? name : String(f.get('displayName'));
      run(async () => {
        const r = await request<{accounts: Account[]}>('/api/accounts', {body: {kind: props.kind, personId: props.personId, displayName, label: f.get('label'), username: f.get('username'), password: f.get('password'), admin: f.get('admin') === 'on'}});
        props.onCreated(r.accounts, {name: displayName, username: String(f.get('username')), password: String(f.get('password'))});
      });
    }}>
      {!props.personId && <>
        <Field label={props.kind === 'biuro' ? 'Nazwa lub imię i nazwisko' : 'Imię i nazwisko'}><input name="displayName" required minLength={3} maxLength={100}/></Field>
        <Field label="Funkcja" hint={props.kind === 'doradczy' ? 'Np. Przewodnicząca Okręgowej Komisji Rewizyjnej' : undefined}><input name="label" maxLength={120}/></Field>
      </>}
      <Field label="Login" hint="Małe litery bez polskich znaków, cyfry, kropka lub myślnik."><input name="username" required minLength={3} maxLength={64} pattern="[a-z0-9._\-]{3,64}" defaultValue={name ? ascii(name) : ''} autocapitalize="none" spellcheck={false}/></Field>
      <Field label="Hasło tymczasowe" hint="Osoba zmieni je przy pierwszym logowaniu."><input name="password" required minLength={12} maxLength={200} defaultValue={password}/></Field>
      <Check name="admin">Administrator, czyli osoba, która zarządza kontami</Check>
      {error && <Notice tone="error">{error}</Notice>}
      <div class="actions"><Button kind="primary" type="submit" disabled={busy}>Utwórz konto</Button><Button onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

function ResetPassword(props: {a: Account; onClose: () => void; onDone: (list: Account[], password: string) => void}) {
  const {busy, error, run} = useAction();
  const [password] = useState(temporaryPassword);
  return <Modal title={`Nowe hasło tymczasowe, ${props.a.displayName}`} onClose={props.onClose}>
    <form class="stack" onSubmit={e => { e.preventDefault(); const p = String(new FormData(e.currentTarget).get('password')); run(async () => { const r = await request<{accounts: Account[]}>('/api/accounts', {method: 'PATCH', body: {id: props.a.id, password: p}}); props.onDone(r.accounts, p); }); }}>
      <p class="small">Dotychczasowe sesje tego konta zostaną zakończone, a przy następnym logowaniu trzeba będzie ustawić własne hasło.</p>
      <Field label="Hasło tymczasowe"><input name="password" required minLength={12} maxLength={200} defaultValue={password}/></Field>
      {error && <Notice tone="error">{error}</Notice>}
      <div class="actions"><Button kind="primary" type="submit" disabled={busy}>Ustaw hasło</Button><Button onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}
