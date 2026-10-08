// Endpoints de webhook. Autenticação por segredo compartilhado (?token= ou header x-webhook-token).
import type { Request, Response } from 'express';
import { config } from '../config.js';
import { safeEqual } from '../lib/crypto.js';
import { unauthorized } from '../lib/errors.js';
import { log } from '../services/logService.js';
import { accountForBridgeToken } from '../services/settingsService.js';
import { handleEvolutionEvent, handleGenericEvent } from '../services/webhookService.js';

function presentedToken(req: Request): string {
  return String(req.query.token ?? req.headers['x-webhook-token'] ?? '');
}

function checkSecret(req: Request) {
  if (!config.webhookSecret) {
    if (config.isProd) throw unauthorized('Webhook desativado: configure WEBHOOK_SECRET.');
    return; // desenvolvimento sem segredo
  }
  if (!safeEqual(presentedToken(req), config.webhookSecret)) throw unauthorized('Token de webhook inválido.');
}

export async function evolution(req: Request, res: Response) {
  checkSecret(req);
  // Responde rápido; processamento é idempotente.
  const result = await handleEvolutionEvent(req.body);
  res.json(result);
}

/** Webhook genérico: autenticado pelo token do bridge da conta (header x-webhook-token). */
export async function whatsapp(req: Request, res: Response) {
  const accountId = await accountForBridgeToken(presentedToken(req));
  if (!accountId) throw unauthorized('Token de webhook inválido.');
  const result = await handleGenericEvent(accountId, req.body);
  if (!result.processed) await log({ accountId, level: 'debug', category: 'webhook', action: 'ignored', message: result.reason });
  res.json(result);
}
