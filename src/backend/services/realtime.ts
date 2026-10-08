// Hub de tempo real (WebSocket) para o frontend. Eventos são isolados por conta.
import type { WebSocket } from 'ws';

export type RealtimeEvent =
  | 'channels.updated'
  | 'channel.qrcode'
  | 'bridge.status'
  | 'queue.updated'
  | 'message.new'
  | 'message.status'
  | 'chat.updated'
  | 'campaign.updated'
  | 'lead.updated'
  | 'log.new';

interface Client {
  ws: WebSocket;
  accountId: number;
  userId: number;
}

const clients = new Set<Client>();

export const realtime = {
  register(ws: WebSocket, accountId: number, userId: number) {
    const client: Client = { ws, accountId, userId };
    clients.add(client);
    ws.on('close', () => clients.delete(client));
    ws.on('error', () => clients.delete(client));
  },
  emit(accountId: number, event: RealtimeEvent, payload: unknown = {}) {
    const data = JSON.stringify({ event, payload, at: new Date().toISOString() });
    for (const c of clients) {
      if (c.accountId === accountId && c.ws.readyState === 1) c.ws.send(data);
    }
  },
  count() {
    return clients.size;
  },
};
