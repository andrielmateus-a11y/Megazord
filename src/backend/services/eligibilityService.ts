// Regras de disponibilidade do CONTATO antes de qualquer disparo (duplicidade, opt-out, bloqueios).
// Se qualquer regra impedir → NÃO ENVIAR e registrar o motivo.
import { db } from '../../db/dbClient.js';
import { BLOCKING_LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadStatus } from '../../shared/constants.js';
import { normalizePhone } from '../../shared/text.js';

export interface EligibilityInput {
  accountId: number;
  phone: string;
  leadId?: number | null;
  cnpj?: string | null;
  kind: 'activation' | 'followup' | 'manual';
  /** Item de fila em processamento (não conta como envio anterior). */
  queueItemId?: number | null;
  /** Para follow-up: data do primeiro contato da sequência. */
  sequenceStartedAt?: string | null;
}

export interface Eligibility {
  ok: boolean;
  reason: string | null;
  /** true quando a sequência de cadência deve ser cancelada. */
  cancelSequence?: boolean;
}

const deny = (reason: string, cancelSequence = false): Eligibility => ({ ok: false, reason, cancelSequence });

export async function checkEligibility(input: EligibilityInput): Promise<Eligibility> {
  const phone = normalizePhone(input.phone);
  if (!phone) return deny('Telefone inválido', true);

  const lead = input.leadId
    ? await db().maybeOne(
        `SELECT l.status, l.do_not_contact, l.contact_count, l.last_reply_at, l.first_contact_at, c.cnpj
         FROM leads l JOIN companies c ON c.id = l.company_id WHERE l.id = $1 AND l.account_id = $2`,
        [input.leadId, input.accountId],
      )
    : null;
  const cnpj = input.cnpj ?? lead?.cnpj ?? null;

  const optOut = await db().maybeOne(
    `SELECT reason FROM opt_outs WHERE account_id = $1 AND (phone = $2 OR ($3::text IS NOT NULL AND cnpj = $3)) LIMIT 1`,
    [input.accountId, phone, cnpj],
  );
  if (optOut) return deny('Contato em opt-out', true);

  if (lead) {
    if (lead.do_not_contact) return deny('Contato marcado como "Não contatar"', true);
    if (input.kind !== 'manual' && BLOCKING_LEAD_STATUSES.includes(lead.status as LeadStatus)) {
      return deny(`Lead com status "${LEAD_STATUS_LABELS[lead.status as LeadStatus]}"`, true);
    }
  }

  if (input.kind === 'activation') {
    if (lead && lead.contact_count > 0) return deny('CNPJ já trabalhado (lead já recebeu contato)');
    const sentBefore = await db().maybeOne(
      `SELECT 1 FROM messages m JOIN chats c ON c.id = m.chat_id
       WHERE m.account_id = $1 AND c.remote_phone = $2 AND m.direction = 'out' AND m.status <> 'failed'
         AND ($3::int IS NULL OR m.queue_item_id IS DISTINCT FROM $3) LIMIT 1`,
      [input.accountId, phone, input.queueItemId ?? null],
    );
    if (sentBefore) return deny('Telefone já recebeu mensagem anteriormente');
    const queuedElsewhere = await db().maybeOne(
      `SELECT 1 FROM message_queue WHERE account_id = $1 AND phone = $2 AND kind = 'activation'
         AND status IN ('pending','processing','sent','delivered','read') AND id <> COALESCE($3::int, -1) LIMIT 1`,
      [input.accountId, phone, input.queueItemId ?? null],
    );
    if (queuedElsewhere) return deny('Já existe uma mensagem de ativação para este telefone na fila');
  }

  if (input.kind === 'followup' && lead) {
    if (lead.last_reply_at) return deny('O contato já respondeu — sequência encerrada', true);
    if (['reuniao_agendada', 'interessado', 'convertido'].includes(lead.status)) return deny('Lead avançou no funil — sequência encerrada', true);
  }

  return { ok: true, reason: null };
}
