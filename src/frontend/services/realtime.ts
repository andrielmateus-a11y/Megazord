// Cliente WebSocket com reconexão automática. Componentes assinam eventos via useRealtime().
import { getToken, wsUrl } from './api';

type Handler = (payload: any) => void;
const handlers = new Map<string, Set<Handler>>();
const statusListeners = new Set<(connected: boolean) => void>();
let socket: WebSocket | null = null;
let retry = 1000;
let stopped = true;
let connected = false;

function setConnected(v: boolean) {
  connected = v;
  statusListeners.forEach((l) => l(v));
}

function open() {
  const token = getToken();
  if (!token || stopped) return;
  socket = new WebSocket(wsUrl(token));
  socket.onopen = () => {
    retry = 1000;
    setConnected(true);
  };
  socket.onmessage = (ev) => {
    try {
      const { event, payload } = JSON.parse(ev.data);
      handlers.get(event)?.forEach((h) => h(payload));
      handlers.get('*')?.forEach((h) => h({ event, payload }));
    } catch {
      /* ignora */
    }
  };
  socket.onclose = () => {
    setConnected(false);
    if (!stopped) setTimeout(open, retry);
    retry = Math.min(retry * 2, 30000);
  };
}

export const realtime = {
  start() {
    if (!stopped) return;
    stopped = false;
    open();
  },
  stop() {
    stopped = true;
    socket?.close();
    socket = null;
  },
  on(event: string, handler: Handler) {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(handler);
    return () => {
      handlers.get(event)?.delete(handler);
    };
  },
  onStatus(fn: (c: boolean) => void) {
    statusListeners.add(fn);
    fn(connected);
    return () => {
      statusListeners.delete(fn);
    };
  },
};
