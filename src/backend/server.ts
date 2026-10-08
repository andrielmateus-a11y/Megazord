// Ponto de entrada do backend MEGAZORD: HTTP + WebSocket (frontend e Firefox Bridge) + worker da fila.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { closeDb, initDb } from '../db/dbClient.js';
import { createApp } from './app.js';
import { assertProductionConfig, config } from './config.js';
import { bridgeHub } from './integrations/firefox/bridgeHub.js';
import { startWorker, stopWorker } from './queue/worker.js';
import { resolveSession } from './services/authService.js';
import { syncInstances, wireBridgeEvents } from './services/channelService.js';
import { realtime } from './services/realtime.js';
import { accountForBridgeToken } from './services/settingsService.js';
import { purgeOldEvents } from './services/webhookService.js';
import { sessionRepository } from './repositories/userRepository.js';
import { db } from '../db/dbClient.js';

export async function startServer(port = config.port) {
  assertProductionConfig();
  await initDb();
  const app = createApp();
  const server = http.createServer(app);

  // /ws        → frontend (token de sessão)
  // /ws/bridge → extensão Firefox (token do bridge)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token') ?? '';
      if (url.pathname === '/ws') {
        const session = await resolveSession(token);
        if (!session) return socket.destroy();
        wss.handleUpgrade(req, socket, head, (ws) => {
          realtime.register(ws, session.accountId, session.userId);
          ws.send(JSON.stringify({ event: 'hello', payload: { userId: session.userId } }));
        });
      } else if (url.pathname === '/ws/bridge') {
        const accountId = await accountForBridgeToken(token);
        if (!accountId) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          return socket.destroy();
        }
        wss.handleUpgrade(req, socket, head, (ws) => bridgeHub.attach(accountId, ws));
      } else {
        socket.destroy();
      }
    } catch {
      socket.destroy();
    }
  });

  // Keep-alive dos sockets.
  const ping = setInterval(() => {
    for (const ws of wss.clients) if (ws.readyState === 1) ws.ping();
  }, 25000);

  wireBridgeEvents();
  await startWorker();

  // Na inicialização: sincroniza instâncias da Evolution (GET /instance/fetchInstances).
  const accounts = await db().query('SELECT id FROM accounts');
  for (const a of accounts) syncInstances(a.id, null).catch(() => undefined);

  const housekeeping = setInterval(() => {
    sessionRepository.purgeExpired().catch(() => undefined);
    purgeOldEvents().catch(() => undefined);
    db().query('DELETE FROM lookup_cache WHERE expires_at < now()').catch(() => undefined);
  }, 3600 * 1000);

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`[megazord] API em http://localhost:${port} (${config.nodeEnv})`);

  const shutdown = async () => {
    clearInterval(ping);
    clearInterval(housekeeping);
    stopWorker();
    bridgeHub.disconnectAll();
    wss.close();
    server.close();
    await closeDb();
  };
  return { server, shutdown };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
if (isMain) {
  startServer()
    .then(({ shutdown }) => {
      const stop = () => shutdown().finally(() => process.exit(0));
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((err) => {
      console.error('[megazord] falha ao iniciar:', err);
      process.exit(1);
    });
}
