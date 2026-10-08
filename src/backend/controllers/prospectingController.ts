import type { Request, Response } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { cleanText, idParam, parse } from '../middleware/validate.js';
import * as prospecting from '../services/prospectingService.js';
import { companyRepository } from '../repositories/companyRepository.js';
import { historyRepository, leadRepository } from '../repositories/leadRepository.js';
import { notFound } from '../lib/errors.js';
import { normalizePhone, isMobile } from '../../shared/text.js';
import { db } from '../../db/dbClient.js';
import { casaDosDadosService } from '../services/casaDosDadosService.js';

const filtersSchema = z.object({
  uf: z.string().trim().length(2).toUpperCase().optional().or(z.literal('')),
  municipio: cleanText(100).optional(),
  bairro: cleanText(100).optional(),
  cnaes: z.array(z.string().regex(/^\d{7}$/, 'CNAE deve ter 7 dígitos')).max(20).optional(),
  situacao: z.enum(['ATIVA', 'BAIXADA', 'INAPTA', 'SUSPENSA', 'NULA']).optional(),
  portes: z.array(z.enum(['ME', 'EPP', 'DEMAIS'])).optional(),
  minAgeMonths: z.coerce.number().int().min(0).max(1200).optional(),
  maxAgeMonths: z.coerce.number().int().min(0).max(1200).optional(),
  onlyWithMobile: z.boolean().optional(),
  count: z.coerce.number().int().min(1).max(100).default(20),
});

export async function discover(req: Request, res: Response) {
  const a = auth(req);
  const body = parse(filtersSchema, req.body);
  res.json(await prospecting.discover(a.accountId, a.userId, body, 'new'));
}

export async function next(req: Request, res: Response) {
  const a = auth(req);
  const body = parse(z.object({ searchId: z.number().int().optional(), count: z.coerce.number().int().min(1).max(100).default(20) }), req.body);
  res.json(await prospecting.discover(a.accountId, a.userId, { count: body.count }, 'next', body.searchId));
}

export async function recent(req: Request, res: Response) {
  const a = auth(req);
  res.json({ results: await prospecting.recentPresented(a.accountId, a.userId, 100), lastSearch: await prospecting.lastSearch(a.accountId, a.userId) });
}

export async function checkCnpj(req: Request, res: Response) {
  res.json(await prospecting.checkCnpj(auth(req).accountId, String(req.params.cnpj)));
}

export async function fetchContacts(req: Request, res: Response) {
  const a = auth(req);
  const body = parse(z.object({ source: z.enum(['casa_dos_dados', 'receita']).default('casa_dos_dados'), useCache: z.boolean().optional() }), req.body ?? {});
  res.json(await prospecting.fetchContacts(a.accountId, a.userId, String(req.params.cnpj), body.source, { useCache: body.useCache }));
}

export async function getCompany(req: Request, res: Response) {
  const a = auth(req);
  const company = await companyRepository.findById(a.accountId, idParam(req.params.id));
  if (!company) throw notFound('Empresa não encontrada.');
  const [result] = await prospecting.buildResults(a.accountId, [company]);
  const lead = await leadRepository.findByCompany(a.accountId, company.id);
  res.json({ ...result, leadDetail: lead, history: lead ? await historyRepository.listForLead(a.accountId, lead.id) : [] });
}

const contactSchema = z.object({
  name: cleanText(150).nullable().optional(),
  role: cleanText(100).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  makePrimary: z.boolean().optional(),
});

export async function addContact(req: Request, res: Response) {
  const a = auth(req);
  const body = parse(contactSchema, req.body);
  const phone = body.phone ? normalizePhone(body.phone) : null;
  res.status(201).json({
    contact: await prospecting.addManualContact(a.accountId, a.userId, idParam(req.params.id), { name: body.name ?? null, role: body.role, phone, makePrimary: body.makePrimary }),
  });
}

export async function updateContact(req: Request, res: Response) {
  const a = auth(req);
  const body = parse(contactSchema, req.body);
  const phone = body.phone === undefined ? undefined : body.phone ? normalizePhone(body.phone) : null;
  const contact = await companyRepository.updateContact(a.accountId, idParam(req.params.id), {
    name: body.name,
    role: body.role,
    phone,
    phoneType: phone === undefined ? undefined : phone ? (isMobile(phone) ? 'celular' : 'fixo') : null,
  });
  if (!contact) throw notFound('Contato não encontrado.');
  if (body.makePrimary && contact.companyId) {
    await companyRepository.setPrimary(db(), a.accountId, contact.companyId, contact.id);
    await db().query('UPDATE leads SET contact_id = $3 WHERE account_id = $1 AND company_id = $2', [a.accountId, contact.companyId, contact.id]);
  }
  res.json({ contact });
}

export async function clearCache(req: Request, res: Response) {
  res.json({ removed: await casaDosDadosService.clearCache(auth(req).accountId) });
}
