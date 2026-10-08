// Operações comerciais sobre leads: status, observações, "Não contatar" e opt-out.
import { db } from '../../db/dbClient.js';
import { LEAD_STATUS_LABELS, type LeadStatus } from '../../shared/constants.js';
import { normalizePhone } from '../../shared/text.js';
import { notFound } from '../lib/errors.js';
import { historyRepository, leadRepository } from '../repositories/leadRepository.js';
import { log } from './logService.js';
import { realtime } from './realtime.js';

async function cancelPending(leadId: number, reason: string) {
  await db().query(
    `UPDATE message_queue SET status = 'cancelled', skip_reason = $2 WHERE lead_id = $1 AND status IN ('pending','paused')`,
    [leadId, reason],
  );
}

export async function updateLead(
  accountId: number,
  userId: number,
  id: number,
  data: { status?: LeadStatus; notes?: string | null; doNotContact?: boolean; contactId?: number | null; ownerUserId?: number | null },
) {
  const lead = await leadRepository.findById(accountId, id);
  if (!lead) throw notFound('Lead não encontrado.');
  const patch = { ...data };
  if (data.status === 'nao_contatar') patch.doNotContact = true;
  if (data.doNotContact === false && lead.status === 'nao_contatar' && !data.status) patch.status = 'novo';
  await leadRepository.update(accountId, id, patch);
  const entries: string[] = [];
  if (data.status && data.status !== lead.status) entries.push(`Status: ${LEAD_STATUS_LABELS[lead.status]} → ${LEAD_STATUS_LABELS[data.status]}`);
  if (patch.doNotContact !== undefined && patch.doNotContact !== lead.doNotContact) entries.push(patch.doNotContact ? 'Bloqueado: Não contatar' : 'Bloqueio "Não contatar" removido');
  if (data.notes !== undefined && data.notes !== lead.notes) entries.push('Observações atualizadas');
  if (patch.doNotContact || ['sem_interesse', 'convertido', 'reuniao_agendada'].includes(data.status ?? '')) {
    await cancelPending(id, 'Lead bloqueado/avançou no funil');
  }
  if (entries.length) {
    await historyRepository.add(db(), { accountId, leadId: id, companyId: lead.companyId, userId, type: 'lead_updated', description: entries.join(' · ') });
    await log({ accountId, userId, category: 'leads', action: 'update', message: `${lead.company.razaoSocial ?? lead.company.cnpj}: ${entries.join(' · ')}`, meta: { leadId: id } });
  }
  realtime.emit(accountId, 'lead.updated', { leadId: id });
  return leadRepository.findById(accountId, id);
}

export async function addOptOut(accountId: number, userId: number, input: { phone?: string | null; cnpj?: string | null; reason?: string | null; leadId?: number | null }) {
  let phone = normalizePhone(input.phone ?? null);
  let cnpj = input.cnpj?.replace(/\D/g, '') || null;
  if (input.leadId) {
    const lead = await leadRepository.findById(accountId, input.leadId);
    if (!lead) throw notFound('Lead não encontrado.');
    phone = phone ?? normalizePhone(lead.contact?.phone ?? null);
    cnpj = cnpj ?? lead.company.cnpj;
    await leadRepository.update(accountId, lead.id, { status: 'nao_contatar', doNotContact: true });
    await cancelPending(lead.id, 'Opt-out');
    await historyRepository.add(db(), { accountId, leadId: lead.id, companyId: lead.companyId, userId, type: 'opt_out', description: `Opt-out registrado${input.reason ? `: ${input.reason}` : ''}` });
    realtime.emit(accountId, 'lead.updated', { leadId: lead.id });
  }
  if (!phone && !cnpj) return null;
  if (phone) {
    await db().query(
      `UPDATE message_queue SET status = 'cancelled', skip_reason = 'Opt-out' WHERE account_id = $1 AND phone = $2 AND status IN ('pending','paused')`,
      [accountId, phone],
    );
  }
  const row = await db().one(
    'INSERT INTO opt_outs (account_id, phone, cnpj, reason, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [accountId, phone, cnpj, input.reason ?? null, userId],
  );
  await log({ accountId, userId, category: 'leads', action: 'opt_out', message: `Opt-out: ${phone ?? ''} ${cnpj ?? ''}`.trim() });
  return row.id;
}

export async function listOptOuts(accountId: number) {
  return db().query('SELECT id, phone, cnpj, reason, created_at FROM opt_outs WHERE account_id = $1 ORDER BY id DESC LIMIT 1000', [accountId]);
}

export async function removeOptOut(accountId: number, userId: number, id: number) {
  await db().query('DELETE FROM opt_outs WHERE account_id = $1 AND id = $2', [accountId, id]);
  await log({ accountId, userId, category: 'leads', action: 'opt_out_removed', message: `Opt-out #${id} removido` });
}
