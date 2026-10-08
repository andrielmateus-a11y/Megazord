// Importação e exportação (CSV/Excel): leads/histórico, mensagens enviadas/recebidas e mensagens de ativação.
import ExcelJS from 'exceljs';
import { db } from '../../db/dbClient.js';
import { LEAD_STATUSES, LEAD_STATUS_LABELS, channelLabel, type LeadStatus } from '../../shared/constants.js';
import { formatCnpj, formatPhone, isMobile, isValidCnpj, normalizeCnpj, normalizePhone } from '../../shared/text.js';
import { badRequest } from '../lib/errors.js';
import { normalizeHeader, parseCsv, toCsv } from '../lib/csv.js';
import { companyRepository } from '../repositories/companyRepository.js';
import { historyRepository, leadRepository } from '../repositories/leadRepository.js';
import { emptyRecord } from '../integrations/normalize.js';
import { log } from './logService.js';

type Column = { key: string; label: string };
export type ExportFormat = 'csv' | 'xlsx';

async function render(columns: Column[], rows: Record<string, unknown>[], format: ExportFormat, sheet: string) {
  if (format === 'csv') return { buffer: Buffer.from(toCsv(columns, rows), 'utf8'), contentType: 'text/csv; charset=utf-8', ext: 'csv' };
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 4) }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
}

const LEAD_COLUMNS: Column[] = [
  { key: 'cnpj', label: 'CNPJ' },
  { key: 'razao_social', label: 'Razão social' },
  { key: 'nome_fantasia', label: 'Nome fantasia' },
  { key: 'socio', label: 'Sócio' },
  { key: 'telefone', label: 'Telefone' },
  { key: 'status', label: 'Status' },
  { key: 'primeiro_contato', label: 'Primeiro contato' },
  { key: 'ultimo_contato', label: 'Último contato' },
  { key: 'quantidade_contatos', label: 'Quantidade de contatos' },
  { key: 'responsavel', label: 'Responsável' },
  { key: 'canal', label: 'Canal' },
  { key: 'cidade', label: 'Cidade' },
  { key: 'uf', label: 'UF' },
  { key: 'observacoes', label: 'Observações' },
  { key: 'opt_out', label: 'Opt-out' },
  { key: 'nao_contatar', label: 'Não contatar' },
];

export async function exportLeads(accountId: number, format: ExportFormat) {
  const { items } = await leadRepository.list(accountId, { limit: 5000 });
  const rows = items.map((l) => ({
    cnpj: formatCnpj(l.company.cnpj),
    razao_social: l.company.razaoSocial,
    nome_fantasia: l.company.nomeFantasia,
    socio: l.contact?.name,
    telefone: formatPhone(l.contact?.phone),
    status: LEAD_STATUS_LABELS[l.status],
    primeiro_contato: l.firstContactAt,
    ultimo_contato: l.lastContactAt,
    quantidade_contatos: l.contactCount,
    responsavel: l.ownerName,
    canal: l.lastChannelLabel,
    cidade: l.company.cidade,
    uf: l.company.uf,
    observacoes: l.notes,
    opt_out: l.optOut ? 'Sim' : 'Não',
    nao_contatar: l.doNotContact ? 'Sim' : 'Não',
  }));
  return render(LEAD_COLUMNS, rows, format, 'Leads');
}

export async function exportHistory(accountId: number, format: ExportFormat) {
  const rows = await db().query(
    `SELECT h.created_at, c.cnpj, COALESCE(c.nome_fantasia, c.razao_social) AS empresa, h.type, h.description, u.name AS usuario, w.order_index
     FROM contact_history h LEFT JOIN companies c ON c.id = h.company_id LEFT JOIN users u ON u.id = h.user_id
     LEFT JOIN whatsapp_channels w ON w.id = h.channel_id WHERE h.account_id = $1 ORDER BY h.id DESC LIMIT 20000`,
    [accountId],
  );
  return render(
    [
      { key: 'data', label: 'Data/hora' },
      { key: 'cnpj', label: 'CNPJ' },
      { key: 'empresa', label: 'Empresa' },
      { key: 'tipo', label: 'Tipo' },
      { key: 'descricao', label: 'Descrição' },
      { key: 'usuario', label: 'Usuário' },
      { key: 'canal', label: 'Canal' },
    ],
    rows.map((r) => ({
      data: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      cnpj: formatCnpj(r.cnpj),
      empresa: r.empresa,
      tipo: r.type,
      descricao: r.description,
      usuario: r.usuario,
      canal: r.order_index ? channelLabel(r.order_index) : '',
    })),
    format,
    'Histórico',
  );
}

export async function exportMessages(accountId: number, format: ExportFormat) {
  const rows = await db().query(
    `SELECT m.created_at, m.direction, m.status, m.body, m.transport, m.container_name, ch.remote_phone, ch.remote_name,
       COALESCE(co.nome_fantasia, co.razao_social) AS empresa, co.cnpj, w.order_index, u.name AS usuario, cp.name AS campanha
     FROM messages m JOIN chats ch ON ch.id = m.chat_id LEFT JOIN companies co ON co.id = m.company_id
     LEFT JOIN whatsapp_channels w ON w.id = m.channel_id LEFT JOIN users u ON u.id = m.user_id LEFT JOIN campaigns cp ON cp.id = m.campaign_id
     WHERE m.account_id = $1 ORDER BY m.id DESC LIMIT 50000`,
    [accountId],
  );
  return render(
    [
      { key: 'data', label: 'Data/hora' },
      { key: 'direcao', label: 'Direção' },
      { key: 'status', label: 'Status' },
      { key: 'telefone', label: 'Telefone' },
      { key: 'contato', label: 'Contato' },
      { key: 'empresa', label: 'Empresa' },
      { key: 'cnpj', label: 'CNPJ' },
      { key: 'canal', label: 'Canal' },
      { key: 'container', label: 'Container' },
      { key: 'transporte', label: 'Transporte' },
      { key: 'campanha', label: 'Campanha' },
      { key: 'usuario', label: 'Usuário' },
      { key: 'mensagem', label: 'Mensagem' },
    ],
    rows.map((r) => ({
      data: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      direcao: r.direction === 'out' ? 'Enviada' : 'Recebida',
      status: r.status,
      telefone: formatPhone(r.remote_phone),
      contato: r.remote_name,
      empresa: r.empresa,
      cnpj: formatCnpj(r.cnpj),
      canal: r.order_index ? channelLabel(r.order_index) : '',
      container: r.container_name,
      transporte: r.transport,
      campanha: r.campanha,
      usuario: r.usuario,
      mensagem: r.body,
    })),
    format,
    'Mensagens',
  );
}

export async function exportTemplates(accountId: number, format: ExportFormat) {
  const rows = await db().query('SELECT name, category, body, favorite FROM message_templates WHERE account_id = $1 ORDER BY name', [accountId]);
  return render(
    [
      { key: 'nome', label: 'Nome' },
      { key: 'categoria', label: 'Categoria' },
      { key: 'mensagem', label: 'Mensagem' },
      { key: 'favorita', label: 'Favorita' },
    ],
    rows.map((r) => ({ nome: r.name, categoria: r.category, mensagem: r.body, favorita: r.favorite ? 'Sim' : 'Não' })),
    format,
    'Mensagens de ativação',
  );
}

/** Lê CSV ou XLSX enviado como base64 e devolve linhas com cabeçalhos normalizados. */
export async function readTable(fileName: string, base64: string): Promise<Record<string, string>[]> {
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > 10 * 1024 * 1024) throw badRequest('Arquivo maior que 10 MB.');
  if (/\.xlsx$/i.test(fileName)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const header: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => (header[col - 1] = normalizeHeader(String(cell.text ?? ''))));
    const rows: Record<string, string>[] = [];
    ws.eachRow((row, idx) => {
      if (idx === 1) return;
      const obj: Record<string, string> = {};
      header.forEach((h, i) => (obj[h] = String(row.getCell(i + 1).text ?? '').trim()));
      if (Object.values(obj).some(Boolean)) rows.push(obj);
    });
    return rows;
  }
  if (/\.(csv|txt)$/i.test(fileName)) return parseCsv(buffer.toString('utf8'));
  throw badRequest('Formato não suportado. Use CSV ou XLSX.');
}

const STATUS_BY_LABEL: Record<string, LeadStatus> = Object.fromEntries(
  LEAD_STATUSES.flatMap((s) => [
    [s, s],
    [normalizeHeader(LEAD_STATUS_LABELS[s]), s],
  ]),
) as Record<string, LeadStatus>;

/**
 * Importa histórico/leads (ex.: exportação do Nibo Search). Colunas reconhecidas:
 * cnpj (obrigatória), razao_social, nome_fantasia, socio, telefone, status, observacoes, cidade, uf, quantidade_contatos, ultimo_contato
 */
export async function importLeads(accountId: number, userId: number, rows: Record<string, string>[]) {
  let created = 0;
  let updated = 0;
  const errors: { line: number; error: string }[] = [];
  for (const [i, r] of rows.entries()) {
    const line = i + 2;
    const cnpj = normalizeCnpj(r.cnpj ?? '');
    if (!isValidCnpj(cnpj)) {
      errors.push({ line, error: 'CNPJ inválido' });
      continue;
    }
    try {
      const existed = await companyRepository.findByCnpj(accountId, cnpj);
      await db().tx(async (q) => {
        const rec = { ...emptyRecord(cnpj), razaoSocial: r.razao_social || r.empresa || null, nomeFantasia: r.nome_fantasia || null, cidade: r.cidade || null, uf: r.uf?.toUpperCase() || null };
        const company = await companyRepository.upsertFromRecord(q, accountId, rec, 'importacao', { presentedBy: userId });
        const phone = normalizePhone(r.telefone || r.celular || '');
        const socio = r.socio || r.nome || null;
        let contactId: number | null = null;
        if (socio || phone) {
          const [existing] = await q.query(
            'SELECT id FROM contacts WHERE company_id = $1 AND (($2::text IS NOT NULL AND phone = $2) OR ($3::text IS NOT NULL AND upper(name) = upper($3))) LIMIT 1',
            [company.id, phone, socio],
          );
          contactId = existing?.id ?? (await companyRepository.insertContact(q, accountId, { companyId: company.id, name: socio, phone, phoneType: phone ? (isMobile(phone) ? 'celular' : 'fixo') : null, isPrimary: true, source: 'importacao' })).id;
        }
        const leadId = await leadRepository.ensure(q, accountId, company.id, contactId, userId);
        const status = STATUS_BY_LABEL[normalizeHeader(r.status ?? '')];
        const count = Number(r.quantidade_contatos ?? r.contatos ?? '') || 0;
        const lastContact = r.ultimo_contato ? new Date(r.ultimo_contato) : null;
        await q.query(
          `UPDATE leads SET status = COALESCE($2, status), notes = COALESCE($3, notes),
             contact_count = GREATEST(contact_count, $4), last_contact_at = COALESCE(last_contact_at, $5),
             first_contact_at = COALESCE(first_contact_at, $5), do_not_contact = do_not_contact OR $6 WHERE id = $1`,
          [leadId, status ?? null, r.observacoes || null, count, lastContact && !isNaN(+lastContact) ? lastContact : null, status === 'nao_contatar'],
        );
        await historyRepository.add(q, { accountId, leadId, companyId: company.id, userId, type: 'imported', description: 'Registro importado' });
      });
      existed ? updated++ : created++;
    } catch (err) {
      errors.push({ line, error: (err as Error).message.slice(0, 120) });
    }
  }
  await log({ accountId, userId, category: 'import', action: 'leads', message: `Importação: ${created} novos, ${updated} atualizados, ${errors.length} erro(s)` });
  return { created, updated, errors: errors.slice(0, 100) };
}

export async function importTemplates(accountId: number, userId: number, rows: Record<string, string>[]) {
  let created = 0;
  const errors: { line: number; error: string }[] = [];
  for (const [i, r] of rows.entries()) {
    const body = r.mensagem || r.body || r.texto;
    const name = r.nome || r.name || `Importada ${i + 1}`;
    if (!body) {
      errors.push({ line: i + 2, error: 'Mensagem vazia' });
      continue;
    }
    await db().query(
      'INSERT INTO message_templates (account_id, name, category, body, favorite, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [accountId, name.slice(0, 120), (r.categoria || 'ativacao').slice(0, 60), body.slice(0, 4000), /^s(im)?$/i.test(r.favorita ?? ''), userId],
    );
    created++;
  }
  await log({ accountId, userId, category: 'import', action: 'templates', message: `${created} mensagem(ns) importada(s)` });
  return { created, updated: 0, errors };
}
