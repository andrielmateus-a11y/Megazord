// Campanhas: público, mensagem, janela de horário, intervalo, limite diário, canais participantes e cadência.
import { camel, db } from '../../db/dbClient.js';
import type { Campaign, CampaignAudience, CadenceStep } from '../../shared/types.js';
import { renderTemplate } from '../../shared/text.js';
import { badRequest, notFound } from '../lib/errors.js';
import { emitQueue, enqueue } from '../queue/queueService.js';
import { checkEligibility } from './eligibilityService.js';
import { log } from './logService.js';
import { realtime } from './realtime.js';
import { rotationOverview } from './rotationService.js';

export interface CampaignInput {
  name: string;
  templateId: number;
  audience: CampaignAudience;
  channelIds: number[];
  startAt?: string | null;
  windowStart: string;
  windowEnd: string;
  weekdays: number[];
  intervalSeconds: number;
  dailyLimit: number;
  cadence?: CadenceStep[];
}

async function mapCampaign(row: any): Promise<Campaign> {
  const c = camel<any>(row);
  const stats = await db().one<Campaign["stats"]>(
    `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE status IN ('pending','queued'))::int AS pending,
       count(*) FILTER (WHERE status = 'sent')::int AS sent,
       count(*) FILTER (WHERE status IN ('skipped','cancelled'))::int AS skipped,
       count(*) FILTER (WHERE status = 'error')::int AS error
     FROM campaign_contacts WHERE campaign_id = $1`,
    [c.id],
  );
  return {
    id: c.id,
    name: c.name,
    templateId: c.templateId,
    templateName: c.templateName ?? null,
    audience: c.audience ?? {},
    channelIds: c.channelIds ?? [],
    startAt: c.startAt,
    windowStart: c.windowStart,
    windowEnd: c.windowEnd,
    weekdays: c.weekdays ?? [],
    intervalSeconds: c.intervalSeconds,
    dailyLimit: c.dailyLimit,
    cadence: c.cadence ?? [],
    status: c.status,
    createdAt: c.createdAt,
    stats,
  };
}

const SELECT = `SELECT c.*, t.name AS template_name FROM campaigns c LEFT JOIN message_templates t ON t.id = c.template_id`;

export async function listCampaigns(accountId: number) {
  const rows = await db().query(`${SELECT} WHERE c.account_id = $1 ORDER BY c.id DESC`, [accountId]);
  return Promise.all(rows.map(mapCampaign));
}

export async function getCampaign(accountId: number, id: number) {
  const row = await db().maybeOne(`${SELECT} WHERE c.account_id = $1 AND c.id = $2`, [accountId, id]);
  if (!row) throw notFound('Campanha não encontrada.');
  return mapCampaign(row);
}

async function validateRefs(accountId: number, input: CampaignInput) {
  const t = await db().maybeOne('SELECT id FROM message_templates WHERE account_id = $1 AND id = $2', [accountId, input.templateId]);
  if (!t) throw badRequest('Selecione uma mensagem de ativação válida.');
  if (!input.channelIds.length) throw badRequest('Selecione ao menos um WhatsApp participante.');
  const chs = await db().query('SELECT id FROM whatsapp_channels WHERE account_id = $1 AND id = ANY($2::int[])', [accountId, input.channelIds]);
  if (chs.length !== input.channelIds.length) throw badRequest('Canal inválido na seleção.');
  for (const step of input.cadence ?? []) {
    const ok = await db().maybeOne('SELECT id FROM message_templates WHERE account_id = $1 AND id = $2', [accountId, step.templateId]);
    if (!ok) throw badRequest(`Mensagem inválida na etapa ${step.step} da cadência.`);
  }
}

function normalizeCadence(input: CampaignInput): CadenceStep[] {
  // Etapa 1 é sempre a ativação (dia 0) com o template principal.
  const extra = (input.cadence ?? []).filter((s) => s.step > 1).sort((a, b) => a.step - b.step);
  return extra.length ? [{ step: 1, dayOffset: 0, templateId: input.templateId }, ...extra] : [];
}

export async function createCampaign(accountId: number, userId: number, input: CampaignInput) {
  await validateRefs(accountId, input);
  const row = await db().one(
    `INSERT INTO campaigns (account_id, name, template_id, audience, channel_ids, start_at, window_start, window_end, weekdays,
       interval_seconds, daily_limit, cadence, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [
      accountId, input.name, input.templateId, JSON.stringify(input.audience), JSON.stringify(input.channelIds), input.startAt ?? null,
      input.windowStart, input.windowEnd, JSON.stringify(input.weekdays), input.intervalSeconds, input.dailyLimit,
      JSON.stringify(normalizeCadence(input)), userId,
    ],
  );
  await log({ accountId, userId, category: 'campaign', action: 'create', message: `Campanha "${input.name}" criada` });
  return getCampaign(accountId, row.id);
}

export async function updateCampaign(accountId: number, userId: number, id: number, input: CampaignInput) {
  const current = await getCampaign(accountId, id);
  if (!['draft', 'paused', 'scheduled'].includes(current.status)) throw badRequest('Só é possível editar campanhas em rascunho, agendadas ou pausadas.');
  await validateRefs(accountId, input);
  await db().query(
    `UPDATE campaigns SET name = $3, template_id = $4, audience = $5, channel_ids = $6, start_at = $7, window_start = $8,
       window_end = $9, weekdays = $10, interval_seconds = $11, daily_limit = $12, cadence = $13, updated_at = now()
     WHERE account_id = $1 AND id = $2`,
    [
      accountId, id, input.name, input.templateId, JSON.stringify(input.audience), JSON.stringify(input.channelIds), input.startAt ?? null,
      input.windowStart, input.windowEnd, JSON.stringify(input.weekdays), input.intervalSeconds, input.dailyLimit,
      JSON.stringify(normalizeCadence(input)),
    ],
  );
  await log({ accountId, userId, category: 'campaign', action: 'update', message: `Campanha "${input.name}" atualizada` });
  return getCampaign(accountId, id);
}

/** Leads do público da campanha (com contato principal e celular). */
export async function resolveAudience(accountId: number, audience: CampaignAudience) {
  const where = ['l.account_id = $1', 'ct.phone IS NOT NULL', 'l.do_not_contact = false'];
  const params: unknown[] = [accountId];
  if (audience.leadIds?.length) {
    params.push(audience.leadIds);
    where.push(`l.id = ANY($${params.length}::int[])`);
  }
  if (audience.statuses?.length) {
    params.push(audience.statuses);
    where.push(`l.status = ANY($${params.length}::text[])`);
  }
  if (audience.uf) {
    params.push(audience.uf.toUpperCase());
    where.push(`c.uf = $${params.length}`);
  }
  if (audience.cidade) {
    params.push(audience.cidade.toLowerCase());
    where.push(`lower(c.cidade) = $${params.length}`);
  }
  if (audience.onlyNeverContacted !== false) where.push('l.contact_count = 0');
  params.push(Math.min(audience.limit ?? 500, 5000));
  return db().query(
    `SELECT l.id AS lead_id, l.company_id, ct.id AS contact_id, ct.phone, ct.name AS socio, c.cnpj,
       COALESCE(c.nome_fantasia, c.razao_social) AS empresa, c.cidade
     FROM leads l JOIN companies c ON c.id = l.company_id JOIN contacts ct ON ct.id = l.contact_id
     WHERE ${where.join(' AND ')} ORDER BY l.created_at LIMIT $${params.length}`,
    params,
  );
}

/** Pré-visualização com exemplos reais e o canal previsto para cada um. */
export async function previewCampaign(accountId: number, input: { audience: CampaignAudience; templateId: number; channelIds: number[] }) {
  const template = await db().maybeOne('SELECT body FROM message_templates WHERE account_id = $1 AND id = $2', [accountId, input.templateId]);
  if (!template) throw badRequest('Selecione uma mensagem de ativação.');
  const audience = await resolveAudience(accountId, input.audience);
  const rotation = await rotationOverview(accountId, input.channelIds, 8);
  const samples = audience.slice(0, 5).map((lead, i) => {
    const ch = rotation.sequence.length ? rotation.sequence[i % rotation.sequence.length] : null;
    const next = rotation.sequence.length ? rotation.sequence[(i + 1) % rotation.sequence.length] : null;
    return {
      leadId: lead.lead_id,
      empresa: lead.empresa,
      socio: lead.socio,
      phone: lead.phone,
      message: renderTemplate(template.body, { socio: lead.socio, empresa: lead.empresa, telefone: lead.phone, cidade: lead.cidade, cnpj: lead.cnpj }),
      channel: ch,
      next,
    };
  });
  return { audienceCount: audience.length, samples, rotation };
}

export async function startCampaign(accountId: number, userId: number, id: number) {
  const campaign = await getCampaign(accountId, id);
  if (!['draft', 'paused', 'scheduled'].includes(campaign.status)) throw badRequest('Campanha não pode ser iniciada neste estado.');
  if (campaign.status === 'paused') {
    await db().query(`UPDATE campaigns SET status = 'running', updated_at = now() WHERE id = $1`, [id]);
    await db().query(`UPDATE message_queue SET status = 'pending' WHERE campaign_id = $1 AND status = 'paused'`, [id]);
    await log({ accountId, userId, category: 'campaign', action: 'resume', message: `Campanha "${campaign.name}" retomada` });
  } else {
    const audience = await resolveAudience(accountId, campaign.audience);
    if (!audience.length) throw badRequest('O público da campanha está vazio (leads precisam de contato com celular).');
    const scheduledAt = campaign.startAt && Date.parse(campaign.startAt) > Date.now() ? new Date(campaign.startAt) : new Date();
    let queued = 0;
    let skipped = 0;
    for (const lead of audience) {
      const exists = await db().maybeOne('SELECT id FROM campaign_contacts WHERE campaign_id = $1 AND lead_id = $2', [id, lead.lead_id]);
      if (exists) continue;
      const eligibility = await checkEligibility({ accountId, phone: lead.phone, leadId: lead.lead_id, kind: 'activation' });
      if (!eligibility.ok) {
        await db().query(`INSERT INTO campaign_contacts (campaign_id, lead_id, contact_id, status, reason) VALUES ($1,$2,$3,'skipped',$4)`, [id, lead.lead_id, lead.contact_id, eligibility.reason]);
        skipped++;
        continue;
      }
      await db().tx(async (q) => {
        await enqueue(q, {
          accountId,
          userId,
          phone: lead.phone,
          leadId: lead.lead_id,
          companyId: lead.company_id,
          contactId: lead.contact_id,
          templateId: campaign.templateId,
          campaignId: id,
          kind: 'activation',
          step: 1,
          scheduledAt,
        });
        await q.query(`INSERT INTO campaign_contacts (campaign_id, lead_id, contact_id, status) VALUES ($1,$2,$3,'queued')`, [id, lead.lead_id, lead.contact_id]);
      });
      queued++;
    }
    const status = scheduledAt.getTime() > Date.now() + 1000 ? 'scheduled' : 'running';
    await db().query(`UPDATE campaigns SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
    await log({ accountId, userId, category: 'campaign', action: 'start', message: `Campanha "${campaign.name}" iniciada: ${queued} na fila, ${skipped} ignorado(s)`, meta: { campaignId: id, queued, skipped } });
  }
  await emitQueue(accountId);
  realtime.emit(accountId, 'campaign.updated', { campaignId: id });
  return getCampaign(accountId, id);
}

export async function pauseCampaign(accountId: number, userId: number, id: number) {
  const campaign = await getCampaign(accountId, id);
  if (!['running', 'scheduled'].includes(campaign.status)) throw badRequest('Campanha não está em execução.');
  await db().query(`UPDATE campaigns SET status = 'paused', updated_at = now() WHERE id = $1`, [id]);
  await db().query(`UPDATE message_queue SET status = 'paused' WHERE campaign_id = $1 AND status = 'pending'`, [id]);
  await log({ accountId, userId, category: 'campaign', action: 'pause', message: `Campanha "${campaign.name}" pausada` });
  await emitQueue(accountId);
  realtime.emit(accountId, 'campaign.updated', { campaignId: id });
  return getCampaign(accountId, id);
}

export async function cancelCampaign(accountId: number, userId: number, id: number) {
  const campaign = await getCampaign(accountId, id);
  await db().query(`UPDATE campaigns SET status = 'cancelled', updated_at = now() WHERE id = $1`, [id]);
  await db().query(`UPDATE message_queue SET status = 'cancelled', skip_reason = 'Campanha cancelada' WHERE campaign_id = $1 AND status IN ('pending','paused')`, [id]);
  await db().query(`UPDATE campaign_contacts SET status = 'cancelled' WHERE campaign_id = $1 AND status IN ('pending','queued')`, [id]);
  await log({ accountId, userId, category: 'campaign', action: 'cancel', message: `Campanha "${campaign.name}" cancelada` });
  await emitQueue(accountId);
  realtime.emit(accountId, 'campaign.updated', { campaignId: id });
  return getCampaign(accountId, id);
}

export async function deleteCampaign(accountId: number, userId: number, id: number) {
  const campaign = await getCampaign(accountId, id);
  if (campaign.status === 'running') throw badRequest('Pause ou cancele a campanha antes de excluir.');
  await db().query('DELETE FROM campaigns WHERE account_id = $1 AND id = $2', [accountId, id]);
  await log({ accountId, userId, category: 'campaign', action: 'delete', message: `Campanha "${campaign.name}" excluída` });
}
