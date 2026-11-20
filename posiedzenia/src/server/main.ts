import {readFileSync} from 'node:fs';
import {createApplication, VERSION, type MailOptions} from './app.ts';

// Wersja 4 (SPEC-4 5.4): poczta ze zmiennych środowiskowych. Hasło z pliku `SMTP_PASSWORD_FILE` (zalecane, np. sekret
// systemd albo kontenera) albo z `SMTP_PASSWORD`; po odczycie obie zmienne znikają z `process.env`, żeby nie widziały ich
// procesy potomne (K4-36). Hasło nigdy nie trafia do bazy, dziennika ani odpowiedzi API. Linia stanu bez hasła.
function mailOptions(): MailOptions {
  let password = '';
  const file = process.env.SMTP_PASSWORD_FILE;
  try { if (file) password = readFileSync(file, 'utf8').replace(/\r?\n$/, ''); }
  catch { console.error('Nie udało się odczytać pliku z hasłem do serwera poczty (SMTP_PASSWORD_FILE).'); }
  if (!password && process.env.SMTP_PASSWORD) password = process.env.SMTP_PASSWORD;
  delete process.env.SMTP_PASSWORD;
  delete process.env.SMTP_PASSWORD_FILE;
  let ca: Buffer | undefined;
  try { if (process.env.SMTP_CA_FILE) ca = readFileSync(process.env.SMTP_CA_FILE); }
  catch { console.error('Nie udało się odczytać pliku urzędu certyfikacji (SMTP_CA_FILE).'); }
  return {password, hostAllowed: process.env.SMTP_HOST_ALLOWED?.trim() || null, ca, off: process.env.MAIL_OFF === '1'};
}

const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3000);
const mail = mailOptions();
const {server, setupKey, mailStatus} = await createApplication({mail});
server.listen(port, host, () => {
  const address = server.address();
  const shown = process.env.APP_URL || `http://localhost:${typeof address === 'object' && address ? address.port : port}`;
  console.log(`Posiedzenia OIPiP Słupsk ${VERSION}: ${shown}`);
  if (setupKey) console.log(`Pierwsze uruchomienie — kod administratora: ${setupKey}`);
  console.log(mailStatus());
  console.log('Zostaw to okno otwarte podczas pracy. Zatrzymanie: Ctrl+C.');
});
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE' ? 'Port jest zajęty. Zamknij poprzednią kopię aplikacji albo ustaw inny PORT.' : error.message);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.close(() => process.exit(0)); server.closeIdleConnections(); });
