// Prospecção: descobrir empresas inéditas, deduplicar no armazenamento, trazer contatos e checar histórico.
import { db } from '../../db/dbClient.js';
import { ACCOUNTING_CNAES } from '../../shared/constants.js';
import { isMobile, isValidCnpj, normalizeCnpj } from '../../shared/text.js';
import type { Company, Contact, ProspectResult } from '../../shared/types.js';
import { badRequest, IntegrationError, notFound } from '../lib/errors.js';
import type { CompanyRecord, CompanySearchFilters } from '../integrations/DataProvider.js';
import { ReceitaProvider } from '../integrations/receita/ReceitaProvider.js';
import { companyRepository } from '../repositories/companyRepository.js';
import { historyRepository, leadRepository } from '../repositories/leadRepository.js';
import { casaDosDadosService } from './casaDosDadosService.js';
import { log } from './logService.js';

const receita = new ReceitaProvider();
const MAX_PAGES_PER_REQUEST = 8;

export interface DiscoverInput {
  uf?: string;
  municipio?: string;
  bairro?: string;
  cnaes?: string[];
  situacao?: string;
  portes?: string[];
  minAgeMonths?: number;
  maxAgeMonths?: number;
  onlyWithMobile?: boolean;
  count: number;
}

export function toProviderFilters(input: DiscoverInput): CompanySearchFilters {
  return {
    uf: input.uf || undefined,
    municipio: input.municipio || undefined,
    bairro: input.bairro || undefined,
    cnaes: input.cnaes?.length ? input.cnaes : ACCOUNTING_CNAES.map((c) => c.code),
    situacao: input.situacao || 'ATIVA',
    portes: input.portes ?? [],
    minAgeMonths: input.minAgeMonths,
    maxAgeMonths: input.maxAgeMonths,
    onlyWithMobile: input.onlyWithMobile,
    limit: 50,
  };
}

/** Monta o resultado de prospecção (empresa + contatos + lead) para uma lista de empresas. */
export async function buildResults(accountId: number, companies: Company[]): Promise<ProspectResult[]> {
  const ids = companies.map((c) => c.id);
  const contacts = await companyRepository.contactsByCompany(accountId, ids);
  const leads = ids.length
    ? await db().query(
        `SELECT id, company_id, status, contact_count, last_contact_at, do_not_contact FROM leads
         WHERE account_id = $1 AND company_id = ANY($2::int[])`,
        [accountId, ids],
      )
    : [];
  return companies.map((company) => {
    const own = contacts.filter((c) => c.companyId === company.id);
    const lead = leads.find((l) => l.company_id === company.id);
    return {
      company,
      contacts: own,
      primaryContact: own.find((c) => c.isPrimary) ?? null,
      lead: lead
        ? {
            id: lead.id,
            status: lead.status,
            contactCount: lead.contact_count,
            lastContactAt: lead.last_contact_at instanceof Date ? lead.last_contact_at.toISOString() : lead.last_contact_at,
            doNotContact: lead.do_not_contact,
          }
        : null,
      alreadyWorked: !!lead && lead.contact_count > 0,
    };
  });
}

/**
 * "Descobrir novos" / "Buscar 20 novos" / "Próximos 20".
 * A deduplicação acontece aqui: CNPJs já apresentados, trabalhados ou em opt-out nunca voltam.
 */
export async function discover(accountId: number, userId: number, input: DiscoverInput, mode: 'new' | 'next', searchId?: number) {
  const count = Math.min(Math.max(input.count || 20, 1), 100);
  let search: any;
  if (mode === 'next') {
    search = searchId
      ? await db().maybeOne('SELECT * FROM prospect_searches WHERE id = $1 AND account_id = $2', [searchId, accountId])
      : await db().maybeOne('SELECT * FROM prospect_searches WHERE account_id = $1 AND user_id = $2 ORDER BY id DESC LIMIT 1', [accountId, userId]);
    if (!search) throw badRequest('Nenhuma busca anterior. Use "Descobrir novos" primeiro.');
  } else {
    search = await db().one(
      'INSERT INTO prospect_searches (account_id, user_id, filters) VALUES ($1,$2,$3) RETURNING *',
      [accountId, userId, JSON.stringify(input)],
    );
  }
  const savedInput: DiscoverInput = { ...(search.filters as DiscoverInput), count };
  const filters = toProviderFilters(savedInput);
  let page = search.next_page as number;
  let total: number | null = search.total ?? null;
  let exhausted = false;
  let skippedDuplicates = 0;
  let skippedPorte = 0;
  const found: Company[] = [];

  for (let i = 0; i < MAX_PAGES_PER_REQUEST && found.length < count; i++) {
    const result = await casaDosDadosService.search(accountId, userId, filters, page);
    total = result.total ?? total;
    const existing = await companyRepository.existingCnpjs(accountId, result.items.map((r) => r.cnpj));
    let consumedAll = true;
    for (const rec of result.items) {
      if (found.length >= count) {
        consumedAll = false;
        break;
      }
      if (existing.has(rec.cnpj)) {
        skippedDuplicates++;
        continue;
      }
      if (filters.portes.length && rec.porte && !filters.portes.includes(rec.porte)) {
        skippedPorte++;
        continue;
      }
      const company = await companyRepository.upsertFromRecord(db(), accountId, rec, 'casa_dos_dados', { presentedBy: userId });
      found.push(company);
    }
    // Se paramos no meio da página, a próxima chamada reaproveita a mesma página (os já apresentados são pulados).
    if (!consumedAll) break;
    page += 1;
    if (!result.hasMore) {
      exhausted = true;
      break;
    }
  }

  await db().query(
    'UPDATE prospect_searches SET next_page = $2, total = $3, result_count = result_count + $4 WHERE id = $1',
    [search.id, page, total, found.length],
  );
  await log({
    accountId,
    userId,
    category: 'prospeccao',
    action: mode === 'new' ? 'discover' : 'discover_next',
    message: `${found.length} empresas novas encontradas`,
    meta: { searchId: search.id, skippedDuplicates, skippedPorte, page },
  });
  return {
    searchId: search.id as number,
    criteria: savedInput,
    total,
    exhausted,
    skippedDuplicates,
    skippedPorte,
    results: await buildResults(accountId, found),
  };
}

export async function recentPresented(accountId: number, userId: number, limit = 100) {
  const rows = await db().query(
    `SELECT id FROM companies WHERE account_id = $1 AND presented_by = $2 ORDER BY presented_at DESC NULLS LAST, id DESC LIMIT $3`,
    [accountId, userId, limit],
  );
  const companies = await Promise.all(rows.map((r) => companyRepository.findById(accountId, r.id)));
  return buildResults(accountId, companies.filter(Boolean) as Company[]);
}

export async function lastSearch(accountId: number, userId: number) {
  return db().maybeOne(
    'SELECT id, filters, next_page, total, result_count, created_at FROM prospect_searches WHERE account_id = $1 AND user_id = $2 ORDER BY id DESC LIMIT 1',
    [accountId, userId],
  );
}

/** "Já usamos este CNPJ?" */
export async function checkCnpj(accountId: number, cnpjInput: string) {
  const cnpj = normalizeCnpj(cnpjInput);
  if (!isValidCnpj(cnpj)) throw badRequest('CNPJ inválido.');
  const company = await companyRepository.findByCnpj(accountId, cnpj);
  const optOut = await db().maybeOne('SELECT reason, created_at FROM opt_outs WHERE account_id = $1 AND cnpj = $2 LIMIT 1', [accountId, cnpj]);
  if (!company) return { cnpj, used: false, optOut: !!optOut, company: null, lead: null, history: [] };
  const lead = await leadRepository.findByCompany(accountId, company.id);
  const history = lead ? await historyRepository.listForLead(accountId, lead.id) : [];
  const [result] = await buildResults(accountId, [company]);
  return {
    cnpj,
    used: !!lead && lead.contactCount > 0,
    presented: !!company.presentedAt,
    optOut: !!optOut,
    company: result,
    lead,
    history,
  };
}

/** Aplica os dados detalhados (sócios/telefones) e define o contato principal: sócio + celular. */
async function applyDetail(accountId: number, userId: number, rec: CompanyRecord, source: string) {
  return db().tx(async (q) => {
    const company = await companyRepository.upsertFromRecord(q, accountId, rec, source, { enrichment: 'found' });
    const existing = await q.query('SELECT id, name, phone FROM contacts WHERE company_id = $1', [company.id]);
    const byName = new Map(existing.filter((c) => c.name).map((c) => [String(c.name).toUpperCase(), c]));
    const contactIds: number[] = [];
    for (const partner of rec.partners) {
      const found = byName.get(partner.name.toUpperCase());
      if (found) {
        contactIds.push(found.id);
        continue;
      }
      const c = await companyRepository.insertContact(q, accountId, { companyId: company.id, name: partner.name, role: partner.role, source });
      contactIds.push(c.id);
    }
    const mobile = rec.phones.find((p) => p.type === 'celular') ?? null;
    const anyPhone = mobile ?? rec.phones[0] ?? null;
    let primaryId: number | null = contactIds[0] ?? null;
    if (primaryId === null && anyPhone) {
      const c = await companyRepository.insertContact(q, accountId, { companyId: company.id, name: null, source });
      primaryId = c.id;
    }
    if (primaryId !== null) {
      await companyRepository.setPrimary(q, accountId, company.id, primaryId);
      if (anyPhone) {
        await q.query(`UPDATE contacts SET phone = COALESCE(phone, $2), phone_type = COALESCE(phone_type, $3) WHERE id = $1`, [
          primaryId,
          anyPhone.phone,
          isMobile(anyPhone.phone) ? 'celular' : anyPhone.type,
        ]);
      }
    }
    const leadId = await leadRepository.ensure(q, accountId, company.id, primaryId, userId);
    await historyRepository.add(q, {
      accountId,
      leadId,
      companyId: company.id,
      userId,
      type: 'enrichment',
      description: `Contatos obtidos via ${source === 'receita' ? 'Receita Federal' : 'Casa dos Dados'}: ${rec.partners.length} sócio(s), ${rec.phones.length} telefone(s)`,
    });
    return company;
  });
}

/** "Trazer contatos" (Casa dos Dados) ou "Tentar pela Receita". */
export async function fetchContacts(accountId: number, userId: number, cnpjInput: string, source: 'casa_dos_dados' | 'receita', opts: { useCache?: boolean } = {}) {
  const cnpj = normalizeCnpj(cnpjInput);
  if (!isValidCnpj(cnpj)) throw badRequest('CNPJ inválido.');
  let company = await companyRepository.findByCnpj(accountId, cnpj);
  let rec: CompanyRecord | null;
  try {
    rec =
      source === 'receita'
        ? await receita.getCompany(cnpj)
        : await casaDosDadosService.getCompany(accountId, userId, cnpj, { useCache: opts.useCache });
    if (source === 'receita') {
      await log({ accountId, userId, category: 'receita', action: 'detail', message: `Consulta Receita ${cnpj}`, meta: { found: !!rec } });
    }
  } catch (err) {
    // Erro de consulta é diferente de "não encontrado".
    if (company) {
      await companyRepository.setEnrichment(accountId, company.id, 'error', err instanceof IntegrationError ? err.userMessage : 'Erro na consulta');
    }
    throw err;
  }
  if (!rec) {
    if (!company) {
      throw notFound('Empresa não encontrada na fonte consultada.');
    }
    await companyRepository.setEnrichment(accountId, company.id, 'not_found', null);
    company = await companyRepository.findById(accountId, company.id);
    const [result] = await buildResults(accountId, [company!]);
    return { status: 'not_found' as const, result };
  }
  company = await applyDetail(accountId, userId, { ...rec, cnpj }, source);
  const [result] = await buildResults(accountId, [company]);
  return {
    status: result.primaryContact?.phone ? ('found' as const) : ('partial' as const),
    result,
  };
}

export async function addManualContact(
  accountId: number,
  userId: number,
  companyId: number,
  data: { name: string | null; role?: string | null; phone: string | null; makePrimary?: boolean },
): Promise<Contact> {
  const company = await companyRepository.findById(accountId, companyId);
  if (!company) throw notFound('Empresa não encontrada.');
  return db().tx(async (q) => {
    const contact = await companyRepository.insertContact(q, accountId, {
      companyId,
      name: data.name,
      role: data.role ?? null,
      phone: data.phone,
      phoneType: data.phone ? (isMobile(data.phone) ? 'celular' : 'fixo') : null,
      source: 'manual',
    });
    const leadId = await leadRepository.ensure(q, accountId, companyId, contact.id, userId);
    if (data.makePrimary) {
      await companyRepository.setPrimary(q, accountId, companyId, contact.id);
      await q.query('UPDATE leads SET contact_id = $2 WHERE id = $1', [leadId, contact.id]);
    }
    await historyRepository.add(q, { accountId, leadId, companyId, userId, type: 'contact_added', description: `Contato adicionado manualmente: ${data.name ?? data.phone}` });
    return contact;
  });
}
