import {useEffect, useState} from 'preact/hooks';
import type {Account, Roster} from '../shared/types.ts';
import {request} from './api.ts';
import {SessionContext, useSession} from './session.ts';
import {Button, Fact, Field, Modal, Notice, Tag, useAction} from './ui.tsx';
import {Home} from './home.tsx';
import {MeetingPage} from './meeting.tsx';
import {RoomScreen} from './screen.tsx';
import {Accounts} from './accounts.tsx';
import {brand} from './brand.ts';
import {currentRoute, go, onRoute} from './route.ts';
import {Plate} from './plate.tsx';

interface SessionInfo { account: Account | null; setupRequired: boolean; roster: Roster | null }

export function App() {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [error, setError] = useState('');
  const [hash, setHash] = useState(currentRoute);
  const load = () => request<SessionInfo>('/api/session').then(setInfo).catch(e => setError(e.message));
  useEffect(() => {
    load();
    const offRoute = onRoute(setHash);
    const onLogout = () => load();
    window.addEventListener('posiedzenia:wyloguj', onLogout);
    return () => { offRoute(); window.removeEventListener('posiedzenia:wyloguj', onLogout); };
  }, []);

  if (!info) return <main class="center-page">{error ? <Notice tone="error">{error} <Button small onClick={load}>Spróbuj ponownie</Button></Notice> : <p class="muted">Wczytywanie…</p>}</main>;
  if (!info.account) {
    const Picker = brand.loginScreen;
    return Picker ? <Picker onDone={load}/> : <Login setup={info.setupRequired} roster={info.roster} onDone={load}/>;
  }
  const session = {account: info.account, roster: info.roster!};
  if (info.account.mustChange) return <SessionContext.Provider value={session}><main class="center-page"><PasswordCard forced onDone={load}/></main></SessionContext.Provider>;

  const screen = hash.match(/^#ekran-([\w-]+)$/);
  if (screen) return <SessionContext.Provider value={session}><RoomScreen id={screen[1]}/></SessionContext.Provider>;
  const meeting = hash.match(/^#p-([\w-]+)$/);
  return <SessionContext.Provider value={session}>
    <TopBar onLogout={load}/>
    <main>
      {meeting ? <MeetingPage id={meeting[1]}/> : hash === '#konta' && info.account.admin ? <Accounts/> : <Home/>}
    </main>
  </SessionContext.Provider>;
}

function TopBar(props: {onLogout: () => void}) {
  const {account, name, membership} = useSession();
  const [open, setOpen] = useState(false);
  const raw = membership('prezydium')?.label ?? account.label ?? '';
  const label = raw === name ? '' : raw;
  const logout = async () => { await request('/api/logout', {method: 'POST'}).catch(() => {}); if (!brand.demo) go(''); props.onLogout(); };
  return <header class="topbar">
    <a class="topbar-brand" href="#" aria-label="Lista posiedzeń">
      <Plate/>
      <span class="topbar-app"><strong>Posiedzenia <b>Prezydium</b></strong><small>{brand.organ}</small></span>
    </a>
    <nav class="topbar-nav" aria-label="Konto">
      <span class="who"><strong>{name}</strong>{label && <small>{label}</small>}</span>
      {account.admin && <a class="oi-btn oi-btn--obrys oi-btn--maly" href="#konta"><span>Konta</span></a>}
      {brand.demo && <Tag dark>Wersja próbna</Tag>}
      {brand.demo
        ? <Button small onClick={logout}>{brand.switchLabel}</Button>
        : <Button small onClick={() => setOpen(true)}>Twoje konto</Button>}
    </nav>
    {open && <Modal title="Twoje konto" onClose={() => setOpen(false)}>
      <dl class="facts"><Fact label="Imię i nazwisko">{name}</Fact>{label && <Fact label="Funkcja">{label}</Fact>}<Fact label="Login"><code>{account.username}</code></Fact></dl>
      <div class="actions"><Button kind="primary" onClick={logout}>Wyloguj się</Button></div>
      <section class="stack"><h3 class="oi-card__title"><span class="oi-mark" aria-hidden="true"/><span>Zmiana hasła</span></h3><PasswordCard onDone={() => {}}/></section>
    </Modal>}
  </header>;
}

function Login(props: {setup: boolean; roster: Roster | null; onDone: () => void}) {
  const {busy, error, run} = useAction();
  const prezydium = props.roster?.memberships.filter(m => m.organ === 'prezydium') ?? [];
  return <main class="center-page">
    <form class="oi-card login" onSubmit={e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run(async () => {
        if (props.setup) await request('/api/setup', {body: {token: f.get('token'), username: f.get('username'), password: f.get('password'), personId: f.get('personId') || null, displayName: brand.office}});
        else await request('/api/login', {body: {username: f.get('username'), password: f.get('password')}});
        props.onDone();
      });
    }}>
      <Plate big/>
      <Tag>{props.setup ? 'Pierwsze uruchomienie' : 'Posiedzenia i głosowania'}</Tag>
      <h1 class="app-title">Posiedzenia <b>Prezydium</b></h1>
      <p class="lead">{brand.organ}{brand.term ? `, ${brand.term}` : ''}</p>
      {props.setup && <>
        <p>Utwórz konto administratora. Kod pierwszego uruchomienia jest w oknie serwera oraz w pliku <code>data/pierwsze-uruchomienie.txt</code>.</p>
        <Field label="Kod pierwszego uruchomienia"><input name="token" required autocomplete="off" spellcheck={false}/></Field>
        <Field label="Czyje to konto?" hint="Administrator zarządza kontami. Członek Prezydium może być administratorem, ale zwykle robi to biuro.">
          <select name="personId"><option value="">{brand.office} (bez prawa głosu)</option>{prezydium.map(m => <option value={m.personId}>{props.roster!.persons.find(p => p.id === m.personId)?.name}, {m.label}</option>)}</select>
        </Field>
      </>}
      <Field label="Login" hint={props.setup ? 'Małe litery bez polskich znaków, cyfry, kropka lub myślnik (3–64 znaki).' : undefined}><input name="username" required autocomplete="username" autocapitalize="none" spellcheck={false} minLength={3} maxLength={64}/></Field>
      <Field label="Hasło" hint={props.setup ? 'Co najmniej 12 znaków.' : undefined}><input name="password" type="password" required autocomplete={props.setup ? 'new-password' : 'current-password'} minLength={props.setup ? 12 : 1} maxLength={200}/></Field>
      {error && <Notice tone="error">{error}</Notice>}
      <Button kind="primary" type="submit" wide disabled={busy}>{props.setup ? 'Utwórz administratora' : 'Zaloguj się'}</Button>
      {!props.setup && <p class="muted small">Login i hasło tymczasowe otrzymasz od biura. Przy pierwszym logowaniu ustawisz własne hasło.</p>}
    </form>
  </main>;
}

function PasswordCard(props: {forced?: boolean; onDone: () => void}) {
  const {busy, error, setError, run} = useAction();
  const [ok, setOk] = useState(false);
  return <form class={props.forced ? 'oi-card login' : 'stack'} onSubmit={e => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (f.get('password') !== f.get('repeat')) { setError('Wpisz w obu polach to samo nowe hasło.'); return; }
    run(async () => { await request('/api/password', {body: {currentPassword: f.get('current'), password: f.get('password')}}); setOk(true); form.reset(); props.onDone(); });
  }}>
    {props.forced && <><Plate big/><h1 class="app-title">Ustaw <b>własne hasło</b></h1><p>Zalogowano hasłem tymczasowym. Przed rozpoczęciem pracy ustaw własne hasło, które znasz tylko Ty.</p></>}
    <Field label={props.forced ? 'Hasło tymczasowe' : 'Obecne hasło'}><input name="current" type="password" required autocomplete="current-password"/></Field>
    <Field label="Nowe hasło" hint="Co najmniej 12 znaków."><input name="password" type="password" required minLength={12} maxLength={200} autocomplete="new-password"/></Field>
    <Field label="Powtórz nowe hasło"><input name="repeat" type="password" required minLength={12} maxLength={200} autocomplete="new-password"/></Field>
    {error && <Notice tone="error">{error}</Notice>}
    {ok && <Notice tone="ok">Hasło zmienione.</Notice>}
    <Button kind={props.forced ? 'primary' : 'secondary'} type="submit" wide={props.forced} disabled={busy}>Zapisz hasło</Button>
  </form>;
}
