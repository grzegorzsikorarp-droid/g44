import {useLayoutEffect, useRef, useState} from 'preact/hooks';
import type {Command} from '../shared/meeting.ts';
import {itemNumber} from '../shared/rules.ts';
import type {AgendaItem} from '../shared/types.ts';
import {useMeeting} from './context.ts';
import {Button, Field, SaveStatus, useSaveStatus} from './ui.tsx';
import {useDocTypes} from './doctypes.ts';
import {cleanPresenters, DocTypeSelect, PresentersEditor, samePresenters} from './people.tsx';

// Formularz „Dane punktu” wspólny dla przygotowania, panelu prowadzenia obrad i kafelków projektu porządku
// (wydzielony z prep.tsx w pakiecie wstępnym A0 wersji 3; właściciel pliku: zespół C, rozdz. 6.0 specyfikacji).

// Rodzaje punktów, w których nie wybiera się „Co jest głosowane” (otwarcie, przyjęcie porządku, zamknięcie).
const noDocType = new Set(['otwarcie', 'porzadek', 'zamkniecie']);

/**
 * Edycja w miejscu: nazwa (przed przyjęciem porządku), „Co jest głosowane w tym punkcie” (F11) i lista „Prowadzą
 * i referują” (F12). Zapis wysyła tylko zmienione pola. `autofocus` przenosi fokus na pierwsze pole po otwarciu.
 */
export function ItemEditForm(props: {it: AgendaItem; onDone?: () => void; titleEditable?: boolean; autofocus?: boolean; onCancel?: () => void; status?: boolean}) {
  const {m, send, busy} = useMeeting();
  const saved = useSaveStatus();
  const types = useDocTypes();
  const {it} = props;
  const editTitle = props.titleEditable ?? (!m.agendaAdopted && m.status !== 'zakonczone');
  const [title, setTitle] = useState(it.title);
  const [docType, setDocType] = useState(it.docType ?? '');
  const [presenters, setPresenters] = useState(it.presenters);
  const box = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => { if (props.autofocus !== false) box.current?.querySelector<HTMLElement>('input, select')?.focus(); }, []);
  const no = itemNumber(m.agenda, it.id);
  return <form class="edit-form" ref={box} onSubmit={async e => {
    e.preventDefault();
    const cmd: Extract<Command, {type: 'item_edit'}> = {type: 'item_edit', itemId: it.id};
    if (editTitle && title.replace(/\s+/g, ' ').trim() !== it.title) cmd.title = title;
    if (docType !== (it.docType ?? '')) cmd.docType = docType || null;
    if (!samePresenters(presenters, it.presenters)) cmd.presenters = cleanPresenters(presenters);
    if (cmd.title === undefined && cmd.docType === undefined && cmd.presenters === undefined) { props.onDone?.(); return; }
    if (await (props.status ? saved.track(() => send(cmd)) : send(cmd))) props.onDone?.();
  }}>
    {editTitle && <Field label={m.kind === 'procedura' ? 'Nazwa sprawy' : 'Nazwa punktu'}><input value={title} onInput={e => setTitle((e.target as HTMLInputElement).value)} maxLength={400} required/></Field>}
    {!noDocType.has(it.kind) && <DocTypeSelect types={types} value={docType} onChange={setDocType} empty="Wynika z materiału"
      hint="Rodzaj decyduje o formule wyniku, np. „Uchwała podjęta”, i o tym, czy w punkcie trzeba głosować."/>}
    <PresentersEditor value={presenters} onChange={setPresenters} organ={m.organ} no={no}/>
    <div class="actions"><Button small type="submit" busy={busy}>{props.status ? 'Zapisz dane punktu' : 'Zapisz'}</Button>{props.onCancel && <Button small kind="ghost" quiet onClick={props.onCancel}>Anuluj</Button>}</div>
    {props.status && <SaveStatus status={saved} saved={t => `Zapisano dane punktu o godz. ${t}.`}/>}
  </form>;
}
