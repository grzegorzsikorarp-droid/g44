import {render} from 'preact';
import {App} from './app.tsx';
import {setBrand} from './brand.ts';
import './styles.css';

setBrand({
  org: 'OIPiP w Słupsku', organShort: 'Prezydium ORPiP w Słupsku', organLong: 'Prezydium Okręgowej Rady Pielęgniarek i Położnych w Słupsku',
  term: 'IX kadencja 2024–2028', organAccounts: 'Prezydium ORPiP', meetingTitle: 'Posiedzenie Prezydium ORPiP',
  procedureTitle: 'Głosowanie między posiedzeniami Prezydium ORPiP', place: 'Siedziba OIPiP, ul. Poniatowskiego 4, Słupsk', office: 'Biuro Izby',
});
render(<App/>, document.getElementById('app')!);
