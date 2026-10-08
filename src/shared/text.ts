// Utilitários puros de texto: CNPJ, telefone e variáveis de mensagem.

export function onlyDigits(v: string | null | undefined): string {
  return (v ?? '').replace(/\D+/g, '');
}

export function normalizeCnpj(v: string): string {
  return onlyDigits(v).padStart(14, '0').slice(-14);
}

export function formatCnpj(v: string | null | undefined): string {
  const d = onlyDigits(v);
  if (d.length !== 14) return v ?? '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function isValidCnpj(v: string): boolean {
  const c = onlyDigits(v);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(c[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

/**
 * Normaliza um telefone brasileiro para o formato internacional só com dígitos (55DDXXXXXXXXX).
 * Retorna null se não for possível interpretar.
 */
export function normalizePhone(v: string | null | undefined): string | null {
  let d = onlyDigits(v);
  if (!d) return null;
  d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!d.startsWith('55') || (d.length !== 12 && d.length !== 13)) {
    return d.length >= 10 && d.length <= 15 ? d : null;
  }
  return d;
}

/** Celular brasileiro: 55 + DDD + 9 dígitos começando com 9. */
export function isMobile(phone: string | null | undefined): boolean {
  const d = normalizePhone(phone);
  return !!d && d.startsWith('55') && d.length === 13 && d[4] === '9';
}

export function formatPhone(v: string | null | undefined): string {
  const d = onlyDigits(v);
  const local = d.startsWith('55') && (d.length === 12 || d.length === 13) ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return v ?? '';
}

export function firstName(name: string | null | undefined): string {
  const n = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return titleCase(n);
}

export function titleCase(s: string | null | undefined): string {
  const lower = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'ltda', 'me', 'epp', 's/a', 'sa']);
  return (s ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      if (w === 'ltda' || w === 'ltda.') return 'Ltda';
      if (['me', 'epp', 's/a'].includes(w)) return w.toUpperCase();
      if (i > 0 && lower.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

export interface TemplateVars {
  socio?: string | null;
  nome?: string | null;
  empresa?: string | null;
  telefone?: string | null;
  cidade?: string | null;
  cnpj?: string | null;
}

export const TEMPLATE_VARIABLES = [
  { key: '{nome}', description: 'Primeiro nome do sócio' },
  { key: '{socio}', description: 'Nome do sócio' },
  { key: '{empresa}', description: 'Nome da empresa (fantasia ou razão social)' },
  { key: '{telefone}', description: 'Celular do contato' },
  { key: '{cidade}', description: 'Cidade da empresa' },
  { key: '{cnpj}', description: 'CNPJ formatado' },
];

/** Substitui as variáveis da mensagem de ativação. Variáveis sem valor viram texto vazio. */
export function renderTemplate(body: string, vars: TemplateVars): string {
  const map: Record<string, string> = {
    nome: firstName(vars.nome ?? vars.socio) || '',
    socio: vars.socio ? titleCase(vars.socio) : '',
    empresa: vars.empresa ? titleCase(vars.empresa) : '',
    telefone: vars.telefone ? formatPhone(vars.telefone) : '',
    cidade: vars.cidade ? titleCase(vars.cidade) : '',
    cnpj: vars.cnpj ? formatCnpj(vars.cnpj) : '',
  };
  return body
    .replace(/\{(\w+)\}/g, (m, k: string) => (k.toLowerCase() in map ? map[k.toLowerCase()] : m))
    .replace(/,\s*!/g, '!')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Variáveis usadas no template que não têm valor (para alertar o SDR antes do envio). */
export function missingVariables(body: string, vars: TemplateVars): string[] {
  const used = [...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1].toLowerCase());
  const has: Record<string, boolean> = {
    nome: !!(vars.nome ?? vars.socio),
    socio: !!vars.socio,
    empresa: !!vars.empresa,
    telefone: !!vars.telefone,
    cidade: !!vars.cidade,
    cnpj: !!vars.cnpj,
  };
  return [...new Set(used.filter((k) => k in has && !has[k]))];
}
