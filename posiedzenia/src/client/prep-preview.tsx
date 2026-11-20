import {useMeeting} from './context.ts';
import {CardTitle, Notice} from './ui.tsx';
import {AgendaList} from './meeting.tsx';
import {MaterialLink} from './reader.tsx';

// Widok członka w przygotowaniu (SPEC-4 6.5). Pakiet D0 przeniósł go bez zmian wyglądu z meeting.tsx; zespół E dodaje
// kartę „Przygotowanie posiedzenia” (`PrepCard` z workspace.tsx) i zgłoszenia. API zamrożone: `<PrepPreview/>` bez
// właściwości, posiedzenie z `useMeeting()` (MeetingCtx z meeting.tsx).
export function PrepPreview() {
  const {m} = useMeeting();
  return <div class="member">
    <Notice>Posiedzenie jest w przygotowaniu. Otworzy je przewodniczący lub wiceprzewodniczący. Wtedy na tym ekranie pojawi się potwierdzenie obecności i głosowania.</Notice>
    <section class="oi-card"><CardTitle level={2}>Projekt porządku obrad</CardTitle><AgendaList compact/></section>
    {m.materials.length > 0 && <section class="oi-card"><CardTitle level={2}>Materiały</CardTitle><div class="material-list">{m.materials.map(x => <MaterialLink key={x.id} id={x.id} version={x.version} label={x.title}/>)}</div></section>}
  </div>;
}
