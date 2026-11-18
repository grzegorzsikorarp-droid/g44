import type {Account, Ballot, Meeting, Roster} from '../shared/types.ts';
import {organMembers, organOf, personName} from '../shared/roster.ts';
import {choiceCountLabel, choiceLabel, itemNumber, orderedAgenda, quorumFor, resultLabel} from '../shared/rules.ts';
import {noticeDays} from '../shared/meeting.ts';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]!);
const zone = {timeZone: 'Europe/Warsaw'} as const;
const time = (ts?: number) => ts ? new Intl.DateTimeFormat('pl-PL', {...zone, hour: '2-digit', minute: '2-digit'}).format(ts) : '–';
const dateTime = (ts?: number) => ts ? `${new Intl.DateTimeFormat('pl-PL', {...zone, dateStyle: 'long'}).format(ts)} r., godz. ${time(ts)}` : '–';
const longDate = (iso: string) => iso ? `${new Intl.DateTimeFormat('pl-PL', {dateStyle: 'long', timeZone: 'UTC'}).format(Date.parse(iso + 'T12:00:00Z'))} r.` : '–';

function ballotBlock(m: Meeting, roster: Roster, b: Ballot) {
  const r = b.result;
  const mode = b.mode === 'jawne' ? 'jawne' : b.mode === 'imienne' ? 'imienne' : 'tajne';
  const lines = [`<p><strong>Głosowanie nr ${b.number}</strong> (${mode}${b.modeBasis ? ', ' + esc(b.modeBasis) : ''}): ${esc(b.subject)}`];
  if (b.material) lines[0] += `<br><span class="muted">Treść poddana pod głosowanie: ${esc(b.material.title)}, wersja ${b.material.version} (skrót ${b.material.hash.slice(0, 12)}).</span>`;
  if (b.reasumptionOf) {
    const original = m.ballots.find(x => x.id === b.reasumptionOf);
    lines[0] += `<br><span class="muted">Reasumpcja głosowania nr ${original?.number ?? '?'} (§ 12).</span>`;
  }
  lines[0] += '</p>';
  if (!r) return lines.join('') + '<p class="muted">Głosowanie nie zostało zakończone.</p>';
  lines.push(`<p>Uprawnionych: ${r.eligible}, uczestniczyło: ${r.participants}, oddano głosów: ${r.cast} (wymagane kworum: ${r.quorum}).<br>
    ${choiceCountLabel.za}: <strong>${r.za}</strong> · ${choiceCountLabel.przeciw}: <strong>${r.przeciw}</strong> · ${choiceCountLabel.wstrzymuje}: <strong>${r.wstrzymuje}</strong>.<br>
    Wynik: <strong>${esc(resultLabel(b))}</strong>. Głosowanie od ${time(b.openedAt)} do ${time(b.closedAt)}${b.closeReason === 'wszyscy' ? ' (zagłosowali wszyscy uprawnieni)' : b.closeReason === 'czas' ? ' (upłynął wyznaczony czas)' : ' (zamknięte przez prowadzącego)'}.</p>`);
  if (b.mode === 'imienne') {
    lines.push('<table><thead><tr><th>Imię i nazwisko</th><th>Głos</th></tr></thead><tbody>' +
      b.eligible.map(id => `<tr><td>${esc(personName(roster, id))}</td><td>${b.votes[id] ? choiceLabel[b.votes[id]] : 'nie głosowała / nie głosował'}</td></tr>`).join('') + '</tbody></table>');
  }
  if (b.secret) lines.push(`<p class="muted">Głosowanie tajne w systemie elektronicznym: pobrano kart ${b.secret.issued.length}, oddano głosów ${b.secret.cast}. Odcisk klucza głosowania: ${esc(b.secret.fingerprint)}. System nie zapisuje powiązania między osobą a głosem.</p>`);
  if (b.supersededBy) lines.push(`<p class="muted">Wynik zastąpiony przez reasumpcję, czyli głosowanie nr ${m.ballots.find(x => x.id === b.supersededBy)?.number}.</p>`);
  return `<div class="ballot">${lines.join('')}</div>`;
}

export function minutesBody(m: Meeting, roster: Roster, accounts: Account[], generatedAt: number) {
  const organ = organOf(roster, m.organ);
  const council = (organOf(roster, 'rada')?.name ?? 'Okręgowa Rada').replace(/^Okręgowa Rada/, 'Okręgowej Rady');
  const members = organMembers(roster, m.organ);
  const procedure = m.kind === 'procedura';
  const days = noticeDays(m);
  const parts: string[] = [];
  parts.push(`<header><p class="draft">Projekt do uzupełnienia przez sekretarza</p>
    <h1>${procedure ? 'Protokół z głosowania między posiedzeniami' : 'Protokół z posiedzenia'} <b>${esc(organ?.name)}</b></h1>
    <p>${procedure ? `Głosowanie zdalne w trybie § 14 ust. 5 Regulaminu ${esc(council)}, od ${dateTime(m.openedAt)} do ${dateTime(m.closedAt ?? m.endsAt)}.` :
      `${longDate(m.date)}, godz. ${esc(m.time)} · ${m.mode === 'zdalne' ? 'posiedzenie zdalne (§ 14 ust. 5)' : 'posiedzenie stacjonarne'}${m.place ? ' · ' + esc(m.place) : ''}`}</p></header>`);
  if (!procedure) {
    parts.push(`<h2>1. Zwołanie i prowadzenie</h2><p>Zawiadomienie wysłano: ${m.noticeDate ? longDate(m.noticeDate) : 'nie wpisano'}${days !== null ? ` (${days} dni przed posiedzeniem${days < 7 ? ' – mniej niż wymagane 7 dni, § 7 ust. 1' : ''})` : ''}.</p>
      <p>Otwarcie: ${time(m.openedAt)}. Zamknięcie: ${time(m.closedAt)}.</p>
      <ul>${m.chair.changes.map(c => `<li>${time(c.at)} – prowadzi: ${esc(personName(roster, c.to))} (${esc(c.reason)})</li>`).join('')}</ul>
      ${m.chair.deputy ? `<p>Zastępstwo przewodniczącego: ${esc(personName(roster, m.chair.deputy))} – ${esc(m.chair.deputyBasis)}.</p>` : ''}`);
    const events = (who: string) => m.presenceLog.filter(e => e.who === who && !e.guest).map(e => `${e.type === 'przybycie' ? 'przybycie' : 'wyjście'} ${time(e.at)}`).join(', ');
    parts.push(`<h2>2. Lista obecności</h2><table><thead><tr><th>Imię i nazwisko</th><th>Funkcja</th><th>Obecność</th></tr></thead><tbody>` +
      members.map(ms => `<tr><td>${esc(personName(roster, ms.personId))}</td><td>${esc(ms.label)}</td><td>${events(ms.personId) || 'nieobecność'}</td></tr>`).join('') + '</tbody></table>');
    const others = m.invited.map(id => accounts.find(a => a.id === id)).filter(Boolean) as Account[];
    if (others.length) parts.push(`<p><strong>Osoby z głosem doradczym i goście:</strong> ${others.map(a => `${esc(a.displayName)}${a.label ? ` (${esc(a.label)})` : ''} – ${m.guests[a.id] && m.guests[a.id] !== 'nieobecny' ? 'obecność' : 'nieobecność'}`).join('; ')}.</p>`);
    parts.push(`<p>Skład organu: ${members.length} osób, kworum: ${quorumFor(members.length)} (§ 8 ust. 2).</p>`);
    if (m.quorumChecks.length) parts.push('<ul>' + m.quorumChecks.map(q => `<li>${time(q.at)} – ${q.present >= q.required ? 'stwierdzono kworum' : 'brak kworum'}: obecnych ${q.present}, wymagane ${q.required}.</li>`).join('') + '</ul>');
    parts.push(`<h2>3. Porządek obrad</h2><ol class="minutes-agenda">` + m.agenda.filter(i => !i.parentId).map(top => {
      const subs = m.agenda.filter(i => i.parentId === top.id);
      const flag = (i: typeof top) => `${i.addedAfterAdoption ? ' <em>(dodany po przyjęciu porządku)</em>' : ''}${i.status === 'odroczony' ? ' <em>(odroczony)</em>' : i.status === 'wycofany' ? ' <em>(wycofany)</em>' : ''}`;
      return `<li>${esc(top.title)}${flag(top)}${subs.length ? '<ol>' + subs.map(s => `<li>${esc(s.title)}${flag(s)}</li>`).join('') + '</ol>' : ''}</li>`;
    }).join('') + '</ol>' + `<p>${m.agendaAdopted ? 'Porządek obrad został przyjęty.' : 'Porządek obrad nie został przyjęty.'}</p>`);
  }
  parts.push(`<h2>${procedure ? 'Sprawy i wyniki' : '4. Przebieg obrad'}</h2>`);
  for (const it of orderedAgenda(m.agenda)) {
    const ballots = m.ballots.filter(b => b.itemId === it.id);
    if (!ballots.length && !it.note.trim() && !it.materialIds.length && procedure) continue;
    const mats = m.materials.filter(x => it.materialIds.includes(x.id));
    parts.push(`<section class="item"><h3>${itemNumber(m.agenda, it.id)}. ${esc(it.title)}</h3>` +
      (it.presenter ? `<p>Przedstawia: ${esc(it.presenter)}</p>` : '') +
      (mats.length ? `<p class="muted">Materiały: ${mats.map(x => esc(x.title)).join('; ')}.</p>` : '') +
      (it.note.trim() ? `<div class="note">${esc(it.note).replace(/\n/g, '<br>')}</div>` : '') +
      ballots.map(b => ballotBlock(m, roster, b)).join('') + '</section>');
  }
  const loose = m.ballots.filter(b => !b.itemId);
  if (loose.length) parts.push('<h3>Głosowania proceduralne</h3>' + loose.map(b => ballotBlock(m, roster, b)).join(''));
  if (m.motions.length) parts.push('<h3>Wnioski o reasumpcję (§ 12)</h3><ul>' + m.motions.map(x => {
    const b = m.ballots.find(y => y.id === x.ballotId);
    const status = {zbiera_podpisy: 'nie zebrał wymaganej liczby podpisów', zlozony: 'złożony, nie poddany pod głosowanie', glosowany: 'w głosowaniu', przyjety: 'przyjęty', odrzucony: 'odrzucony', wycofany: 'wycofany'}[x.status];
    return `<li>Dotyczy głosowania nr ${b?.number}: ${esc(x.justification)} – podpisy: ${x.signatures.map(id => esc(personName(roster, id))).join(', ')}; ${status}.</li>`;
  }).join('') + '</ul>');
  if (procedure && m.messages.length) parts.push('<h2>Wiadomości uczestników w trakcie procedury</h2><ul class="messages">' + m.messages.map(x => `<li>${dateTime(x.at)} – <strong>${esc(x.authorName)}</strong>: ${esc(x.text)}</li>`).join('') + '</ul>');
  parts.push(`<div class="signatures"><div>Przewodniczący obrad</div><div>Sekretarz</div><div>Protokolant</div></div>
    <p class="muted footer">Projekt wygenerowany z zapisu aplikacji ${dateTime(generatedAt)}. Protokół sporządza się w terminie 21 dni od zakończenia obrad; przyjmuje go Prezydium na następnym posiedzeniu (§ 13 ust. 2–3 w zw. z § 14 ust. 4).</p>`);
  return parts.join('\n');
}

export interface MinutesLook { css?: string | null; logo?: string | null; nameplate?: [string, string] | null; org?: string }

// Pełna strona do druku: ten sam arkusz stylów co aplikacja (krój, kolory i nagłówki Izby), znak Izby na górze.
export function minutesHtml(m: Meeting, roster: Roster, accounts: Account[], generatedAt: number, look: MinutesLook = {}) {
  const plate = look.logo && look.nameplate ? `<div class="oi-nameplate"><img src="${esc(look.logo)}" alt="Znak ${esc((look.org ?? '').replace(/^Okręgowa Izba/, 'Okręgowej Izby'))}"><p class="oi-nameplate__name">${esc(look.nameplate[0])} <b>${esc(look.nameplate[1])}</b></p></div>` : '';
  const style = look.css ? `<link rel="stylesheet" href="${esc(look.css)}">` : '<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:0 auto;padding:24px}</style>';
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Projekt protokołu – ${esc(m.title)}</title>${style}</head>
<body class="oi-root minutes-page"><div class="toolbar"><span class="kicker">Projekt protokołu</span><button type="button" class="oi-btn" data-print><span>Drukuj lub zapisz jako PDF</span></button></div>
<main>${plate}<article class="minutes-view">${minutesBody(m, roster, accounts, generatedAt)}</article></main><script src="/druk.js"></script></body></html>`;
}
