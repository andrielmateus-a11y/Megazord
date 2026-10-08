// Firefox Bridge: a extensão MEGAZORD (Firefox) conecta-se a este hub via WebSocket (/ws/bridge).
// O hub envia comandos para o Container correto e recebe heartbeats com o estado de cada Container/aba.
//
//   MEGAZORD (backend) ⇄ WebSocket ⇄ Extensão Firefox ⇄ Container N ⇄ WhatsApp Web
import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import { config } from '../../config.js';

export interface BridgeContainer {
  cookieStoreId: string;
  name: string;
  color?: string;
  icon?: string;
}

export interface BridgeTab {
  cookieStoreId: string;
  tabId: number;
  /** ready = WhatsApp Web aberto e logado; logged_out = pede QR Code; loading = carregando. */
  status: 'ready' | 'logged_out' | 'loading';
}

export interface BridgeState {
  connected: boolean;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
  extensionVersion: string | null;
  containers: BridgeContainer[];
  tabs: BridgeTab[];
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

interface Connection {
  ws: WebSocket;
  state: BridgeState;
  pending: Map<string, Pending>;
}

export class BridgeError extends Error {
  constructor(
    public code: 'bridge_offline' | 'container_not_found' | 'whatsapp_not_open' | 'invalid_session' | 'timeout' | 'send_failed' | 'invalid_number',
    public userMessage: string,
    technical?: string,
  ) {
    super(technical ?? userMessage);
  }
}

export const BRIDGE_MESSAGES: Record<BridgeError['code'], string> = {
  bridge_offline: 'Firefox Bridge indisponível. Abra a extensão MEGAZORD no Firefox para continuar.',
  container_not_found: 'Container do Firefox não encontrado. Use "Testar Container" na tela de Canais.',
  whatsapp_not_open: 'WhatsApp Web não está aberto neste Container.',
  invalid_session: 'Sessão do WhatsApp Web inválida neste Container. Leia o QR Code novamente.',
  timeout: 'O Firefox não respondeu a tempo. Verifique se o navegador está aberto.',
  send_failed: 'O WhatsApp Web não confirmou o envio.',
  invalid_number: 'O número não possui WhatsApp ou é inválido.',
};

type Listener = (accountId: number, state: BridgeState, kind: 'connected' | 'disconnected' | 'heartbeat') => void;

class BridgeHub {
  private connections = new Map<number, Connection>();
  private listeners: Listener[] = [];

  onChange(fn: Listener) {
    this.listeners.push(fn);
  }

  private notify(accountId: number, kind: 'connected' | 'disconnected' | 'heartbeat') {
    const state = this.state(accountId);
    for (const l of this.listeners) {
      try {
        l(accountId, state, kind);
      } catch (err) {
        console.error('[bridge] listener error', err);
      }
    }
  }

  attach(accountId: number, ws: WebSocket) {
    const previous = this.connections.get(accountId);
    if (previous) previous.ws.close(4000, 'Nova conexão do bridge');
    const conn: Connection = {
      ws,
      pending: new Map(),
      state: {
        connected: true,
        connectedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        extensionVersion: null,
        containers: [],
        tabs: [],
      },
    };
    this.connections.set(accountId, conn);

    ws.on('message', (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      this.handleMessage(accountId, conn, msg);
    });
    ws.on('close', () => {
      if (this.connections.get(accountId) === conn) {
        this.connections.delete(accountId);
        for (const p of conn.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new BridgeError('bridge_offline', BRIDGE_MESSAGES.bridge_offline, 'socket closed'));
        }
        this.notify(accountId, 'disconnected');
      }
    });
    this.notify(accountId, 'connected');
  }

  private handleMessage(accountId: number, conn: Connection, msg: any) {
    if (msg.type === 'response' && msg.requestId) {
      const p = conn.pending.get(msg.requestId);
      if (!p) return;
      conn.pending.delete(msg.requestId);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.data ?? {});
      else {
        const code = (msg.error?.code as BridgeError['code']) ?? 'send_failed';
        p.reject(new BridgeError(code in BRIDGE_MESSAGES ? code : 'send_failed', BRIDGE_MESSAGES[code] ?? BRIDGE_MESSAGES.send_failed, msg.error?.message));
      }
      return;
    }
    if (msg.type === 'hello' || msg.type === 'heartbeat') {
      conn.state.lastHeartbeatAt = new Date().toISOString();
      if (msg.version) conn.state.extensionVersion = String(msg.version).slice(0, 20);
      if (Array.isArray(msg.containers)) {
        conn.state.containers = msg.containers
          .filter((c: any) => c && typeof c.cookieStoreId === 'string')
          .map((c: any) => ({ cookieStoreId: c.cookieStoreId, name: String(c.name ?? ''), color: c.color, icon: c.icon }));
      }
      if (Array.isArray(msg.tabs)) {
        conn.state.tabs = msg.tabs
          .filter((t: any) => t && typeof t.cookieStoreId === 'string')
          .map((t: any) => ({ cookieStoreId: t.cookieStoreId, tabId: Number(t.tabId), status: t.status }));
      }
      this.notify(accountId, 'heartbeat');
      if (msg.type === 'heartbeat' && conn.ws.readyState === 1) conn.ws.send(JSON.stringify({ type: 'ack' }));
    }
  }

  isConnected(accountId: number): boolean {
    const conn = this.connections.get(accountId);
    if (!conn || conn.ws.readyState !== 1) return false;
    const last = conn.state.lastHeartbeatAt ? Date.parse(conn.state.lastHeartbeatAt) : 0;
    return Date.now() - last < config.bridge.heartbeatTimeoutMs;
  }

  state(accountId: number): BridgeState {
    const conn = this.connections.get(accountId);
    if (!conn) {
      return { connected: false, connectedAt: null, lastHeartbeatAt: null, extensionVersion: null, containers: [], tabs: [] };
    }
    return { ...conn.state, connected: this.isConnected(accountId) };
  }

  async command<T = any>(accountId: number, command: string, payload: Record<string, unknown>, timeoutMs = 30000): Promise<T> {
    const conn = this.connections.get(accountId);
    if (!conn || !this.isConnected(accountId)) {
      throw new BridgeError('bridge_offline', BRIDGE_MESSAGES.bridge_offline);
    }
    const requestId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.pending.delete(requestId);
        reject(new BridgeError('timeout', BRIDGE_MESSAGES.timeout, `${command} timeout`));
      }, timeoutMs);
      conn.pending.set(requestId, { resolve, reject, timer });
      conn.ws.send(JSON.stringify({ type: 'command', command, requestId, payload }));
    });
  }

  disconnectAll() {
    for (const c of this.connections.values()) c.ws.close();
    this.connections.clear();
  }
}

export const bridgeHub = new BridgeHub();
