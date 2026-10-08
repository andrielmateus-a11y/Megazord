// Criação de conta e dados iniciais: WA 01..04 com seus Containers, ponteiro de rodízio e mensagens de exemplo.
import type { Queryable } from '../../db/dbClient.js';
import { INITIAL_CHANNELS, channelLabel, containerLabel } from '../../shared/constants.js';

const CONTAINER_COLORS = ['blue', 'turquoise', 'green', 'yellow', 'orange', 'red', 'pink', 'purple'];

export const DEFAULT_TEMPLATES = [
  {
    name: 'Primeiro contato',
    category: 'ativacao',
    favorite: true,
    body: 'Olá, {nome}! Tudo bem?\n\nEstou entrando em contato com a {empresa}. Posso te fazer uma pergunta rápida sobre a rotina do escritório?',
  },
  {
    name: 'Ativação direta',
    category: 'ativacao',
    favorite: false,
    body: 'Oi {nome}, tudo certo? Vi que você é sócio(a) da {empresa} e queria apresentar rapidamente uma solução para escritórios contábeis. Faz sentido conversarmos?',
  },
  {
    name: 'Follow-up dia 3',
    category: 'follow-up',
    favorite: false,
    body: 'Oi {nome}, passando para saber se você conseguiu ver minha mensagem anterior. Fico à disposição!',
  },
  {
    name: 'Último contato dia 7',
    category: 'follow-up',
    favorite: false,
    body: '{nome}, esta é minha última mensagem por aqui para não incomodar. Se em algum momento fizer sentido para a {empresa}, é só me chamar.',
  },
];

export async function insertChannel(q: Queryable, accountId: number, orderIndex: number) {
  const [channel] = await q.query(
    `INSERT INTO whatsapp_channels (account_id, order_index, name) VALUES ($1,$2,$3) RETURNING *`,
    [accountId, orderIndex, channelLabel(orderIndex)],
  );
  await q.query(
    `INSERT INTO firefox_containers (account_id, channel_id, name, color, icon) VALUES ($1,$2,$3,$4,'briefcase')`,
    [accountId, channel.id, containerLabel(orderIndex), CONTAINER_COLORS[(orderIndex - 1) % CONTAINER_COLORS.length]],
  );
  return channel;
}

export async function bootstrapAccount(q: Queryable, name: string): Promise<number> {
  const [account] = await q.query('INSERT INTO accounts (name) VALUES ($1) RETURNING id', [name]);
  const accountId = account.id as number;
  for (let i = 1; i <= INITIAL_CHANNELS; i++) await insertChannel(q, accountId, i);
  await q.query('INSERT INTO rotation_state (account_id) VALUES ($1)', [accountId]);
  for (const t of DEFAULT_TEMPLATES) {
    await q.query(
      'INSERT INTO message_templates (account_id, name, category, body, favorite) VALUES ($1,$2,$3,$4,$5)',
      [accountId, t.name, t.category, t.body, t.favorite],
    );
  }
  return accountId;
}
