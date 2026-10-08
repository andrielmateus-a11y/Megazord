// Mensagens de Ativação (templates).
import { camel, camelAll, db } from '../../db/dbClient.js';
import type { Template } from '../../shared/types.js';
import { renderTemplate, missingVariables, type TemplateVars } from '../../shared/text.js';
import { notFound } from '../lib/errors.js';
import { log } from './logService.js';

const COLS = 'id, name, category, body, favorite, created_at, updated_at';

export const templateService = {
  async list(accountId: number): Promise<Template[]> {
    return camelAll(await db().query(`SELECT ${COLS} FROM message_templates WHERE account_id = $1 ORDER BY favorite DESC, name`, [accountId]));
  },
  async get(accountId: number, id: number): Promise<Template> {
    const t = await db().maybeOne(`SELECT ${COLS} FROM message_templates WHERE account_id = $1 AND id = $2`, [accountId, id]);
    if (!t) throw notFound('Mensagem não encontrada.');
    return camel(t);
  },
  async create(accountId: number, userId: number, data: { name: string; category: string; body: string; favorite?: boolean }) {
    const t = await db().one(
      `INSERT INTO message_templates (account_id, name, category, body, favorite, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLS}`,
      [accountId, data.name, data.category, data.body, !!data.favorite, userId],
    );
    await log({ accountId, userId, category: 'templates', action: 'create', message: `Mensagem "${data.name}" criada` });
    return camel<Template>(t);
  },
  async update(accountId: number, userId: number, id: number, data: Partial<{ name: string; category: string; body: string; favorite: boolean }>) {
    await this.get(accountId, id);
    const t = await db().one(
      `UPDATE message_templates SET name = COALESCE($3, name), category = COALESCE($4, category), body = COALESCE($5, body),
         favorite = COALESCE($6, favorite), updated_at = now() WHERE account_id = $1 AND id = $2 RETURNING ${COLS}`,
      [accountId, id, data.name ?? null, data.category ?? null, data.body ?? null, data.favorite ?? null],
    );
    await log({ accountId, userId, category: 'templates', action: 'update', message: `Mensagem "${t.name}" atualizada` });
    return camel<Template>(t);
  },
  async duplicate(accountId: number, userId: number, id: number) {
    const t = await this.get(accountId, id);
    return this.create(accountId, userId, { name: `${t.name} (cópia)`, category: t.category, body: t.body, favorite: false });
  },
  async remove(accountId: number, userId: number, id: number) {
    const t = await this.get(accountId, id);
    await db().query('DELETE FROM message_templates WHERE account_id = $1 AND id = $2', [accountId, id]);
    await log({ accountId, userId, category: 'templates', action: 'delete', message: `Mensagem "${t.name}" excluída` });
  },
  preview(body: string, vars: TemplateVars) {
    return { message: renderTemplate(body, vars), missingVariables: missingVariables(body, vars) };
  },
};
