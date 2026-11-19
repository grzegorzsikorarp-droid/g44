import {createMeeting} from '../shared/meeting.ts';
import {newItem} from '../shared/agenda.ts';
import {textToHtml} from '../shared/text.ts';
import type {Account, MaterialRef, Meeting, Roster} from '../shared/types.ts';

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

export const demoRoster: Roster = {
  organs: [
    {code: 'prezydium', name: 'Prezydium Okręgowej Rady (dane fikcyjne)', shortName: 'Prezydium', active: true},
    {code: 'rada', name: 'Okręgowa Rada (dane fikcyjne)', shortName: 'Rada', active: false},
  ],
  persons: people.map(([id, name]) => ({id, name, sortName: name.split(' ').reverse().join(' ')})),
  memberships: people.map(([personId, , func, label, canChair], order) => ({organ: 'prezydium', personId, func: func as never, label, order, canChair})),
};

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
  const material = (meetingId: string, title: string, number: string, text: string) => {
    const html = textToHtml(text);
    const ref: MaterialRef = {id: newId(), title, type: 'uchwala', number, version: 1, hash: hash(html), size: html.length, fileId: null, fileName: null, createdAt: now};
    materials.push({meetingId, ref, html});
    return ref;
  };
  const meeting: Meeting = createMeeting({id: newId(), organ: 'prezydium', kind: 'posiedzenie', title: 'Posiedzenie Prezydium (próbne)', date: today, time: '10:00', place: 'Sala posiedzeń (przykład)', mode: 'stacjonarne', createdBy: 'Biuro', now, newId});
  meeting.noticeDate = notice;
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
    meeting.agenda.splice(at++, 0, sub);
  }
  const patronage = material(meeting.id, 'Uchwała nr 108/IX/2026 w sprawie objęcia patronatem konferencji', '108/IX/2026',
    'Prezydium Okręgowej Rady\n\n§ 1\nObejmuje się patronatem konferencję „Pielęgniarstwo 2027” (przykład).\n\n§ 2\nUchwała wchodzi w życie z dniem podjęcia.');
  meeting.materials.push(patronage);
  const sub = newItem(newId(), patronage.title, 'sprawa', resolutions.id);
  sub.materialIds = [patronage.id];
  meeting.agenda.splice(at, 0, sub);

  const procedure: Meeting = createMeeting({id: newId(), organ: 'prezydium', kind: 'procedura', title: 'Głosowanie między posiedzeniami (próbne)', date: today, time: '00:00', place: '', mode: 'zdalne', createdBy: 'Biuro', now, newId, endsAt: now + 4 * 3600000});
  const act = newItem(newId(), 'Uchwała nr 130/IX/2026 w sprawie delegowania przedstawicieli na szkolenie', 'sprawa');
  const ref = material(procedure.id, act.title, '130/IX/2026', 'Prezydium Okręgowej Rady\n\n§ 1\nDeleguje się dwie osoby na szkolenie regionalne (przykład).\n\n§ 2\nUchwała wchodzi w życie z dniem podjęcia.');
  procedure.materials.push(ref);
  act.materialIds = [ref.id];
  procedure.agenda.push(act);
  return {meetings: [meeting, procedure], materials};
}
