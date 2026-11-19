import {useEffect, useId, useRef, useState} from 'preact/hooks';
import {useMeeting} from './context.ts';
import {useSession} from './session.ts';
import {Button, CardTitle, fmtTime} from './ui.tsx';

// Wspólny kanał wiadomości, czyli dwustronna komunikacja uczestników w czasie rzeczywistym (§ 14 ust. 5).
// Lista ma rolę „log”, więc czytnik ekranu odczytuje nowe wiadomości. Pole ma widoczną etykietę.
// `bare`: bez własnej karty i tytułu, gdy wiadomości stoją w zwijanej sekcji (panel prowadzenia obrad). Tam „Wyślij”
// ma obrys, bo w kolumnie panelu jest najwyżej jeden przycisk główny (np. „Wznów obrady”).
export function Messages(props: {bare?: boolean}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const [text, setText] = useState('');
  const [empty, setEmpty] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => { list.current?.scrollTo({top: list.current.scrollHeight}); }, [m.messages.length]);
  const closed = m.status === 'zakonczone';
  if (closed && !m.messages.length) return null;
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!text.trim()) { setEmpty(true); field.current?.focus(); return; }
    setEmpty(false);
    if (await send({type: 'message', text})) setText('');
  };
  const body = <>
    {m.messages.length === 0 && <p class="muted small">{m.kind === 'procedura' ? 'Tu uczestnicy mogą zadawać pytania i wyjaśniać wątpliwości w trakcie głosowania.' : 'Wiadomości widzą wszyscy uczestnicy posiedzenia.'}</p>}
    <div role="log" aria-label="Wiadomości">
      {m.messages.length > 0 && <ol class="message-list" ref={list}>
        {m.messages.map(x => <li key={x.id} class={x.author === s.account.id ? 'is-mine' : ''}><span class="message-meta">{x.authorName}, godz. {fmtTime(x.at)}</span><span class="message-text">{x.text}</span></li>)}
      </ol>}
    </div>
    {!closed && <form class="message-form" onSubmit={submit}>
      <div class={'oi-field' + (empty ? ' oi-field--blad' : '')}>
        <label class="oi-field__label" for={id}>Wiadomość do wszystkich uczestników</label>
        <div class="message-row">
          <input id={id} ref={field} class="oi-input" value={text} maxLength={1000} autocomplete="off"
            aria-invalid={empty ? 'true' : undefined} aria-describedby={empty ? `${id}-b` : undefined}
            onInput={e => { setText((e.target as HTMLInputElement).value); if (empty) setEmpty(false); }}/>
          {empty && <span class="oi-field__error message-error" id={`${id}-b`}>Wpisz treść wiadomości.</span>}
          <Button type="submit" kind={props.bare ? 'secondary' : 'primary'} busy={busy}>Wyślij</Button>
        </div>
      </div>
    </form>}
  </>;
  if (props.bare) return <div class="messages stack">{body}</div>;
  return <section class="oi-card messages">
    <div class="panel-head"><CardTitle level={2}>Wiadomości</CardTitle>{m.messages.length > 0 && <span class="oi-count">{m.messages.length}</span>}</div>
    {body}
  </section>;
}
