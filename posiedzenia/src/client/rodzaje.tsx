import {useEffect, useState} from 'preact/hooks';
import {sortedDocTypes} from '../shared/doctypes.ts';
import type {DocType} from '../shared/types.ts';
import {request} from './api.ts';
import {setDocTypes} from './doctypes.ts';
import {Button, CardTitle, Confirm, ErrorNotice, Field, Modal, Segments, StateChip, Tag, useAction} from './ui.tsx';
import {docTypeChip} from './stany.ts';

// Strona administratora „Rodzaje dokumentów” (F11, trasa #rodzaje): słownik rodzajów materiałów i spraw z formułami
// wyniku, wymogiem głosowania, kolejnością i stanem. Rodzaju użytego w materiale, punkcie albo głosowaniu nie da się
// usunąć, można go tylko wyłączyć. Głosowania zachowują formuły z chwili otwarcia, więc zmiana nie zmienia historii.

type Draft = {name: string; adopted: string; rejected: string; voted: boolean; order: string};
const draftOf = (t?: DocType, next = 10): Draft => t
  ? {name: t.name, adopted: t.adopted, rejected: t.rejected, voted: t.voted, order: String(t.order)}
  : {name: '', adopted: '', rejected: '', voted: true, order: String(next)};

export function DocTypesPage() {
  const [types, setTypes] = useState<DocType[] | null>(null);
  const {busy, error, errorKind, run} = useAction();
  const [editing, setEditing] = useState<DocType | 'nowy' | null>(null);
  const [removing, setRemoving] = useState<DocType | null>(null);
  const accept = (list: DocType[]) => { setTypes(list); setDocTypes(list); };
  useEffect(() => { request<{docTypes: DocType[]}>('/api/doc-types').then(r => accept(r.docTypes)).catch(() => setTypes([])); }, []);
  const toggle = (t: DocType) => run(async () => { accept((await request<{docTypes: DocType[]}>(`/api/doc-types/${t.id}`, {method: 'PUT', body: {active: !t.active}})).docTypes); });
  const list = types ? sortedDocTypes(types) : [];
  const next = list.reduce((max, t) => Math.max(max, t.order), 0) + 10;
  return <>
    <header class="oi-hero page-head page-head--niski">
      <div class="page page--kolumna oi-hero__in">
        <Tag>Administracja</Tag>
        <h1>Rodzaje <b>dokumentów</b></h1>
        <p class="oi-hero__lead">Rodzaj materiału albo sprawy decyduje o formule wyniku głosowania, np. „Uchwała podjęta”, i o tym, czy sprawa wymaga głosowania. Osoba prowadząca obrady wybiera rodzaj przy każdym punkcie. Rodzaju, który już użyto, nie można usunąć, tylko wyłączyć. Zakończone głosowania zachowują dawne formuły.</p>
      </div>
    </header>
    <div class="page page--kolumna stack">
      {error && !editing && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      {!types && <p class="muted">Wczytywanie…</p>}
      {types && <section class="oi-card">
        <div class="panel-head"><CardTitle level={2}>{`Słownik rodzajów (${list.length})`}</CardTitle><Button small haspopup onClick={() => setEditing('nowy')}>Dodaj rodzaj</Button></div>
        <div class="oi-table-wrap"><table class="oi-table doctype-table" role="table" aria-label="Rodzaje dokumentów">
          <thead role="rowgroup"><tr role="row">
            <th scope="col" role="columnheader">Nazwa</th><th scope="col" role="columnheader">Gdy przyjęto</th><th scope="col" role="columnheader">Gdy nie przyjęto</th>
            <th scope="col" role="columnheader">Wymaga głosowania</th><th scope="col" role="columnheader">Stan</th><th scope="col" role="columnheader" class="doctype-act">Działania</th>
          </tr></thead>
          <tbody role="rowgroup">{list.map(t => <tr role="row" key={t.id} class={t.active ? '' : 'is-off'}>
            <th scope="row" role="rowheader"><span class="account-name">{t.name}</span></th>
            <td role="cell" data-label="Gdy przyjęto">{t.adopted}</td>
            <td role="cell" data-label="Gdy nie przyjęto">{t.rejected}</td>
            <td role="cell" data-label="Wymaga głosowania">{t.voted ? 'tak' : 'nie'}</td>
            <td role="cell" data-label="Stan">{docTypeChip(t.active) ? <StateChip state={docTypeChip(t.active)}/> : <span>Włączony</span>}</td>
            <td role="cell" class="doctype-act"><span class="actions">
              <Button small haspopup label={`Zmień rodzaj ${t.name}`} onClick={() => setEditing(t)}>Zmień</Button>
              <Button kind="ghost" quiet small busy={busy} label={`${t.active ? 'Wyłącz' : 'Włącz'} rodzaj ${t.name}`} onClick={() => toggle(t)}>{t.active ? 'Wyłącz' : 'Włącz'}</Button>
              <Button kind="ghost" quiet small haspopup label={`Usuń rodzaj ${t.name}`} onClick={() => setRemoving(t)}>Usuń</Button>
            </span></td>
          </tr>)}</tbody>
        </table></div>
        <p class="muted small">Wyłączony rodzaj nie pojawia się przy nowych materiałach i punktach. Materiały i głosowania, które już go mają, zostają bez zmian.</p>
      </section>}
    </div>
    {editing && <DocTypeForm current={editing === 'nowy' ? undefined : editing} next={next} onClose={() => setEditing(null)} onSaved={list => { accept(list); setEditing(null); }}/>}
    {removing && <Confirm title="Usunąć rodzaj dokumentu?" kind="danger" confirm="Usuń rodzaj" onClose={() => setRemoving(null)}
      onConfirm={() => run(async () => { accept((await request<{docTypes: DocType[]}>(`/api/doc-types/${removing.id}`, {method: 'DELETE'})).docTypes); })}
      text={<p>{`Rodzaj „${removing.name}” zniknie ze słownika. Rodzaju, który już użyto w materiale, punkcie albo głosowaniu, nie można usunąć. Wtedy wyłącz go przyciskiem „Wyłącz”.`}</p>}/>}
  </>;
}

// Okno dodawania i zmiany rodzaju. Komunikaty błędów są te same co w API (docTypeInput).
function DocTypeForm(props: {current?: DocType; next: number; onClose: () => void; onSaved: (list: DocType[]) => void}) {
  const {busy, error, errorKind, run} = useAction();
  const [draft, setDraft] = useState(draftOf(props.current, props.next));
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft(d => ({...d, [field]: value}));
  const text = (field: 'name' | 'adopted' | 'rejected' | 'order') => (e: Event) => set(field, (e.target as HTMLInputElement).value);
  return <Modal title={props.current ? `Zmień rodzaj „${props.current.name}”` : 'Nowy rodzaj dokumentu'} onClose={props.onClose}>
    <form class="stack" onSubmit={e => {
      e.preventDefault();
      const body = {name: draft.name, adopted: draft.adopted, rejected: draft.rejected, voted: draft.voted, order: Number(draft.order)};
      run(async () => {
        const r = props.current
          ? await request<{docTypes: DocType[]}>(`/api/doc-types/${props.current.id}`, {method: 'PUT', body})
          : await request<{docTypes: DocType[]}>('/api/doc-types', {body});
        props.onSaved(r.docTypes);
      });
    }}>
      <Field label="Nazwa" hint="Np. Opinia."><input value={draft.name} onInput={text('name')} required maxLength={60}/></Field>
      <Field label="Formuła wyniku, gdy sprawę przyjęto" hint="Np. Opinia przyjęta."><input value={draft.adopted} onInput={text('adopted')} required maxLength={120}/></Field>
      <Field label="Formuła wyniku, gdy sprawy nie przyjęto" hint="Np. Opinia nie została przyjęta."><input value={draft.rejected} onInput={text('rejected')} required maxLength={120}/></Field>
      <Segments label="Wymaga głosowania" value={draft.voted ? 'tak' : 'nie'} options={[['tak', 'Tak'], ['nie', 'Nie']]} onChange={v => set('voted', v === 'tak')}
        hint="Punkt z materiałem tego rodzaju czeka na głosowanie, a zamknięcie posiedzenia bez niego wymaga powodu."/>
      <Field label="Kolejność" hint="Liczba od 0 do 9999. Rodzaj z mniejszą liczbą stoi wyżej na listach."><input type="number" min={0} max={9999} step={1} value={draft.order} onInput={text('order')} required/></Field>
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>{props.current ? 'Zapisz zmiany' : 'Dodaj rodzaj'}</Button><Button onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}
