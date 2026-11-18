import {useEffect, useRef, useState} from 'preact/hooks';
import {useMeeting} from './context.ts';
import {useSession} from './session.ts';
import {Button, CardTitle, fmtTime} from './ui.tsx';

// Wspólny kanał wiadomości, czyli dwustronna komunikacja uczestników w czasie rzeczywistym (§ 14 ust. 5).
export function Messages() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const [text, setText] = useState('');
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { list.current?.scrollTo({top: list.current.scrollHeight}); }, [m.messages.length]);
  const closed = m.status === 'zakonczone';
  if (closed && !m.messages.length) return null;
  return <section class="oi-card messages">
    <div class="panel-head"><CardTitle>Wiadomości</CardTitle>{m.messages.length > 0 && <span class="oi-count">{m.messages.length}</span>}</div>
    {m.messages.length === 0 && <p class="muted small">{m.kind === 'procedura' ? 'Tu uczestnicy mogą zadawać pytania i wyjaśniać wątpliwości w trakcie głosowania.' : 'Wiadomości widzą wszyscy uczestnicy posiedzenia.'}</p>}
    {m.messages.length > 0 && <ol class="message-list" ref={list}>
      {m.messages.map(x => <li class={x.author === s.account.id ? 'is-mine' : ''}><span class="message-meta">{x.authorName}, godz. {fmtTime(x.at)}</span><span class="message-text">{x.text}</span></li>)}
    </ol>}
    {!closed && <form class="inline-form" onSubmit={async e => { e.preventDefault(); if (text.trim() && await send({type: 'message', text})) setText(''); }}>
      <input class="oi-input" value={text} onInput={e => setText((e.target as HTMLInputElement).value)} maxLength={1000} placeholder="Napisz wiadomość do wszystkich…" aria-label="Wiadomość do wszystkich uczestników"/>
      <Button type="submit" kind="primary" disabled={busy || !text.trim()}>Wyślij</Button>
    </form>}
  </section>;
}
