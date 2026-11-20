import type {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {buildMessage, type Address} from './mime.ts';
import {SmtpError, SmtpSession, type SmtpOptions} from './smtp.ts';

// Skrzynka nadawcza poczty (SPEC-4 5.4, B2-P11, K4-13, K4-36; wzór proby-B2/outbox.ts) na tabelach z store.ts.
// Pracownik co 15 s, najwyżej 20 wiadomości w jednym połączeniu. Licznik prób rośnie przy przejściu do „wysylanie”,
// więc wiadomość, przy której proces pada, nie krąży bez końca: „wysylanie” starsze niż 10 minut wraca do kolejki, a po
// wyczerpaniu prób przechodzi w „blad”. Błąd przejściowy: ponowienie po 1, 5, 15, 60 i 180 minutach; błąd trwały
// odbiorcy: od razu „blad”; błąd ustawień (hasło, certyfikat, brak szyfrowania) wstrzymuje całą wysyłkę bez liczenia prób.
// Przed każdym przejściem: wiadomości posiedzeń trwających zostają w kolejce (obrona w głąb dla T-5), a informacje
// o postępie posiedzeń poza przygotowaniem dostają stan „anulowana”.

export const RETRY_MINUTES = [1, 5, 15, 60, 180];
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
export const PER_RUN = 20;
export const RUN_EVERY_MS = 15000;
export const STALE_MS = 600000;
export const KEEP_BODY_DAYS = 30, KEEP_LOG_DAYS = 365;

export interface Outgoing { accountId: string; to: Address; subject: string; text: string; html: string }
export interface Sender { options: SmtpOptions; from: Address; replyTo?: Address }
export interface BatchInput { kind: string; meetingId: string | null; createdBy: string; actor: string; subject: string; intro: string }
export interface OutboxRow {
  id: string; batch_id: string; account_id: string; to_address: string; to_name: string; subject: string; body_text: string; body_html: string;
  message_id: string; status: 'czeka' | 'wysylanie' | 'wyslana' | 'blad' | 'anulowana'; attempts: number; next_at: number; last_error: string;
  created: number; sent_at: number | null; purged: number;
}
export interface BatchRow { id: string; kind: string; meeting_id: string | null; created: number; created_by: string; actor: string; subject: string; intro: string; recipients: number }

/** Komunikaty dziennika wysyłek (K4-13). */
export const CANCELLED_ON_OPEN = 'Anulowano przy otwarciu posiedzenia.';
export const CANCELLED_NOT_PREP = 'Anulowano, bo posiedzenie nie jest już w przygotowaniu.';

export class Outbox {
  db: DatabaseSync;
  private running = false;
  constructor(db: DatabaseSync) { this.db = db; }

  /** Wstrzymanie wysyłki po błędzie ustawień (`meta 'poczta-wstrzymana'`). */
  get paused(): {at: number; reason: string} | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key='poczta-wstrzymana'").get() as {value: string} | undefined;
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return null; }
  }
  pause(at: number, reason: string) { this.db.prepare("INSERT INTO meta(key, value) VALUES ('poczta-wstrzymana', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({at, reason})); }
  resume() { this.db.prepare("DELETE FROM meta WHERE key='poczta-wstrzymana'").run(); }

  /** Wysyłka z jedną wiadomością na odbiorcę (B2-P04); Message-ID nadawany przy wstawieniu, więc ponowienie ma ten sam. */
  enqueue(b: BatchInput, list: Outgoing[], now: number, domain: string, status: 'czeka' | 'wyslana' | 'blad' = 'czeka', error = ''): string {
    const batch = randomUUID();
    this.db.prepare('INSERT INTO mail_batches(id,kind,meeting_id,created,created_by,actor,subject,intro,recipients) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(batch, b.kind, b.meetingId, now, b.createdBy, b.actor, b.subject, b.intro, list.length);
    for (const m of list) {
      const id = `<${now.toString(36)}.${randomUUID()}@${domain}>`;
      this.db.prepare('INSERT INTO mail_outbox(id,batch_id,account_id,to_address,to_name,subject,body_text,body_html,message_id,status,attempts,next_at,created,sent_at,last_error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(randomUUID(), batch, m.accountId, m.to.address, m.to.name ?? '', m.subject, m.text, m.html, id, status, status === 'czeka' ? 0 : 1, now, now, status === 'wyslana' ? now : null, error);
    }
    return batch;
  }
  /** Anuluje czekające i nieudane informacje o postępie posiedzenia (polecenie otwarcia, 5.1, K4-13). */
  cancelProgress(meetingId: string, reason = CANCELLED_ON_OPEN): number {
    return Number(this.db.prepare(`UPDATE mail_outbox SET status='anulowana', last_error=? WHERE status IN ('czeka','blad')
      AND batch_id IN (SELECT id FROM mail_batches WHERE kind='postep' AND meeting_id=?)`).run(reason, meetingId).changes);
  }
  /**
   * Przed przejściem pracownika (K4-13, T-5): `postep` posiedzeń, które nie są w przygotowaniu, dostaje „anulowana”;
   * wiadomości posiedzeń w statusie „trwa” albo „przerwa” zostają w kolejce. Zwraca identyfikatory wysyłek do pominięcia.
   */
  private guard() {
    this.db.prepare(`UPDATE mail_outbox SET status='anulowana', last_error=? WHERE status IN ('czeka','wysylanie','blad') AND batch_id IN (
      SELECT b.id FROM mail_batches b JOIN meetings m ON m.id=b.meeting_id WHERE b.kind='postep' AND m.status <> 'przygotowanie')`).run(CANCELLED_NOT_PREP);
  }

  /**
   * Jedno przejście pracownika poczty: wiadomości gotowe do wysłania (najwyżej PER_RUN) w jednym połączeniu.
   * `sender` null (poczta wyłączona albo `MAIL_OFF`) nic nie wysyła.
   */
  async run(now: number, sender: Sender | null): Promise<{sent: number; retry: number; failed: number}> {
    const out = {sent: 0, retry: 0, failed: 0};
    if (!sender || this.paused || this.running) return out;
    this.running = true;
    try {
      this.guard();
      // „wysylanie” starsze niż 10 minut (przerwany proces) wraca do kolejki, a po wyczerpaniu prób przechodzi w „blad”.
      this.db.prepare("UPDATE mail_outbox SET status='blad', last_error='Wiadomość nie wyszła po wszystkich próbach.' WHERE status='wysylanie' AND next_at < ? AND attempts >= ?").run(now - STALE_MS, MAX_ATTEMPTS);
      this.db.prepare("UPDATE mail_outbox SET status='czeka' WHERE status='wysylanie' AND next_at < ?").run(now - STALE_MS);
      const due = this.db.prepare(`SELECT o.* FROM mail_outbox o JOIN mail_batches b ON b.id=o.batch_id LEFT JOIN meetings m ON m.id=b.meeting_id
        WHERE o.status='czeka' AND o.next_at <= ? AND (m.status IS NULL OR m.status NOT IN ('trwa','przerwa')) ORDER BY o.created LIMIT ?`).all(now, PER_RUN) as unknown as OutboxRow[];
      if (!due.length) return out;
      // K4-36: próba liczy się przy przejściu do „wysylanie”.
      const mark = this.db.prepare("UPDATE mail_outbox SET status='wysylanie', attempts=attempts+1, next_at=? WHERE id=?");
      for (const row of due) { mark.run(now, row.id); row.attempts++; }
      const session = new SmtpSession(sender.options);
      const fail = (row: OutboxRow, e: SmtpError) => {
        const again = e.temporary && row.attempts < MAX_ATTEMPTS;
        this.db.prepare('UPDATE mail_outbox SET status=?, next_at=?, last_error=? WHERE id=?')
          .run(again ? 'czeka' : 'blad', again ? now + RETRY_MINUTES[row.attempts - 1] * 60000 : now, (e.message + (e.reply ? ` Odpowiedź serwera ${e.reply}` : '')).slice(0, 600), row.id);
        if (again) out.retry++; else out.failed++;
      };
      try {
        await session.open();
      } catch (e) {
        const err = e instanceof SmtpError ? e : new SmtpError('Połączenie z serwerem poczty zostało przerwane.', {temporary: true, stage: 'polaczenie'});
        if (err.temporary) for (const row of due) fail(row, err);
        else {
          // Błąd ustawień: wysyłka staje dla wszystkich, próby się nie liczą, wiadomości czekają na „Wznów wysyłkę”.
          const back = this.db.prepare("UPDATE mail_outbox SET status='czeka', attempts=MAX(attempts-1, 0) WHERE id=?");
          for (const row of due) back.run(row.id);
          this.pause(now, err.message);
        }
        await session.close();
        return out;
      }
      for (const row of due) {
        try {
          const {raw} = buildMessage({from: sender.from, replyTo: sender.replyTo, to: {name: row.to_name, address: row.to_address}, subject: row.subject, text: row.body_text, html: row.body_html,
            headers: [['X-Posiedzenia-Wysylka', row.batch_id]]}, new Date(now), row.message_id);
          await session.send({from: sender.from.address, to: row.to_address, raw});
          this.db.prepare("UPDATE mail_outbox SET status='wyslana', sent_at=?, last_error='' WHERE id=?").run(now, row.id);
          out.sent++;
        } catch (e) {
          const err = e instanceof SmtpError ? e : new SmtpError((e as Error).message || 'Nie udało się zbudować wiadomości.', {temporary: false, stage: 'tresc'});
          fail(row, err);
          if (err.code === null && err.temporary) {   // połączenie zerwane: pozostałe wracają do kolejki bez liczenia próby
            this.db.prepare("UPDATE mail_outbox SET status='czeka', attempts=MAX(attempts-1, 0) WHERE status='wysylanie'").run();
            break;
          }
        }
      }
      await session.close();
      return out;
    } finally { this.running = false; }
  }

  /** „Wyślij ponownie” (stan „blad”) i „Anuluj” (stan „czeka”) w dzienniku wysyłek (B2-P14). */
  retry(id: string, now: number) {
    const row = this.message(id);
    if (!row) throw Object.assign(new Error('Nie znaleziono wiadomości.'), {status: 404});
    if (row.status !== 'blad') throw Object.assign(new Error('Ponownie wysyła się tylko wiadomość, która nie wyszła.'), {status: 409});
    if (row.purged) throw Object.assign(new Error('Treść tej wiadomości usunięto po 30 dniach.'), {status: 409});
    this.db.prepare("UPDATE mail_outbox SET status='czeka', attempts=0, next_at=?, last_error='' WHERE id=?").run(now, id);
    return this.message(id)!;
  }
  cancel(id: string) {
    const row = this.message(id);
    if (!row) throw Object.assign(new Error('Nie znaleziono wiadomości.'), {status: 404});
    if (row.status !== 'czeka') throw Object.assign(new Error('Anuluje się tylko wiadomość, która czeka na wysłanie.'), {status: 409});
    this.db.prepare("UPDATE mail_outbox SET status='anulowana', last_error='Anulowano w dzienniku wysyłek.' WHERE id=?").run(id);
    return this.message(id)!;
  }
  message(id: string) { return this.db.prepare('SELECT * FROM mail_outbox WHERE id=?').get(id) as unknown as OutboxRow | undefined; }
  rows(batchId: string) { return this.db.prepare('SELECT * FROM mail_outbox WHERE batch_id=? ORDER BY to_name').all(batchId) as unknown as OutboxRow[]; }
  batches(o: {meetingId?: string; before?: number; limit?: number} = {}) {
    const where: string[] = [], args: (string | number)[] = [];
    if (o.meetingId) { where.push('meeting_id=?'); args.push(o.meetingId); }
    if (o.before) { where.push('created<?'); args.push(o.before); }
    const limit = Math.min(Math.max(o.limit ?? 50, 1), 200);
    return this.db.prepare(`SELECT * FROM mail_batches ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created DESC LIMIT ?`).all(...args, limit + 1) as unknown as BatchRow[];
  }
  /** Ostatnia informacja o postępie posiedzenia (G-32: najwyżej co 60 minut). */
  lastProgressAt(meetingId: string): number | null {
    const row = this.db.prepare("SELECT MAX(created) AS at FROM mail_batches WHERE kind='postep' AND meeting_id=?").get(meetingId) as {at: number | null} | undefined;
    return row?.at ?? null;
  }
  lastSentAt(): number | null {
    const row = this.db.prepare("SELECT MAX(sent_at) AS at FROM mail_outbox WHERE status='wyslana'").get() as {at: number | null} | undefined;
    return row?.at ?? null;
  }

  /** Usuwanie po terminie (DB-36): treść po 30 dniach (zostaje temat), wpis po 365 dniach, zawiadomienia z posiedzeniem. */
  purge(now: number) {
    const body = this.db.prepare("UPDATE mail_outbox SET body_text='', body_html='', purged=1 WHERE purged=0 AND status IN ('wyslana','blad','anulowana') AND COALESCE(sent_at, next_at) < ?").run(now - KEEP_BODY_DAYS * 86400000);
    const rows = this.db.prepare("DELETE FROM mail_outbox WHERE created < ? AND batch_id IN (SELECT id FROM mail_batches WHERE kind <> 'zawiadomienie')").run(now - KEEP_LOG_DAYS * 86400000);
    this.db.prepare('DELETE FROM mail_batches WHERE id NOT IN (SELECT batch_id FROM mail_outbox) AND created < ?').run(now - KEEP_LOG_DAYS * 86400000);
    return {bodies: Number(body.changes), rows: Number(rows.changes)};
  }
}
