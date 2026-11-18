import {useEffect, useState} from 'preact/hooks';
import type {Account, Roster} from '../shared/types.ts';
import {request} from './api.ts';
import {SessionContext, useSession} from './session.ts';
import {Button, Field, Modal, Notice, useAction} from './ui.tsx';
import {Home} from './home.tsx';
import {MeetingPage} from './meeting.tsx';
import {RoomScreen} from './screen.tsx';
import {Accounts} from './accounts.tsx';

interface SessionInfo { account: Account | null; setupRequired: boolean; roster: Roster | null }

export function App() {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [error, setError] = useState('');
  const [hash, setHash] = useState(location.hash);
  const load = () => request<SessionInfo>('/api/session').then(setInfo).catch(e => setError(e.message));
  useEffect(() => {
    load();
    const onHash = () => setHash(location.hash);
    const onLogout = () => load();
    window.addEventListener('hashchange', onHash);
    window.addEventListener('posiedzenia:wyloguj', onLogout);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('posiedzenia:wyloguj', onLogout); };
  }, []);

  if (!info) return <main class="center-page">{error ? <Notice tone="error">{error} <Button small onClick={load}>Spróbuj ponownie</Button></Notice> : <p class="muted">Wczytywanie…</p>}</main>;
  if (!info.account) return <Login setup={info.setupRequired} roster={info.roster} onDone={load}/>;
  const session = {account: info.account, roster: info.roster!};
  if (info.account.mustChange) return <SessionContext.Provider value={session}><main class="center-page"><PasswordCard forced onDone={load}/></main></SessionContext.Provider>;

  const screen = hash.match(/^#\/ekran\/([\w-]+)/);
  if (screen) return <SessionContext.Provider value={session}><RoomScreen id={screen[1]}/></SessionContext.Provider>;
  const meeting = hash.match(/^#\/p\/([\w-]+)/);
  return <SessionContext.Provider value={session}>
    <TopBar onLogout={load}/>
    <main class="page">
      {meeting ? <MeetingPage id={meeting[1]}/> : hash === '#/konta' && info.account.admin ? <Accounts/> : <Home/>}
    </main>
  </SessionContext.Provider>;
}

function TopBar(props: {onLogout: () => void}) {
  const {account, name, membership} = useSession();
  const [password, setPassword] = useState(false);
  const label = membership('prezydium')?.label ?? account.label ?? '';
  return <header class="topbar">
    <a class="brand" href="#/"><span class="brand-mark" aria-hidden="true">§</span><span><strong>Posiedzenia</strong><small>Prezydium ORPiP w Słupsku</small></span></a>
    <nav class="topbar-nav">
      <span class="who"><strong>{name}</strong>{label && <small>{label}</small>}</span>
      {account.admin && <a class="btn btn-ghost btn-small" href="#/konta">Konta</a>}
      <Button small kind="ghost" onClick={() => setPassword(true)}>Hasło</Button>
      <Button small kind="ghost" onClick={async () => { await request('/api/logout', {method: 'POST'}).catch(() => {}); location.hash = ''; props.onLogout(); }}>Wyloguj</Button>
    </nav>
    {password && <Modal title="Zmiana hasła" onClose={() => setPassword(false)}><PasswordCard onDone={() => setPassword(false)}/></Modal>}
  </header>;
}

function Login(props: {setup: boolean; roster: Roster | null; onDone: () => void}) {
  const {busy, error, run} = useAction();
  const prezydium = props.roster?.memberships.filter(m => m.organ === 'prezydium') ?? [];
  return <main class="center-page">
    <form class="card login" onSubmit={e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run(async () => {
        if (props.setup) await request('/api/setup', {body: {token: f.get('token'), username: f.get('username'), password: f.get('password'), personId: f.get('personId') || null, displayName: 'Biuro Izby'}});
        else await request('/api/login', {body: {username: f.get('username'), password: f.get('password')}});
        props.onDone();
      });
    }}>
      <div class="login-brand"><span class="brand-mark big" aria-hidden="true">§</span><div><small>OIPiP w Słupsku</small><h1>{props.setup ? 'Pierwsze uruchomienie' : 'Posiedzenia Prezydium'}</h1></div></div>
      {props.setup && <>
        <p>Utwórz konto administratora. Kod pierwszego uruchomienia jest w oknie serwera oraz w pliku <code>data/pierwsze-uruchomienie.txt</code>.</p>
        <Field label="Kod pierwszego uruchomienia"><input name="token" required autocomplete="off" spellcheck={false}/></Field>
        <Field label="Czyje to konto?" hint="Administrator zarządza kontami. Członek Prezydium może być administratorem, ale zwykle robi to biuro.">
          <select name="personId"><option value="">Biuro Izby (bez prawa głosu)</option>{prezydium.map(m => <option value={m.personId}>{props.roster!.persons.find(p => p.id === m.personId)?.name} — {m.label}</option>)}</select>
        </Field>
      </>}
      <Field label="Login" hint={props.setup ? 'Małe litery bez polskich znaków, cyfry, kropka lub myślnik (3–64 znaki).' : undefined}><input name="username" required autocomplete="username" autocapitalize="none" spellcheck={false} minLength={3} maxLength={64}/></Field>
      <Field label="Hasło" hint={props.setup ? 'Co najmniej 12 znaków.' : undefined}><input name="password" type="password" required autocomplete={props.setup ? 'new-password' : 'current-password'} minLength={props.setup ? 12 : 1} maxLength={200}/></Field>
      {error && <Notice tone="error">{error}</Notice>}
      <Button kind="primary" type="submit" wide disabled={busy}>{props.setup ? 'Utwórz administratora' : 'Zaloguj się'}</Button>
      {!props.setup && <p class="muted small">Login i hasło tymczasowe otrzymasz od biura Izby. Przy pierwszym logowaniu ustawisz własne hasło.</p>}
    </form>
  </main>;
}

function PasswordCard(props: {forced?: boolean; onDone: () => void}) {
  const {busy, error, setError, run} = useAction();
  const [ok, setOk] = useState(false);
  return <form class={props.forced ? 'card login' : 'stack'} onSubmit={e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get('password') !== f.get('repeat')) { setError('Nowe hasła różnią się od siebie.'); return; }
    run(async () => { await request('/api/password', {body: {currentPassword: f.get('current'), password: f.get('password')}}); setOk(true); props.onDone(); });
  }}>
    {props.forced && <><h1>Ustaw własne hasło</h1><p>Zalogowano hasłem tymczasowym. Przed rozpoczęciem pracy ustaw własne hasło — znasz je tylko Ty.</p></>}
    <Field label={props.forced ? 'Hasło tymczasowe' : 'Obecne hasło'}><input name="current" type="password" required autocomplete="current-password"/></Field>
    <Field label="Nowe hasło" hint="Co najmniej 12 znaków."><input name="password" type="password" required minLength={12} maxLength={200} autocomplete="new-password"/></Field>
    <Field label="Powtórz nowe hasło"><input name="repeat" type="password" required minLength={12} maxLength={200} autocomplete="new-password"/></Field>
    {error && <Notice tone="error">{error}</Notice>}
    {ok && <Notice tone="ok">Hasło zmienione.</Notice>}
    <Button kind="primary" type="submit" wide disabled={busy}>Zapisz hasło</Button>
  </form>;
}
