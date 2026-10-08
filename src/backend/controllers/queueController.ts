import type { Request, Response } from 'express';
import { z } from 'zod';
import { QUEUE_STATUSES } from '../../shared/constants.js';
import { auth } from '../middleware/auth.js';
import { idParam, parse } from '../middleware/validate.js';
import * as queue from '../queue/queueService.js';
import { tick } from '../queue/worker.js';
import { dashboard, monitor } from '../services/dashboardService.js';

export async function list(req: Request, res: Response) {
  const a = auth(req);
  const q = parse(z.object({ status: z.enum(QUEUE_STATUSES).optional(), campaignId: z.coerce.number().int().optional(), limit: z.coerce.number().int().max(1000).optional() }), req.query);
  res.json({ items: await queue.listQueue(a.accountId, q), stats: await queue.queueStats(a.accountId) });
}
export async function cancel(req: Request, res: Response) {
  const a = auth(req);
  await queue.cancelItem(a.accountId, a.userId, idParam(req.params.id));
  res.json({ ok: true });
}
export async function retry(req: Request, res: Response) {
  const a = auth(req);
  await queue.retryItem(a.accountId, a.userId, idParam(req.params.id));
  res.json({ ok: true });
}
export async function pauseAll(req: Request, res: Response) {
  const a = auth(req);
  res.json({ affected: await queue.pauseAll(a.accountId, a.userId, true) });
}
export async function resumeAll(req: Request, res: Response) {
  const a = auth(req);
  res.json({ affected: await queue.pauseAll(a.accountId, a.userId, false) });
}
export async function clearCancelled(req: Request, res: Response) {
  res.json({ removed: await queue.clearFinished(auth(req).accountId) });
}
export async function processNow(_req: Request, res: Response) {
  res.json({ processed: await tick() });
}
export async function getMonitor(req: Request, res: Response) {
  res.json(await monitor(auth(req).accountId));
}
export async function getDashboard(req: Request, res: Response) {
  res.json(await dashboard(auth(req).accountId));
}
