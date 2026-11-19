import {options} from 'preact';
import {typo} from '../shared/typo.ts';

// Polska typografia w całym interfejsie: funkcja typo() ze wspólnego kodu (tak samo działa w protokole)
// dopięta do Preact. Działa na tekście w elementach, a nie na wartościach pól, kodach ani atrybutach.
export {typo};
const skip = new Set(['code', 'pre', 'textarea', 'script', 'style', 'kbd']);

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
