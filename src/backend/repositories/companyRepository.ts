// Empresas e contatos (sócios/telefones).
import { camel, camelAll, db, type Queryable } from '../../db/dbClient.js';
import type { Company, Contact } from '../../shared/types.js';
import type { CompanyRecord } from '../integrations/DataProvider.js';

const COMPANY_COLS = `id, cnpj, razao_social, nome_fantasia, situacao, cnae, cnae_descricao, data_abertura, porte,
  logradouro, numero, bairro, cidade, uf, cep, email, phones, source, enrichment_status, enrichment_error,
  enriched_at, presented_at`;

export const companyRepository = {
  async findById(accountId: number, id: number): Promise<Company | null> {
    return camel(await db().maybeOne(`SELECT ${COMPANY_COLS} FROM companies WHERE account_id = $1 AND id = $2`, [accountId, id]));
  },
  async findByCnpj(accountId: number, cnpj: string): Promise<Company | null> {
    return camel(await db().maybeOne(`SELECT ${COMPANY_COLS} FROM companies WHERE account_id = $1 AND cnpj = $2`, [accountId, cnpj]));
  },
  async existingCnpjs(accountId: number, cnpjs: string[]): Promise<Set<string>> {
    if (!cnpjs.length) return new Set();
    const rows = await db().query(
      `SELECT cnpj FROM companies WHERE account_id = $1 AND cnpj = ANY($2::text[])
       UNION SELECT cnpj FROM opt_outs WHERE account_id = $1 AND cnpj = ANY($2::text[])`,
      [accountId, cnpjs],
    );
    return new Set(rows.map((r) => r.cnpj));
  },
  /**
   * Insere ou atualiza a empresa com os dados do fornecedor.
   * Campos vazios no fornecedor NÃO apagam dados existentes.
   */
  async upsertFromRecord(
    q: Queryable,
    accountId: number,
    rec: CompanyRecord,
    source: string,
    opts: { presentedBy?: number; enrichment?: 'found' | 'pending' } = {},
  ): Promise<Company> {
    const [row] = await q.query(
      `INSERT INTO companies (account_id, cnpj, razao_social, nome_fantasia, situacao, cnae, cnae_descricao, data_abertura,
         porte, logradouro, numero, complemento, bairro, cidade, uf, cep, email, phones, raw, source, enrichment_status,
         enriched_at, presented_at, presented_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
         CASE WHEN $21 = 'found' THEN now() ELSE NULL END,
         CASE WHEN $22::int IS NOT NULL THEN now() ELSE NULL END, $22::int)
       ON CONFLICT (account_id, cnpj) DO UPDATE SET
         razao_social = COALESCE(EXCLUDED.razao_social, companies.razao_social),
         nome_fantasia = COALESCE(EXCLUDED.nome_fantasia, companies.nome_fantasia),
         situacao = COALESCE(EXCLUDED.situacao, companies.situacao),
         cnae = COALESCE(EXCLUDED.cnae, companies.cnae),
         cnae_descricao = COALESCE(EXCLUDED.cnae_descricao, companies.cnae_descricao),
         data_abertura = COALESCE(EXCLUDED.data_abertura, companies.data_abertura),
         porte = COALESCE(EXCLUDED.porte, companies.porte),
         logradouro = COALESCE(EXCLUDED.logradouro, companies.logradouro),
         numero = COALESCE(EXCLUDED.numero, companies.numero),
         complemento = COALESCE(EXCLUDED.complemento, companies.complemento),
         bairro = COALESCE(EXCLUDED.bairro, companies.bairro),
         cidade = COALESCE(EXCLUDED.cidade, companies.cidade),
         uf = COALESCE(EXCLUDED.uf, companies.uf),
         cep = COALESCE(EXCLUDED.cep, companies.cep),
         email = COALESCE(EXCLUDED.email, companies.email),
         phones = CASE WHEN jsonb_array_length(EXCLUDED.phones) > 0 THEN EXCLUDED.phones ELSE companies.phones END,
         raw = COALESCE(EXCLUDED.raw, companies.raw),
         source = CASE WHEN EXCLUDED.enrichment_status = 'found' THEN EXCLUDED.source ELSE companies.source END,
         enrichment_status = CASE WHEN EXCLUDED.enrichment_status = 'found' THEN 'found' ELSE companies.enrichment_status END,
         enrichment_error = CASE WHEN EXCLUDED.enrichment_status = 'found' THEN NULL ELSE companies.enrichment_error END,
         enriched_at = CASE WHEN EXCLUDED.enrichment_status = 'found' THEN now() ELSE companies.enriched_at END,
         presented_at = COALESCE(companies.presented_at, EXCLUDED.presented_at),
         presented_by = COALESCE(companies.presented_by, EXCLUDED.presented_by),
         updated_at = now()
       RETURNING ${COMPANY_COLS}`,
      [
        accountId, rec.cnpj, rec.razaoSocial, rec.nomeFantasia, rec.situacao, rec.cnae, rec.cnaeDescricao, rec.dataAbertura,
        rec.porte, rec.logradouro, rec.numero, rec.complemento, rec.bairro, rec.cidade, rec.uf, rec.cep, rec.email,
        JSON.stringify(rec.phones), rec.raw ? JSON.stringify(rec.raw) : null, source, opts.enrichment ?? 'pending',
        opts.presentedBy ?? null,
      ],
    );
    return camel(row);
  },
  async setEnrichment(accountId: number, id: number, status: 'not_found' | 'error', error: string | null) {
    await db().query(
      `UPDATE companies SET enrichment_status = $3, enrichment_error = $4, updated_at = now() WHERE account_id = $1 AND id = $2`,
      [accountId, id, status, error],
    );
  },

  // ---------- contatos ----------
  async contactsByCompany(accountId: number, companyIds: number[]): Promise<Contact[]> {
    if (!companyIds.length) return [];
    return camelAll(
      await db().query(
        `SELECT id, company_id, name, role, phone, phone_type, is_primary, source FROM contacts
         WHERE account_id = $1 AND company_id = ANY($2::int[]) ORDER BY is_primary DESC, id`,
        [accountId, companyIds],
      ),
    );
  },
  async findContact(accountId: number, id: number): Promise<Contact | null> {
    return camel(
      await db().maybeOne(
        `SELECT id, company_id, name, role, phone, phone_type, is_primary, source FROM contacts WHERE account_id = $1 AND id = $2`,
        [accountId, id],
      ),
    );
  },
  async findContactByPhone(accountId: number, phone: string): Promise<Contact | null> {
    return camel(
      await db().maybeOne(
        `SELECT id, company_id, name, role, phone, phone_type, is_primary, source FROM contacts
         WHERE account_id = $1 AND phone = $2 ORDER BY is_primary DESC, id LIMIT 1`,
        [accountId, phone],
      ),
    );
  },
  async insertContact(
    q: Queryable,
    accountId: number,
    data: { companyId: number | null; name: string | null; role?: string | null; phone?: string | null; phoneType?: string | null; isPrimary?: boolean; source: string },
  ): Promise<Contact> {
    const [row] = await q.query(
      `INSERT INTO contacts (account_id, company_id, name, role, phone, phone_type, is_primary, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, company_id, name, role, phone, phone_type, is_primary, source`,
      [accountId, data.companyId, data.name, data.role ?? null, data.phone ?? null, data.phoneType ?? null, !!data.isPrimary, data.source],
    );
    return camel(row);
  },
  async updateContact(accountId: number, id: number, data: { name?: string | null; role?: string | null; phone?: string | null; phoneType?: string | null }) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const map: Record<string, string> = { name: 'name', role: 'role', phone: 'phone', phoneType: 'phone_type' };
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      params.push(v);
      sets.push(`${map[k]} = $${params.length}`);
    }
    if (!sets.length) return this.findContact(accountId, id);
    params.push(accountId, id);
    return camel<Contact>(
      await db().maybeOne(
        `UPDATE contacts SET ${sets.join(', ')} WHERE account_id = $${params.length - 1} AND id = $${params.length}
         RETURNING id, company_id, name, role, phone, phone_type, is_primary, source`,
        params,
      ),
    );
  },
  async setPrimary(q: Queryable, accountId: number, companyId: number, contactId: number) {
    await q.query(`UPDATE contacts SET is_primary = (id = $3) WHERE account_id = $1 AND company_id = $2`, [accountId, companyId, contactId]);
  },
};
