import {useEffect, useState} from 'preact/hooks';
import {request} from '../client/api.ts';
import {Fact, Fold, Notice, Segments, Tag} from '../client/ui.tsx';
import {dateDots, isoDayOf, timeOf} from '../shared/text.ts';
import type {DemoMessage} from './server.ts';

// „Skrzynka (próba)” (SPEC-4 6.7.5, B2-P18): wersja próbna nie wysyła wiadomości, tylko pokazuje, co dostałaby każda
// osoba. Wybrana osoba widzi swoje wiadomości, biuro i ekran wyboru osoby wszystkie. Tylko budowa wersji próbnej.

function Message(props: {message: DemoMessage}) {
  const {message: m} = props;
  const [view, setView] = useState<'html' | 'tekst'>('html');
  const to = m.name ? `${m.name}, ${m.address}` : m.address;
  return <li class="oi-card demo-mail">
    <h3 class="oi-card__title"><span class="oi-mark" aria-hidden="true"/><span>{m.subject}</span></h3>
    <dl class="facts">
      <Fact label="Do">{to}</Fact>
      <Fact label="Stan">{m.status === 'anulowana' ? m.error : 'Nie wysłano, wersja próbna'}</Fact>
      <Fact label="Utworzono">{dateDots(isoDayOf(m.at))}, godz. {timeOf(m.at)}</Fact>
    </dl>
    <Fold title="Podgląd">
      <Segments label="Podgląd" value={view} options={[['html', 'Wersja HTML'], ['tekst', 'Wersja tekstowa']]} onChange={setView}/>
      {view === 'html'
        ? <iframe class="demo-mail-frame" sandbox="" srcdoc={m.html} title="Podgląd wiadomości"/>
        : <pre class="demo-mail-text">{m.text}</pre>}
    </Fold>
  </li>;
}

export function DemoInbox(props: {onBack?: () => void}) {
  const [messages, setMessages] = useState<DemoMessage[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { request<{messages: DemoMessage[]}>('/api/proba/skrzynka').then(r => setMessages(r.messages)).catch(e => setError(e.message)); }, []);
  return <section class="demo-inbox stack">
    <Tag dark>Wersja próbna</Tag>
    <h1 class="app-title">Skrzynka <b>(próba)</b></h1>
    <p>Wersja próbna nie wysyła wiadomości. Tu widać, co dostałaby każda osoba.</p>
    {props.onBack && <p><a href="#" onClick={e => { e.preventDefault(); props.onBack!(); }}>Wybór osoby</a></p>}
    {error && <Notice tone="error">{error}</Notice>}
    {messages && (messages.length
      ? <ol class="demo-mails">{messages.map(m => <Message key={m.id} message={m}/>)}</ol>
      : <p class="muted">Nie ma jeszcze żadnych wiadomości.</p>)}
  </section>;
}
