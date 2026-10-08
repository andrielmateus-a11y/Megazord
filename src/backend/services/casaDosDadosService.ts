// CasaDosDadosService — ponto único de acesso à Casa dos Dados para todo o sistema.
// Responsável por: chave (banco criptografado ou env), limite diário, cache, status e logs.
import { db } from '../../db/dbClient.js';
import { normalizeCnpj } from '../../shared/text.js';
import { config } from '../config.js';
import { IntegrationError } from '../lib/errors.js';
import { CasaDosDadosProvider } from '../integrations/casaDosDados/CasaDosDadosProvider.js';
import type { CompanyRecord, CompanySearchFilters, DataProvider, SearchPage } from '../integrations/DataProvider.js';
import { credentialService } from './credentialService.js';
import { log } from './logService.js';

const PROVIDER = 'casa_dos_dados' as const;

export class CasaDosDadosService {
  constructor(private provider: DataProvider = new CasaDosDadosProvider()) {}

  private async key(accountId: number): Promise<string> {
    return credentialService.getSecret(accountId, PROVIDER, config.casaDosDados.apiKey);
  }

  private async dailyLimit(accountId: number): Promise<number> {
    const row = await credentialService.getRow(accountId, PROVIDER);
    const v = Number(row?.meta?.dailyLimit);
    return Number.isFinite(v) && v > 0 ? v : config.casaDosDados.dailyLimit;
  }

  private async guardLimit(accountId: number) {
    const [used, limit] = await Promise.all([credentialService.usageToday(accountId, PROVIDER), this.dailyLimit(accountId)]);
    if (used >= limit) {
      throw new IntegrationError('Casa dos Dados', `Limite diário de ${limit} consultas atingido. Ajuste em Configurações → Integrações.`, 'daily limit', 429, false);
    }
  }

  private async track<T>(accountId: number, userId: number | null, action: string, meta: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    await this.guardLimit(accountId);
    const started = Date.now();
    try {
      const result = await fn();
      await credentialService.registerUsage(accountId, PROVIDER);
      await credentialService.markStatus(accountId, PROVIDER, 'ok');
      await log({ accountId, userId, category: 'casa_dos_dados', action, message: `Consulta Casa dos Dados (${action})`, meta: { ...meta, ms: Date.now() - started } });
      return result;
    } catch (err) {
      const message = err instanceof IntegrationError ? err.userMessage : 'Erro inesperado';
      if (err instanceof IntegrationError && err.httpStatus && [401, 403, 402].includes(err.httpStatus)) {
        await credentialService.markStatus(accountId, PROVIDER, 'error', message);
      }
      await log({ accountId, userId, level: 'error', category: 'casa_dos_dados', action: `${action}_error`, message, meta: { ...meta, technical: (err as Error).message } });
      throw err;
    }
  }

  async search(accountId: number, userId: number, filters: CompanySearchFilters, page: number): Promise<SearchPage> {
    const key = await this.key(accountId);
    return this.track(accountId, userId, 'search', { page, filters }, () => this.provider.search(filters, page, key));
  }

  /** Consulta detalhada (sócios + telefones), com cache. null = não encontrado. */
  async getCompany(accountId: number, userId: number | null, cnpjInput: string, opts: { useCache?: boolean } = {}): Promise<CompanyRecord | null> {
    const cnpj = normalizeCnpj(cnpjInput);
    const cacheKey = `cdd:${accountId}:${cnpj}`;
    if (opts.useCache !== false) {
      const cached = await db().maybeOne(`SELECT value FROM lookup_cache WHERE key = $1 AND expires_at > now()`, [cacheKey]);
      if (cached) return cached.value.notFound ? null : (cached.value as CompanyRecord);
    }
    const key = await this.key(accountId);
    const rec = await this.track(accountId, userId, 'detail', { cnpj }, () => this.provider.getCompany(cnpj, key));
    const expires = new Date(Date.now() + config.casaDosDados.cacheTtlHours * 3600 * 1000);
    await db().query(
      `INSERT INTO lookup_cache (key, account_id, value, expires_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
      [cacheKey, accountId, rec ?? { notFound: true }, expires],
    );
    return rec;
  }

  async testConnection(accountId: number, userId: number) {
    const key = await this.key(accountId);
    try {
      const result = await this.provider.checkConnection(key);
      await credentialService.markStatus(accountId, PROVIDER, 'ok');
      await credentialService.setMeta(accountId, PROVIDER, { balance: result.balance, balanceCheckedAt: new Date().toISOString() });
      await log({ accountId, userId, category: 'casa_dos_dados', action: 'test_connection', message: 'Conexão validada', meta: { balance: result.balance } });
      return result;
    } catch (err) {
      const message = err instanceof IntegrationError ? err.userMessage : 'Falha ao testar conexão';
      await credentialService.markStatus(accountId, PROVIDER, 'error', message);
      await log({ accountId, userId, level: 'warn', category: 'casa_dos_dados', action: 'test_connection_failed', message });
      return { ok: false, balance: null, message };
    }
  }

  async status(accountId: number) {
    const info = await credentialService.info(accountId, PROVIDER, config.casaDosDados.apiKey);
    return { ...info, dailyLimit: await this.dailyLimit(accountId) };
  }

  async clearCache(accountId: number): Promise<number> {
    const rows = await db().query(`DELETE FROM lookup_cache WHERE account_id = $1 RETURNING key`, [accountId]);
    return rows.length;
  }
}

export const casaDosDadosService = new CasaDosDadosService();
