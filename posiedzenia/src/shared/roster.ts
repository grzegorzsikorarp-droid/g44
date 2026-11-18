import type {Membership, Organ, Person, Roster} from './types.ts';

// Skład IX kadencji 2024–2028: strona oipip.slupsk.pl (Okręgowa Rada, stan z 18.11.2026)
// oraz uchwała 40/IX/2024 ORPiP z 18.04.2024 w sprawie składu osobowego Prezydium.
const people: [string, string, string][] = [
  ['si', 'Sebastian Irzykowski', 'Irzykowski Sebastian'],
  ['ag', 'Anna Grzegorczyk', 'Grzegorczyk Anna'],
  ['jw', 'Jolanta Woźniak', 'Woźniak Jolanta'],
  ['kn', 'Krystyna Naczk', 'Naczk Krystyna'],
  ['az', 'Alina Zawadowicz', 'Zawadowicz Alina'],
  ['eo', 'Edyta Ostrowska', 'Ostrowska Edyta'],
  ['ak', 'Anna Kryczka', 'Kryczka Anna'],
  ['an', 'Agata Niewiadomska', 'Niewiadomska Agata'],
  ['ss', 'Stefania Stoppa', 'Stoppa Stefania'],
  ['kz', 'Krzysztof Ząbek', 'Ząbek Krzysztof'],
  ['is', 'Iwona Sapowicz', 'Sapowicz Iwona'],
  ['md', 'Małgorzata Dajczak', 'Dajczak Małgorzata'],
  ['mm', 'Monika Makowska', 'Makowska Monika'],
  ['ig', 'Iwona Gołębiewska', 'Gołębiewska Iwona'],
  ['rs', 'Roksana Sadowska', 'Sadowska Roksana'],
  ['as', 'Alicja Szczepanek', 'Szczepanek Alicja'],
];

export const seedOrgans: Organ[] = [
  {code: 'prezydium', name: 'Prezydium Okręgowej Rady Pielęgniarek i Położnych w Słupsku', shortName: 'Prezydium ORPiP', active: true},
  {code: 'rada', name: 'Okręgowa Rada Pielęgniarek i Położnych w Słupsku', shortName: 'ORPiP', active: false},
  {code: 'zjazd', name: 'Okręgowy Zjazd Pielęgniarek i Położnych w Słupsku', shortName: 'OZPiP', active: false},
];

export const seedPersons: Person[] = people.map(([id, name, sortName]) => ({id, name, sortName}));

const presidium: [string, Membership['func'], string, boolean][] = [
  ['si', 'przewodniczacy', 'Przewodniczący', true],
  ['ag', 'wiceprzewodniczacy', 'I Wiceprzewodnicząca', true],
  ['jw', 'wiceprzewodniczacy', 'II Wiceprzewodnicząca', true],
  ['kn', 'sekretarz', 'Sekretarz', false],
  ['az', 'skarbnik', 'Skarbnik', false],
  ['eo', 'czlonek', 'Członek Prezydium', false],
  ['ak', 'czlonek', 'Członek Prezydium', false],
];

export const seedMemberships: Membership[] = [
  ...presidium.map(([personId, func, label, canChair], order) => ({organ: 'prezydium' as const, personId, func, label, order, canChair})),
  ...people.map(([personId], order) => {
    const inPresidium = presidium.find(p => p[0] === personId);
    return {
      organ: 'rada' as const, personId, order,
      func: inPresidium ? inPresidium[1] : 'czlonek' as const,
      label: inPresidium && inPresidium[1] !== 'czlonek' ? inPresidium[2].replace(/^I+ /, '') : 'Członek ORPiP',
      canChair: inPresidium ? inPresidium[3] : false,
    };
  }),
];

export const seedRoster: Roster = {organs: seedOrgans, persons: seedPersons, memberships: seedMemberships};

export const organMembers = (roster: Roster, organ: string) =>
  roster.memberships.filter(m => m.organ === organ).sort((a, b) => a.order - b.order);
export const membership = (roster: Roster, organ: string, personId: string | null) =>
  personId ? roster.memberships.find(m => m.organ === organ && m.personId === personId) : undefined;
export const personName = (roster: Roster, personId: string | null | undefined) =>
  roster.persons.find(p => p.id === personId)?.name ?? (personId || '—');
export const organOf = (roster: Roster, code: string) => roster.organs.find(o => o.code === code);
