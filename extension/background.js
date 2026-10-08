/* MEGAZORD Firefox Bridge — background
 *
 * MEGAZORD (backend) ⇄ WebSocket /ws/bridge ⇄ esta extensão ⇄ Firefox Container ⇄ WhatsApp Web
 *
 * - Heartbeat a cada 15s com Containers e estado do WhatsApp Web em cada Container.
 * - Comandos: containers.ensure | wa.open | wa.send | wa.status
 * - Reutiliza a aba do WhatsApp Web de cada Container (não abre abas desnecessárias).
 */
const VERSION = browser.runtime.getManifest().version;
const WA_URL = 'https://web.whatsapp.com/';
const HEARTBEAT_MS = 15000;

let ws = null;
let reconnectDelay = 2000;
let heartbeatTimer = null;
let state = { status: 'disconnected', lastError: null, lastHeartbeatAt: null };
const recentLog = [];

function addLog(level, message) {
  recentLog.unshift({ at: new Date().toISOString(), level, message });
  recentLog.length = Math.min(recentLog.length, 50);
}

async function getConfig() {
  const { serverUrl = 'http://localhost:3001', token = '' } = await browser.storage.local.get(['serverUrl', 'token']);
  return { serverUrl: serverUrl.replace(/\/$/, ''), token };
}

function wsUrl(serverUrl, token) {
  const u = new URL(serverUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws/bridge';
  u.search = `?token=${encodeURIComponent(token)}`;
  return u.toString();
}

async function connect() {
  const { serverUrl, token } = await getConfig();
  if (!token) {
    state = { ...state, status: 'not_configured', lastError: 'Informe o token do bridge (Configurações → Firefox Containers).' };
    return;
  }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  state.status = 'connecting';
  try {
    ws = new WebSocket(wsUrl(serverUrl, token));
  } catch (err) {
    state = { ...state, status: 'disconnected', lastError: String(err) };
    return scheduleReconnect();
  }
  ws.onopen = async () => {
    reconnectDelay = 2000;
    state = { ...state, status: 'connected', lastError: null };
    addLog('info', 'Conectado à MEGAZORD');
    await sendHeartbeat('hello');
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => sendHeartbeat('heartbeat'), HEARTBEAT_MS);
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'command') handleCommand(msg);
  };
  ws.onclose = (ev) => {
    clearInterval(heartbeatTimer);
    state = { ...state, status: 'disconnected', lastError: ev.code === 1006 ? 'Servidor inacessível ou token inválido' : `Conexão encerrada (${ev.code})` };
    addLog('warn', state.lastError);
    scheduleReconnect();
  };
  ws.onerror = () => { /* onclose trata */ };
}

function scheduleReconnect() {
  setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 60000);
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ---------------------------------------------------------------- Containers e abas

async function listContainers() {
  try {
    const list = await browser.contextualIdentities.query({});
    return list.map((c) => ({ cookieStoreId: c.cookieStoreId, name: c.name, color: c.color, icon: c.icon }));
  } catch (err) {
    addLog('error', 'Containers desativados no Firefox (about:preferences → Abas de contêiner).');
    return [];
  }
}

async function waTabs() {
  const tabs = await browser.tabs.query({ url: 'https://web.whatsapp.com/*' });
  // Uma aba por Container: a mais recente.
  const byStore = new Map();
  for (const t of tabs) if (!byStore.has(t.cookieStoreId) || t.lastAccessed > byStore.get(t.cookieStoreId).lastAccessed) byStore.set(t.cookieStoreId, t);
  return byStore;
}

async function tabStatus(tab) {
  if (tab.status !== 'complete') return 'loading';
  try {
    const res = await browser.tabs.sendMessage(tab.id, { type: 'status' });
    return res?.status ?? 'loading';
  } catch {
    return 'loading';
  }
}

async function sendHeartbeat(type) {
  const containers = await listContainers();
  const tabs = [];
  for (const [cookieStoreId, tab] of await waTabs()) tabs.push({ cookieStoreId, tabId: tab.id, status: await tabStatus(tab) });
  state.lastHeartbeatAt = new Date().toISOString();
  send({ type, version: VERSION, containers, tabs });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function waitTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { browser.tabs.onUpdated.removeListener(listener); reject(err('timeout', 'WhatsApp Web não carregou a tempo')); }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    browser.tabs.onUpdated.addListener(listener);
  });
}

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

async function containerExists(cookieStoreId) {
  try { await browser.contextualIdentities.get(cookieStoreId); return true; } catch { return false; }
}

/** Devolve a aba do WhatsApp Web do Container (reutiliza; cria só se não existir). */
async function ensureWaTab(cookieStoreId, { focus = false } = {}) {
  if (!(await containerExists(cookieStoreId))) throw err('container_not_found', 'Container não encontrado');
  let tab = (await waTabs()).get(cookieStoreId);
  if (!tab) {
    tab = await browser.tabs.create({ url: WA_URL, cookieStoreId, active: focus });
    await waitTabComplete(tab.id).catch(() => undefined);
  } else if (focus) {
    await browser.tabs.update(tab.id, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
  }
  return tab;
}

async function waitStatus(tab, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  let status = 'loading';
  while (Date.now() < end) {
    status = await tabStatus(await browser.tabs.get(tab.id));
    if (status !== 'loading') return status;
    await sleep(1000);
  }
  return status;
}

// ---------------------------------------------------------------- Comandos

const commands = {
  async 'containers.ensure'({ containers = [] }) {
    const existing = await browser.contextualIdentities.query({});
    const out = [];
    for (const c of containers) {
      let found = existing.find((e) => e.name === c.name);
      if (!found) {
        found = await browser.contextualIdentities.create({ name: c.name, color: c.color || 'green', icon: c.icon || 'briefcase' });
        addLog('info', `Container criado: ${c.name}`);
      }
      out.push({ name: found.name, cookieStoreId: found.cookieStoreId });
    }
    setTimeout(() => sendHeartbeat('heartbeat'), 500);
    return { containers: out };
  },

  async 'wa.open'({ cookieStoreId }) {
    const tab = await ensureWaTab(cookieStoreId, { focus: true });
    const status = await waitStatus(tab, 20000);
    setTimeout(() => sendHeartbeat('heartbeat'), 500);
    return { status, tabId: tab.id };
  },

  async 'wa.status'() {
    const out = [];
    for (const [cookieStoreId, tab] of await waTabs()) out.push({ cookieStoreId, status: await tabStatus(tab) });
    return { tabs: out };
  },

  async 'wa.send'({ cookieStoreId, containerName, phone, text }) {
    const tab = await ensureWaTab(cookieStoreId);
    const status = await waitStatus(tab, 30000);
    if (status === 'logged_out') throw err('invalid_session', 'WhatsApp Web pede QR Code');
    if (status !== 'ready') throw err('whatsapp_not_open', 'WhatsApp Web não está pronto');
    // Abre a conversa na MESMA aba do Container, com o texto preenchido.
    const url = `${WA_URL}send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}`;
    const loaded = waitTabComplete(tab.id);
    await browser.tabs.update(tab.id, { url });
    await loaded;
    await sleep(1500);
    const res = await browser.tabs.sendMessage(tab.id, { type: 'sendPrefilled', text, timeoutMs: 45000 });
    if (!res?.ok) throw err(res?.code || 'send_failed', res?.message || 'Envio não confirmado');
    addLog('info', `Enviado via ${containerName || cookieStoreId} → ${phone}`);
    return { ok: true, tabId: tab.id, container: containerName, confirmedAt: new Date().toISOString(), messageId: res.messageId || null };
  },
};

async function handleCommand(msg) {
  const fn = commands[msg.command];
  if (!fn) return send({ type: 'response', requestId: msg.requestId, ok: false, error: { code: 'send_failed', message: 'Comando desconhecido' } });
  try {
    const data = await fn(msg.payload || {});
    send({ type: 'response', requestId: msg.requestId, ok: true, data });
  } catch (e) {
    addLog('error', `${msg.command}: ${e.message}`);
    send({ type: 'response', requestId: msg.requestId, ok: false, error: { code: e.code || 'send_failed', message: e.message } });
  }
}

// ---------------------------------------------------------------- Popup

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === 'getState') return { ...state, log: recentLog.slice(0, 15), config: await getConfig().then((c) => ({ serverUrl: c.serverUrl, hasToken: !!c.token })) };
  if (msg.type === 'saveConfig') {
    await browser.storage.local.set({ serverUrl: msg.serverUrl, ...(msg.token ? { token: msg.token } : {}) });
    if (ws) ws.close();
    reconnectDelay = 1000;
    setTimeout(connect, 300);
    return { ok: true };
  }
  if (msg.type === 'reconnect') {
    if (ws) ws.close();
    else connect();
    return { ok: true };
  }
});

browser.alarms.create('megazord-keepalive', { periodInMinutes: 1 });
browser.alarms.onAlarm.addListener(() => { if (!ws || ws.readyState === WebSocket.CLOSED) connect(); });

connect();
