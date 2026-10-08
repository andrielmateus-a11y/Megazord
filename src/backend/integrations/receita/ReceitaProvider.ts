// "Tentar pela Receita": consulta cadastral pública (BrasilAPI, com fallback para ReceitaWS).
// Não exige chave. Retorna QSA (sócios) e telefones declarados na Receita Federal.
import { config } from '../../config.js';
import { IntegrationError } from '../../lib/errors.js';
import { fetchWithTimeout, readJson } from '../../lib/http.js';
import { normalizeCnpj } from '../../../shared/text.js';
import type { CompanyRecord } from '../DataProvider.js';
import { buildPartners, buildPhones, emptyRecord, normalizePorte, pick, str, toIsoDate } from '../normalize.js';

const PROVIDER = 'Receita Federal';

export function mapBrasilApi(data: any): CompanyRecord {
  const rec = emptyRecord(String(data.cnpj));
  rec.razaoSocial = str(data.razao_social);
  rec.nomeFantasia = str(data.nome_fantasia);
  rec.situacao = str(data.descricao_situacao_cadastral)?.toUpperCase() ?? null;
  rec.cnae = str(data.cnae_fiscal);
  rec.cnaeDescricao = str(data.cnae_fiscal_descricao);
  rec.dataAbertura = toIsoDate(data.data_inicio_atividade);
  rec.porte = normalizePorte(data.porte ?? data.descricao_porte);
  rec.logradouro = [str(data.descricao_tipo_de_logradouro), str(data.logradouro)].filter(Boolean).join(' ') || null;
  rec.numero = str(data.numero);
  rec.complemento = str(data.complemento);
  rec.bairro = str(data.bairro);
  rec.cidade = str(data.municipio);
  rec.uf = str(data.uf);
  rec.cep = str(data.cep);
  rec.email = str(data.email);
  rec.phones = buildPhones([{ raw: data.ddd_telefone_1 }, { raw: data.ddd_telefone_2 }]);
  rec.partners = buildPartners(data.qsa ?? []);
  rec.detailed = true;
  rec.raw = data;
  return rec;
}

export function mapReceitaWs(data: any): CompanyRecord {
  const rec = emptyRecord(String(data.cnpj));
  rec.razaoSocial = str(data.nome);
  rec.nomeFantasia = str(data.fantasia);
  rec.situacao = str(data.situacao)?.toUpperCase() ?? null;
  rec.cnae = str(pick(data, 'atividade_principal.0.code'))?.replace(/\D/g, '') ?? null;
  rec.cnaeDescricao = str(pick(data, 'atividade_principal.0.text'));
  rec.dataAbertura = toIsoDate(data.abertura);
  rec.porte = normalizePorte(data.porte);
  rec.logradouro = str(data.logradouro);
  rec.numero = str(data.numero);
  rec.complemento = str(data.complemento);
  rec.bairro = str(data.bairro);
  rec.cidade = str(data.municipio);
  rec.uf = str(data.uf);
  rec.cep = str(data.cep);
  rec.email = str(data.email);
  rec.phones = buildPhones(String(data.telefone ?? '').split('/').map((raw) => ({ raw })));
  rec.partners = buildPartners(data.qsa ?? []);
  rec.detailed = true;
  rec.raw = data;
  return rec;
}

export class ReceitaProvider {
  readonly name = 'receita';

  async getCompany(cnpjInput: string): Promise<CompanyRecord | null> {
    const cnpj = normalizeCnpj(cnpjInput);
    let brasilApiError: string | null = null;
    try {
      const res = await fetchWithTimeout(`${config.receita.brasilApiUrl}/api/cnpj/v1/${cnpj}`, { timeoutMs: 15000 });
      if (res.status === 404) return null;
      if (res.ok) return { ...mapBrasilApi(await readJson(res)), cnpj };
      brasilApiError = `BrasilAPI HTTP ${res.status}`;
    } catch (err) {
      brasilApiError = (err as Error).message;
    }
    try {
      const res = await fetchWithTimeout(`${config.receita.receitaWsUrl}/v1/cnpj/${cnpj}`, { timeoutMs: 15000 });
      const data = await readJson(res);
      if (res.status === 429) throw new IntegrationError(PROVIDER, 'Limite de consultas da Receita atingido. Aguarde um minuto.', 'receitaws 429', 429);
      if (!res.ok) throw new IntegrationError(PROVIDER, 'Consulta à Receita indisponível no momento.', `ReceitaWS HTTP ${res.status}; ${brasilApiError}`, res.status);
      if (data?.status === 'ERROR') {
        if (/inv[aá]lido|n[aã]o encontrad/i.test(String(data.message))) return null;
        throw new IntegrationError(PROVIDER, 'Consulta à Receita indisponível no momento.', String(data.message));
      }
      return { ...mapReceitaWs(data), cnpj };
    } catch (err) {
      if (err instanceof IntegrationError) throw err;
      throw new IntegrationError(PROVIDER, 'Não foi possível consultar a Receita agora.', `${brasilApiError}; ${(err as Error).message}`);
    }
  }
}
