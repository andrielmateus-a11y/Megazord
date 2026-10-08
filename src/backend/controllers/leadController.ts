import type { Request, Response } from 'express';
import { z } from 'zod';
import { LEAD_STATUSES } from '../../shared/constants.js';
import { notFound } from '../lib/errors.js';
import { auth } from '../middleware/auth.js';
import { cleanText, idParam, parse } from '../middleware/validate.js';
import { historyRepository, leadRepository } from '../repositories/leadRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
import { db } from '../../db/dbClient.js';
import * as leadService from '../services/leadService.js';

export async function list(req: Request, res: Response) {
  const a = auth(req);
  const q = parse(
    z.object({
      status: z.enum(LEAD_STATUSES).optional(),
      search: z.string().trim().max(100).optional(),
      uf: z.string().trim().max(2).optional(),
      mine: z.enum(['true', 'false']).optional(),
      worked: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }),
    req.query,
  );
  res.json(
    await leadRepository.list(a.accountId, {
      status: q.status,
      search: q.search,
      uf: q.uf,
      ownerUserId: q.mine === 'true' ? a.userId : undefined,
      onlyWorked: q.worked === 'true',
      limit: q.limit,
      offset: q.offset,
    }),
  );
}

export async function get(req: Request, res: Response) {
  const a = auth(req);
  const id = idParam(req.params.id);
  const lead = await leadRepository.findById(a.accountId, id);
  if (!lead) throw notFound('Lead não encontrado.');
  const chats = await db().query('SELECT id FROM chats WHERE account_id = $1 AND lead_id = $2', [a.accountId, id]);
  res.json({
    lead,
    history: await historyRepository.listForLead(a.accountId, id),
    chats: (await Promise.all(chats.map((c) => chatRepository.findById(a.accountId, c.id)))).filter(Boolean),
  });
}

export async function update(req: Request, res: Response) {
  const a = auth(req);
  const body = parse(
    z.object({
      status: z.enum(LEAD_STATUSES).optional(),
      notes: cleanText(5000).nullable().optional(),
      doNotContact: z.boolean().optional(),
      contactId: z.number().int().nullable().optional(),
    }),
    req.body,
  );
  res.json({ lead: await leadService.updateLead(a.accountId, a.userId, idParam(req.params.id), body) });
}

export async function addNote(req: Request, res: Response) {
  const a = auth(req);
  const id = idParam(req.params.id);
  const body = parse(z.object({ text: cleanText(2000).pipe(z.string().min(1)) }), req.body);
  const lead = await leadRepository.findById(a.accountId, id);
  if (!lead) throw notFound('Lead não encontrado.');
  await historyRepository.add(db(), { accountId: a.accountId, leadId: id, companyId: lead.companyId, userId: a.userId, type: 'note', description: body.text });
  res.status(201).json({ ok: true });
}

export async function optOut(req: Request, res: Response) {
  const a = auth(req);
  const body = parse(
    z.object({ leadId: z.number().int().optional(), phone: z.string().max(30).optional(), cnpj: z.string().max(20).optional(), reason: cleanText(300).optional() }),
    req.body,
  );
  res.status(201).json({ id: await leadService.addOptOut(a.accountId, a.userId, body) });
}

export async function listOptOuts(req: Request, res: Response) {
  res.json({ optOuts: await leadService.listOptOuts(auth(req).accountId) });
}

export async function removeOptOut(req: Request, res: Response) {
  const a = auth(req);
  await leadService.removeOptOut(a.accountId, a.userId, idParam(req.params.id));
  res.json({ ok: true });
}
