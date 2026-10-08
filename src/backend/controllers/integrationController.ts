// Casa dos Dados (consulta + configuração), Evolution e Firefox Bridge.
import type { Request, Response } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import { casaDosDadosService } from '../services/casaDosDadosService.js';
import { credentialService } from '../services/credentialService.js';
import { evolutionClientFor, evolutionInfo } from '../services/evolutionService.js';
import { log } from '../services/logService.js';
import { bridgeTokenInfo, generateBridgeToken } from '../services/settingsService.js';
import { bridgeSummary, ensureContainers, syncInstances } from '../services/channelService.js';
import { normalizeCnpj, isValidCnpj } from '../../shared/text.js';
import { badRequest } from '../lib/errors.js';
import { config } from '../config.js';
import * as prospecting from '../services/prospectingService.js';

// ---------- Casa dos Dados
export async function cddStatus(req: Request, res: Response) {
  res.json(await casaDosDadosService.status(auth(req).accountId));
}

export async function cddSetKey(req: Request, res: Response) {
  const a = auth(req);
  const body = parse(z.object({ apiKey: z.string().trim().min(8).max(500).optional(), dailyLimit: z.number().int().min(1).max(100000).optional() }), req.body);
  if (body.apiKey) await credentialService.set(a.accountId, 'casa_dos_dados', body.apiKey, body.dailyLimit ? { dailyLimit: body.dailyLimit } : {});
  else if (body.dailyLimit) await credentialService.setMeta(a.accountId, 'casa_dos_dados', { dailyLimit: body.dailyLimit });
  await log({ accountId: a.accountId, userId: a.userId, category: 'settings', action: 'casa_dos_dados_key', message: body.apiKey ? 'Chave da Casa dos Dados atualizada' : 'Limite diário atualizado' });
  res.json(await casaDosDadosService.status(a.accountId));
}

export async function cddRemoveKey(req: Request, res: Response) {
  const a = auth(req);
  await credentialService.remove(a.accountId, 'casa_dos_dados');
  await log({ accountId: a.accountId, userId: a.userId, category: 'settings', action: 'casa_dos_dados_key_removed', message: 'Chave da Casa dos Dados removida' });
  res.json(await casaDosDadosService.status(a.accountId));
}

/** Revela a chave apenas para administradores, sob demanda (botão mostrar/copiar). */
export async function cddRevealKey(req: Request, res: Response) {
  const a = auth(req);
  const key = await credentialService.getSecret(a.accountId, 'casa_dos_dados', config.casaDosDados.apiKey);
  await log({ accountId: a.accountId, userId: a.userId, level: 'warn', category: 'security', action: 'casa_dos_dados_key_revealed', message: 'Chave da Casa dos Dados exibida a um administrador' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ apiKey: key });
}

export async function cddTest(req: Request, res: Response) {
  const a = auth(req);
  res.json(await casaDosDadosService.testConnection(a.accountId, a.userId));
}

/** Busca objetiva por CNPJ: Sócio, Celular e Empresa. */
export async function cddLookup(req: Request, res: Response) {
  const a = auth(req);
  const cnpj = normalizeCnpj(String(req.params.cnpj));
  if (!isValidCnpj(cnpj)) throw badRequest('CNPJ inválido.');
  const body = parse(z.object({ useCache: z.boolean().optional(), source: z.enum(['casa_dos_dados', 'receita']).default('casa_dos_dados') }), req.body ?? {});
  res.json(await prospecting.fetchContacts(a.accountId, a.userId, cnpj, body.source, { useCache: body.useCache }));
}

export async function cddClearCache(req: Request, res: Response) {
  res.json({ removed: await casaDosDadosService.clearCache(auth(req).accountId) });
}

// ---------- Evolution
export async function evolutionStatus(req: Request, res: Response) {
  res.json(await evolutionInfo(auth(req).accountId));
}

export async function evolutionConfigure(req: Request, res: Response) {
  const a = auth(req);
  const body = parse(z.object({ url: z.string().trim().url('URL inválida').max(300), apiKey: z.string().trim().min(6).max(500).optional() }), req.body);
  const url = body.url.replace(/\/$/, '');
  if (body.apiKey) await credentialService.set(a.accountId, 'evolution', body.apiKey, { url });
  else await credentialService.setMeta(a.accountId, 'evolution', { url });
  await log({ accountId: a.accountId, userId: a.userId, category: 'settings', action: 'evolution_config', message: 'Configuração da Evolution API atualizada', meta: { url } });
  res.json(await evolutionInfo(a.accountId));
}

export async function evolutionTest(req: Request, res: Response) {
  const a = auth(req);
  const client = await evolutionClientFor(a.accountId);
  try {
    const instances = await client.fetchInstances();
    await credentialService.markStatus(a.accountId, 'evolution', 'ok');
    res.json({ ok: true, message: `Conectado. ${instances.length} instância(s) encontrada(s).` });
  } catch (err) {
    const message = (err as any).userMessage ?? 'Falha ao conectar.';
    await credentialService.markStatus(a.accountId, 'evolution', 'error', message);
    res.json({ ok: false, message });
  }
}

export async function evolutionSync(req: Request, res: Response) {
  const a = auth(req);
  res.json(await syncInstances(a.accountId, a.userId));
}

// ---------- Firefox Bridge
export async function bridgeStatus(req: Request, res: Response) {
  const a = auth(req);
  res.json({ ...bridgeSummary(a.accountId), token: await bridgeTokenInfo(a.accountId) });
}

export async function bridgeToken(req: Request, res: Response) {
  const a = auth(req);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ token: await generateBridgeToken(a.accountId, a.userId) });
}

export async function bridgeEnsureContainers(req: Request, res: Response) {
  const a = auth(req);
  try {
    res.json({ ok: true, ...(await ensureContainers(a.accountId)) });
  } catch (err) {
    res.json({ ok: false, message: (err as any).userMessage ?? 'Falha ao sincronizar Containers.' });
  }
}
