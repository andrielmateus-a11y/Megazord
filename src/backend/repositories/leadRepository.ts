// Leads: o vínculo comercial entre empresa, contato principal, canal e conversas.
import { camel, db, type Queryable, type Row } from '../../db/dbClient.js';
import type { Lead } from '../../shared/types.js';
import type { LeadStatus, LeadStatus as LS } from '../../shared/constants.js';
import { channelLabel } from '../../shared/constants.js';

export const LEAD_SELECT = `
  SELECT l.*, u.name AS owner_name, ch.order_index AS last_channel_order,
    c.id AS c_id, c.cnpj AS c_cnpj, c.razao_social AS c_razao_social, c.nome_fantasia AS c_nome_fantasia,
    c.situacao AS c_situacao, c.cnae AS c_cnae, c.cnae_descricao AS c_cnae_descricao, c.data_abertura AS c_data_abertura,
    c.porte AS c_porte, c.logradouro AS c_logradouro, c.numero AS c_numero, c.bairro AS c_bairro, c.cidade AS c_cidade,
    c.uf AS c_uf, c.cep AS c_cep, c.email AS c_email, c.phones AS c_phones, c.source AS c_source,
    c.enrichment_status AS c_enrichment_status, c.enrichment_error AS c_enrichment_error, c.enriched_at AS c_enriched_at,
    c.presented_at AS c_presented_at,
    ct.id AS ct_id, ct.company_id AS ct_company_id, ct.name AS ct_name, ct.role AS ct_role, ct.phone AS ct_phone,
    ct.phone_type AS ct_phone_type, ct.is_primary AS ct_is_primary, ct.source AS ct_source,
    EXISTS (SELECT 1 FROM opt_outs o WHERE o.account_id = l.account_id AND (o.cnpj = c.cnpj OR (ct.phone IS NOT NULL AND o.phone = ct.phone))) AS opt_out
  FROM leads l
  JOIN companies c ON c.id = l.company_id
  LEFT JOIN contacts ct ON ct.id = l.contact_id
  LEFT JOIN users u ON u.id = l.owner_user_id
  LEFT JOIN whatsapp_channels ch ON ch.id = l.last_channel_id`;

function prefixed(row: Row, prefix: string) {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}

export function mapLead(row: Row): Lead {
  const base = camel<any>(
    Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('c_') && !k.startsWith('ct_'))),
  );
  const company = camel<any>(prefixed(row, 'c_'));
  const contactRaw = prefixed(row, 'ct_');
  return {
    id: base.id,
    companyId: base.companyId,
    contactId: base.contactId,
    status: base.status,
    ownerUserId: base.ownerUserId,
    ownerName: base.ownerName ?? null,
    lastChannelId: base.lastChannelId,
    lastChannelLabel: base.lastChannelOrder ? channelLabel(base.lastChannelOrder) : null,
    firstContactAt: base.firstContactAt,
    lastContactAt: base.lastContactAt,
    lastReplyAt: base.lastReplyAt,
    contactCount: base.contactCount,
    notes: base.notes,
    doNotContact: base.doNotContact,
    optOut: !!base.optOut,
    createdAt: base.createdAt,
    company,
    contact: contactRaw.id ? camel(contactRaw) : null,
  };
}

export interface LeadFilters {
  status?: LeadStatus;
  search?: string;
  ownerUserId?: number;
  uf?: string;
  onlyWorked?: boolean;
  limit?: number;
  offset?: number;
}

export const leadRepository = {
  async findById(accountId: number, id: number): Promise<Lead | null> {
    const row = await db().maybeOne(`${LEAD_SELECT} WHERE l.account_id = $1 AND l.id = $2`, [accountId, id]);
    return row ? mapLead(row) : null;
  },
  async findByCompany(accountId: number, companyId: number): Promise<Lead | null> {
    const row = await db().maybeOne(`${LEAD_SELECT} WHERE l.account_id = $1 AND l.company_id = $2`, [accountId, companyId]);
    return row ? mapLead(row) : null;
  },
  async list(accountId: number, f: LeadFilters) {
    const where = ['l.account_id = $1'];
    const params: unknown[] = [accountId];
    if (f.status) {
      params.push(f.status);
      where.push(`l.status = $${params.length}`);
    }
    if (f.ownerUserId) {
      params.push(f.ownerUserId);
      where.push(`l.owner_user_id = $${params.length}`);
    }
    if (f.uf) {
      params.push(f.uf.toUpperCase());
      where.push(`c.uf = $${params.length}`);
    }
    if (f.onlyWorked) where.push('l.contact_count > 0');
    if (f.search) {
      params.push(`%${f.search.toLowerCase()}%`);
      const p = `$${params.length}`;
      params.push(f.search.replace(/\D/g, '') || '__none__');
      const d = `$${params.length}`;
      where.push(`(lower(coalesce(c.razao_social,'')) LIKE ${p} OR lower(coalesce(c.nome_fantasia,'')) LIKE ${p}
        OR lower(coalesce(ct.name,'')) LIKE ${p} OR c.cnpj LIKE '%' || ${d} || '%' OR coalesce(ct.phone,'') LIKE '%' || ${d} || '%')`);
    }
    const total = (
      await db().one(
        `SELECT count(*)::int AS n FROM leads l JOIN companies c ON c.id = l.company_id LEFT JOIN contacts ct ON ct.id = l.contact_id
         WHERE ${where.join(' AND ')}`,
        params,
      )
    ).n as number;
    params.push(Math.min(f.limit ?? 50, 5000), f.offset ?? 0);
    const rows = await db().query(
      `${LEAD_SELECT} WHERE ${where.join(' AND ')}
       ORDER BY coalesce(l.last_contact_at, l.created_at) DESC, l.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { total, items: rows.map(mapLead) };
  },
  async ensure(q: Queryable, accountId: number, companyId: number, contactId: number | null, ownerUserId: number | null) {
    const [row] = await q.query(
      `INSERT INTO leads (account_id, company_id, contact_id, owner_user_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (account_id, company_id) DO UPDATE SET
         contact_id = COALESCE(leads.contact_id, EXCLUDED.contact_id),
         owner_user_id = COALESCE(leads.owner_user_id, EXCLUDED.owner_user_id),
         updated_at = now()
       RETURNING id`,
      [accountId, companyId, contactId, ownerUserId],
    );
    return row.id as number;
  },
  async update(
    accountId: number,
    id: number,
    data: Partial<{ status: LS; notes: string | null; doNotContact: boolean; contactId: number | null; ownerUserId: number | null }>,
  ) {
    const map: Record<string, string> = {
      status: 'status',
      notes: 'notes',
      doNotContact: 'do_not_contact',
      contactId: 'contact_id',
      ownerUserId: 'owner_user_id',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined || !map[k]) continue;
      params.push(v);
      sets.push(`${map[k]} = $${params.length}`);
    }
    if (!sets.length) return;
    params.push(accountId, id);
    await db().query(
      `UPDATE leads SET ${sets.join(', ')}, updated_at = now() WHERE account_id = $${params.length - 1} AND id = $${params.length}`,
      params,
    );
  },
  async registerOutbound(q: Queryable, leadId: number, channelId: number, userId: number | null) {
    await q.query(
      `UPDATE leads SET contact_count = contact_count + 1, last_contact_at = now(),
         first_contact_at = COALESCE(first_contact_at, now()), last_channel_id = $2,
         owner_user_id = COALESCE(owner_user_id, $3),
         status = CASE WHEN status IN ('novo','em_contato','nao_respondeu') THEN 'aguardando_resposta' ELSE status END,
         updated_at = now()
       WHERE id = $1`,
      [leadId, channelId, userId],
    );
  },
  async registerReply(q: Queryable, leadId: number) {
    await q.query(
      `UPDATE leads SET last_reply_at = now(),
         status = CASE WHEN status IN ('novo','aguardando_resposta','nao_respondeu') THEN 'em_contato' ELSE status END,
         updated_at = now()
       WHERE id = $1`,
      [leadId],
    );
  },
};

export const historyRepository = {
  async add(
    q: Queryable,
    entry: { accountId: number; leadId: number | null; companyId: number | null; userId?: number | null; channelId?: number | null; type: string; description: string },
  ) {
    await q.query(
      `INSERT INTO contact_history (account_id, lead_id, company_id, user_id, channel_id, type, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [entry.accountId, entry.leadId, entry.companyId, entry.userId ?? null, entry.channelId ?? null, entry.type, entry.description],
    );
  },
  async listForLead(accountId: number, leadId: number) {
    const rows = await db().query(
      `SELECT h.id, h.type, h.description, h.created_at, u.name AS user_name, ch.order_index
       FROM contact_history h LEFT JOIN users u ON u.id = h.user_id LEFT JOIN whatsapp_channels ch ON ch.id = h.channel_id
       WHERE h.account_id = $1 AND h.lead_id = $2 ORDER BY h.id DESC LIMIT 200`,
      [accountId, leadId],
    );
    return rows.map((r) => ({ ...camel<any>(r), channelLabel: r.order_index ? channelLabel(r.order_index) : null }));
  },
};
