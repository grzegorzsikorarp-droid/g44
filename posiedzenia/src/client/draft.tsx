import {useEffect, useLayoutEffect, useRef, useState} from 'preact/hooks';
import {itemNumber, orderedAgenda} from '../shared/rules.ts';
import type {AgendaItem} from '../shared/types.ts';
import {useMeeting} from './context.ts';
import {announce, Button, Confirm, ErrorNotice, Field, Fold, StateChip, useAction} from './ui.tsx';
import {request, type MeetingData} from './api.ts';
import {useSession} from './session.ts';
import {carriedText, waitingLiveAllowed, type Proposal} from '../shared/workspace.ts';
import {dateDotsOf} from '../shared/text.ts';
import type {Meeting} from '../shared/types.ts';
import {agendaChip} from './stany.ts';
import {ItemEditForm} from './item-form.tsx';
import {PeopleFacts} from './people.tsx';

// Projekt porządku obrad jako kafelki (F8). Gdy bieżący punkt to „Przyjęcie porządku obrad”, porządek nie jest przyjęty
// i nic się nie głosuje, osoba prowadząca obrady układa projekt: przeciąga kafelek wskaźnikiem (także palcem, bez HTML5
// drag and drop), przenosi go przyciskami „Wyżej” i „Niżej”, zmienia nazwę i osoby, dodaje punkt i podpunkt, usuwa punkt.
// Każda zmiana trafia do przebiegu obrad, a członkowie i ekran sali widzą ją przy zwykłym odświeżaniu.
// Po otwarciu posiedzenia domena przenosi tylko punkty nierozpoczęte i tylko za punkt „Przyjęcie porządku obrad”.
// Wersja 3 (D2, O-04): na spotkaniu roboczym te same kafelki działają w trybie zmian (`live`), który członkowie i ekran
// sali widzą przez całe spotkanie; „Zakończ zmiany” przywraca na ekranie sali bieżący punkt.

const fixedKinds = new Set(['otwarcie', 'porzadek', 'zamkniecie']);
/** Miejsce upuszczenia: rodzic, punkt, przed którym staje kafelek (null to koniec grupy), i wysokość kreski w liście. */
type Slot = {parentId: string | null; beforeId: string | null; y: number; same?: boolean};

export function DraftAgenda(props: {live?: {main: 'primary' | 'secondary'}}) {
  const {m, send, busy} = useMeeting();
  const box = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [subFor, setSubFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  // O-10 (dodatek): na ekranach dotykowych narzędzia kafelka pokazuje „Zmień punkt {nr}” (przy myszy: najechanie i fokus).
  const [toolsFor, setToolsFor] = useState<string | null>(null);
  const [drag, setDrag] = useState<{id: string; dy: number; slot: Slot | null} | null>(null);
  const [focusAfter, setFocusAfter] = useState<{id: string; tool: string} | null>(null);
  // Położenia w geście są liczone względem początku listy (y w liście), więc przewinięcie strony w trakcie ruchu,
  // także samoczynne przy krawędzi okna, nie przesuwa miejsc upuszczenia.
  const gesture = useRef<{id: string; startAt: number; tileTop: number; tileBottom: number; clientY: number; slots: Slot[]; frame: number} | null>(null);
  useEffect(() => () => { if (gesture.current?.frame) window.cancelAnimationFrame(gesture.current.frame); }, []);
  const items = orderedAgenda(m.agenda);
  const top = m.agenda.filter(i => !i.parentId);
  const agendaAt = top.findIndex(i => i.kind === 'porzadek');
  const rootOf = (it: AgendaItem) => it.parentId ? top.find(t => t.id === it.parentId) ?? it : it;
  const afterAgenda = (t: AgendaItem) => top.indexOf(t) > agendaAt;
  const canMove = (it: AgendaItem) => it.status === 'oczekuje' && !fixedKinds.has(it.kind) && afterAgenda(rootOf(it));
  const siblingsOf = (it: AgendaItem) => m.agenda.filter(i => i.parentId === it.parentId);
  const childrenOf = (t: AgendaItem) => m.agenda.filter(i => i.parentId === t.id);
  // Po przeniesieniu przyciskiem fokus wraca na ten sam przycisk kafelka (jeśli jest aktywny).
  useEffect(() => {
    if (!focusAfter) return;
    box.current?.querySelector<HTMLElement>(`li[data-id="${focusAfter.id}"] .${focusAfter.tool}`)?.focus();
    setFocusAfter(null);
  }, [focusAfter, m.revision]);

  // „Wyżej”: przed poprzedni punkt tej samej grupy. „Niżej”: za następny punkt, czyli przed punkt po nim albo na koniec.
  // Punkt główny nie przechodzi przed „Przyjęcie porządku obrad” ani za „Zamknięcie posiedzenia”. Pierwszy podpunkt
  // idzie „Wyżej” na koniec poprzedniego punktu głównego, a ostatni „Niżej” na początek następnego (te same miejsca,
  // co przy przeciąganiu), więc z klawiatury można przenieść podpunkt do innego punktu.
  const hosts = top.filter(t => afterAgenda(t) && !fixedKinds.has(t.kind));
  const upTarget = (it: AgendaItem) => {
    const sib = siblingsOf(it), prev = sib[sib.indexOf(it) - 1];
    if (it.parentId && !prev) {
      const host = hosts[hosts.findIndex(t => t.id === it.parentId) - 1];
      return host ? {parentId: host.id, beforeId: null} : undefined;
    }
    if (!prev || (!it.parentId && !afterAgenda(prev))) return undefined;
    return {parentId: it.parentId, beforeId: prev.id};
  };
  const downTarget = (it: AgendaItem) => {
    const sib = siblingsOf(it), next = sib[sib.indexOf(it) + 1];
    if (it.parentId && !next) {
      const at = hosts.findIndex(t => t.id === it.parentId);
      const host = at >= 0 ? hosts[at + 1] : undefined;
      return host ? {parentId: host.id, beforeId: childrenOf(host)[0]?.id ?? null} : undefined;
    }
    if (!next || (!it.parentId && next.kind === 'zamkniecie')) return undefined;
    return {parentId: it.parentId, beforeId: sib[sib.indexOf(it) + 2]?.id ?? null};
  };
  const place = async (it: AgendaItem, to: {parentId: string | null; beforeId: string | null}, tool?: string) => {
    const r = await send({type: 'item_place', itemId: it.id, parentId: to.parentId, beforeId: to.beforeId});
    if (!r) return;
    announce(`Punkt „${it.title}” przeniesiono na pozycję ${itemNumber(r.agenda, it.id)}.`);
    if (tool) setFocusAfter({id: it.id, tool});
  };

  // Miejsca upuszczenia liczone z położenia kafelków w liście w chwili chwycenia. Punkt główny staje przed innym punktem
  // głównym za „Przyjęciem porządku obrad” (z podpunktami), a podpunkt przed innym podpunktem albo na końcu punktu.
  const slotsFor = (it: AgendaItem, listTop: number): Slot[] => {
    const rect = (id: string) => box.current!.querySelector<HTMLElement>(`li[data-id="${id}"]`)!.getBoundingClientRect();
    const y = (r: DOMRect, edge: 'top' | 'bottom') => r[edge] - listTop;
    const slots: Slot[] = [];
    if (!it.parentId) {
      const others = top.filter(t => t.id !== it.id);
      const sib = top, next = sib[sib.indexOf(it) + 1];
      for (const t of others) if (afterAgenda(t)) slots.push({parentId: null, beforeId: t.id, y: y(rect(t.id), 'top'), same: next?.id === t.id});
      const last = others[others.length - 1];
      if (last && last.kind !== 'zamkniecie') {
        const tail = childrenOf(last).at(-1) ?? last;
        slots.push({parentId: null, beforeId: null, y: y(rect(tail.id), 'bottom'), same: !next});
      }
    } else {
      const sib = siblingsOf(it), next = sib[sib.indexOf(it) + 1];
      for (const t of top) {
        if (!afterAgenda(t) || fixedKinds.has(t.kind)) continue;
        const kids = childrenOf(t).filter(c => c.id !== it.id);
        for (const c of kids) slots.push({parentId: t.id, beforeId: c.id, y: y(rect(c.id), 'top'), same: t.id === it.parentId && next?.id === c.id});
        slots.push({parentId: t.id, beforeId: null, y: y(rect((kids.at(-1) ?? t).id), 'bottom'), same: t.id === it.parentId && !next});
      }
    }
    return slots;
  };
  // Górna krawędź widocznej części strony: pod przyklejonym paskiem posiedzenia i zakładkami panelu.
  const topEdge = () => Math.max(0, ...['.meeting-top', '.chair-tabs'].map(sel => {
    const el = document.querySelector<HTMLElement>(sel);
    return el && getComputedStyle(el).display !== 'none' ? el.getBoundingClientRect().bottom : 0;
  }));
  const EDGE = 60, STEP = 14;
  // Stan przeciągania z bieżącego położenia wskaźnika: kafelek idzie za wskaźnikiem, ale nie wchodzi pod pasek
  // posiedzenia ani poza dolną krawędź okna, a kreska staje w najbliższym miejscu upuszczenia.
  const follow = () => {
    const g = gesture.current;
    if (!g || !box.current) return;
    const listTop = box.current.getBoundingClientRect().top;
    const at = g.clientY - listTop;
    const slot = g.slots.reduce<Slot | null>((best, s) => !best || Math.abs(s.y - at) < Math.abs(best.y - at) ? s : best, null);
    const min = topEdge() - listTop - g.tileTop, max = window.innerHeight - listTop - g.tileBottom;
    setDrag({id: g.id, dy: Math.min(Math.max(at - g.startAt, min), Math.max(min, max)), slot});
  };
  // Przy krawędzi okna strona przewija się sama, dopóki wskaźnik tam jest.
  const autoScroll = () => {
    const g = gesture.current;
    if (!g) return;
    g.frame = 0;
    const upper = topEdge() + EDGE, lower = window.innerHeight - EDGE;
    const step = g.clientY < upper ? -STEP : g.clientY > lower ? STEP : 0;
    if (!step) return;
    const before = window.scrollY;
    window.scrollBy(0, step);
    if (window.scrollY !== before) follow();
    g.frame = window.requestAnimationFrame(autoScroll);
  };
  const grab = (e: PointerEvent, it: AgendaItem) => {
    if (busy || e.button > 0 || !box.current) return;
    e.preventDefault();
    const listTop = box.current.getBoundingClientRect().top;
    const tile = box.current.querySelector<HTMLElement>(`li[data-id="${it.id}"]`)!.getBoundingClientRect();
    const last = it.parentId ? tile : box.current.querySelector<HTMLElement>(`li[data-id="${(childrenOf(it).at(-1) ?? it).id}"]`)!.getBoundingClientRect();
    gesture.current = {id: it.id, startAt: e.clientY - listTop, tileTop: tile.top - listTop, tileBottom: last.bottom - listTop, clientY: e.clientY, slots: slotsFor(it, listTop), frame: 0};
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({id: it.id, dy: 0, slot: null});
  };
  const moveTo = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    g.clientY = e.clientY;
    follow();
    if (!g.frame) g.frame = window.requestAnimationFrame(autoScroll);
  };
  const stop = () => {
    const g = gesture.current;
    if (g?.frame) window.cancelAnimationFrame(g.frame);
    gesture.current = null;
    return g;
  };
  const drop = () => {
    const g = stop(), slot = drag?.slot;
    setDrag(null);
    const it = g ? m.agenda.find(i => i.id === g.id) : undefined;
    if (it && slot && !slot.same) place(it, slot);
  };
  const cancel = () => { stop(); setDrag(null); };

  const removed = m.agenda.find(i => i.id === removing);
  const live = props.live;
  return <section class={'oi-card draft-agenda' + (live?.main === 'primary' ? ' is-teraz' : '')} aria-labelledby="projekt-porzadku">
    <div class="panel-head"><h2 class="oi-card__title" id="projekt-porzadku"><span class="oi-mark" aria-hidden="true"/><span>Projekt porządku obrad</span></h2><StateChip state={m.working ? null : agendaChip(false)}/></div>
    {live && <div class="draft-live">
      <p class="strong">Członkowie i ekran sali widzą teraz projekt porządku.</p>
      <div><Button kind={live.main} busy={busy} onClick={() => send({type: 'present', kind: null})}>Zakończ zmiany</Button></div>
    </div>}
    <p class="muted small">Przeciągnij kafelek za napis „Przeciągnij” albo użyj przycisków „Wyżej” i „Niżej”. Członkowie i ekran sali widzą zmiany od razu, a każda zmiana trafia do przebiegu obrad. Punkty rozpoczęte i punkty przed „Przyjęciem porządku obrad” zostają na miejscu.</p>
    <div class="draft-box" ref={box}>
      <ol class="draft-list">{items.map(it => {
        const no = itemNumber(m.agenda, it.id);
        const movable = canMove(it);
        const up = movable ? upTarget(it) : undefined, down = movable ? downTarget(it) : undefined;
        // Punkt główny przesuwa się razem z podpunktami.
        const dragging = !!drag && (drag.id === it.id || drag.id === it.parentId);
        const cls = ['tile', it.parentId ? 'is-sub' : '', dragging ? 'is-dragging' : '', it.status !== 'oczekuje' ? 'is-done' : '', toolsFor === it.id || editing === it.id || subFor === it.id ? 'is-tools' : ''].filter(Boolean).join(' ');
        return <li key={it.id} data-id={it.id} class={cls} style={dragging && drag ? {transform: `translateY(${drag.dy}px)`} : undefined}>
          <div class="tile-head">
            {movable && <span class="tile-grip" aria-hidden="true" onPointerDown={e => grab(e as unknown as PointerEvent, it)}
              onPointerMove={e => moveTo(e as unknown as PointerEvent)} onPointerUp={drop} onPointerCancel={cancel}>Przeciągnij</span>}
            <span class="agenda-no">{no}</span>
            <div class="tile-main"><span class="tile-title">{it.title}</span><PeopleFacts it={it} compact/></div>
            {editing !== it.id && <Button kind="ghost" quiet small class="tile-toggle" onClick={() => setToolsFor(toolsFor === it.id ? null : it.id)}>{toolsFor === it.id ? `Ukryj narzędzia punktu ${no}` : `Zmień punkt ${no}`}</Button>}
          </div>
          {editing === it.id
            ? <ItemEditForm it={it} onDone={() => { setEditing(null); setFocusAfter({id: it.id, tool: 'tool-zmien'}); }} onCancel={() => { setEditing(null); setFocusAfter({id: it.id, tool: 'tool-zmien'}); }}/>
            : <div class="tile-tools">
              {movable && <>
                <Button kind="ghost" quiet small class="tool-wyzej" busy={busy} disabled={!up} label={`Przesuń punkt ${no} wyżej`} onClick={() => up && place(it, up, 'tool-wyzej')}>Wyżej</Button>
                <Button kind="ghost" quiet small class="tool-nizej" busy={busy} disabled={!down} label={`Przesuń punkt ${no} niżej`} onClick={() => down && place(it, down, 'tool-nizej')}>Niżej</Button>
              </>}
              <Button kind="ghost" quiet small class="tool-zmien" label={`Zmień nazwę i osoby, punkt ${no}`} onClick={() => { setSubFor(null); setEditing(it.id); }}>Zmień</Button>
              {!it.parentId && !fixedKinds.has(it.kind) && afterAgenda(it) && <Button kind="ghost" quiet small class="tool-podpunkt" label={`Dodaj podpunkt w punkcie ${no}`} onClick={() => setSubFor(subFor === it.id ? null : it.id)}>Dodaj podpunkt</Button>}
              {it.status === 'oczekuje' && !fixedKinds.has(it.kind) && <Button kind="ghost" quiet small haspopup class="tool-usun" busy={busy} label={`Usuń punkt ${no}`} onClick={() => setRemoving(it.id)}>Usuń</Button>}
            </div>}
          {subFor === it.id && editing !== it.id && <AddForm label={`Nowy podpunkt w punkcie ${no}`} button="Dodaj podpunkt" onAdd={async title => {
            if (await send({type: 'item_add', title, parentId: it.id})) { setSubFor(null); setFocusAfter({id: it.id, tool: 'tool-podpunkt'}); return true; }
            return false;
          }}/>}
        </li>;
      })}</ol>
      {drag?.slot && !drag.slot.same && <span class="drop-line" style={{top: `${drag.slot.y}px`}} aria-hidden="true"/>}
    </div>
    <AddForm label="Nowy punkt" hint="Punkt stanie przed „Zamknięciem posiedzenia”." button="Dodaj punkt" focus={false} onAdd={async title => !!(await send({type: 'item_add', title, parentId: null}))}/>
    <WaitingProposals/>
    {removed && <Confirm title="Usunąć punkt?" kind="danger" confirm="Usuń punkt" onClose={() => setRemoving(null)}
      onConfirm={() => send({type: 'item_remove', itemId: removed.id})}
      text={<p>{`Punkt ${itemNumber(m.agenda, removed.id)} „${removed.title}”${m.agenda.some(i => i.parentId === removed.id) ? ' zostanie usunięty z projektu razem z podpunktami.' : ' zostanie usunięty z projektu porządku obrad.'}`}</p>}/>}
  </section>;
}

// Dodanie punktu albo podpunktu: etykieta nad polem, przycisk obok pola (jak w przygotowaniu).
function AddForm(props: {label: string; hint?: string; button: string; focus?: boolean; onAdd: (title: string) => Promise<boolean>}) {
  const {busy} = useMeeting();
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { if (props.focus !== false) input.current?.focus(); }, []);
  return <form class="add-form draft-add" onSubmit={async e => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement, title = String(new FormData(form).get('title') ?? '');
    if (title.trim() && await props.onAdd(title)) form.reset();
  }}>
    <Field label={props.label} hint={props.hint}><input ref={input} name="title" maxLength={400} required/></Field>
    <Button small type="submit" busy={busy}>{props.button}</Button>
  </form>;
}

/**
 * Dodatek D-5 (U-44, B2-W16, D2): na spotkaniu roboczym osoba prowadząca widzi zwiniętą część „Zgłoszenia czekające ({n})”
 * ze zgłoszeniami odłożonymi, także przeniesionymi przy otwarciu. Lista ładuje się dopiero po rozwinięciu (S-25), a cichy
 * „Dodaj do projektu” zmienia projekt na żywo (`item_add`, wpis `projekt` widoczny w notatce według F8).
 */
function WaitingProposals() {
  const {m, replace} = useMeeting();
  const s = useSession();
  const {busy, error, errorKind, run} = useAction();
  const [list, setList] = useState<Proposal[] | null>(null);
  if (!waitingLiveAllowed(m as unknown as Meeting, {account: s.account, personId: s.personId, name: s.name})) return null;
  const path = `/api/meetings/${encodeURIComponent(m.id)}/czekajace`;
  const load = () => run(async () => setList((await request<{proposals: Proposal[]}>(path)).proposals));
  return <div class="draft-waiting">
    <Fold title={list ? `Zgłoszenia czekające (${list.length})` : 'Zgłoszenia czekające'} onToggle={open => { if (open && !list) load(); }}>
      {!list ? <p class="muted">Wczytywanie…</p> : !list.length ? <p class="muted">Nie ma zgłoszeń czekających na posiedzenie.</p>
        : <ul class="proposal-list">{list.map(p => <li key={p.id} class="proposal">
          <p><strong>{`„${p.title}”`}</strong></p>
          <p class="small">{`${p.byName}, ${dateDotsOf(p.at)}. ${p.justification}`}</p>
          {carriedText(p) && <p class="small muted">{carriedText(p)}</p>}
          <div><Button small kind="ghost" quiet busy={busy} label={`Dodaj do projektu zgłoszenie „${p.title}”`} onClick={() => run(async () => {
            const r = await request<{meeting: MeetingData; proposals: Proposal[]}>(path, {body: {proposalId: p.id}});
            setList(r.proposals);
            replace({meeting: r.meeting as never});
            announce(`Dodano punkt „${p.title}” do projektu porządku obrad.`);
          })}>Dodaj do projektu</Button></div>
        </li>)}</ul>}
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
    </Fold>
  </div>;
}
