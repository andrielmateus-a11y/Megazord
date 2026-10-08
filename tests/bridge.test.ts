// Ponta a ponta: servidor real + "extensão Firefox" simulada via WebSocket.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer } from '../src/backend/server';
import { db } from '../src/db/dbClient';

let base = '';
let token = '';
let shutdown: () => Promise<void>;
let ext: WebSocket;
const commands: any[] = [];

const containers = Array.from({ length: 4 }, (_, i) => ({ cookieStoreId: `firefox-container-${i + 1}`, name: `MEGAZORD WA 0${i + 1}` }));

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const started = await startServer(0);
  shutdown = started.shutdown;
  const addr = started.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
  const reg = await api('POST', '/auth/register', { name: 'Admin', email: 'bridge@megazord.test', password: 'senha1234' });
  token = reg.body.token;
});

afterAll(async () => {
  ext?.close();
  await shutdown();
});

describe('Firefox Bridge', () => {
  it('recusa token inválido', async () => {
    const bad = new WebSocket(`${base.replace('http', 'ws')}/ws/bridge?token=mzb_invalido`);
    const result = await new Promise((resolve) => {
      bad.on('open', () => resolve('open'));
      bad.on('error', () => resolve('error'));
      bad.on('unexpected-response', () => resolve('rejected'));
    });
    expect(result).not.toBe('open');
  });

  it('conecta, detecta Containers e envia pelo Container correto', async () => {
    const { body } = await api('POST', '/firefox/token');
    expect(body.token).toMatch(/^mzb_/);
    ext = new WebSocket(`${base.replace('http', 'ws')}/ws/bridge?token=${body.token}`);
    ext.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type !== 'command') return;
      commands.push(msg);
      const reply = (data: unknown) => ext.send(JSON.stringify({ type: 'response', requestId: msg.requestId, ok: true, data }));
      if (msg.command === 'containers.ensure') reply({ containers: msg.payload.containers.map((c: any, i: number) => ({ name: c.name, cookieStoreId: `firefox-container-${i + 1}` })) });
      if (msg.command === 'wa.send') reply({ ok: true, container: msg.payload.containerName, messageId: 'true_5511@c.us_ABC' });
      if (msg.command === 'wa.open') reply({ status: 'ready', tabId: 1 });
    });
    await new Promise((r) => ext.on('open', r));
    ext.send(JSON.stringify({ type: 'hello', version: '1.0.0', containers, tabs: containers.map((c, i) => ({ cookieStoreId: c.cookieStoreId, tabId: i + 1, status: 'ready' })) }));
    await wait(400);

    const status = await api('GET', '/firefox/status');
    expect(status.body.connected).toBe(true);
    expect(status.body.containersDetected).toBe(4);
    expect(commands.some((c) => c.command === 'containers.ensure')).toBe(true);

    const channels = await api('GET', '/whatsapp/channels');
    expect(channels.body.channels.map((c: any) => [c.label, c.status, c.container.cookieStoreId])).toEqual([
      ['WA 01', 'connected', 'firefox-container-1'],
      ['WA 02', 'connected', 'firefox-container-2'],
      ['WA 03', 'connected', 'firefox-container-3'],
      ['WA 04', 'connected', 'firefox-container-4'],
    ]);
    expect(channels.body.rotation.nextChannel.label).toBe('WA 01');

    // Lead com sócio + celular.
    const accountId = (await db().one('SELECT id FROM accounts LIMIT 1')).id;
    const company = await db().one(`INSERT INTO companies (account_id, cnpj, razao_social, enrichment_status) VALUES ($1,'11222333000181','ABC CONTABILIDADE LTDA','found') RETURNING id`, [accountId]);
    const contact = await db().one(`INSERT INTO contacts (account_id, company_id, name, phone, phone_type, is_primary) VALUES ($1,$2,'JOAO DA SILVA','5511999990000','celular',true) RETURNING id`, [accountId, company.id]);
    const lead = await db().one('INSERT INTO leads (account_id, company_id, contact_id) VALUES ($1,$2,$3) RETURNING id', [accountId, company.id, contact.id]);

    const sent = await api('POST', '/whatsapp/messages/activation/send', { leadId: lead.id, templateId: 1, channelId: 3 });
    expect(sent.body).toMatchObject({ status: 'sent', channelLabel: 'WA 03' });
    const cmd = commands.find((c) => c.command === 'wa.send');
    expect(cmd.payload).toMatchObject({ cookieStoreId: 'firefox-container-3', containerName: 'MEGAZORD WA 03', phone: '5511999990000' });
    expect(cmd.payload.text).toContain('Olá, Joao!');
    const msg = await db().one('SELECT transport, container_name FROM messages WHERE lead_id = $1', [lead.id]);
    expect(msg).toEqual({ transport: 'firefox', container_name: 'MEGAZORD WA 03' });
    const logs = await db().query(`SELECT meta FROM system_logs WHERE action = 'message_sent'`);
    expect(logs[0].meta).toMatchObject({ container: 'MEGAZORD WA 03', transport: 'firefox' });
  });

  it('bridge desconectado tira os canais Firefox do rodízio com mensagem legível', async () => {
    ext.close();
    await wait(400);
    const channels = await api('GET', '/whatsapp/channels');
    expect(channels.body.channels[0].availability).toEqual({ available: false, reason: 'Firefox Bridge desconectado' });
    const test = await api('POST', `/whatsapp/channels/${channels.body.channels[0].id}/test-container`);
    expect(test.body.message).toBe('Firefox Bridge indisponível. Abra a extensão MEGAZORD no Firefox para continuar.');
  });
});
