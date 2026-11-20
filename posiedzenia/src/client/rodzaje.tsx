import {useState} from 'preact/hooks';
import {sortedDocTypes} from '../shared/doctypes.ts';
import {isLockedDocType, lawOf} from '../shared/law.ts';
import {FUNCS, funcLabel, type CaseType, type GeneralBundle} from '../shared/settings.ts';
import {compositionBasisText} from '../shared/settings.ts';
import {organOfCode} from '../shared/roster.ts';
import type {ActRef, DocType, Func} from '../shared/types.ts';
import {request} from './api.ts';
import {setGeneral} from './general.ts';
import {useSession} from './session.ts';
import {Button, CardTitle, Check, Confirm, ErrorNotice, Fact, Field, Modal, Segments, StateChip, useAction} from './ui.tsx';
import {docTypeChip} from './stany.ts';
import {ActFields, HistoryFold, OrganFact} from './cascade-ui.tsx';

// Sekcja „Rodzaje spraw i dokumentów” ustawień ogólnych (wersja 3, rozdz. 5.2 sekcja 6; dawniej strona #rodzaje).
// Rodzaje dokumentów (F11): formuły wyniku, wymóg głosowania i wykaz aktów; formy aktów z regulaminu zawsze wymagają
// głosowania (G-1). Rodzaje spraw: co jest głosowane i słowa, po których aplikacja proponuje rodzaj w projekcie porządku.
// Zmienia biuro; przewodniczący i wiceprzewodniczący oglądają. Słownik i rodzaje spraw przychodzą z danymi sesji.

const law = lawOf('prezydium');

export function KindsSection(props: {bundle: GeneralBundle; canEdit: boolean}) {
  const [tab, setTab] = useState<'dokumenty' | 'sprawy'>('dokumenty');
  return <div class="stack">
    <Segments label="Rodzaje" value={tab} options={[['dokumenty', 'Rodzaje dokumentów'], ['sprawy', 'Rodzaje spraw']]} onChange={setTab}/>
    {tab === 'dokumenty' ? <DocTypesPanel bundle={props.bundle} canEdit={props.canEdit}/> : <CaseTypesPanel bundle={props.bundle} canEdit={props.canEdit}/>}
    <HistoryFold key={tab} area={tab === 'dokumenty' ? 'rodzaje_dokumentow' : 'rodzaje_spraw'} version={props.bundle.revision}/>
  </div>;
}

type DocResult = {docTypes: DocType[]; general: GeneralBundle};
const accept = (r: DocResult) => setGeneral(r.general);

function DocTypesPanel(props: {bundle: GeneralBundle; canEdit: boolean}) {
  const {busy, error, errorKind, run} = useAction();
  const [editing, setEditing] = useState<DocType | 'nowy' | null>(null);
  const [removing, setRemoving] = useState<DocType | null>(null);
  const list = sortedDocTypes(props.bundle.docTypes);
  const next = list.reduce((max, t) => Math.max(max, t.order), 0) + 10;
  const toggle = (t: DocType) => run(async () => accept(await request<DocResult>(`/api/doc-types/${t.id}`, {method: 'PUT', body: {active: !t.active}})));
  return <section class="oi-card">
    <div class="panel-head"><CardTitle level={3}>{`Rodzaje dokumentów (${list.length})`}</CardTitle>{props.canEdit && <Button small haspopup onClick={() => setEditing('nowy')}>Dodaj rodzaj</Button>}</div>
    <p class="muted small">Rodzaj materiału albo sprawy decyduje o formule wyniku głosowania, np. „Uchwała podjęta”, i o tym, czy sprawa wymaga głosowania. Rodzaju, który już użyto, nie można usunąć, tylko wyłączyć. Zakończone głosowania zachowują dawne formuły.</p>
    {error && !editing && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
    <div class="oi-table-wrap"><table class="oi-table doctype-table" role="table" aria-label="Rodzaje dokumentów">
      <thead role="rowgroup"><tr role="row">
        <th scope="col" role="columnheader">Nazwa</th><th scope="col" role="columnheader">Gdy przyjęto</th><th scope="col" role="columnheader">Gdy nie przyjęto</th>
        <th scope="col" role="columnheader">Wymaga głosowania</th><th scope="col" role="columnheader">W wykazie aktów</th>
        {props.canEdit && <th scope="col" role="columnheader" class="doctype-act">Działania</th>}
      </tr></thead>
      <tbody role="rowgroup">{list.map(t => {
        const locked = isLockedDocType(t.id, law);
        return <tr role="row" key={t.id} class={t.active ? '' : 'is-off'}>
          <th scope="row" role="rowheader"><span class="account-name">{t.name}</span>{docTypeChip(t.active) && <StateChip state={docTypeChip(t.active)}/>}</th>
          <td role="cell" data-label="Gdy przyjęto">{t.adopted}</td>
          <td role="cell" data-label="Gdy nie przyjęto">{t.rejected}</td>
          <td role="cell" data-label="Wymaga głosowania">{locked ? `Tak, regulamin (${law.acts.voted[t.id]})` : t.voted ? 'Tak' : 'Nie'}</td>
          <td role="cell" data-label="W wykazie aktów">{t.inActs ? 'Tak' : 'Nie'}</td>
          {props.canEdit && <td role="cell" class="doctype-act"><span class="actions">
            {locked
              ? <Button small haspopup label={`Zmień formuły, ${t.name}`} onClick={() => setEditing(t)}>Zmień formuły</Button>
              : <>
                <Button small haspopup label={`Zmień rodzaj ${t.name}`} onClick={() => setEditing(t)}>Zmień</Button>
                <Button kind="ghost" quiet small busy={busy} label={`${t.active ? 'Wyłącz' : 'Włącz'} rodzaj ${t.name}`} onClick={() => toggle(t)}>{t.active ? 'Wyłącz' : 'Włącz'}</Button>
                <Button kind="ghost" quiet small haspopup label={`Usuń rodzaj ${t.name}`} onClick={() => setRemoving(t)}>Usuń</Button>
              </>}
          </span></td>}
        </tr>;
      })}</tbody>
    </table></div>
    <p class="muted small">Wyłączony rodzaj nie pojawia się przy nowych materiałach i punktach. Materiały i głosowania, które już go mają, zostają bez zmian.</p>
    {editing && <DocTypeForm current={editing === 'nowy' ? undefined : editing} next={next} onClose={() => setEditing(null)} onSaved={r => { accept(r); setEditing(null); }}/>}
    {removing && <Confirm title="Usunąć rodzaj dokumentu?" kind="danger" confirm="Usuń rodzaj" onClose={() => setRemoving(null)}
      onConfirm={() => run(async () => accept(await request<DocResult>(`/api/doc-types/${removing.id}`, {method: 'DELETE'})))}
      text={<p>{`Rodzaj „${removing.name}” zniknie ze słownika. Rodzaju, który już użyto w materiale, punkcie albo głosowaniu, nie można usunąć. Wtedy wyłącz go przyciskiem „Wyłącz”.`}</p>}/>}
  </section>;
}

type Draft = {name: string; adopted: string; rejected: string; voted: boolean; inActs: boolean; order: string};
const draftOf = (t?: DocType, next = 10): Draft => t
  ? {name: t.name, adopted: t.adopted, rejected: t.rejected, voted: t.voted, inActs: t.inActs, order: String(t.order)}
  : {name: '', adopted: '', rejected: '', voted: true, inActs: false, order: String(next)};

// Okno dodawania i zmiany rodzaju. Komunikaty błędów są te same co w API (docTypeInput). Forma aktu z regulaminu ma tylko
// nazwę, formuły wyniku, wykaz aktów i kolejność (G-1).
function DocTypeForm(props: {current?: DocType; next: number; onClose: () => void; onSaved: (r: DocResult) => void}) {
  const {busy, error, errorKind, run} = useAction();
  const [draft, setDraft] = useState(draftOf(props.current, props.next));
  const locked = !!props.current && isLockedDocType(props.current.id, law);
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft(d => ({...d, [field]: value}));
  const text = (field: 'name' | 'adopted' | 'rejected' | 'order') => (e: Event) => set(field, (e.target as HTMLInputElement).value);
  return <Modal title={props.current ? `Zmień rodzaj „${props.current.name}”` : 'Nowy rodzaj dokumentu'} onClose={props.onClose}>
    <form class="stack" onSubmit={e => {
      e.preventDefault();
      const body = {name: draft.name, adopted: draft.adopted, rejected: draft.rejected, inActs: draft.inActs, order: Number(draft.order), ...(locked ? {} : {voted: draft.voted})};
      run(async () => {
        const r = props.current
          ? await request<DocResult>(`/api/doc-types/${props.current.id}`, {method: 'PUT', body})
          : await request<DocResult>('/api/doc-types', {body});
        props.onSaved(r);
      });
    }}>
      {locked && <p class="small">{`${props.current!.name} zawsze wymaga głosowania (${law.acts.voted[props.current!.id]}). Możesz zmienić nazwę i brzmienie formuł wyniku.`}</p>}
      <Field label="Nazwa" hint="Np. Opinia."><input value={draft.name} onInput={text('name')} required maxLength={60}/></Field>
      <Field label="Formuła wyniku, gdy sprawę przyjęto" hint="Np. Opinia przyjęta."><input value={draft.adopted} onInput={text('adopted')} required maxLength={120}/></Field>
      <Field label="Formuła wyniku, gdy sprawy nie przyjęto" hint="Np. Opinia nie została przyjęta."><input value={draft.rejected} onInput={text('rejected')} required maxLength={120}/></Field>
      {!locked && <Segments label="Wymaga głosowania" value={draft.voted ? 'tak' : 'nie'} options={[['tak', 'Tak'], ['nie', 'Nie']]} onChange={v => set('voted', v === 'tak')}
        hint="Punkt z materiałem tego rodzaju czeka na głosowanie, a zamknięcie posiedzenia bez niego wymaga powodu."/>}
      <Segments label="W wykazie aktów protokołu" value={draft.inActs ? 'tak' : 'nie'} options={[['tak', 'Tak'], ['nie', 'Nie']]} onChange={v => set('inActs', v === 'tak')}
        hint="Rezolucje, oświadczenia, deklaracje i apele podejmuje się w trybie uchwał (§ 8 ust. 9). Zaznacz, jeśli mają stać w wykazie podjętych aktów."/>
      <Field label="Kolejność" hint="Liczba od 0 do 9999. Rodzaj z mniejszą liczbą stoi wyżej na listach."><input type="number" min={0} max={9999} step={1} value={draft.order} onInput={text('order')} required/></Field>
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>{props.current ? 'Zapisz zmiany' : 'Dodaj rodzaj'}</Button><Button onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

/** Zdanie faktów rodzaju sprawy: dokument, sprawa finansowa i słowa do rozpoznawania. */
function caseFacts(c: CaseType, types: DocType[]) {
  const doc = types.find(t => t.id === c.docType)?.name ?? c.docType;
  return [`Dokument ${doc}.`, c.financial ? 'Sprawa finansowa, podpisuje także skarbnik (§ 8 ust. 7).' : '',
    c.keywords.length ? `Rozpoznawana po słowach ${c.keywords.join(', ')}.` : 'Bez słów do rozpoznawania.', c.active ? '' : 'Wyłączony.'].filter(Boolean).join(' ');
}

function CaseTypesPanel(props: {bundle: GeneralBundle; canEdit: boolean}) {
  const {roster} = useSession();
  const [editing, setEditing] = useState<CaseType | 'nowy' | null>(null);
  const rada = organOfCode(roster, 'rada');
  const list = [...props.bundle.general.caseTypes].filter(c => c.organs.includes('prezydium')).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pl'));
  return <section class="oi-card">
    <div class="panel-head"><CardTitle level={3}>{`Rodzaje spraw (${list.length})`}</CardTitle>{props.canEdit && <Button small haspopup onClick={() => setEditing('nowy')}>Dodaj rodzaj sprawy</Button>}</div>
    <p class="muted small">Rodzaj sprawy mówi, co jest głosowane, kto podpisuje uchwałę i kto zwykle referuje. Gdy tytuł punktu w projekcie porządku obrad zawiera słowo rodzaju, aplikacja proponuje ten rodzaj w przeglądzie przed otwarciem.</p>
    {!list.length && <p class="muted">Nie ma jeszcze rodzajów spraw.</p>}
    <ul class="case-list">{list.map(c => <li key={c.id} class="case-item">
      <h4 class="case-name">{c.name}</h4>
      <p class="small">{caseFacts(c, props.bundle.docTypes)}</p>
      <dl class="facts"><Fact label="Podstawa przekazania Prezydium">{c.basis
        ? compositionBasisText({kind: 'uchwala', act: c.basis}, roster)
        : `Nie wpisano. Prezydium działa w sprawach określonych uchwałą ${rada.forms.genitive} (§ 14 ust. 1).`}</Fact></dl>
      {props.canEdit && <div><Button kind="ghost" small quiet haspopup label={`Zmień rodzaj sprawy ${c.name}`} onClick={() => setEditing(c)}>Zmień</Button></div>}
    </li>)}</ul>
    {editing && <CaseTypeForm bundle={props.bundle} current={editing === 'nowy' ? undefined : editing} onClose={() => setEditing(null)}/>}
  </section>;
}

const emptyAct = (): ActRef => ({organ: 'rada', number: '', date: ''});

// Okno rodzaju sprawy: pola w kolejności z rozdz. 5.2 sekcja 6. Podstawa przekazania jest nieobowiązkowa (DA-22).
function CaseTypeForm(props: {bundle: GeneralBundle; current?: CaseType; onClose: () => void}) {
  const {busy, error, errorKind, run} = useAction();
  const c = props.current;
  const types = sortedDocTypes(props.bundle.docTypes).filter(t => t.active || t.id === c?.docType);
  const [name, setName] = useState(c?.name ?? '');
  const [docType, setDocType] = useState(c?.docType ?? 'uchwala');
  const [words, setWords] = useState((c?.keywords ?? []).join(', '));
  const [act, setAct] = useState<ActRef>(c?.basis ?? emptyAct());
  const [financial, setFinancial] = useState(c?.financial ?? false);
  const [pattern, setPattern] = useState(c?.titlePattern ?? '');
  const [presenter, setPresenter] = useState<Func | ''>(c?.presenterFunc ?? '');
  const locked = isLockedDocType(docType, law);
  return <Modal title={c ? `Zmień rodzaj sprawy „${c.name}”` : 'Nowy rodzaj sprawy'} onClose={props.onClose}>
    <form class="stack" onSubmit={e => {
      e.preventDefault();
      const keywords = words.split(/[,;\n]+/).map(w => w.trim()).filter(Boolean);
      const basis = act.number.trim() || act.date ? act : null;
      const caseType: Partial<CaseType> = {...(c ? {id: c.id} : {}), name, docType, organs: ['prezydium'], keywords, financial, titlePattern: pattern, presenterFunc: presenter || undefined, basis: basis as ActRef | undefined};
      if (!presenter) (caseType as Record<string, unknown>).presenterFunc = '';
      if (!basis) (caseType as Record<string, unknown>).basis = null;
      run(async () => {
        const r = await request<{general: GeneralBundle}>('/api/settings', {body: {change: {area: 'rodzaje_spraw', caseType}}});
        setGeneral(r.general);
        props.onClose();
      });
    }}>
      <Field label="Nazwa" hint="Np. Pomoc w przypadkach losowych."><input value={name} onInput={e => setName((e.target as HTMLInputElement).value)} required maxLength={80}/></Field>
      <Field label="Co jest głosowane" hint={locked ? `Ta sprawa zawsze wymaga głosowania (${law.acts.voted[docType]}).` : undefined}>
        <select value={docType} onChange={e => setDocType((e.target as HTMLSelectElement).value)}>{types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      </Field>
      <OrganFact organ="prezydium"/>
      <Field label="Słowa w tytule punktu" hint="Gdy tytuł punktu zawiera jedno z tych słów, aplikacja zaproponuje ten rodzaj sprawy. Propozycję przyjmuje się w przeglądzie przed otwarciem. Np. zapomoga, zdarzenie losowe. Słowa oddziel przecinkami.">
        <input value={words} onInput={e => setWords((e.target as HTMLInputElement).value)} maxLength={450}/>
      </Field>
      <fieldset class="plain-fieldset">
        <legend class="oi-field__label">Podstawa przekazania Prezydium (nieobowiązkowa)</legend>
        <ActFields value={act} onChange={setAct}/>
      </fieldset>
      <Check checked={financial} onChange={setFinancial}>Sprawa finansowa. Uchwałę podpisuje także skarbnik, a projekt przygotowuje skarbnik (§ 8 ust. 7, § 18 ust. 2 pkt 1).</Check>
      <Field label="Wzór tytułu punktu" hint="Np. Uchwała nr … w sprawie przyznania zapomogi."><input value={pattern} onInput={e => setPattern((e.target as HTMLInputElement).value)} maxLength={200}/></Field>
      <Field label="Domyślnie referuje"><select value={presenter} onChange={e => setPresenter((e.target as HTMLSelectElement).value as Func | '')}>
        <option value="">Bez wskazania</option>{FUNCS.map(f => <option key={f} value={f}>{funcLabel(f, 'prezydium')}</option>)}
      </select></Field>
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>Zapisz rodzaj sprawy</Button><Button onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}
