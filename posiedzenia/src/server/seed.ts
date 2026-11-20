import type {CompositionBasis, Membership, Organ, OrganCode, OrganForms, Person, Roster} from '../shared/types.ts';
import type {SiteSettings} from '../shared/settings.ts';

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

const region = 'Pielęgniarek i Położnych w Słupsku';
const actRR = `załącznik do uchwały nr 9 Okręgowego Zjazdu Okręgowej Izby ${region} IX kadencji z dnia 22 marca 2025 r.`;
/** Nazwy organów w przypadkach do tekstów wersji 3 (Organ.forms). */
export const seedOrganForms: Record<OrganCode, OrganForms> = {
  prezydium: {
    genitive: `Prezydium Okręgowej Rady ${region}`, dative: `Prezydium Okręgowej Rady ${region}`, gender: 'n',
    members: 'członków Prezydium', member: 'członek Prezydium', chairman: `Przewodniczący Okręgowej Rady ${region}`,
    regulation: `Regulaminu Okręgowej Rady ${region}`, regulationAct: actRR,
  },
  rada: {
    genitive: `Okręgowej Rady ${region}`, dative: `Okręgowej Radzie ${region}`, gender: 'f',
    members: `członków Okręgowej Rady ${region}`, member: `członek Okręgowej Rady ${region}`, chairman: `Przewodniczący Okręgowej Rady ${region}`,
    regulation: `Regulaminu Okręgowej Rady ${region}`, regulationAct: actRR,
  },
  zjazd: {
    genitive: `Okręgowego Zjazdu ${region}`, dative: `Okręgowemu Zjazdowi ${region}`, gender: 'm',
    members: `delegatów na Okręgowy Zjazd ${region}`, member: `delegat na Okręgowy Zjazd ${region}`, chairman: `Przewodniczący Okręgowego Zjazdu ${region}`,
    regulation: `Regulaminu Okręgowego Zjazdu ${region}`, regulationAct: `załącznik do uchwały nr 8 Okręgowego Zjazdu Okręgowej Izby ${region} IX kadencji z dnia 22 marca 2025 r.`,
  },
};

export const seedOrgans: Organ[] = [
  {code: 'prezydium', name: 'Prezydium Okręgowej Rady Pielęgniarek i Położnych w Słupsku', shortName: 'Prezydium ORPiP', active: true, forms: seedOrganForms.prezydium},
  {code: 'rada', name: 'Okręgowa Rada Pielęgniarek i Położnych w Słupsku', shortName: 'ORPiP', active: false, forms: seedOrganForms.rada},
  {code: 'zjazd', name: 'Okręgowy Zjazd Pielęgniarek i Położnych w Słupsku', shortName: 'OZPiP', active: false, forms: seedOrganForms.zjazd},
];

/** Siedziba i kadencja (ustawienia ogólne wersji 3, dawniej stałe w src/client/main.tsx). */
export const seedSite: SiteSettings = {place: 'Siedziba Izby, ul. Poniatowskiego 4, Słupsk', term: 'IX kadencja 2024–2028', termNumber: 'IX', protocolNumberPattern: ''};
/** Podstawa składu Prezydium IX kadencji: uchwała 40/IX/2024 Okręgowej Rady z 18.04.2024. */
export const presidiumSince = '2024-04-18';
export const presidiumBasis: CompositionBasis = {kind: 'uchwala', act: {organ: 'rada', number: '40/IX/2024', date: '2024-04-18'}};

export const seedPersons: Person[] = people.map(([id, name, sortName]) => ({id, name, sortName}));

/** Funkcja członka Okręgowej Rady spoza Prezydium (pełna nazwa organu zamiast skrótu). */
export const councilMemberLabel = 'Członek Okręgowej Rady Pielęgniarek i Położnych w Słupsku';

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
  ...presidium.map(([personId, func, label, canChair], order) => ({organ: 'prezydium' as const, personId, func, label, order, canChair, since: presidiumSince, basis: presidiumBasis})),
  ...people.map(([personId], order) => {
    const inPresidium = presidium.find(p => p[0] === personId);
    return {
      organ: 'rada' as const, personId, order,
      func: inPresidium ? inPresidium[1] : 'czlonek' as const,
      label: inPresidium && inPresidium[1] !== 'czlonek' ? inPresidium[2].replace(/^I+ /, '') : councilMemberLabel,
      canChair: inPresidium ? inPresidium[3] : false,
    };
  }),
];

export const seedRoster: Roster = {organs: seedOrgans, persons: seedPersons, memberships: seedMemberships};

