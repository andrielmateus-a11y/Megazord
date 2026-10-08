// Normalização tolerante de respostas de fornecedores (campos podem variar entre versões).
import { isMobile, normalizeCnpj, normalizePhone } from '../../shared/text.js';
import type { CompanyRecord, PartnerRecord, PhoneRecord } from './DataProvider.js';

export function pick(obj: any, ...paths: string[]): any {
  for (const p of paths) {
    const v = p.split('.').reduce((acc: any, k) => (acc == null ? undefined : acc[k]), obj);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function toIsoDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

export function normalizePorte(v: unknown): string | null {
  const s = (str(v) ?? '').toUpperCase();
  if (!s) return null;
  if (s.includes('MICRO') || s === 'ME' || s === '01' || s === '1') return 'ME';
  if (s.includes('PEQUENO') || s === 'EPP' || s === '03' || s === '3') return 'EPP';
  if (s.includes('DEMAIS') || s === '05' || s === '5') return 'DEMAIS';
  return s;
}

export function buildPhones(list: Array<{ raw: unknown; type?: unknown }>): PhoneRecord[] {
  const seen = new Set<string>();
  const out: PhoneRecord[] = [];
  for (const item of list) {
    const phone = normalizePhone(str(item.raw));
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    const declared = (str(item.type) ?? '').toLowerCase();
    const type: PhoneRecord['type'] = isMobile(phone)
      ? 'celular'
      : declared.includes('cel') || declared.includes('mov')
        ? 'celular'
        : declared.includes('fix')
          ? 'fixo'
          : 'fixo';
    out.push({ phone, type });
  }
  // Celulares primeiro.
  return out.sort((a, b) => (a.type === b.type ? 0 : a.type === 'celular' ? -1 : 1));
}

export function buildPartners(list: unknown[]): PartnerRecord[] {
  const out: PartnerRecord[] = [];
  const seen = new Set<string>();
  for (const p of list ?? []) {
    const name = str(pick(p, 'nome', 'nome_socio', 'name', 'nome_completo'));
    if (!name || seen.has(name.toUpperCase())) continue;
    seen.add(name.toUpperCase());
    const role = str(pick(p, 'qualificacao_socio.descricao', 'qualificacao_socio', 'qualificacao', 'qual', 'cargo'));
    out.push({ name, role });
  }
  // Sócio-administrador primeiro.
  return out.sort((a, b) => Number(/admin/i.test(b.role ?? '')) - Number(/admin/i.test(a.role ?? '')));
}

export function emptyRecord(cnpj: string): CompanyRecord {
  return {
    cnpj: normalizeCnpj(cnpj),
    razaoSocial: null,
    nomeFantasia: null,
    situacao: null,
    cnae: null,
    cnaeDescricao: null,
    dataAbertura: null,
    porte: null,
    logradouro: null,
    numero: null,
    complemento: null,
    bairro: null,
    cidade: null,
    uf: null,
    cep: null,
    email: null,
    phones: [],
    partners: [],
    detailed: false,
    raw: null,
  };
}
