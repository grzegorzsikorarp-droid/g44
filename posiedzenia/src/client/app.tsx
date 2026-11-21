import {useEffect, useId, useLayoutEffect, useRef, useState} from 'preact/hooks';
import type {Account, DocType, Roster} from '../shared/types.ts';
import type {GeneralBundle} from '../shared/settings.ts';
import {ApiError, request} from './api.ts';
import {SessionContext, useSession} from './session.ts';
import {Button, Check, Chip, ErrorNotice, errorKindOf, Field, LiveRegion, Notice, Tag, useAction, type ErrorKind} from './ui.tsx';
import {Home} from './home.tsx';
import {MeetingPage} from './meeting.tsx';
import {RoomScreen} from './screen.tsx';
import {isSectionId, SettingsPage, sectionName, visibleSections, type SectionId} from './settings.tsx';
import {settingsAccess} from '../shared/role.ts';
import {personName} from '../shared/roster.ts';
import {brand} from './brand.ts';
import {commsRouteAllowed, currentRoute, go, onRoute, registeredPage, v4Route} from './route.ts';
import type {VNode} from 'preact';
import {AccountPage, applyTextSize, PasswordCard, readTextSize} from './account.tsx';
import {Avatar} from './avatar.tsx';
import {MyStatsPage, RosterStatsPage} from './stats.tsx';
import {CatalogPage, ReportPage} from './catalog.tsx';
import type {Session} from './session.ts';
import {Plate} from './plate.tsx';
import {acceptSession} from './general.ts';

interface SessionInfo extends Partial<Omit<Session, 'account' | 'roster'>> { account: Account | null; setupRequired: boolean; roster: Roster | null; docTypes?: DocType[] | null; general?: GeneralBundle | null }

const APP = 'Posiedzenia Prezydium';
// Pamięć karty przeglądarki. W ramce bez własnego adresu (wersja próbna) jest niedostępna, a aplikacja działa bez niej.
const BACK = 'posiedzenia:powrot', FRESH = 'posiedzenia:po-logowaniu';
const tabStore = {
  get: (key: string) => { try { return sessionStorage.getItem(key); } catch { return null; } },
  set: (key: string, value: string) => { try { sessionStorage.setItem(key, value); } catch { /* bez pamięci karty */ } },
  del: (key: string) => { try { sessionStorage.removeItem(key); } catch { /* bez pamięci karty */ } },
};

/** Po zalogowaniu (także po wyborze osoby w wersji próbnej): znacznik dla listy posiedzeń i powrót na trasę sprzed wygaśnięcia sesji. */
export function afterLogin() {
  const back = tabStore.get(BACK);
  if (back !== null) { tabStore.del(BACK); go(back); }
  // Znacznik tylko po zwykłym zalogowaniu i tylko wtedy, gdy widać listę. Po wygaśnięciu sesji osoba wraca na swój ekran,
  // także na listę, i nie jest przenoszona do posiedzenia.
  if (back === null && !currentRoute()) tabStore.set(FRESH, '1');
}

export function App() {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<{text: string; kind: ErrorKind} | null>(null);
  const [hash, setHash] = useState(currentRoute);
  const latest = useRef<SessionInfo | null>(null);
  latest.current = info;
  const leaving = useRef(false);
  // Wersja 3 (I-9): ustawienia ogólne i słownik rodzajów dokumentów przychodzą z sesją (general.ts, doctypes.ts).
  const load = () => request<SessionInfo>('/api/session').then(value => { setError(null); acceptSession(value); setInfo(value); }).catch(e => setError({text: e.message, kind: errorKindOf(e)}));
  useEffect(() => {
    load();
    const offRoute = onRoute(setHash);
    // Odpowiedź 401 przy zalogowanej osobie oznacza wygaśnięcie sesji: trasa czeka na powrót po ponownym zalogowaniu.
    const onExpired = () => {
      if (!leaving.current && latest.current?.account) tabStore.set(BACK, currentRoute());
      load();
    };
    window.addEventListener('posiedzenia:wyloguj', onExpired);
    // Po zmianie składu (ustawienia ogólne) i gdy przygotowanie posiedzenia trafi na rodzaj sprawy albo dokumentu, którego
    // karta jeszcze nie zna (prep.tsx), sesja wczytuje się ponownie.
    const onRoster = () => { load(); };
    window.addEventListener('posiedzenia:sesja', onRoster);
    return () => { offRoute(); window.removeEventListener('posiedzenia:wyloguj', onExpired); window.removeEventListener('posiedzenia:sesja', onRoster); };
  }, []);
  const logout = async () => {
    leaving.current = true;
    tabStore.del(BACK);
    await request('/api/logout', {method: 'POST'}).catch(() => {});
    if (!brand.demo) go('');
    await load();
    leaving.current = false;
  };

  const screen = hash.match(/^#ekran-([\w-]+)$/);
  // Dodatek D-2 (U-47): wielkość tekstu z „Mojego konta” na tym urządzeniu; ekran sali ma własną wielkość pisma.
  useEffect(() => { applyTextSize(readTextSize(), !!screen); }, [!!screen]);
  const meeting = hash.match(/^#p-([\w-]+)$/);
  // Wersja 3: ustawienia ogólne pod #ustawienia i #ustawienia-{sekcja}; dawne trasy #konta i #rodzaje prowadzą do sekcji.
  const legacy = hash === '#konta' ? '#ustawienia-konta' : hash === '#rodzaje' ? '#ustawienia-rodzaje' : null;
  useEffect(() => { if (legacy) go(legacy); }, [legacy]);
  const route = legacy ?? hash;
  const settingsMatch = route.match(/^#ustawienia(?:-([a-z]+))?$/);
  const actor = info?.account && info.roster ? {account: info.account, personId: info.account.personId, name: info.account.personId ? personName(info.roster, info.account.personId) : info.account.displayName} : null;
  const sections = actor ? visibleSections(settingsAccess(info!.roster!, actor)) : [];
  const settings = !!settingsMatch && sections.length > 0;
  const section: SectionId | null = settings && settingsMatch![1] && isSectionId(settingsMatch![1]) && sections.includes(settingsMatch![1]) ? settingsMatch![1] : null;
  const signedIn = !!info?.account && !info.account.mustChange;
  // Wersja 4 (pakiet D0, SPEC-4 8.2 D.3): trasy nowych stron; konto „Komunikacja” wraca na swoją stronę startową (4.4).
  const v4 = screen || meeting || settings ? null : v4Route(route);
  const extraPage = signedIn && v4?.page === 'skrzynka' ? registeredPage(route) : null;
  const commsHome = signedIn && info!.account!.kind === 'komunikacja' && !commsRouteAllowed(route) ? info!.home ?? '#odbyte' : null;
  useEffect(() => { if (commsHome) go(commsHome); }, [commsHome]);
  const docsId = v4?.page === 'dokumenty' ? v4.id : null;
  useEffect(() => {
    if (!docsId) return;
    // #p-{id}/dokumenty: przewinięcie do karty „Dokumenty posiedzenia” i fokus na jej nagłówek, gdy karta się pojawi.
    let n = 0;
    const timer = window.setInterval(() => {
      const card = document.getElementById('dokumenty-posiedzenia');
      if (card || ++n > 30) { window.clearInterval(timer); card?.scrollIntoView({block: 'start'}); const h = card?.querySelector<HTMLElement>('h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); } }
    }, 100);
    return () => window.clearInterval(timer);
  }, [docsId]);
  const title = !info ? null : !info.account ? `Logowanie – ${APP}` : info.account.mustChange ? `Ustaw własne hasło – ${APP}` : screen || meeting ? null
    : settings ? (section ? `${sectionName(section)} – Ustawienia ogólne` : `Ustawienia ogólne – ${APP}`) : v4 ? null : `Lista posiedzeń – ${APP}`;
  // Tytuł karty ustawia się przed efektami ekranów, więc tytuł posiedzenia ustawiony niżej przez usePageTitle ma pierwszeństwo.
  useLayoutEffect(() => { document.title = title ?? APP; }, [title]);

  // Po zmianie trasy fokus przechodzi na pierwszy nagłówek h1 w treści (czeka do 3 s, aż ekran się wczyta).
  const firstRoute = useRef(true);
  useEffect(() => {
    if (firstRoute.current) { firstRoute.current = false; return; }
    let stopped = false, timer = 0;
    const started = Date.now();
    const typing = () => !!document.activeElement?.matches('input, textarea, select');
    const tick = () => {
      if (stopped || typing()) return;
      const heading = document.querySelector<HTMLElement>('main h1');
      if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); return; }
      if (Date.now() - started < 3000) timer = window.setTimeout(tick, 100);
    };
    timer = window.setTimeout(tick, 50);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [hash]);

  let content;
  if (!info) content = <main class="center-page" id="tresc" tabIndex={-1}>{error ? <ErrorNotice kind={error.kind}>{error.text} <Button small onClick={load}>Spróbuj ponownie</Button></ErrorNotice> : <p class="muted">Wczytywanie…</p>}</main>;
  else if (!info.account) {
    const Picker = brand.loginScreen;
    content = Picker ? <Picker onDone={load}/> : <Login setup={info.setupRequired} roster={info.roster} onDone={load}/>;
  } else {
    const session: Session = {account: info.account, roster: info.roster!, avatars: info.avatars, photoCircle: info.photoCircle, can: info.can, mail: info.mail, home: info.home};
    const page = !v4 ? null : v4.page === 'konto' ? <AccountPage onLogout={() => { logout(); }}/> : v4.page === 'moje-statystyki' ? <MyStatsPage query={v4.query}/>
      : v4.page === 'statystyki' ? <RosterStatsPage query={v4.query}/>
      : v4.page === 'odbyte' ? <CatalogPage query={v4.query}/> : v4.page === 'zestawienie' ? <ReportPage query={v4.query}/>
      : v4.page === 'dokumenty' ? <MeetingPage id={v4.id}/> : extraPage ? extraPage() as VNode : null;
    content = <SessionContext.Provider value={session}>
      {info.account.mustChange ? <main class="center-page" id="tresc" tabIndex={-1}><PasswordCard forced onDone={load}/></main>
        : screen ? <RoomScreen id={screen[1]}/>
        : <><TopBar current={meeting ? null : settings ? 'ustawienia' : v4?.page === 'konto' || v4?.page === 'moje-statystyki' ? 'konto' : v4?.page === 'statystyki' ? 'statystyki' : v4?.page === 'odbyte' ? (info.account.kind === 'komunikacja' ? 'odbyte' : 'lista') : v4 ? null : 'lista'}
          home={!meeting && !settings && !v4 && !commsHome} settings={sections.length > 0} onLogout={logout}/>
          {/* W-W4-13: konto „Komunikacja” spoza swoich tras od razu przechodzi na #odbyte, bez montowania listy posiedzeń. */}
          <main id="tresc" tabIndex={-1}>{commsHome ? <p class="muted">Wczytywanie…</p> : meeting ? <MeetingPage id={meeting[1]}/> : settings ? <SettingsPage section={section}/> : page ?? <Home/>}</main></>}
    </SessionContext.Provider>;
  }
  return <>{!(signedIn && screen) && <SkipLink/>}{content}<LiveRegion/></>;
}

/** Pierwszy element strony: odnośnik do treści dla osób poruszających się klawiaturą. */
function SkipLink() {
  return <a class="skip-link" href="#tresc" data-kotwica onClick={e => { e.preventDefault(); document.getElementById('tresc')?.focus(); }}>Przejdź do treści</a>;
}

// Na stronie głównej (lista posiedzeń) tytuł aplikacji stoi w nagłówku strony, więc górny pasek go nie powtarza (`home`).
// Zaznaczenie pozycji „Posiedzenia” (`current`) jest osobne: na „Odbytych posiedzeniach” nazwa aplikacji zostaje (W-W4-11).
// Nawigacja (SPEC-4 6.1, DB-8) ma najwyżej trzy pozycje: „Posiedzenia” (zakładki „Bieżące” i „Odbyte”), „Statystyki”
// (dopiero z dodatkiem D-13, `session.can.rosterStats`) i „Ustawienia” (settingsAccess z role.ts). Konto „Komunikacja” ma
// jedną pozycję „Odbyte posiedzenia”. „Moje konto” to przycisk z własnym zdjęciem i imieniem w górnym pasku (zamiast okna
// „Twoje konto”); przy 320 px widać tylko zdjęcie albo inicjały, a imię jest w nazwie dostępnej. W wersji próbnej pasek ma
// też odnośnik „Skrzynka (próba)” (S-24) i przycisk zmiany osoby.
type TopCurrent = 'statystyki' | 'lista' | 'ustawienia' | 'konto' | 'odbyte' | null;
function TopBar(props: {current: TopCurrent; home: boolean; settings: boolean; onLogout: () => Promise<void>}) {
  const s = useSession();
  const {account, name, membership} = s;
  const comms = account.kind === 'komunikacja';
  const raw = membership('prezydium')?.label ?? account.label ?? '';
  const label = raw === name ? '' : raw;
  const who = <span class="who"><strong>{name}</strong>{label && <small>{label}</small>}</span>;
  return <header class="topbar">
    <a class="topbar-brand" href={comms ? '#odbyte' : '#'} aria-label={comms ? 'Posiedzenia Prezydium, odbyte posiedzenia' : 'Posiedzenia Prezydium, lista posiedzeń'}>
      <Plate decorative/>
      {!props.home && <span class="topbar-app"><strong>Posiedzenia <b>Prezydium</b></strong><small>{brand.organ}</small></span>}
    </a>
    <div class="topbar-side">
      <nav class="oi-subnav topbar-nav" aria-label="Części aplikacji">
        {comms
          ? <a href="#odbyte" aria-current={props.current === 'odbyte' ? 'page' : undefined}><span class="oi-mark" aria-hidden="true"/>Odbyte posiedzenia</a>
          : <a href="#" aria-current={props.current === 'lista' ? 'page' : undefined}><span class="oi-mark" aria-hidden="true"/>Posiedzenia</a>}
        {!comms && s.can.rosterStats && <a href="#statystyki" aria-current={props.current === 'statystyki' ? 'page' : undefined}><span class="oi-mark" aria-hidden="true"/>Statystyki</a>}
        {!comms && props.settings && <a href="#ustawienia" aria-current={props.current === 'ustawienia' ? 'page' : undefined}><span class="oi-mark" aria-hidden="true"/>Ustawienia</a>}
      </nav>
      {brand.demo && <a class="topbar-inbox" href="#skrzynka">Skrzynka (próba)</a>}
      <a class="topbar-account" href="#konto" aria-label={`Moje konto, ${name}`} aria-current={props.current === 'konto' ? 'page' : undefined}>
        {who}<Avatar personKey={s.avatarKey} name={name} size={32}/>
      </a>
      {brand.demo && <><span class="topbar-demo"><Chip>Wersja próbna</Chip></span><Button kind="ghost" onClick={() => { props.onLogout(); }}>{brand.switchLabel}</Button></>}
    </div>
  </header>;
}

const capsLock = (e: KeyboardEvent) => typeof e.getModifierState === 'function' && e.getModifierState('CapsLock');

function Login(props: {setup: boolean; roster: Roster | null; onDone: () => void}) {
  const {busy, error, errorKind, run} = useAction();
  const [wrong, setWrong] = useState(false);
  const [caps, setCaps] = useState(false);
  const [show, setShow] = useState(false);
  const password = useRef<HTMLInputElement>(null);
  const wrongId = useId();
  const expired = !props.setup && tabStore.get(BACK) !== null;
  const prezydium = props.roster?.memberships.filter(m => m.organ === 'prezydium') ?? [];
  const passwordHint = [props.setup ? 'Co najmniej 12 znaków.' : '', caps ? 'Włączony jest Caps Lock.' : ''].filter(Boolean).join(' ') || undefined;
  return <main class="center-page" id="tresc" tabIndex={-1}>
    <form class="oi-card login" onKeyDown={e => setCaps(capsLock(e))} onKeyUp={e => setCaps(capsLock(e))} onSubmit={e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      setWrong(false);
      run(async () => {
        if (props.setup) {
          await request('/api/setup', {body: {token: f.get('token'), username: f.get('username'), password: f.get('password'), personId: f.get('personId') || null, displayName: brand.office}});
          props.onDone();
          return;
        }
        try { await request('/api/login', {body: {username: f.get('username'), password: f.get('password')}}); }
        catch (err) {
          if (err instanceof ApiError && err.status === 401) { setWrong(true); password.current?.focus(); return; }
          throw err;
        }
        afterLogin();
        props.onDone();
      });
    }}>
      <Plate big/>
      <Tag>{props.setup ? 'Pierwsze uruchomienie' : 'Posiedzenia i głosowania'}</Tag>
      <h1 class="app-title">Posiedzenia <b>Prezydium</b></h1>
      <p class="lead">{brand.organ}{brand.term ? `, ${brand.term}` : ''}</p>
      {expired && <Notice>Sesja wygasła. Zaloguj się ponownie, a wrócisz do tego samego ekranu.</Notice>}
      {props.setup && <>
        <p>Utwórz konto administratora. Kod pierwszego uruchomienia jest w oknie, w którym uruchomiono aplikację, oraz w pliku <code>data/pierwsze-uruchomienie.txt</code>.</p>
        <Field label="Kod pierwszego uruchomienia"><input name="token" required autocomplete="off" spellcheck={false}/></Field>
        <Field label="Czyje to konto?" hint="Administrator zarządza kontami. Członek Prezydium może być administratorem, ale zwykle robi to biuro.">
          <select name="personId"><option value="">{brand.office} (bez prawa głosu)</option>{prezydium.map(m => <option value={m.personId}>{props.roster!.persons.find(p => p.id === m.personId)?.name}, {m.label}</option>)}</select>
        </Field>
      </>}
      <Field label="Login" hint={props.setup ? 'Małe litery bez polskich znaków, cyfry, kropka lub myślnik (3–64 znaki).' : undefined} error={wrong ? true : undefined} describedBy={wrong ? wrongId : undefined}>
        <input name="username" required autocomplete="username" autocapitalize="none" spellcheck={false} minLength={3} maxLength={64}/>
      </Field>
      <Field label="Hasło" hint={passwordHint} error={wrong ? 'Login lub hasło są nieprawidłowe. Sprawdź oba pola. W haśle liczy się wielkość liter.' : undefined} errorId={wrongId}>
        <input ref={password} name="password" type={show ? 'text' : 'password'} required autocomplete={props.setup ? 'new-password' : 'current-password'} minLength={props.setup ? 12 : 1} maxLength={200}/>
      </Field>
      <Check checked={show} onChange={setShow}>Pokaż hasło</Check>
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <Button kind="primary" type="submit" wide busy={busy}>{props.setup ? 'Utwórz administratora' : 'Zaloguj się'}</Button>
      {!props.setup && <p class="muted small">Login i hasło tymczasowe otrzymasz od {brand.officeOf}. Przy pierwszym logowaniu ustawisz własne hasło. Nie pamiętasz hasła? {brand.office} nada Ci nowe hasło tymczasowe.</p>}
    </form>
  </main>;
}
