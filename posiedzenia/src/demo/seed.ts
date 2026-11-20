import {createMeeting} from '../shared/meeting.ts';
import {newItem} from '../shared/agenda.ts';
import {textToHtml} from '../shared/text.ts';
import type {Account, MaterialRef, MaterialType, Meeting, Presenter, Roster} from '../shared/types.ts';
import {defaultGeneral, type GeneralSettings, type SiteSettings} from '../shared/settings.ts';

// Dane fikcyjne wersji próbnej — żadna z tych osób nie istnieje.
const people: [string, string, string, string, boolean][] = [
  ['p1', 'Barbara Wiśniewska', 'przewodniczacy', 'Przewodnicząca', true],
  ['p2', 'Tomasz Lewandowski', 'wiceprzewodniczacy', 'I Wiceprzewodniczący', true],
  ['p3', 'Ewa Dąbrowska', 'wiceprzewodniczacy', 'II Wiceprzewodnicząca', true],
  ['p4', 'Marta Kaczmarek', 'sekretarz', 'Sekretarz', false],
  ['p5', 'Paweł Zieliński', 'skarbnik', 'Skarbnik', false],
  ['p6', 'Joanna Szymańska', 'czlonek', 'Członek Prezydium', false],
  ['p7', 'Agnieszka Wójcik', 'czlonek', 'Członek Prezydium', false],
];
const login = (name: string) => name.toLowerCase().replace(/[ąćęłńóśźż]/g, c => 'acelnoszz'['ąćęłńóśźż'.indexOf(c)]).replace(/\s+/g, '.');

/** Nazwy organów w wersji próbnej: fikcyjne, bez nazwy miejscowości. */
const demoForms = {
  prezydium: {genitive: 'Prezydium Okręgowej Rady (dane fikcyjne)', dative: 'Prezydium Okręgowej Rady (dane fikcyjne)', gender: 'n' as const,
    members: 'członków Prezydium', member: 'członek Prezydium', chairman: 'Przewodniczący Okręgowej Rady (dane fikcyjne)',
    regulation: 'Regulaminu Okręgowej Rady (dane fikcyjne)', regulationAct: 'załącznik do uchwały zjazdu (dane fikcyjne)'},
  rada: {genitive: 'Okręgowej Rady (dane fikcyjne)', dative: 'Okręgowej Radzie (dane fikcyjne)', gender: 'f' as const,
    members: 'członków Okręgowej Rady (dane fikcyjne)', member: 'członek Okręgowej Rady (dane fikcyjne)', chairman: 'Przewodniczący Okręgowej Rady (dane fikcyjne)',
    regulation: 'Regulaminu Okręgowej Rady (dane fikcyjne)', regulationAct: 'załącznik do uchwały zjazdu (dane fikcyjne)'},
};
/** Skład fikcyjny od początku kadencji fikcyjnej, z podstawą (wersja 3). */
const demoBasis = {kind: 'uchwala' as const, act: {organ: 'rada' as const, number: '12/I/2025', date: '2025-04-10'}};

export const demoRoster: Roster = {
  organs: [
    {code: 'prezydium', name: 'Prezydium Okręgowej Rady (dane fikcyjne)', shortName: 'Prezydium', active: true, forms: demoForms.prezydium},
    {code: 'rada', name: 'Okręgowa Rada (dane fikcyjne)', shortName: 'Rada', active: false, forms: demoForms.rada},
  ],
  persons: people.map(([id, name]) => ({id, name, sortName: name.split(' ').reverse().join(' ')})),
  memberships: people.map(([personId, , func, label, canChair], order) => ({organ: 'prezydium', personId, func: func as never, label, order, canChair, since: '2025-04-10', basis: demoBasis})),
};

/** Ustawienia ogólne wersji próbnej: miejsce i kadencja fikcyjne, dwa przykładowe rodzaje spraw, wzór „Posiedzenie zwykłe”. */
export const demoSite: SiteSettings = {place: 'Sala posiedzeń (przykład)', term: 'I kadencja 2025–2029', termNumber: 'I', protocolNumberPattern: ''};
export function demoGeneral(): GeneralSettings {
  const general = defaultGeneral(demoSite);
  general.caseTypes = [
    {id: 'prawo_wykonywania_zawodu', name: 'Stwierdzenie prawa wykonywania zawodu', docType: 'uchwala', organs: ['prezydium'], financial: false,
      keywords: ['prawa wykonywania zawodu', 'pwz'], titlePattern: 'Uchwała nr … w sprawie stwierdzenia prawa wykonywania zawodu', presenterFunc: 'sekretarz', order: 10, active: true},
    {id: 'pomoc_losowa', name: 'Pomoc w przypadkach losowych', docType: 'uchwala', organs: ['prezydium'], financial: true,
      keywords: ['zapomoga', 'zdarzenie losowe'], titlePattern: 'Uchwała nr … w sprawie przyznania zapomogi', presenterFunc: 'skarbnik', order: 20, active: true},
  ];
  return general;
}

export const demoAccounts: Account[] = [
  ...people.map(([personId, name]) => ({id: 'a-' + personId, username: login(name), kind: 'czlonek' as const, personId, displayName: name, label: '', admin: false, mustChange: false, disabled: false})),
  {id: 'a-biuro', username: 'biuro', kind: 'biuro', personId: null, displayName: 'Biuro', label: 'Obsługa posiedzeń', admin: true, mustChange: false, disabled: false},
  {id: 'a-kr', username: 'komisja.rewizyjna', kind: 'doradczy', personId: null, displayName: 'Halina Kowalczyk', label: 'Przewodnicząca Okręgowej Komisji Rewizyjnej', admin: false, mustChange: false, disabled: false},
];

const licence = (no: string, who: string, number: string) => `Uchwała nr ${no}/IX/2026
Prezydium Okręgowej Rady
z dnia 22 października 2026 r.
w sprawie stwierdzenia prawa wykonywania zawodu pielęgniarki

Na podstawie art. 3 ust. 1 ustawy z dnia 15 lipca 2011 r. o zawodach pielęgniarki i położnej uchwala się, co następuje:

§ 1
Stwierdza się prawo wykonywania zawodu pielęgniarki: ${who}, numer ${number} (dane fikcyjne).

§ 2
Uchwała wchodzi w życie z dniem podjęcia.`;

export interface DemoMaterial { ref: MaterialRef; html: string }

export function demoMeetings(now: number, newId: () => string, hash: (html: string) => string) {
  const today = new Date(now - new Date(now).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const notice = new Date(now - 9 * 86400000).toISOString().slice(0, 10);
  const materials: {meetingId: string; ref: MaterialRef; html: string}[] = [];
  const material = (meetingId: string, title: string, number: string, text: string, type: MaterialType = 'uchwala') => {
    const html = textToHtml(text);
    const ref: MaterialRef = {id: newId(), title, type, number, version: 1, hash: hash(html), size: html.length, fileId: null, fileName: null, createdAt: now};
    materials.push({meetingId, ref, html});
    return ref;
  };
  const meeting: Meeting = createMeeting({id: newId(), organ: 'prezydium', kind: 'posiedzenie', title: 'Posiedzenie Prezydium (próbne)', date: today, time: '10:00', place: 'Sala posiedzeń (przykład)', mode: 'stacjonarne', createdBy: 'Biuro', now, newId});
  meeting.noticeDate = notice;
  // Wersja 3: wzór posiedzenia i osoba z głosem doradczym zaproszona z urzędu (DA-5).
  meeting.template = {id: 'zwykle', name: 'Posiedzenie zwykłe'};
  meeting.invited = ['a-kr'];
  // Osoby przy punktach (F12): funkcje ze składu fikcyjnego, a sprawozdanie referuje osoba z głosem doradczym.
  const secretary: Presenter = {name: 'Marta Kaczmarek', role: 'Sekretarz', kind: 'referuje'};
  meeting.agenda.find(i => i.kind === 'protokol')!.presenters = [secretary];
  // Sprawy bieżące z rodzajami dokumentów ze słownika (F11): sprawozdanie i stanowisko, każde z formułą wyniku.
  const current = meeting.agenda.find(i => i.kind === 'sprawozdania')!;
  const report = material(meeting.id, 'Sprawozdanie z kontroli finansowej za III kwartał 2026 r. (przykład)', '',
    'Sprawozdanie z kontroli finansowej (dane fikcyjne)\n\n1. Kontrola objęła wydatki w III kwartale 2026 r.\n2. Nie stwierdzono nieprawidłowości.', 'sprawozdanie');
  const position = material(meeting.id, 'Stanowisko w sprawie bezpiecznej obsady dyżurów (przykład)', '',
    'Prezydium Okręgowej Rady (dane fikcyjne)\n\nPrezydium zwraca uwagę, że obsada dyżurów powinna odpowiadać potrzebom pacjentów (przykład).', 'stanowisko');
  meeting.materials.push(report, position);
  const reportItem = newItem(newId(), report.title, 'sprawa', current.id);
  reportItem.materialIds = [report.id];
  reportItem.docType = 'sprawozdanie';
  reportItem.presenters = [{name: 'Halina Kowalczyk', role: 'Przewodnicząca Okręgowej Komisji Rewizyjnej', kind: 'referuje'}];
  const positionItem = newItem(newId(), position.title, 'sprawa', current.id);
  positionItem.materialIds = [position.id];
  positionItem.docType = 'stanowisko';
  positionItem.presenters = [{name: 'Ewa Dąbrowska', role: 'II Wiceprzewodnicząca', kind: 'prowadzi'}, {name: 'Joanna Szymańska', role: 'Członek Prezydium', kind: 'referuje'}];
  meeting.agenda.splice(meeting.agenda.indexOf(current) + 1, 0, reportItem, positionItem);
  const resolutions = meeting.agenda.find(i => i.kind === 'uchwaly')!;
  const acts: [string, string, string][] = [
    ['117', 'Katarzyna Nowicka', '1170001P'], ['118', 'Magdalena Pawlak', '1180002P'], ['119', 'Natalia Michalska', '1190003P'],
  ];
  let at = meeting.agenda.indexOf(resolutions) + 1;
  for (const [no, who, number] of acts) {
    const title = `Uchwała nr ${no}/IX/2026 w sprawie stwierdzenia prawa wykonywania zawodu pielęgniarki`;
    const ref = material(meeting.id, title, `${no}/IX/2026`, licence(no, who, number));
    meeting.materials.push(ref);
    const sub = newItem(newId(), title, 'sprawa', resolutions.id);
    sub.materialIds = [ref.id];
    sub.presenters = [secretary];
    meeting.agenda.splice(at++, 0, sub);
  }
  const patronage = material(meeting.id, 'Uchwała nr 108/IX/2026 w sprawie objęcia patronatem konferencji', '108/IX/2026',
    'Prezydium Okręgowej Rady\n\n§ 1\nObejmuje się patronatem konferencję „Pielęgniarstwo 2027” (przykład).\n\n§ 2\nUchwała wchodzi w życie z dniem podjęcia.');
  meeting.materials.push(patronage);
  const sub = newItem(newId(), patronage.title, 'sprawa', resolutions.id);
  sub.materialIds = [patronage.id];
  sub.presenters = [{name: 'Tomasz Lewandowski', role: 'I Wiceprzewodniczący', kind: 'referuje'}];
  meeting.agenda.splice(at, 0, sub);

  // Wersja 3 (DA-21): bez terminu wpisanego ręcznie głosowanie trwa 24 godziny od rozpoczęcia, więc rozpoczęcie w próbie
  // nie wymaga powodu także wtedy, gdy ktoś rozpocznie je później.
  const procedure: Meeting = createMeeting({id: newId(), organ: 'prezydium', kind: 'procedura', title: 'Głosowanie między posiedzeniami (próbne)', date: today, time: '00:00', place: '', mode: 'zdalne', createdBy: 'Biuro', now, newId});
  const act = newItem(newId(), 'Uchwała nr 130/IX/2026 w sprawie delegowania przedstawicieli na szkolenie', 'sprawa');
  const ref = material(procedure.id, act.title, '130/IX/2026', 'Prezydium Okręgowej Rady\n\n§ 1\nDeleguje się dwie osoby na szkolenie regionalne (przykład).\n\n§ 2\nUchwała wchodzi w życie z dniem podjęcia.');
  procedure.materials.push(ref);
  act.materialIds = [ref.id];
  procedure.agenda.push(act);
  procedure.invited = ['a-kr'];
  return {meetings: [meeting, procedure], materials};
}
