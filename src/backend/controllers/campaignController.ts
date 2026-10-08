import type { Request, Response } from 'express';
import { z } from 'zod';
import { LEAD_STATUSES } from '../../shared/constants.js';
import { auth } from '../middleware/auth.js';
import { cleanText, idParam, parse } from '../middleware/validate.js';
import * as campaigns from '../services/campaignService.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM');
const audienceSchema = z.object({
  leadIds: z.array(z.number().int()).max(5000).optional(),
  statuses: z.array(z.enum(LEAD_STATUSES)).optional(),
  uf: z.string().trim().max(2).optional(),
  cidade: cleanText(100).optional(),
  onlyNeverContacted: z.boolean().optional(),
  limit: z.number().int().min(1).max(5000).optional(),
});
const campaignSchema = z.object({
  name: cleanText(120).pipe(z.string().min(1, 'informe o nome')),
  templateId: z.number().int(),
  audience: audienceSchema.default({}),
  channelIds: z.array(z.number().int()).min(1, 'selecione ao menos um WhatsApp'),
  startAt: z.string().datetime({ offset: true }).nullable().optional(),
  windowStart: hhmm.default('09:00'),
  windowEnd: hhmm.default('18:00'),
  weekdays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  intervalSeconds: z.number().int().min(10, 'intervalo mínimo de 10s').max(86400).default(90),
  dailyLimit: z.number().int().min(1).max(5000).default(100),
  cadence: z.array(z.object({ step: z.number().int().min(1).max(10), dayOffset: z.number().int().min(0).max(60), templateId: z.number().int() })).max(10).optional(),
});

export async function list(req: Request, res: Response) {
  res.json({ campaigns: await campaigns.listCampaigns(auth(req).accountId) });
}
export async function get(req: Request, res: Response) {
  res.json({ campaign: await campaigns.getCampaign(auth(req).accountId, idParam(req.params.id)) });
}
export async function create(req: Request, res: Response) {
  const a = auth(req);
  res.status(201).json({ campaign: await campaigns.createCampaign(a.accountId, a.userId, parse(campaignSchema, req.body)) });
}
export async function update(req: Request, res: Response) {
  const a = auth(req);
  res.json({ campaign: await campaigns.updateCampaign(a.accountId, a.userId, idParam(req.params.id), parse(campaignSchema, req.body)) });
}
export async function preview(req: Request, res: Response) {
  const body = parse(z.object({ audience: audienceSchema.default({}), templateId: z.number().int(), channelIds: z.array(z.number().int()).default([]) }), req.body);
  res.json(await campaigns.previewCampaign(auth(req).accountId, body));
}
export async function action(req: Request, res: Response) {
  const a = auth(req);
  const id = idParam(req.params.id);
  const fn = { start: campaigns.startCampaign, pause: campaigns.pauseCampaign, cancel: campaigns.cancelCampaign }[String(req.params.action) as 'start'];
  if (!fn) return res.status(404).json({ error: 'Ação desconhecida.' });
  res.json({ campaign: await fn(a.accountId, a.userId, id) });
}
export async function remove(req: Request, res: Response) {
  const a = auth(req);
  await campaigns.deleteCampaign(a.accountId, a.userId, idParam(req.params.id));
  res.json({ ok: true });
}
