import {useLayoutEffect, useRef, useState} from 'preact/hooks';
import type {Command} from '../shared/meeting.ts';
import {itemNumber} from '../shared/rules.ts';
import {docTypeById} from '../shared/doctypes.ts';
import type {AgendaItem, DocType} from '../shared/types.ts';
import {useMeeting, type ViewMeeting} from './context.ts';
import {useSession} from './session.ts';
import {Button, Confirm, Field, SaveStatus, useSaveStatus} from './ui.tsx';
import {useDocTypes} from './doctypes.ts';
import {cleanPresenters, DocTypeSelect, PresentersEditor, samePresenters} from './people.tsx';

// Formularz „Dane punktu” wspólny dla przygotowania, panelu prowadzenia obrad i kafelków projektu porządku
// (wydzielony z prep.tsx w pakiecie wstępnym A0 wersji 3; właściciel pliku: zespół C, rozdz. 6.0 specyfikacji).
// Wersja 3 (O-05, DA-8, G-10): w trakcie obrad „Co jest głosowane” zmienia tylko osoba prowadząca, zawsze z powodem do
// protokołu, a biuro widzi w „Danych punktu” tylko osoby i notatki. Rodzaj bez głosowania w punkcie, który wymaga
// głosowania, otwiera okno „Zamknąć punkt bez głosowania?”.

// Rodzaje punktów, w których nie wybiera się „Co jest głosowane” (otwarcie, przyjęcie porządku, zamknięcie).
const noDocType = new Set(['otwarcie', 'porzadek', 'zamkniecie']);

/**
 * Punkt ma projekt aktu albo rodzaj sprawy, który się głosuje (DA-8): wartość wynikająca z materiału albo z rodzaju sprawy
 * (`effective.items[id].docType`, a przy własnym wyborze wartość niżej). Ten sam warunek sprawdza domena przy zmianie.
 */
export function votedSource(m: ViewMeeting, it: AgendaItem, types: DocType[]) {
  const e = m.effective?.items[it.id]?.docType;
  const source = !e ? m.materials.find(x => it.materialIds.includes(x.id))?.type ?? null
    : it.docType ? (e.inheritedSource ? e.inherited ?? null : null) : e.via ? e.value : null;
  return !!docTypeById(types, source)?.voted;
}

/**
 * Edycja w miejscu: nazwa (przed przyjęciem porządku), „Co jest głosowane w tym punkcie” (F11) i lista „Prowadzą
 * i referują” (F12). Zapis wysyła tylko zmienione pola. `autofocus` przenosi fokus na pierwsze pole po otwarciu.
 */
export function ItemEditForm(props: {it: AgendaItem; onDone?: () => void; titleEditable?: boolean; autofocus?: boolean; onCancel?: () => void; status?: boolean}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const saved = useSaveStatus();
  const types = useDocTypes();
  const {it} = props;
  const editTitle = props.titleEditable ?? (!m.agendaAdopted && m.status !== 'zakonczone');
  const [title, setTitle] = useState(it.title);
  const [docType, setDocType] = useState(it.docType ?? '');
  const [reason, setReason] = useState('');
  const [skip, setSkip] = useState(false);
  const [presenters, setPresenters] = useState(it.presenters);
  const box = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => { if (props.autofocus !== false) box.current?.querySelector<HTMLElement>('input, select')?.focus(); }, []);
  const no = itemNumber(m.agenda, it.id);
  const live = m.status === 'trwa' || m.status === 'przerwa';
  // G-10: w trakcie obrad rodzaj sprawy zmienia osoba prowadząca; biuro go nie widzi w tym formularzu (O-05).
  const docEditable = !noDocType.has(it.kind) && (!live || (!!s.personId && m.chair.current === s.personId));
  const docChanged = docType !== (it.docType ?? '');
  const needsReason = live && docChanged;
  const chosen = docTypeById(types, docType);
  // DA-8: rodzaj bez głosowania w punkcie z projektem aktu albo z rodzajem sprawy, który się głosuje.
  const skips = live && docChanged && !!chosen && !chosen.voted && votedSource(m, it, types);
  const missing = needsReason && !reason.trim() ? 'Wpisz powód zmiany rodzaju sprawy.' : undefined;
  const save = async () => {
    const cmd: Extract<Command, {type: 'item_edit'}> = {type: 'item_edit', itemId: it.id};
    if (editTitle && title.replace(/\s+/g, ' ').trim() !== it.title) cmd.title = title;
    if (docEditable && docChanged) { cmd.docType = docType || null; if (live) cmd.reason = reason.replace(/\s+/g, ' ').trim(); }
    if (!samePresenters(presenters, it.presenters)) cmd.presenters = cleanPresenters(presenters);
    if (cmd.title === undefined && cmd.docType === undefined && cmd.presenters === undefined) { props.onDone?.(); return; }
    if (await (props.status ? saved.track(() => send(cmd)) : send(cmd))) { setReason(''); props.onDone?.(); }
  };
  return <form class="edit-form" ref={box} onSubmit={async e => {
    e.preventDefault();
    if (missing) return;
    if (skips) { setSkip(true); return; }
    await save();
  }}>
    {editTitle && <Field label={m.kind === 'procedura' ? 'Nazwa sprawy' : 'Nazwa punktu'}><input value={title} onInput={e => setTitle((e.target as HTMLInputElement).value)} maxLength={400} required/></Field>}
    {docEditable && <DocTypeSelect types={types} value={docType} onChange={setDocType} empty="Wynika z materiału"
      hint="Rodzaj decyduje o formule wyniku, np. „Uchwała podjęta”, i o tym, czy w punkcie trzeba głosować."/>}
    {docEditable && needsReason && <Field label="Powód" hint="Np. projekt zawiera stanowisko, a nie uchwałę. Powód trafi do protokołu.">
      <input value={reason} maxLength={500} required onInput={e => setReason((e.target as HTMLInputElement).value)}/>
    </Field>}
    <PresentersEditor value={presenters} onChange={setPresenters} organ={m.organ} no={no}/>
    <div class="actions"><Button small type="submit" busy={busy} disabled={!!missing} reason={missing}>{props.status ? 'Zapisz dane punktu' : 'Zapisz'}</Button>{props.onCancel && <Button small kind="ghost" quiet onClick={props.onCancel}>Anuluj</Button>}</div>
    {props.status && <SaveStatus status={saved} saved={t => `Zapisano dane punktu o godz. ${t}.`}/>}
    {skip && <Confirm title="Zamknąć punkt bez głosowania?" kind="danger" confirm="Bez głosowania" onClose={() => setSkip(false)} onConfirm={() => save()}
      text={<p>W tym punkcie nie zapadnie uchwała. Powód trafi do protokołu.</p>}/>}
  </form>;
}
