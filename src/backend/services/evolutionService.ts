// Resolve o cliente Evolution da conta (URL + API Key do banco, com fallback para env).
import { config } from '../config.js';
import { EvolutionClient } from '../integrations/evolution/EvolutionClient.js';
import { credentialService } from './credentialService.js';

export async function evolutionClientFor(accountId: number): Promise<EvolutionClient> {
  const row = await credentialService.getRow(accountId, 'evolution');
  const url = String(row?.meta?.url ?? config.evolution.url ?? '').replace(/\/$/, '');
  const key = await credentialService.getSecret(accountId, 'evolution', config.evolution.apiKey);
  return new EvolutionClient(url, key);
}

export function evolutionWebhookUrl(): string {
  const secret = config.webhookSecret ? `?token=${encodeURIComponent(config.webhookSecret)}` : '';
  return `${config.publicApiUrl}/api/webhook/evolution${secret}`;
}

export async function evolutionInfo(accountId: number) {
  const row = await credentialService.getRow(accountId, 'evolution');
  const info = await credentialService.info(accountId, 'evolution', config.evolution.apiKey);
  return { ...info, url: String(row?.meta?.url ?? config.evolution.url ?? ''), webhookUrl: `${config.publicApiUrl}/api/webhook/evolution` };
}
