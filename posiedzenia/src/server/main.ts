import {createApplication, VERSION} from './app.ts';

const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3000);
const {server, setupKey} = await createApplication();
server.listen(port, host, () => {
  const address = server.address();
  const shown = process.env.APP_URL || `http://localhost:${typeof address === 'object' && address ? address.port : port}`;
  console.log(`Posiedzenia OIPiP Słupsk ${VERSION}: ${shown}`);
  if (setupKey) console.log(`Pierwsze uruchomienie — kod administratora: ${setupKey}`);
  console.log('Zostaw to okno otwarte podczas pracy. Zatrzymanie: Ctrl+C.');
});
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE' ? 'Port jest zajęty. Zamknij poprzednią kopię aplikacji albo ustaw inny PORT.' : error.message);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.close(() => process.exit(0)); server.closeIdleConnections(); });
