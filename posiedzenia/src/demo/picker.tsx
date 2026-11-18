import {useState} from 'preact/hooks';
import {organMembers} from '../shared/roster.ts';
import type {Choice} from '../shared/types.ts';
import {request} from '../client/api.ts';
import {Button, Notice} from '../client/ui.tsx';
import type {DemoServer} from './server.ts';

// Wybór osoby w wersji próbnej — zamiast logowania. Jedna osoba sprawdza wszystkie role.
export function DemoPicker(props: {server: DemoServer; onDone: () => void}) {
  const {server} = props;
  const [note, setNote] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const state = server.state;
  const live = Object.values(state.meetings).find(m => m.status === 'trwa' || m.status === 'przerwa');
  const open = live?.ballots.find(b => b.status === 'otwarte');
  const choose = async (username: string) => { await request('/api/login', {body: {username}}); props.onDone(); };
  const members = organMembers(state.roster, 'prezydium');
  const others = state.accounts.filter(a => !a.personId && !a.disabled);
  const shortcut = (message: string) => setNote(message || 'Zrobione.');
  return <main class="center-page">
    <section class="card login demo-picker">
      <div class="login-brand"><span class="brand-mark big" aria-hidden="true">§</span><div><small>Wersja próbna</small><h1>Kim jesteś w tej próbie?</h1></div></div>
      <p>Dane są fikcyjne. Wybierz osobę, a potem w każdej chwili zmień ją przyciskiem „Zmień osobę” u góry. Tak sprawdzisz posiedzenie z perspektywy prowadzącej, członków i biura.</p>
      <div class="demo-people">
        {members.map(ms => {
          const account = state.accounts.find(a => a.personId === ms.personId)!;
          const present = live?.attendance[ms.personId] === 'obecny';
          return <button class="demo-person" onClick={() => choose(account.username)}><strong>{account.displayName}</strong><small>{ms.label}{live ? (present ? ' · obecność potwierdzona' : ' · bez potwierdzonej obecności') : ''}</small></button>;
        })}
        {others.map(a => <button class="demo-person is-other" onClick={() => choose(a.username)}><strong>{a.displayName}</strong><small>{a.kind === 'biuro' ? 'Biuro — przygotowuje posiedzenia, bez prawa głosu' : a.label}</small></button>)}
      </div>
      {live && <div class="demo-shortcuts">
        <p class="kicker">Skróty próby</p>
        <p class="small muted">Żeby nie przełączać się po kolei na siedem osób, możesz zrobić to za pozostałych.</p>
        <div class="actions">
          <Button small onClick={() => shortcut(server.everyonePresent(live.id))}>Wszyscy członkowie obecni</Button>
          {open && (['za', 'przeciw', 'wstrzymuje'] as Choice[]).map(c => <Button small onClick={() => shortcut(server.othersVote(live.id, c, null))}>{`Pozostali głosują: ${c === 'za' ? 'za' : c === 'przeciw' ? 'przeciw' : 'wstrzymują się'}`}</Button>)}
        </div>
        {note && <Notice tone="ok">{note}</Notice>}
      </div>}
      <details class="demo-help">
        <summary>Jak przeprowadzić próbne posiedzenie</summary>
        <ol>
          <li>Wybierz <strong>Barbarę Wiśniewską</strong> (Przewodnicząca), otwórz „Posiedzenie Prezydium (próbne)” i kliknij <strong>Otwórz posiedzenie</strong>.</li>
          <li>Zmień osobę na członka, otwórz posiedzenie i kliknij <strong>Potwierdzam obecność</strong> — albo użyj skrótu „Wszyscy członkowie obecni”.</li>
          <li>Wróć do Przewodniczącej: punkt 2 → <strong>Rozpocznij ten punkt</strong> → <strong>Otwórz głosowanie</strong>.</li>
          <li>Zagłosuj jako członek albo skrótem „Pozostali głosują”. Potem jako Przewodnicząca <strong>Ogłoś wynik</strong>.</li>
          <li>W uchwałach 5.1–5.4 spróbuj wniosku o głosowanie tajne i reasumpcji.</li>
        </ol>
      </details>
      {confirmReset
        ? <div class="actions"><span class="small">Usunąć wszystko i zacząć od nowa?</span><Button small kind="danger" onClick={() => { server.reset(); setConfirmReset(false); props.onDone(); }}>Tak, od nowa</Button><Button small onClick={() => setConfirmReset(false)}>Nie</Button></div>
        : <button class="link small" onClick={() => setConfirmReset(true)}>Zacznij próbę od nowa</button>}
    </section>
  </main>;
}
