import {render} from 'preact';
import {App} from './app.tsx';
import {setBrand} from './brand.ts';
import './typo.ts';
import './styles.css';

setBrand({
  org: 'Okręgowa Izba Pielęgniarek i Położnych w Słupsku',
  nameplate: ['Okręgowa Izba Pielęgniarek i Położnych', 'w Słupsku'],
  logo: '/brand/logo/znak-oipip-slupsk.svg',
  organ: 'Prezydium Okręgowej Rady Pielęgniarek i Położnych w Słupsku',
  term: 'IX kadencja 2024–2028',
  meetingTitle: 'Posiedzenie Prezydium Okręgowej Rady Pielęgniarek i Położnych w Słupsku',
  procedureTitle: 'Głosowanie między posiedzeniami Prezydium Okręgowej Rady Pielęgniarek i Położnych w Słupsku',
  place: 'Siedziba Izby, ul. Poniatowskiego 4, Słupsk',
  office: 'Biuro Izby',
  officeLower: 'biuro Izby',
  officeOf: 'biura Izby',
  officeTo: 'biuru Izby',
  regulation: 'Regulaminu Okręgowej Rady Pielęgniarek i Położnych w Słupsku',
});
render(<App/>, document.getElementById('app')!);
