// Canais, conversas, mensagens e templates.
import type { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../../db/dbClient.js';
import { notFound } from '../lib/errors.js';
import { auth } from '../middleware/auth.js';
import { cleanText, idParam, parse } from '../middleware/validate.js';
import { chatRepository } from '../repositories/chatRepository.js';
import { leadRepository } from '../repositories/leadRepository.js';
import { realtime } from '../services/realtime.js';
import * as channels from '../services/channelService.js';
import * as messages from '../services/messageService.js';
import { rotationOverview } from '../services/rotationService.js';
import { templateService } from '../services/templateService.js';
import { listLogs } from '../services/logService.js';

// ---------- Canais
export async function listChannels(req: Request, res: Response) {
  const a = auth(req);
  res.json({ channels: await channels.listChannels(a.accountId), rotation: await rotationOverview(a.accountId), bridge: channels.bridgeSummary(a.accountId) });
}

export async function addChannel(req: Request, res: Response) {
  const a = auth(req);
  await channels.addChannel(a.accountId, a.userId);
  res.status(201).json({ channels: await channels.listChannels(a.accountId) });
}

export async function updateChannel(req: Request, res: Response) {
  const a = auth(req);
  const body = parse(
    z.object({
      name: cleanText(60).pipe(z.string().min(1)).optional(),
      phone: z.string().trim().max(20).nullable().optional(),
      transport: z.enum(['firefox', 'evolution']).optional(),
      evolutionInstance: z.string().trim().regex(/^[\w.-]{1,80}$/, 'nome de instância inválido').nullable().optional(),
      dailyLimit: z.number().int().min(1).max(1000).optional(),
      cooldownSeconds: z.number().int().min(0).max(3600).optional(),
      containerName: cleanText(60).pipe(z.string().min(1)).optional(),
    }),
    req.body,
  );
  await channels.updateChannel(a.accountId, a.userId, idParam(req.params.id), body);
  res.json({ channels: await channels.listChannels(a.accountId) });
}

export async function removeChannel(req: Request, res: Response) {
  const a = auth(req);
  await channels.removeChannel(a.accountId, a.userId, idParam(req.params.id));
  res.json({ channels: await channels.listChannels(a.accountId) });
}

export async function channelAction(req: Request, res: Response) {
  const a = auth(req);
  const id = idParam(req.params.id);
  const action = String(req.params.action);
  switch (action) {
    case 'pause':
      await channels.setPaused(a.accountId, a.userId, id, true);
      return res.json({ ok: true });
    case 'resume':
      await channels.setPaused(a.accountId, a.userId, id, false);
      return res.json({ ok: true });
    case 'queue-on':
      await channels.setQueueEnabled(a.accountId, a.userId, id, true);
      return res.json({ ok: true });
    case 'queue-off':
      await channels.setQueueEnabled(a.accountId, a.userId, id, false);
      return res.json({ ok: true });
    case 'reset-errors':
      await channels.resetErrors(a.accountId, id);
      return res.json({ ok: true });
    case 'connect':
      return res.json(await channels.connectEvolution(a.accountId, a.userId, id));
    case 'reconnect':
      return res.json(await channels.reconnectEvolution(a.accountId, a.userId, id));
    case 'disconnect':
      await channels.disconnectEvolution(a.accountId, a.userId, id);
      return res.json({ ok: true });
    case 'test-container':
      return res.json(await channels.testContainer(a.accountId, a.userId, id));
    default:
      throw notFound('Ação desconhecida.');
  }
}

export async function channelLogs(req: Request, res: Response) {
  const a = auth(req);
  res.json({ logs: await listLogs(a.accountId, { channelId: idParam(req.params.id), limit: 100 }) });
}

export async function rotation(req: Request, res: Response) {
  res.json(await rotationOverview(auth(req).accountId));
}

// ---------- Conversas
export async function listChats(req: Request, res: Response) {
  const a = auth(req);
  const q = parse(
    z.object({ channelId: z.coerce.number().int().optional(), search: z.string().trim().max(100).optional(), unread: z.enum(['true', 'false']).optional() }),
    req.query,
  );
  res.json({ chats: await chatRepository.list(a.accountId, { channelId: q.channelId, search: q.search, unreadOnly: q.unread === 'true' }) });
}

export async function getChat(req: Request, res: Response) {
  const a = auth(req);
  const id = idParam(req.params.id);
  const chat = await chatRepository.findById(a.accountId, id);
  if (!chat) throw notFound('Conversa não encontrada.');
  await chatRepository.markRead(a.accountId, id);
  realtime.emit(a.accountId, 'chat.updated', { chatId: id });
  res.json({
    chat: { ...chat, unreadCount: 0 },
    messages: await chatRepository.messages(a.accountId, id),
    lead: chat.leadId ? await leadRepository.findById(a.accountId, chat.leadId) : null,
  });
}

export async function linkChatLead(req: Request, res: Response) {
  const a = auth(req);
  const body = parse(z.object({ leadId: z.number().int().nullable() }), req.body);
  await db().query('UPDATE chats SET lead_id = $3 WHERE account_id = $1 AND id = $2', [a.accountId, idParam(req.params.id), body.leadId]);
  res.json({ ok: true });
}

// ---------- Mensagens
const sendSchema = z.object({
  chatId: z.number().int().optional(),
  phone: z.string().trim().max(30).optional(),
  leadId: z.number().int().nullable().optional(),
  body: z.string().max(4000).transform((s) => s.trim()).pipe(z.string().min(1, 'mensagem vazia')),
  channelId: z.number().int().nullable().optional(),
});

export async function send(req: Request, res: Response) {
  const a = auth(req);
  res.json(await messages.sendManual(a.accountId, a.userId, parse(sendSchema, req.body)));
}

const activationSchema = z.object({
  leadId: z.number().int(),
  contactId: z.number().int().nullable().optional(),
  templateId: z.number().int().nullable().optional(),
  body: z.string().max(4000).nullable().optional(),
  channelId: z.number().int().nullable().optional(),
});

export async function previewActivation(req: Request, res: Response) {
  res.json(await messages.previewActivation(auth(req).accountId, parse(activationSchema, req.body)));
}

export async function sendActivation(req: Request, res: Response) {
  const a = auth(req);
  res.json(await messages.sendActivation(a.accountId, a.userId, parse(activationSchema, req.body)));
}

// ---------- Templates
const templateSchema = z.object({
  name: cleanText(120).pipe(z.string().min(1, 'informe o nome')),
  category: cleanText(60).default('ativacao'),
  body: z.string().max(4000).transform((s) => s.replace(/\r\n/g, '\n').trim()).pipe(z.string().min(1, 'mensagem vazia')),
  favorite: z.boolean().optional(),
});

export async function listTemplates(req: Request, res: Response) {
  res.json({ templates: await templateService.list(auth(req).accountId) });
}

export async function createTemplate(req: Request, res: Response) {
  const a = auth(req);
  res.status(201).json({ template: await templateService.create(a.accountId, a.userId, parse(templateSchema, req.body)) });
}

export async function updateTemplate(req: Request, res: Response) {
  const a = auth(req);
  res.json({ template: await templateService.update(a.accountId, a.userId, idParam(req.params.id), parse(templateSchema.partial(), req.body)) });
}

export async function duplicateTemplate(req: Request, res: Response) {
  const a = auth(req);
  res.status(201).json({ template: await templateService.duplicate(a.accountId, a.userId, idParam(req.params.id)) });
}

export async function deleteTemplate(req: Request, res: Response) {
  const a = auth(req);
  await templateService.remove(a.accountId, a.userId, idParam(req.params.id));
  res.json({ ok: true });
}

export async function previewTemplate(req: Request, res: Response) {
  const body = parse(
    z.object({
      body: z.string().max(4000),
      vars: z.object({ socio: z.string().nullable().optional(), empresa: z.string().nullable().optional(), telefone: z.string().nullable().optional(), cidade: z.string().nullable().optional(), cnpj: z.string().nullable().optional() }).default({}),
    }),
    req.body,
  );
  res.json(templateService.preview(body.body, body.vars));
}
