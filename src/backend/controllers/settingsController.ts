import type { Request, Response } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { cleanText, parse } from '../middleware/validate.js';
import { listLogs } from '../services/logService.js';
import { getAccount, updateAccount } from '../services/settingsService.js';
import * as io from '../services/importExportService.js';
import { badRequest } from '../lib/errors.js';

export async function account(req: Request, res: Response) {
  res.json({ account: await getAccount(auth(req).accountId) });
}

export async function saveAccount(req: Request, res: Response) {
  const a = auth(req);
  const body = parse(z.object({ name: cleanText(120).optional(), settings: z.record(z.unknown()).optional() }), req.body);
  res.json({ account: await updateAccount(a.accountId, a.userId, body) });
}

export async function logs(req: Request, res: Response) {
  const a = auth(req);
  const q = parse(z.object({ category: z.string().max(40).optional(), level: z.enum(['debug', 'info', 'warn', 'error']).optional(), limit: z.coerce.number().int().max(1000).optional() }), req.query);
  res.json({ logs: await listLogs(a.accountId, q) });
}

const EXPORTS = {
  leads: io.exportLeads,
  history: io.exportHistory,
  messages: io.exportMessages,
  templates: io.exportTemplates,
} as const;

export async function exportData(req: Request, res: Response) {
  const a = auth(req);
  const kind = String(req.params.kind) as keyof typeof EXPORTS;
  const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
  const fn = EXPORTS[kind];
  if (!fn) throw badRequest('Tipo de exportação inválido.');
  const file = await fn(a.accountId, format);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="megazord-${kind}-${date}.${file.ext}"`);
  res.send(file.buffer);
}

export async function importData(req: Request, res: Response) {
  const a = auth(req);
  const body = parse(z.object({ fileName: z.string().max(200), contentBase64: z.string().max(15 * 1024 * 1024) }), req.body);
  const rows = await io.readTable(body.fileName, body.contentBase64);
  if (!rows.length) throw badRequest('Arquivo sem linhas para importar.');
  if (rows.length > 20000) throw badRequest('Máximo de 20.000 linhas por importação.');
  const kind = String(req.params.kind);
  if (kind === 'leads' || kind === 'history') return res.json(await io.importLeads(a.accountId, a.userId, rows));
  if (kind === 'templates') return res.json(await io.importTemplates(a.accountId, a.userId, rows));
  throw badRequest('Tipo de importação inválido.');
}
