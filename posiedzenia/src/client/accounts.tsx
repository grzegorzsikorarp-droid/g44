import {useEffect, useState} from 'preact/hooks';
import type {Account} from '../shared/types.ts';
import {request} from './api.ts';
import {useSession} from './session.ts';
import {Button, Chip, Field, Modal, Notice, useAction} from './ui.tsx';
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
  const [reset, setReset] = useState<Account | null>(null);
  useEffect(() => { request<{accounts: Account[]}>('/api/accounts').then(r => setAccounts(r.accounts)).catch(() => setAccounts([])); }, []);
  const patch = (body: object) => run(async () => { const r = await request<{accounts: Account[]}>('/api/accounts', {method: 'PATCH', body}); setAccounts(r.accounts); });
  const presidium = s.roster.memberships.filter(m => m.organ === 'prezydium');
  const council = s.roster.memberships.filter(m => m.organ === 'rada' && !presidium.some(p => p.personId === m.personId));
  const byPerson = (id: string) => accounts?.find(a => a.personId === id);
  const others = accounts?.filter(a => !a.personId) ?? [];
  const row = (personId: string, label: string) => {
    const a = byPerson(personId);
    return <li class="account-row">
      <div><strong>{s.personName(personId)}</strong><small>{label}</small></div>
      {a ? <AccountState a={a} self={a.id === s.account.id} busy={busy} onPatch={patch} onReset={() => setReset(a)}/> : <Button small kind="primary" onClick={() => setCreating({kind: 'czlonek', personId})}>Utwórz konto</Button>}
    </li>;
  };
  return <div class="stack">
    <a class="back" href="#">← Posiedzenia</a>
    <h1>Konta</h1>
    <p class="muted">Każda osoba ma własne konto — udział w posiedzeniu jest osobisty (§ 19 ust. 2). Przekaż login i hasło tymczasowe; przy pierwszym logowaniu osoba ustawi własne hasło. Zablokowanie konta albo nowe hasło tymczasowe kończy jego sesje.</p>
    {error && <Notice tone="error">{error}</Notice>}
    {!accounts && <p class="muted">Wczytywanie…</p>}
    {accounts && <>
      <section class="card"><h3>{brand.organAccounts}</h3><ul class="account-list">{presidium.map(m => row(m.personId, m.label))}</ul></section>
      <section class="card">
        <div class="card-head"><h3>Biuro, głos doradczy i goście</h3><div class="actions"><Button small onClick={() => setCreating({kind: 'doradczy'})}>Głos doradczy</Button><Button small onClick={() => setCreating({kind: 'gosc'})}>Gość</Button><Button small onClick={() => setCreating({kind: 'biuro'})}>Biuro</Button></div></div>
        <p class="muted small">Głos doradczy mają przewodniczący okręgowej komisji rewizyjnej, przewodniczący okręgowego sądu oraz okręgowy rzecznik (§ 7 ust. 2). Biuro przygotowuje posiedzenia i prowadzi listę obecności, ale nie głosuje.</p>
        <ul class="account-list">{others.map(a => <li class="account-row"><div><strong>{a.displayName}</strong><small>{kinds[a.kind]}{a.label ? ` · ${a.label}` : ''}</small></div><AccountState a={a} self={a.id === s.account.id} busy={busy} onPatch={patch} onReset={() => setReset(a)}/></li>)}</ul>
      </section>
      <section class="card"><details><summary>Pozostali członkowie Okręgowej Rady (etap 2)</summary><ul class="account-list">{council.map(m => row(m.personId, m.label))}</ul></details></section>
    </>}
    {creating && <CreateAccount kind={creating.kind} personId={creating.personId} onClose={() => setCreating(null)} onCreated={(list, info) => { setAccounts(list); setCreating(null); setIssued(info); }}/>}
    {issued && <Modal title="Dane do przekazania" onClose={() => setIssued(null)}>
      <p>Przekaż osobie <strong>{issued.name}</strong> poniższe dane (najlepiej osobiście lub SMS-em). Przy pierwszym logowaniu ustawi własne hasło.</p>
      <dl class="credentials"><dt>Adres</dt><dd>{brand.demo ? "adres pełnej aplikacji" : location.origin}</dd><dt>Login</dt><dd><code>{issued.username}</code></dd><dt>Hasło tymczasowe</dt><dd><code>{issued.password}</code></dd></dl>
      <div class="actions"><Button onClick={() => navigator.clipboard?.writeText(`Posiedzenia ${brand.org}: ${location.origin}\nLogin: ${issued.username}\nHasło tymczasowe: ${issued.password}`)}>Kopiuj</Button><Button kind="primary" onClick={() => setIssued(null)}>Gotowe</Button></div>
    </Modal>}
    {reset && <ResetPassword a={reset} onClose={() => setReset(null)} onDone={(list, password) => { setAccounts(list); setIssued({name: reset.displayName, username: reset.username, password}); setReset(null); }}/>}
  </div>;
}

function AccountState(props: {a: Account; self: boolean; busy: boolean; onPatch: (body: object) => void; onReset: () => void}) {
  const {a} = props;
  return <div class="account-state">
    <code class="small">{a.username}</code>
    {a.disabled ? <Chip tone="muted">Zablokowane</Chip> : a.mustChange ? <Chip tone="warn">Czeka na pierwsze logowanie</Chip> : <Chip tone="done">Aktywne</Chip>}
    {a.admin && <Chip tone="live">Administrator</Chip>}
    <span class="actions">
      <Button small kind="ghost" disabled={props.busy} onClick={props.onReset}>Nowe hasło</Button>
      {!props.self && <Button small kind="ghost" disabled={props.busy} onClick={() => props.onPatch({id: a.id, disabled: !a.disabled})}>{a.disabled ? 'Odblokuj' : 'Zablokuj'}</Button>}
      {!props.self && <Button small kind="ghost" disabled={props.busy} onClick={() => props.onPatch({id: a.id, admin: !a.admin})}>{a.admin ? 'Odbierz administratora' : 'Nadaj administratora'}</Button>}
    </span>
  </div>;
}

function CreateAccount(props: {kind: Account['kind']; personId?: string; onClose: () => void; onCreated: (list: Account[], info: {name: string; username: string; password: string}) => void}) {
  const s = useSession();
  const {busy, error, run} = useAction();
  const name = props.personId ? s.personName(props.personId) : '';
  const [password] = useState(temporaryPassword);
  return <Modal title={props.personId ? `Konto: ${name}` : `Nowe konto — ${kinds[props.kind].toLowerCase()}`} onClose={props.onClose}>
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
      <label class="check"><input type="checkbox" name="admin"/> Administrator (zarządza kontami)</label>
      {error && <Notice tone="error">{error}</Notice>}
      <div class="actions"><Button onClick={props.onClose}>Anuluj</Button><Button kind="primary" type="submit" disabled={busy}>Utwórz konto</Button></div>
    </form>
  </Modal>;
}

function ResetPassword(props: {a: Account; onClose: () => void; onDone: (list: Account[], password: string) => void}) {
  const {busy, error, run} = useAction();
  const [password] = useState(temporaryPassword);
  return <Modal title={`Nowe hasło tymczasowe: ${props.a.displayName}`} onClose={props.onClose}>
    <form class="stack" onSubmit={e => { e.preventDefault(); const p = String(new FormData(e.currentTarget).get('password')); run(async () => { const r = await request<{accounts: Account[]}>('/api/accounts', {method: 'PATCH', body: {id: props.a.id, password: p}}); props.onDone(r.accounts, p); }); }}>
      <p class="small">Dotychczasowe sesje tego konta zostaną zakończone, a przy następnym logowaniu trzeba będzie ustawić własne hasło.</p>
      <Field label="Hasło tymczasowe"><input name="password" required minLength={12} maxLength={200} defaultValue={password}/></Field>
      {error && <Notice tone="error">{error}</Notice>}
      <div class="actions"><Button onClick={props.onClose}>Anuluj</Button><Button kind="primary" type="submit" disabled={busy}>Ustaw hasło</Button></div>
    </form>
  </Modal>;
}
