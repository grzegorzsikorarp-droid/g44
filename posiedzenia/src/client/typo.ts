import {options} from 'preact';

// Polska typografia w całym interfejsie (zasady językowe Izby): twarda spacja po jednoliterowych
// spójnikach i przyimkach, po „§”, „nr”, „ust.”, „pkt”, „art.” oraz między liczbą a jednostką.
// Działa na tekście w elementach, a nie na wartościach pól, kodach ani atrybutach.
const glued = /^[(„»]?([aiouwzAIOUWZ]|§|nr|Nr|ust\.|pkt|art\.|godz\.)$/;
const unit = /^(r\.|zł|min\.?|dni|godz\.|KB|MB|%|osób|osoby|osoba|głosów|głosy)/;
const skip = new Set(['code', 'pre', 'textarea', 'script', 'style', 'kbd']);

export function typo(text: string) {
  if (text.indexOf('–') > 0) text = text.replace(/(\d)–(?=\d)/g, '$1\u2060–\u2060');
  if (text.indexOf(' ') < 0) return text;
  const parts = text.split(/( +)/);
  for (let i = 0; i + 2 < parts.length; i += 2) {
    if (glued.test(parts[i]) || (/\d$/.test(parts[i]) && unit.test(parts[i + 2]))) parts[i + 1] = '\u00a0';
  }
  return parts.join('');
}

function fix(children: unknown): unknown {
  if (typeof children === 'string') return typo(children);
  if (Array.isArray(children)) return children.map(fix);
  return children;
}

const previous = options.vnode;
options.vnode = vnode => {
  if (typeof vnode.type === 'string' && !skip.has(vnode.type)) {
    const props = vnode.props as {children?: unknown};
    if (props.children !== undefined) props.children = fix(props.children);
  }
  previous?.(vnode);
};
