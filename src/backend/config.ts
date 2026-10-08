// Configuração central lida das variáveis de ambiente. Nenhuma credencial é hardcoded.
import 'dotenv/config';

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function num(v: string | undefined, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : def;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: num(process.env.PORT, 3001),
  publicApiUrl: (process.env.PUBLIC_API_URL ?? `http://localhost:${num(process.env.PORT, 3001)}`).replace(/\/$/, ''),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  encryptionKey: process.env.APP_ENCRYPTION_KEY ?? '',
  sessionTtlHours: num(process.env.SESSION_TTL_HOURS, 72),
  allowRegistration: bool(process.env.ALLOW_REGISTRATION, false),
  webhookSecret: process.env.WEBHOOK_SECRET ?? '',
  serveFrontend: bool(process.env.SERVE_FRONTEND, true),
  casaDosDados: {
    baseUrl: (process.env.CASA_DOS_DADOS_BASE_URL ?? 'https://api.casadosdados.com.br').replace(/\/$/, ''),
    apiKey: process.env.CASA_DOS_DADOS_API_KEY ?? '',
    dailyLimit: num(process.env.CASA_DOS_DADOS_DAILY_LIMIT, 500),
    searchPath: process.env.CASA_DOS_DADOS_SEARCH_PATH ?? '/v5/cnpj/pesquisa',
    detailPath: process.env.CASA_DOS_DADOS_DETAIL_PATH ?? '/v4/cnpj/{cnpj}',
    balancePath: process.env.CASA_DOS_DADOS_BALANCE_PATH ?? '/v5/saldo',
    timeoutMs: num(process.env.CASA_DOS_DADOS_TIMEOUT_MS, 20000),
    cacheTtlHours: num(process.env.CASA_DOS_DADOS_CACHE_TTL_HOURS, 24 * 7),
  },
  receita: {
    brasilApiUrl: (process.env.BRASILAPI_URL ?? 'https://brasilapi.com.br').replace(/\/$/, ''),
    receitaWsUrl: (process.env.RECEITAWS_URL ?? 'https://receitaws.com.br').replace(/\/$/, ''),
  },
  evolution: {
    url: (process.env.EVOLUTION_API_URL ?? '').replace(/\/$/, ''),
    apiKey: process.env.EVOLUTION_API_KEY ?? '',
    integration: process.env.EVOLUTION_INTEGRATION ?? 'WHATSAPP-BAILEYS',
  },
  queue: {
    enabled: bool(process.env.QUEUE_WORKER_ENABLED, true),
    tickMs: num(process.env.QUEUE_TICK_MS, 2000),
    sendTimeoutMs: num(process.env.QUEUE_SEND_TIMEOUT_MS, 60000),
    timezone: process.env.APP_TIMEZONE ?? 'America/Sao_Paulo',
  },
  bridge: {
    heartbeatTimeoutMs: num(process.env.BRIDGE_HEARTBEAT_TIMEOUT_MS, 45000),
  },
};

export function assertProductionConfig(): void {
  if (!config.isProd) return;
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (config.encryptionKey.length < 32) missing.push('APP_ENCRYPTION_KEY (mín. 32 caracteres)');
  if (config.webhookSecret.length < 16) missing.push('WEBHOOK_SECRET (mín. 16 caracteres)');
  if (missing.length) {
    throw new Error(`Configuração de produção incompleta: ${missing.join(', ')}`);
  }
}
