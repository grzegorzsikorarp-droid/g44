import type {ComponentChildren} from 'preact';
import {useEffect, useState} from 'preact/hooks';
import type {Account} from '../shared/types.ts';
import {organOf} from '../shared/roster.ts';
import {request} from './api.ts';
import {useSession} from './session.ts';
import {Button, CardTitle, Check, Confirm, ErrorNotice, Fact, Field, Fold, Modal, Notice, StateChip, useAction, type ErrorKind} from './ui.tsx';
import {accountChip} from './stany.ts';
import {brand} from './brand.ts';
import {HistoryFold} from './cascade-ui.tsx';

const kinds: Record<Account['kind'], string> = {czlonek: 'Członek organu', doradczy: 'Głos doradczy', gosc: 'Gość', biuro: 'Biuro'};
const newAccountTitle: Record<Exclude<Account['kind'], 'czlonek'>, string> = {doradczy: 'Nowe konto z głosem doradczym', gosc: 'Nowe konto gościa', biuro: 'Nowe konto biura'};
const ascii = (s: string) => s.toLowerCase().replace(/[ąćęłńóśźż]/g, c => 'acelnoszz'['ąćęłńóśźż'.indexOf(c)]).replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
function temporaryPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(bytes, b => chars[b % chars.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}
const stateWord = (a: Account) => a.disabled ? 'Zablokowane' : a.mustChange ? 'Czeka na pierwsze logowanie' : 'Aktywne';

/**
 * Sekcja „Konta i role” ustawień ogólnych (wersja 3, rozdz. 5.2 sekcja 4; dawniej strona #konta). Konta zmienia
 * wyłącznie administrator, czyli rola techniczna bez uprawnień w posiedzeniach (DA-2).
 */
export function AccountsPanel() {
  const s = useSession();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const {busy, error, errorKind, run} = useAction();
  const [creating, setCreating] = useState<{kind: Account['kind']; personId?: string} | null>(null);
  const [issued, setIssued] = useState<{name: string; username: string; password: string} | null>(null);
  const [copied, setCopied] = useState(false);
  const [reset, setReset] = useState<{a: Account; name: string} | null>(null);
  const [managing, setManaging] = useState<{id: string; name: string} | null>(null);
  useEffect(() => { request<{accounts: Account[]}>('/api/accounts').then(r => setAccounts(r.accounts)).catch(() => setAccounts([])); }, []);
  const patch = (body: object) => run(async () => { const r = await request<{accounts: Account[]}>('/api/accounts', {method: 'PATCH', body}); setAccounts(r.accounts); });
  const presidium = s.roster.memberships.filter(m => m.organ === 'prezydium');
  const council = s.roster.memberships.filter(m => m.organ === 'rada' && !presidium.some(p => p.personId === m.personId));
  const byPerson = (id: string) => accounts?.find(a => a.personId === id);
  const others = accounts?.filter(a => !a.personId) ?? [];
  const councilName = (organOf(s.roster, 'rada')?.name ?? 'Okręgowa Rada').replace(/^Okręgowa Rada/, 'Okręgowej Rady');
  const address = brand.demo ? 'adres pełnej aplikacji' : location.origin;
  const managed = managing ? accounts?.find(a => a.id === managing.id) : undefined;
  const personRow = (personId: string, label: string) => {
    const name = s.personName(personId);
    return <AccountRow key={personId} name={name} sub={label} a={byPerson(personId)} onCreate={() => setCreating({kind: 'czlonek', personId})} onManage={a => setManaging({id: a.id, name})}/>;
  };
  return <>
    <p class="settings-lead">Każda osoba ma własne, imienne konto i nie przekazuje go innym. Przekaż login i hasło tymczasowe, a osoba ustawi własne hasło przy pierwszym logowaniu. Po zablokowaniu konta albo nadaniu nowego hasła tymczasowego osoba zostanie wylogowana na wszystkich urządzeniach.</p>
    <div class="stack">
      {error && !managed && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      {!accounts && <p class="muted">Wczytywanie…</p>}
      {accounts && <>
        <section class="oi-card"><CardTitle level={2}>{brand.organ || 'Prezydium'}</CardTitle><AccountTable label={brand.organ || 'Prezydium'}>{presidium.map(m => personRow(m.personId, m.label))}</AccountTable></section>
        <section class="oi-card">
          <CardTitle level={2}>Biuro, głos doradczy i goście</CardTitle>
          <p class="muted small">Głos doradczy mają przewodniczący Okręgowej Komisji Rewizyjnej, przewodniczący Okręgowego Sądu Pielęgniarek i Położnych oraz Okręgowy Rzecznik Odpowiedzialności Zawodowej (§ 7 ust. 2). Gość widzi posiedzenia, na które go zaproszono, i czyta kanał wiadomości.</p>
          <p class="muted small">Biuro obsługuje posiedzenia. Przygotowuje je, prowadzi listę obecności, materiały i dane do protokołu. Nie wykonuje czynności organu, np. nie wyznacza zastępcy przewodniczącego i nie ogłasza wyników (§ 23).</p>
          <div class="actions"><Button small haspopup onClick={() => setCreating({kind: 'doradczy'})}>Dodaj konto z głosem doradczym</Button><Button small haspopup onClick={() => setCreating({kind: 'gosc'})}>Dodaj konto gościa</Button><Button small haspopup onClick={() => setCreating({kind: 'biuro'})}>Dodaj konto biura</Button></div>
          {others.length > 0 && <AccountTable label="Biuro, głos doradczy i goście">{others.map(a => <AccountRow key={a.id} name={a.displayName}
            sub={a.label && ![a.displayName, kinds[a.kind]].includes(a.label) ? a.label : ''} role={kinds[a.kind]} a={a} onManage={x => setManaging({id: x.id, name: x.displayName})}/>)}</AccountTable>}
        </section>
        {council.length > 0 && <Fold title={`Pozostali członkowie ${councilName}`}>
          <p class="muted small">{`Konta będą potrzebne do posiedzeń ${councilName}. Posiedzenia Prezydium ich nie wymagają.`}</p>
          <AccountTable label={`Pozostali członkowie ${councilName}`}>{council.map(m => personRow(m.personId, m.label))}</AccountTable>
        </Fold>}
        <HistoryFold area="konta"/>
      </>}
    </div>
    {managed && managing && <ManageAccount a={managed} name={managing.name} self={managed.id === s.account.id} busy={busy} error={error} errorKind={errorKind}
      onPatch={patch} onReset={() => setReset({a: managed, name: managing.name})} onClose={() => setManaging(null)}/>}
    {creating && <CreateAccount kind={creating.kind} personId={creating.personId} councilName={councilName} onClose={() => setCreating(null)} onCreated={(list, info) => { setAccounts(list); setCreating(null); setCopied(false); setIssued(info); }}/>}
    {reset && <ResetPassword a={reset.a} name={reset.name} onClose={() => setReset(null)} onDone={(list, password) => { setAccounts(list); setCopied(false); setIssued({name: reset.name, username: reset.a.username, password}); setReset(null); }}/>}
    {issued && <Modal title="Dane do przekazania" onClose={() => setIssued(null)}>
      <p>Przekaż osobie <strong>{issued.name}</strong> poniższe dane, najlepiej osobiście lub SMS-em. Przy pierwszym logowaniu ustawi własne hasło.</p>
      <dl class="facts credentials oi-note oi-note--wazne"><Fact label="Adres">{address}</Fact><Fact label="Login"><code>{issued.username}</code></Fact><Fact label="Hasło tymczasowe"><code>{issued.password}</code></Fact></dl>
      <div class="actions">
        <Button kind="primary" onClick={() => setIssued(null)}>Gotowe</Button>
        <Button onClick={() => { navigator.clipboard?.writeText(`Posiedzenia Prezydium, ${address}\nLogin ${issued.username}\nHasło tymczasowe ${issued.password}`).then(() => setCopied(true)).catch(() => {}); }}>{copied ? 'Skopiowano' : 'Kopiuj dane'}</Button>
      </div>
    </Modal>}
  </>;
}

function AccountTable(props: {label: string; children: ComponentChildren}) {
  // Role ARIA powtarzają znaczenie tabeli, bo do 560 px wiersze mają układ bloków (lista.css).
  return <div class="oi-table-wrap"><table class="oi-table account-table" role="table" aria-label={props.label}>
    <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Osoba</th><th scope="col" role="columnheader">Rola w aplikacji</th><th scope="col" role="columnheader">Login</th><th scope="col" role="columnheader">Stan</th><th scope="col" role="columnheader" class="account-act">Działanie</th></tr></thead>
    <tbody role="rowgroup">{props.children}</tbody>
  </table></div>;
}

// Wiersz konta: stan słowem (znacznik tylko przy wyjątku), uprawnienia jako tekst i jeden przycisk w kolumnie „Działanie”.
function AccountRow(props: {name: string; sub: string; role?: string; a?: Account; onManage: (a: Account) => void; onCreate?: () => void}) {
  const {a} = props;
  const role = props.role ?? kinds[a?.kind ?? 'czlonek'];
  return <tr role="row">
    <th scope="row" role="rowheader"><span class="account-name">{props.name}</span>{props.sub && <span class="account-sub">{props.sub}</span>}</th>
    <td role="cell" data-label="Rola w aplikacji"><span class="account-state"><span>{role}</span>{a?.admin && <span class="account-sub">Administrator</span>}</span></td>
    <td role="cell">{a ? <code>{a.username}</code> : <span class="muted">–</span>}</td>
    <td role="cell">{a ? <span class="account-state">{accountChip(a) ? <StateChip state={accountChip(a)}/> : <span>Aktywne</span>}</span> : <span class="muted">Brak konta</span>}</td>
    <td role="cell" class="account-act">{a
      ? <Button small haspopup label={`Zarządzaj kontem, ${props.name}`} onClick={() => props.onManage(a)}>Zarządzaj kontem</Button>
      : props.onCreate && <Button small haspopup label={`Utwórz konto, ${props.name}`} onClick={props.onCreate}>Utwórz konto</Button>}</td>
  </tr>;
}

// Okno „Zarządzanie kontem”: fakty o koncie i trzy działania z opisem skutku. Blokada i nadanie uprawnień wymagają potwierdzenia.
function ManageAccount(props: {a: Account; name: string; self: boolean; busy: boolean; error: string; errorKind: ErrorKind; onPatch: (body: object) => void; onReset: () => void; onClose: () => void}) {
  const {a} = props;
  const [asking, setAsking] = useState<'blokada' | 'admin' | null>(null);
  return <Modal title="Zarządzanie kontem" onClose={props.onClose}>
    <dl class="facts"><Fact label="Imię i nazwisko">{props.name}</Fact><Fact label="Rola w aplikacji">{kinds[a.kind]}</Fact><Fact label="Login"><code>{a.username}</code></Fact><Fact label="Stan">{stateWord(a)}</Fact><Fact label="Uprawnienia">{a.admin ? 'Administrator' : 'Bez uprawnień administratora'}</Fact></dl>
    {a.kind === 'gosc' && <p class="small">Gość widzi posiedzenia, na które go zaproszono, i czyta kanał wiadomości.</p>}
    {props.error && <ErrorNotice kind={props.errorKind}>{props.error}</ErrorNotice>}
    <ul class="manage-list">
      <li><Button small haspopup onClick={props.onReset}>Nadaj nowe hasło tymczasowe</Button><p class="muted small">Osoba zostanie wylogowana na wszystkich urządzeniach. Przy następnym logowaniu ustawi własne hasło.</p></li>
      {props.self ? <li><p class="small">Własnego konta nie można zablokować ani odebrać sobie uprawnień.</p></li> : <>
        <li>{a.disabled
          ? <><Button small busy={props.busy} onClick={() => props.onPatch({id: a.id, disabled: false})}>Odblokuj konto</Button><p class="muted small">Osoba znowu będzie mogła się zalogować.</p></>
          : <><Button small haspopup busy={props.busy} onClick={() => setAsking('blokada')}>Zablokuj konto</Button><p class="muted small">Zablokowana osoba zostanie wylogowana i nie zaloguje się, dopóki konto nie zostanie odblokowane.</p></>}</li>
        <li>{a.admin
          ? <><Button small busy={props.busy} onClick={() => props.onPatch({id: a.id, admin: false})}>Odbierz uprawnienia administratora</Button><p class="muted small">Osoba straci dostęp do sekcji „Konta i role”.</p></>
          : <><Button small haspopup busy={props.busy} onClick={() => setAsking('admin')}>Nadaj uprawnienia administratora</Button><p class="muted small">Administrator, czyli osoba, która zarządza kontami i hasłami. Ta rola nie daje uprawnień w posiedzeniach ani w ustawieniach.</p></>}</li>
      </>}
    </ul>
    {asking === 'blokada' && <Confirm title="Zablokować konto?" confirm="Zablokuj konto" focus="cancel" onClose={() => setAsking(null)} onConfirm={() => props.onPatch({id: a.id, disabled: true})}
      text={<p>{`Konto ${a.username} (${props.name}) zostanie wylogowane na wszystkich urządzeniach. Logowanie będzie możliwe dopiero po odblokowaniu. W trwającym posiedzeniu ta osoba nie będzie mogła głosować.`}</p>}/>}
    {asking === 'admin' && <Confirm title="Nadać uprawnienia administratora?" confirm="Nadaj uprawnienia" focus="cancel" onClose={() => setAsking(null)} onConfirm={() => props.onPatch({id: a.id, admin: true})}
      text={<><p>{`Konto ${a.username} (${props.name}) będzie mogło zarządzać kontami wszystkich osób, w tym hasłami. Ta rola nie daje uprawnień w posiedzeniach ani w ustawieniach.`}</p>
        {a.kind === 'czlonek' && <Notice tone="warn">Ta osoba jest członkiem organu. Administrator może nadać każdemu kontu nowe hasło, więc zwykle tę rolę ma biuro.</Notice>}</>}/>}
  </Modal>;
}

function CreateAccount(props: {kind: Account['kind']; personId?: string; councilName: string; onClose: () => void; onCreated: (list: Account[], info: {name: string; username: string; password: string}) => void}) {
  const s = useSession();
  const {busy, error, errorKind, run} = useAction();
  const name = props.personId ? s.personName(props.personId) : '';
  const [password] = useState(temporaryPassword);
  const [admin, setAdmin] = useState(false);
  const title = props.personId ? (s.roster.memberships.some(m => m.organ === 'prezydium' && m.personId === props.personId) ? 'Nowe konto członka Prezydium' : `Nowe konto członka ${props.councilName}`)
    : newAccountTitle[props.kind as Exclude<Account['kind'], 'czlonek'>];
  return <Modal title={title} onClose={props.onClose}>
    <form class="stack" onSubmit={e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const displayName = props.personId ? name : String(f.get('displayName'));
      run(async () => {
        const r = await request<{accounts: Account[]}>('/api/accounts', {body: {kind: props.kind, personId: props.personId, displayName, label: f.get('label'), username: f.get('username'), password: f.get('password'), admin}});
        props.onCreated(r.accounts, {name: displayName, username: String(f.get('username')), password: String(f.get('password'))});
      });
    }}>
      {props.personId ? <dl class="facts"><Fact label="Imię i nazwisko">{name}</Fact></dl> : <>
        <Field label={props.kind === 'biuro' ? 'Nazwa lub imię i nazwisko' : 'Imię i nazwisko'}><input name="displayName" required minLength={3} maxLength={100}/></Field>
        <Field label="Funkcja" hint={props.kind === 'doradczy' ? 'Np. Przewodnicząca Okręgowej Komisji Rewizyjnej' : undefined}><input name="label" maxLength={120}/></Field>
      </>}
      <Field label="Login" hint="Małe litery bez polskich znaków, cyfry, kropka lub myślnik."><input name="username" required minLength={3} maxLength={64} pattern="[a-z0-9._\-]{3,64}" defaultValue={name ? ascii(name) : ''} autocapitalize="none" spellcheck={false}/></Field>
      <Field label="Hasło tymczasowe" hint="Osoba zmieni je przy pierwszym logowaniu."><input name="password" required minLength={12} maxLength={200} defaultValue={password}/></Field>
      {props.kind === 'gosc' && <p class="small">Gość widzi posiedzenia, na które go zaproszono, i czyta kanał wiadomości.</p>}
      <Check name="admin" checked={admin} onChange={setAdmin}>Administrator, czyli osoba, która zarządza kontami i hasłami. Ta rola nie daje uprawnień w posiedzeniach ani w ustawieniach.</Check>
      {admin && props.kind === 'czlonek' && <Notice tone="warn">Ta osoba jest członkiem organu. Administrator może nadać każdemu kontu nowe hasło, więc zwykle tę rolę ma biuro.</Notice>}
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>Utwórz konto</Button><Button onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

function ResetPassword(props: {a: Account; name: string; onClose: () => void; onDone: (list: Account[], password: string) => void}) {
  const {busy, error, errorKind, run} = useAction();
  const [password] = useState(temporaryPassword);
  return <Modal title="Nowe hasło tymczasowe" onClose={props.onClose}>
    <form class="stack" onSubmit={e => { e.preventDefault(); const p = String(new FormData(e.currentTarget).get('password')); run(async () => { const r = await request<{accounts: Account[]}>('/api/accounts', {method: 'PATCH', body: {id: props.a.id, password: p}}); props.onDone(r.accounts, p); }); }}>
      <dl class="facts"><Fact label="Konto">{`${props.name} (${props.a.username})`}</Fact></dl>
      <p class="small">Osoba zostanie wylogowana na wszystkich urządzeniach. Przy następnym logowaniu ustawi własne hasło.</p>
      <Field label="Hasło tymczasowe"><input name="password" required minLength={12} maxLength={200} defaultValue={password}/></Field>
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>Ustaw hasło</Button><Button onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}
