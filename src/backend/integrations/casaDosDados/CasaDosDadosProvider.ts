// Adaptador HTTP da API Casa dos Dados (https://api.casadosdados.com.br, header `api-key`).
// Endpoints configuráveis via env (CASA_DOS_DADOS_*_PATH) caso o fornecedor mude versões.
// Esta é a ÚNICA classe que conversa com a Casa dos Dados; o resto do sistema usa o CasaDosDadosService.
import { config } from '../../config.js';
import { IntegrationError } from '../../lib/errors.js';
import { fetchWithTimeout, readJson } from '../../lib/http.js';
import { normalizeCnpj } from '../../../shared/text.js';
import type { CompanyRecord, CompanySearchFilters, DataProvider, SearchPage } from '../DataProvider.js';
import { buildPartners, buildPhones, emptyRecord, normalizePorte, pick, str, toIsoDate } from '../normalize.js';

const PROVIDER = 'Casa dos Dados';

function monthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

function lowerList(v?: string): string[] | undefined {
  const s = v?.trim();
  return s ? [s.toLowerCase()] : undefined;
}

export function buildSearchBody(filters: CompanySearchFilters, page: number) {
  const body: Record<string, unknown> = {
    codigo_atividade_principal: filters.cnaes,
    incluir_atividade_secundaria: false,
    situacao_cadastral: [filters.situacao || 'ATIVA'],
    uf: lowerList(filters.uf),
    municipio: lowerList(filters.municipio),
    bairro: lowerList(filters.bairro),
    mais_filtros: {
      somente_matriz: true,
      com_telefone: true,
      somente_celular: !!filters.onlyWithMobile,
    },
    limite: filters.limit,
    pagina: page,
  };
  if (filters.minAgeMonths !== undefined || filters.maxAgeMonths !== undefined) {
    body.data_abertura = {
      inicio: filters.maxAgeMonths !== undefined ? monthsAgo(filters.maxAgeMonths) : undefined,
      fim: filters.minAgeMonths !== undefined ? monthsAgo(filters.minAgeMonths) : undefined,
    };
  }
  return JSON.parse(JSON.stringify(body));
}

export function mapCompany(item: any, detailed: boolean): CompanyRecord {
  const rec = emptyRecord(String(pick(item, 'cnpj', 'cnpj_completo') ?? ''));
  const endereco = pick(item, 'endereco') ?? item;
  rec.razaoSocial = str(pick(item, 'razao_social', 'razaoSocial', 'nome'));
  rec.nomeFantasia = str(pick(item, 'nome_fantasia', 'nomeFantasia', 'fantasia'));
  rec.situacao = str(pick(item, 'situacao_cadastral.situacao_atual', 'situacao_cadastral', 'situacao'))?.toUpperCase() ?? null;
  rec.cnae = str(pick(item, 'atividade_principal.codigo', 'cnae_fiscal', 'codigo_atividade_principal'));
  rec.cnaeDescricao = str(pick(item, 'atividade_principal.descricao', 'cnae_fiscal_descricao'));
  rec.dataAbertura = toIsoDate(pick(item, 'data_abertura', 'data_inicio_atividade', 'abertura'));
  rec.porte = normalizePorte(pick(item, 'porte_empresa.descricao', 'porte_empresa.codigo', 'porte_empresa', 'porte'));
  rec.logradouro = str(pick(endereco, 'logradouro'));
  rec.numero = str(pick(endereco, 'numero'));
  rec.complemento = str(pick(endereco, 'complemento'));
  rec.bairro = str(pick(endereco, 'bairro'));
  rec.cidade = str(pick(endereco, 'municipio', 'cidade'));
  rec.uf = str(pick(endereco, 'uf'))?.toUpperCase() ?? null;
  rec.cep = str(pick(endereco, 'cep'));
  const emails = pick(item, 'contato_email', 'emails') ?? [];
  rec.email = str(Array.isArray(emails) ? pick(emails[0], 'email') ?? emails[0] : emails) ?? str(pick(item, 'email'));
  const phonesRaw = pick(item, 'contato_telefonico', 'telefones') ?? [];
  rec.phones = buildPhones(
    (Array.isArray(phonesRaw) ? phonesRaw : [phonesRaw]).map((p: any) => ({
      raw: typeof p === 'object' ? pick(p, 'completo', 'numero_completo') ?? `${p.ddd ?? ''}${p.numero ?? ''}` : p,
      type: typeof p === 'object' ? pick(p, 'tipo') : undefined,
    })),
  );
  rec.partners = buildPartners(pick(item, 'quadro_societario', 'socios', 'qsa') ?? []);
  rec.detailed = detailed;
  rec.raw = item;
  return rec;
}

export class CasaDosDadosProvider implements DataProvider {
  readonly name = 'casa_dos_dados';

  private async request(method: 'GET' | 'POST', path: string, apiKey: string, body?: unknown) {
    if (!apiKey) {
      throw new IntegrationError(PROVIDER, 'Chave da Casa dos Dados não configurada. Cadastre em Configurações → Integrações.', 'missing api key', 0, false);
    }
    let res: Response;
    try {
      res = await fetchWithTimeout(`${config.casaDosDados.baseUrl}${path}`, {
        method,
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        timeoutMs: config.casaDosDados.timeoutMs,
      });
    } catch (err) {
      const aborted = (err as Error).name === 'AbortError';
      throw new IntegrationError(
        PROVIDER,
        aborted ? 'A Casa dos Dados demorou para responder. Tente novamente.' : 'Não foi possível conectar à Casa dos Dados.',
        (err as Error).message,
      );
    }
    const data = await readJson(res);
    return { status: res.status, ok: res.ok, data };
  }

  private fail(status: number, data: any): never {
    const detail = str(pick(data, 'message', 'mensagem', 'error', 'detail')) ?? `HTTP ${status}`;
    if (status === 401) throw new IntegrationError(PROVIDER, 'Chave da Casa dos Dados inválida.', detail, status, false);
    if (status === 403) throw new IntegrationError(PROVIDER, 'A chave não tem permissão para este recurso da Casa dos Dados.', detail, status, false);
    if (status === 402) throw new IntegrationError(PROVIDER, 'Saldo insuficiente na Casa dos Dados.', detail, status, false);
    if (status === 429) throw new IntegrationError(PROVIDER, 'Limite de requisições da Casa dos Dados atingido. Aguarde e tente novamente.', detail, status);
    if (status >= 400 && status < 500) throw new IntegrationError(PROVIDER, `A Casa dos Dados recusou a consulta: ${detail}`, detail, status, false);
    throw new IntegrationError(PROVIDER, 'A Casa dos Dados está instável no momento. Tente novamente.', detail, status);
  }

  async search(filters: CompanySearchFilters, page: number, apiKey: string): Promise<SearchPage> {
    const res = await this.request('POST', config.casaDosDados.searchPath, apiKey, buildSearchBody(filters, page));
    if (!res.ok) this.fail(res.status, res.data);
    const list = pick(res.data, 'cnpjs', 'data.cnpj', 'data', 'empresas', 'result', 'resultados') ?? [];
    const items = (Array.isArray(list) ? list : []).map((i: any) => mapCompany(i, false)).filter((c) => c.cnpj.length === 14);
    const total = Number(pick(res.data, 'total', 'count', 'data.count', 'quantidade')) || null;
    const hasMore = items.length >= filters.limit && (total === null || page * filters.limit < total);
    return { total, items, hasMore };
  }

  async getCompany(cnpj: string, apiKey: string): Promise<CompanyRecord | null> {
    const path = config.casaDosDados.detailPath.replace('{cnpj}', normalizeCnpj(cnpj));
    const res = await this.request('GET', path, apiKey);
    if (res.status === 404) return null;
    if (!res.ok) this.fail(res.status, res.data);
    const item = pick(res.data, 'data', 'empresa') ?? res.data;
    if (!item || (!pick(item, 'cnpj') && !pick(item, 'razao_social'))) return null;
    const rec = mapCompany({ cnpj, ...item }, true);
    rec.cnpj = normalizeCnpj(cnpj);
    return rec;
  }

  async checkConnection(apiKey: string) {
    const res = await this.request('GET', config.casaDosDados.balancePath, apiKey);
    if (!res.ok) this.fail(res.status, res.data);
    const raw = pick(res.data, 'saldo', 'creditos', 'balance', 'data.saldo', 'saldo_disponivel');
    const balance = raw === null ? null : Number(raw);
    return {
      ok: true,
      balance: Number.isFinite(balance) ? balance : null,
      message: 'Conexão com a Casa dos Dados validada.',
    };
  }
}
