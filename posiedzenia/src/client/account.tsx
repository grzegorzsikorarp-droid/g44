import {useState} from 'preact/hooks';
import {request, upload} from './api.ts';
import {useMe, useSession, type Me} from './session.ts';
import {Avatar, avatars} from './avatar.tsx';
import {brand} from './brand.ts';
import {Button, CardTitle, Check, Confirm, ErrorNotice, Fact, Field, Notice, Tag, useAction, usePageTitle} from './ui.tsx';
import {dateDots, isoDayOf} from '../shared/text.ts';
import {tokens} from '../../brand/tokens/tokens.ts';

// „Moje konto” (SPEC-4 6.2, trasa #konto). Pakiet D0: zamrożone API (`AccountPage` bez właściwości) i prosta działająca
// wersja kart „Zdjęcie”, „Dane konta”, „Adres e-mail i powiadomienia”, „Moje statystyki” i „Wylogowanie”. Zespół E
// dodaje okno „Kadr zdjęcia” (`AvatarEditor`, B3-31), kartę „Hasło” (dzisiejszy `PasswordCard` z app.tsx), styl
// `konto.css` i dodatki D-2, D-3, D-9, D-16. `GET /api/me` tylko przy wejściu i po zapisie (`useMe`, K4-22).

const roleName = (kind: string, admin: boolean) => {
  const base = ({czlonek: 'Członek organu', doradczy: 'Głos doradczy', gosc: 'Gość', biuro: 'Biuro', komunikacja: 'Komunikacja'} as Record<string, string>)[kind] ?? kind;
  return admin ? `${base}, administrator` : base;
};
const emailState = (me: Me) => me.emailState === 'brak' || !me.email ? 'Brak adresu'
  : me.emailState === 'potwierdzony' ? `${me.emailConfirmedBy === 'administrator' ? 'Potwierdzony przez administratora' : 'Potwierdzony'}${me.emailConfirmedAt ? ' ' + dateDots(isoDayOf(me.emailConfirmedAt)) : ''}`
  : 'Czeka na potwierdzenie';

/** Prosty kadr: środek zdjęcia jako kwadrat 512 px w JPEG (pełny kadr z suwakami dodaje zespół E w `AvatarEditor`). */
async function squareJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { throw new Error(`Tego zdjęcia przeglądarka nie odczyta. Wybierz zdjęcie JPG, PNG albo WebP.${/\.hei[cf]$/i.test(file.name) ? ' Zdjęcie z iPhone’a dodaj z telefonu albo zapisz jako JPG.' : ''}`); }
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d')!;
    g.fillStyle = tokens.kolory.jasny.bialy;
    g.fillRect(0, 0, 512, 512);
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 512, 512);
    return await new Promise<Blob>((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('Nie udało się zapisać zdjęcia.')), 'image/jpeg', 0.85));
  } finally { URL.revokeObjectURL(url); }
}

function PhotoCard(props: {me: Me; onSaved: () => void}) {
  const s = useSession();
  const {busy, error, errorKind, run} = useAction();
  const [ok, setOk] = useState('');
  const [asking, setAsking] = useState(false);
  const has = !!avatars.url(s.avatarKey) || props.me.avatar > 0;
  const removed = props.me.avatarRemoved;
  return <section class="oi-card stack account-photo">
    <CardTitle level={2}>Zdjęcie</CardTitle>
    <Avatar personKey={s.avatarKey} name={s.name} size={160} alone/>
    <div class="actions">
      <label class="oi-btn oi-btn--obrys account-file"><span>{has ? 'Zmień zdjęcie' : 'Wybierz zdjęcie'}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" disabled={busy} onChange={e => {
          const file = (e.target as HTMLInputElement).files?.[0];
          (e.target as HTMLInputElement).value = '';
          if (!file) return;
          setOk('');
          run(async () => {
            const blob = await squareJpeg(file);
            const r = await upload<{account: {avatar?: number}}>('/api/me/avatar', blob, 'PUT');
            avatars.setOwn(s.avatarKey, r.account.avatar ?? 1, blob);
            setOk('Zapisano zdjęcie.');
            props.onSaved();
          });
        }}/></label>
      {has && <Button kind="ghost" haspopup onClick={() => setAsking(true)}>Usuń zdjęcie</Button>}
    </div>
    <p class="small">Zdjęcie jest dobrowolne. Widzą je {s.photoCircle}, w panelu prowadzenia obrad, na liście obecności i w składzie w ustawieniach. Nie trafia do protokołu ani do innych dokumentów. Znika po zablokowaniu konta i 30 dni po zakończeniu członkostwa. Możesz je w każdej chwili zmienić albo usunąć.</p>
    {removed && <Notice>{`Zdjęcie usunięto ${dateDots(isoDayOf(removed.at))}, ${removed.cause === 'koniec_czlonkostwa' ? '30 dni po zakończeniu członkostwa' : 'usunięcie przez administratora'}.`}{removed.reason ? ` Powód „${removed.reason}”.` : ''}</Notice>}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
    {ok && <p role="status" class="save-status">{ok}</p>}
    {asking && <Confirm title="Usunąć zdjęcie?" text={<p>Zdjęcie zniknie z aplikacji od razu. Możesz dodać nowe w każdej chwili.</p>} confirm="Usuń zdjęcie" kind="danger" cancel="Anuluj" focus="cancel"
      onClose={() => setAsking(false)} onConfirm={() => { setAsking(false); run(async () => { await request('/api/me/avatar', {method: 'DELETE'}); avatars.remove(s.avatarKey); setOk('Usunięto zdjęcie.'); props.onSaved(); }); }}/>}
  </section>;
}

function EmailCard(props: {me: Me; onSaved: (me?: Partial<Me>) => void}) {
  const s = useSession();
  const {busy, error, errorKind, run} = useAction();
  const [email, setEmail] = useState(props.me.pendingEmail ?? props.me.email ?? '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(!!props.me.pendingEmail);
  const [ok, setOk] = useState('');
  const comms = s.account.kind === 'komunikacja';
  const member = !!s.personId || s.account.kind === 'doradczy';
  const prefs = props.me.prefs;
  const setPref = (key: 'postep' | 'po_posiedzeniu', on: boolean) => run(async () => { await request('/api/me/prefs', {method: 'PUT', body: {[key]: on}}); props.onSaved(); });
  return <section class="oi-card stack">
    <CardTitle level={2}>Adres e-mail i powiadomienia</CardTitle>
    {!props.me.mailEnabled && <Notice>Aplikacja nie wysyła jeszcze wiadomości e-mail. Adres możesz wpisać już teraz, a potwierdzi go administrator albo kod, gdy poczta zacznie działać.</Notice>}
    {brand.demo && <Notice>W wersji próbnej wiadomości nie są wysyłane. Kod znajdziesz w Skrzynce (próba).</Notice>}
    <dl class="facts"><Fact label="Stan">{emailState(props.me)}</Fact></dl>
    <Field label="Adres e-mail do powiadomień" hint="Na ten adres aplikacja wyśle informacje o przygotowaniu posiedzeń i o dokumentach po posiedzeniu.">
      <input type="email" autocomplete="email" value={email} maxLength={254} onInput={e => setEmail((e.target as HTMLInputElement).value)}/>
    </Field>
    <div class="actions">
      <Button busy={busy} onClick={() => { setOk(''); run(async () => {
        const r = await request<{codeSent?: boolean; message?: string}>('/api/me/email', {body: {email}});
        if (r.codeSent) { setSent(true); setOk(`Wysłano kod na adres ${email}. Kod jest ważny 30 minut.`); } else if (r.message) setOk(r.message);
        props.onSaved();
      }); }}>Wyślij kod</Button>
      {props.me.email && <Button kind="ghost" onClick={() => run(async () => { await request('/api/me/email', {body: {email: ''}}); setEmail(''); setSent(false); props.onSaved(); })}>Usuń adres</Button>}
    </div>
    {sent && <form class="stack" onSubmit={e => { e.preventDefault(); run(async () => { await request('/api/me/email/confirm', {body: {code}}); setCode(''); setSent(false); setOk('Adres potwierdzony.'); props.onSaved(); }); }}>
      <Field label="Kod z wiadomości"><input inputMode="numeric" autocomplete="one-time-code" maxLength={7} value={code} onInput={e => setCode((e.target as HTMLInputElement).value)}/></Field>
      <div><Button type="submit" busy={busy}>Potwierdź adres</Button></div>
    </form>}
    {!comms && <Check checked={prefs.postep} onChange={on => setPref('postep', on)}>Informacje o przygotowaniu posiedzeń</Check>}
    <Check checked={prefs.po_posiedzeniu} onChange={on => setPref('po_posiedzeniu', on)}>Dokumenty po posiedzeniu</Check>
    {member && <p class="small">Informacja o protokole do wglądu przychodzi zawsze, dopóki pełnisz funkcję w organie. Zawiadomienia o posiedzeniach przychodzą tak jak dotąd.</p>}
    <p class="small muted">Adres służy wyłącznie do wiadomości o posiedzeniach. Widzisz go Ty i administrator aplikacji. Szczegóły w informacji o przetwarzaniu danych osobowych.</p>
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
    {ok && <p role="status" class="save-status">{ok}</p>}
  </section>;
}

/** Strona „Moje konto” (#konto). */
export function AccountPage(props: {onLogout?: () => void} = {}) {
  const s = useSession();
  const {me, error, reload} = useMe();
  usePageTitle('Moje konto – Posiedzenia Prezydium');
  const label = s.membership('prezydium')?.label ?? s.account.label;
  return <div class="page account-page stack">
    <header class="page-head"><Tag>Konto</Tag><h1 class="app-title">Moje <b>konto</b></h1><p>Tu zmienisz zdjęcie, adres do powiadomień i hasło.</p></header>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {me && <PhotoCard me={me} onSaved={reload}/>}
    <section class="oi-card stack">
      <CardTitle level={2}>Dane konta</CardTitle>
      <dl class="facts">
        <Fact label="Imię i nazwisko">{s.name}</Fact>
        {label && label !== s.name && <Fact label="Funkcja">{label}</Fact>}
        <Fact label="Login"><code>{s.account.username}</code></Fact>
        <Fact label="Rola w aplikacji">{roleName(s.account.kind, s.account.admin)}</Fact>
      </dl>
      <p class="small">Błąd w danych zgłoś {brand.officeTo}.</p>
    </section>
    {me && <EmailCard me={me} onSaved={reload}/>}
    {s.can.ownStats && <section class="oi-card stack">
      <CardTitle level={2}>Moje statystyki</CardTitle>
      <p>Obecność i udział w głosowaniach w wybranym okresie.</p>
      <div><a class="oi-btn oi-btn--obrys" href="#konto/statystyki"><span>Pokaż moje statystyki</span></a></div>
    </section>}
    {brand.demo && <section class="oi-card stack"><CardTitle level={2}>Hasło</CardTitle><p>W wersji próbnej nie ma haseł.</p></section>}
    {props.onLogout && <section class="oi-card stack"><CardTitle level={2}>Wylogowanie</CardTitle><div><Button onClick={props.onLogout}>Wyloguj się</Button></div></section>}
  </div>;
}
