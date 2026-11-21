import {useEffect, useRef, useState} from 'preact/hooks';
import {request, upload} from './api.ts';
import {useMe, useSession, type Me} from './session.ts';
import {Avatar, avatars} from './avatar.tsx';
import {brand} from './brand.ts';
import {generalNow} from './general.ts';
import {Plate} from './plate.tsx';
import {Button, CardTitle, Check, Confirm, ErrorNotice, Fact, Field, Modal, Notice, Tag, useAction, usePageTitle} from './ui.tsx';
import {dateDots, isoDayOf} from '../shared/text.ts';
import {tokens} from '../../brand/tokens/tokens.ts';
import './style/konto.css';

// „Moje konto” (SPEC-4 6.2, DB-21, B3-43, trasa #konto). Karty w kolejności 6.2: „Zdjęcie” (z oknem „Kadr zdjęcia”,
// `AvatarEditor`, B3-31), „Dane konta”, „Adres e-mail i powiadomienia”, „Moje statystyki” (tylko `canSeeOwnStats`),
// „Hasło” (`PasswordCard`), „Wylogowanie”. Dodatki D-2 (wielkość tekstu), D-3 (wylogowanie na innych urządzeniach), D-9
// („Pokazuj innym …”) i D-16 (zgoda na ekran sali) dochodzą później i nie mają tu jeszcze miejsca. `GET /api/me` tylko przy
// wejściu i po zapisie (`useMe`, K4-22). Zdjęcie trafia do pamięci zdjęć karty (`avatars.setOwn`), więc `<img>` dostaje
// wyłącznie adres `blob:` (T-4).

const roleName = (kind: string, admin: boolean) => {
  const base = ({czlonek: 'Członek organu', doradczy: 'Głos doradczy', gosc: 'Gość', biuro: 'Biuro', komunikacja: 'Komunikacja'} as Record<string, string>)[kind] ?? kind;
  return admin ? `${base}, administrator` : base;
};
/** Stan adresu słowem (6.2): „Brak adresu”, „Czeka na potwierdzenie”, „Potwierdzony {data}”, „Potwierdzony przez administratora {data}”. */
export const emailStateText = (me: Pick<Me, 'email' | 'emailState' | 'emailConfirmedAt' | 'emailConfirmedBy' | 'pendingEmail'>) =>
  me.emailState === 'potwierdzony' && me.email
    ? `${me.emailConfirmedBy === 'administrator' ? 'Potwierdzony przez administratora' : 'Potwierdzony'}${me.emailConfirmedAt ? ' ' + dateDots(isoDayOf(me.emailConfirmedAt)) : ''}`
    : me.email || me.pendingEmail ? 'Czeka na potwierdzenie' : 'Brak adresu';

const readError = (file: File) => `Tego zdjęcia przeglądarka nie odczyta. Wybierz zdjęcie JPG, PNG albo WebP.${/\.hei[cf]$/i.test(file.name) || /hei[cf]/i.test(file.type) ? ' Zdjęcie z iPhone’a dodaj z telefonu albo zapisz jako JPG.' : ''}`;
/** Dekodowanie z orientacją z EXIF (B3-31 pkt 1); w starszej przeglądarce zwykły obraz. */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    if (typeof createImageBitmap === 'function') return await createImageBitmap(file, {imageOrientation: 'from-image'});
  } catch { /* niżej druga próba */ }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch { throw new Error(readError(file)); }
  finally { URL.revokeObjectURL(url); }
}
const sizeOf = (img: ImageBitmap | HTMLImageElement) => 'naturalWidth' in img ? {w: img.naturalWidth, h: img.naturalHeight} : {w: img.width, h: img.height};
interface Crop { zoom: number; x: number; y: number }
/** Wycinek źródła: kwadrat o boku krótszego boku podzielonego przez powiększenie, przesunięty w granicach obrazu (x, y od 0 do 1). */
function cropRect(w: number, h: number, c: Crop) {
  const side = Math.min(w, h) / c.zoom;
  return {sx: (w - side) * c.x, sy: (h - side) * c.y, side};
}
function draw(g: CanvasRenderingContext2D, img: ImageBitmap | HTMLImageElement, c: Crop, out: number) {
  const {w, h} = sizeOf(img);
  const r = cropRect(w, h, c);
  g.imageSmoothingQuality = 'high';
  g.fillStyle = tokens.kolory.jasny.bialy;   // przezroczystość PNG na białym tle
  g.fillRect(0, 0, out, out);
  g.drawImage(img, r.sx, r.sy, r.side, r.side, 0, 0, out, out);
}
/** Kadr 512 × 512 w JPEG (B3-31 pkt 3). Ponowne kodowanie usuwa EXIF, GPS, XMP i komentarze. */
function jpegOf(img: ImageBitmap | HTMLImageElement, c: Crop): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  draw(canvas.getContext('2d')!, img, c, 512);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Nie udało się zapisać zdjęcia. Spróbuj jeszcze raz.')), 'image/jpeg', 0.85));
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Okno „Kadr zdjęcia” (6.2, B3-31): podgląd na `<canvas>` w kwadracie z ramką, suwaki „Powiększenie”, „Przesunięcie
 * w poziomie” i „Przesunięcie w pionie” (klawiatura i czytnik ekranu), na ekranie dotykowym także przeciąganie i rozsuwanie
 * palcami. Domyślnie środek krótszego boku.
 */
export function AvatarEditor(props: {file: File; onClose: () => void; onSave: (blob: Blob) => Promise<unknown>}) {
  const [img, setImg] = useState<ImageBitmap | HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>({zoom: 1, x: 0.5, y: 0.5});
  const {busy, error, errorKind, run} = useAction();
  const [readFail, setReadFail] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, {x: number; y: number}>());
  const pinch = useRef<{dist: number; zoom: number} | null>(null);
  useEffect(() => { decode(props.file).then(setImg).catch(e => setReadFail((e as Error).message)); }, [props.file]);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    draw(c.getContext('2d')!, img, crop, c.width);
  }, [img, crop]);
  const move = (dx: number, dy: number) => {
    if (!img || !canvas.current) return;
    const {w, h} = sizeOf(img);
    const r = cropRect(w, h, crop);
    const scale = r.side / canvas.current.getBoundingClientRect().width;
    setCrop(c => ({...c, x: w - r.side > 0 ? clamp(c.x - dx * scale / (w - r.side), 0, 1) : c.x, y: h - r.side > 0 ? clamp(c.y - dy * scale / (h - r.side), 0, 1) : c.y}));
  };
  const distance = () => { const [a, b] = [...pointers.current.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const slider = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void, text: string) =>
    <div class="crop-slider"><label>{label}<input type="range" min={min} max={max} step={step} value={value} aria-valuetext={text} onInput={e => set(Number((e.target as HTMLInputElement).value))}/></label></div>;
  return <Modal title="Kadr zdjęcia" onClose={props.onClose}>
    <div class="stack avatar-editor">
      {readFail ? <ErrorNotice>{readFail}</ErrorNotice> : <>
        <p class="small">Przeciągnij zdjęcie albo użyj suwaków. Zostanie część widoczna w ramce.</p>
        <div class="crop-frame">
          <canvas ref={canvas} width={320} height={320} class="crop-canvas" aria-hidden="true"
            onPointerDown={e => { (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY}); if (pointers.current.size === 2) pinch.current = {dist: distance(), zoom: crop.zoom}; }}
            onPointerMove={e => {
              const prev = pointers.current.get(e.pointerId);
              if (!prev) return;
              pointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
              if (pointers.current.size === 2 && pinch.current) { const z = clamp(pinch.current.zoom * distance() / pinch.current.dist, 1, 4); setCrop(c => ({...c, zoom: z})); }
              else if (pointers.current.size === 1) move(e.clientX - prev.x, e.clientY - prev.y);
            }}
            onPointerUp={e => { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null; }}
            onPointerCancel={e => { pointers.current.delete(e.pointerId); pinch.current = null; }}/>
        </div>
        {img && <fieldset class="stack-tight crop-sliders"><legend class="sr-only">Kadr zdjęcia</legend>
          {slider('Powiększenie', crop.zoom, 1, 4, 0.05, v => setCrop(c => ({...c, zoom: v})), `${Math.round(crop.zoom * 100)}%`)}
          {slider('Przesunięcie w poziomie', Math.round(crop.x * 100), 0, 100, 1, v => setCrop(c => ({...c, x: v / 100})), `${Math.round(crop.x * 100)}%`)}
          {slider('Przesunięcie w pionie', Math.round(crop.y * 100), 0, 100, 1, v => setCrop(c => ({...c, y: v / 100})), `${Math.round(crop.y * 100)}%`)}
        </fieldset>}
      </>}
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions">
        {!readFail && <Button kind="primary" busy={busy} disabled={!img} reason="Zdjęcie jeszcze się wczytuje." onClick={() => run(async () => { await props.onSave(await jpegOf(img!, crop)); })}>Zapisz zdjęcie</Button>}
        <Button kind="ghost" onClick={props.onClose}>Anuluj</Button>
      </div>
    </div>
  </Modal>;
}

/** Odnośnik do informacji o przetwarzaniu danych osobowych (K4-30), gdy biuro wpisało adres w ustawieniach poczty. */
const privacyUrl = (me: Me) => { const u = me.privacyUrl ?? generalNow()?.general.mail?.privacyUrl ?? ''; return /^https:\/\//.test(u) ? u : ''; };

function PhotoCard(props: {me: Me; onSaved: () => void}) {
  const s = useSession();
  const {busy, error, errorKind, run} = useAction();
  const [ok, setOk] = useState('');
  const [asking, setAsking] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const has = !!avatars.url(s.avatarKey) || props.me.avatar > 0;
  const removed = props.me.avatarRemoved;
  const url = privacyUrl(props.me);
  return <section class="oi-card stack account-photo" aria-labelledby="konto-zdjecie">
    <h2 class="oi-card__title" id="konto-zdjecie"><span class="oi-mark" aria-hidden="true"/><span>Zdjęcie</span></h2>
    <div class="account-photo__row">
      <Avatar personKey={s.avatarKey} name={s.name} size={160} alone/>
      <div class="stack-tight">
        <div class="actions">
          <Button haspopup busy={busy} onClick={() => picker.current?.click()}>{has ? 'Zmień zdjęcie' : 'Wybierz zdjęcie'}</Button>
          {has && <Button kind="ghost" haspopup onClick={() => setAsking(true)}>Usuń zdjęcie</Button>}
        </div>
        <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => {
          const input = e.target as HTMLInputElement, f = input.files?.[0];
          input.value = '';
          if (f) { setOk(''); setFile(f); }
        }}/>
      </div>
    </div>
    <p class="small">{`Zdjęcie jest dobrowolne. Widzą je ${s.photoCircle}, w panelu prowadzenia obrad, na liście obecności i w składzie w ustawieniach. Nie trafia do protokołu ani do innych dokumentów. Znika po zablokowaniu konta i 30 dni po zakończeniu członkostwa. Możesz je w każdej chwili zmienić albo usunąć.`}</p>
    {url && <p class="small"><a class="oi-link" href={url} target="_blank" rel="noopener noreferrer">Informacja o przetwarzaniu danych osobowych</a></p>}
    {removed && <Notice>{removed.cause === 'koniec_czlonkostwa'
      ? `Zdjęcie usunięto ${dateDots(isoDayOf(removed.at))}, 30 dni po zakończeniu członkostwa.`
      : `Zdjęcie usunięto ${dateDots(isoDayOf(removed.at))}, usunięcie przez administratora.${removed.reason ? ` Powód „${removed.reason}”.` : ''}`}</Notice>}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
    <p role="status" class="save-status">{ok}</p>
    {file && <AvatarEditor file={file} onClose={() => setFile(null)} onSave={async blob => {
      const r = await upload<{account: {avatar?: number}}>('/api/me/avatar', blob, 'PUT');
      avatars.setOwn(s.avatarKey, r.account.avatar ?? 1, blob);
      setFile(null);
      setOk('Zapisano zdjęcie.');
      props.onSaved();
    }}/>}
    {asking && <Confirm title="Usunąć zdjęcie?" text={<p>Zdjęcie zniknie z aplikacji od razu. Możesz dodać nowe w każdej chwili.</p>} confirm="Usuń zdjęcie" kind="danger" cancel="Anuluj" focus="cancel"
      onClose={() => setAsking(false)} onConfirm={() => { setAsking(false); run(async () => { await request('/api/me/avatar', {method: 'DELETE'}); avatars.remove(s.avatarKey); setOk('Usunięto zdjęcie.'); props.onSaved(); }); }}/>}
  </section>;
}

function EmailCard(props: {me: Me; onSaved: () => void}) {
  const s = useSession();
  const {busy, error, errorKind, run} = useAction();
  const [email, setEmail] = useState(props.me.pendingEmail ?? props.me.email ?? '');
  const [code, setCode] = useState('');
  const [ok, setOk] = useState('');
  const sent = !!props.me.pendingEmail;
  const comms = s.account.kind === 'komunikacja';
  // K4-21: zdanie o protokole tylko u członków organu i osób z głosem doradczym (bez kont biura i komunikacji).
  const member = !!s.personId || s.account.kind === 'doradczy';
  const prefs = props.me.prefs;
  const url = privacyUrl(props.me);
  const setPref = (key: 'postep' | 'po_posiedzeniu', on: boolean) => run(async () => { await request('/api/me/prefs', {method: 'PUT', body: {[key]: on}}); setOk('Zapisano.'); props.onSaved(); });
  return <section class="oi-card stack" aria-labelledby="konto-adres">
    <h2 class="oi-card__title" id="konto-adres"><span class="oi-mark" aria-hidden="true"/><span>Adres e-mail i powiadomienia</span></h2>
    {!props.me.mailEnabled && !brand.demo && <Notice>Aplikacja nie wysyła jeszcze wiadomości e-mail. Adres możesz wpisać już teraz, a potwierdzi go administrator albo kod, gdy poczta zacznie działać.</Notice>}
    {brand.demo && <Notice>W wersji próbnej wiadomości nie są wysyłane. Kod znajdziesz w Skrzynce (próba).</Notice>}
    <form class="stack" onSubmit={e => { e.preventDefault(); setOk(''); run(async () => {
      const r = await request<{codeSent?: boolean; message?: string}>('/api/me/email', {body: {email: email.trim()}});
      setOk(r.codeSent ? `Wysłano kod na adres ${email.trim()}. Kod jest ważny 30 minut.` : r.message ?? 'Zapisano.');
      props.onSaved();
    }); }}>
      <Field label="Adres e-mail do powiadomień" hint="Na ten adres aplikacja wyśle informacje o przygotowaniu posiedzeń i o dokumentach po posiedzeniu.">
        <input type="email" autocomplete="email" spellcheck={false} value={email} maxLength={254} onInput={e => setEmail((e.target as HTMLInputElement).value)}/>
      </Field>
      <dl class="facts"><Fact label="Stan">{emailStateText(props.me)}</Fact></dl>
      <div class="actions">
        <Button type="submit" busy={busy} disabled={!email.trim()} reason="Wpisz adres e-mail.">Wyślij kod</Button>
        {(props.me.email || props.me.pendingEmail) && <Button kind="ghost" onClick={() => { setOk(''); run(async () => { await request('/api/me/email', {body: {email: ''}}); setEmail(''); setOk('Usunięto adres.'); props.onSaved(); }); }}>Usuń adres</Button>}
      </div>
    </form>
    {sent && <form class="stack" onSubmit={e => { e.preventDefault(); setOk(''); run(async () => { await request('/api/me/email/confirm', {body: {code: code.trim()}}); setCode(''); setOk('Adres potwierdzony.'); props.onSaved(); }); }}>
      <Field label="Kod z wiadomości"><input inputMode="numeric" autocomplete="one-time-code" maxLength={6} value={code} onInput={e => setCode((e.target as HTMLInputElement).value)}/></Field>
      <div><Button type="submit" busy={busy} disabled={!code.trim()} reason="Wpisz kod z wiadomości.">Potwierdź adres</Button></div>
    </form>}
    <fieldset class="stack-tight plain-fieldset"><legend class="sr-only">Powiadomienia</legend>
      {!comms && <Check checked={prefs.postep} disabled={busy} onChange={on => setPref('postep', on)}>Informacje o przygotowaniu posiedzeń</Check>}
      <Check checked={prefs.po_posiedzeniu} disabled={busy} onChange={on => setPref('po_posiedzeniu', on)}>Dokumenty po posiedzeniu</Check>
    </fieldset>
    {member && <p class="small">Informacja o protokole do wglądu przychodzi zawsze, dopóki pełnisz funkcję w organie. Zawiadomienia o posiedzeniach przychodzą tak jak dotąd.</p>}
    <p class="small muted">Adres służy wyłącznie do wiadomości o posiedzeniach. Widzisz go Ty i administrator aplikacji. {url
      ? <>Szczegóły w <a class="oi-link" href={url} target="_blank" rel="noopener noreferrer">informacji o przetwarzaniu danych osobowych</a>.</>
      : 'Szczegóły w informacji o przetwarzaniu danych osobowych.'}</p>
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
    <p role="status" class="save-status">{ok}</p>
  </section>;
}

/** Zmiana hasła (karta „Hasło” w „Moim koncie” i ekran wymuszonej zmiany po haśle tymczasowym), bez zmian wobec wersji 3. */
export function PasswordCard(props: {forced?: boolean; onDone: () => void}) {
  const {busy, error, errorKind, run} = useAction();
  const [ok, setOk] = useState(false);
  const [show, setShow] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const repeat = useRef<HTMLInputElement>(null);
  const type = show ? 'text' : 'password';
  return <form class={props.forced ? 'oi-card login' : 'stack'} onSubmit={e => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setOk(false);
    if (f.get('password') !== f.get('repeat')) { setMismatch(true); repeat.current?.focus(); return; }
    setMismatch(false);
    run(async () => { await request('/api/password', {body: {currentPassword: f.get('current'), password: f.get('password')}}); setOk(true); form.reset(); props.onDone(); });
  }}>
    {props.forced && <><Plate big/><h1 class="app-title">Ustaw <b>własne hasło</b></h1><p>Zalogowano hasłem tymczasowym. Przed rozpoczęciem pracy ustaw własne hasło, które znasz tylko Ty.</p></>}
    <Field label={props.forced ? 'Hasło tymczasowe' : 'Obecne hasło'}><input name="current" type={type} required autocomplete="current-password"/></Field>
    <Field label="Nowe hasło" hint="Co najmniej 12 znaków."><input name="password" type={type} required minLength={12} maxLength={200} autocomplete="new-password"/></Field>
    <Field label="Powtórz nowe hasło" error={mismatch ? 'Wpisz w obu polach to samo nowe hasło.' : undefined}><input ref={repeat} name="repeat" type={type} required minLength={12} maxLength={200} autocomplete="new-password"/></Field>
    <Check checked={show} onChange={setShow}>Pokaż hasło</Check>
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
    {ok && <Notice tone="ok">Hasło zmienione.</Notice>}
    <Button kind={props.forced ? 'primary' : 'secondary'} type="submit" wide={props.forced} busy={busy}>Zapisz hasło</Button>
  </form>;
}

/** Strona „Moje konto” (#konto). */
export function AccountPage(props: {onLogout?: () => void} = {}) {
  const s = useSession();
  const {me, error, reload} = useMe();
  const [leaving, setLeaving] = useState(false);
  usePageTitle('Moje konto – Posiedzenia Prezydium');
  const label = s.membership('prezydium')?.label ?? s.account.label;
  return <div class="page page--kolumna account-page stack">
    <header class="page-head"><Tag>Konto</Tag><h1 class="app-title">Moje <b>konto</b></h1><p>Tu zmienisz zdjęcie, adres do powiadomień i hasło.</p></header>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {!me && !error && <p class="muted">Wczytywanie…</p>}
    {me && <PhotoCard me={me} onSaved={reload}/>}
    <section class="oi-card stack">
      <CardTitle level={2}>Dane konta</CardTitle>
      <dl class="facts">
        <Fact label="Imię i nazwisko">{s.name}</Fact>
        {label && label !== s.name && <Fact label="Funkcja">{label}</Fact>}
        <Fact label="Login"><code>{s.account.username}</code></Fact>
        <Fact label="Rola w aplikacji">{roleName(s.account.kind, s.account.admin)}</Fact>
      </dl>
      <p class="small">{`Błąd w danych zgłoś ${brand.officeTo}.`}</p>
    </section>
    {me && <EmailCard me={me} onSaved={reload}/>}
    {s.can.ownStats && <section class="oi-card stack">
      <CardTitle level={2}>Moje statystyki</CardTitle>
      <p>Obecność i udział w głosowaniach w wybranym okresie.</p>
      <div><a class="oi-btn oi-btn--obrys" href="#konto/statystyki"><span>Pokaż moje statystyki</span></a></div>
    </section>}
    <section class="oi-card stack">
      <CardTitle level={2}>Hasło</CardTitle>
      {brand.demo ? <p>W wersji próbnej nie ma haseł.</p> : <PasswordCard onDone={() => {}}/>}
    </section>
    {props.onLogout && <section class="oi-card stack">
      <CardTitle level={2}>Wylogowanie</CardTitle>
      <div><Button haspopup={!brand.demo} onClick={() => brand.demo ? props.onLogout!() : setLeaving(true)}>Wyloguj się</Button></div>
      {leaving && <Confirm title="Wylogować się?" confirm="Wyloguj się" focus="cancel" onClose={() => setLeaving(false)} onConfirm={() => { props.onLogout!(); }}
        text={<p>Aby wrócić, zalogujesz się ponownie loginem i hasłem. Jeśli trwa posiedzenie, do tego czasu nie oddasz głosu.</p>}/>}
    </section>}
  </div>;
}
