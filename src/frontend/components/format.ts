export { formatCnpj, formatPhone, titleCase } from '../../shared/text';

export function fmtDateTime(v: string | null | undefined) {
  if (!v) return '—';
  return new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(v);
  return d.toLocaleDateString('pt-BR');
}

export function fmtTime(v: string | null | undefined) {
  if (!v) return '';
  return new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function relative(v: string | null | undefined) {
  if (!v) return '—';
  const diff = Date.now() - new Date(v).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d < 30 ? `há ${d} d` : fmtDate(v);
}

export function companyName(c: { nomeFantasia?: string | null; razaoSocial?: string | null } | null | undefined) {
  return c?.nomeFantasia || c?.razaoSocial || '—';
}
