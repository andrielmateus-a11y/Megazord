// Card de resultado de prospecção: destaca Sócio, Empresa e Celular.
import { AlertCircle, Building2, Landmark, Phone, Send, User, UserSearch } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../hooks/useToast';
import { api } from '../services/api';
import type { ProspectResult } from '../types';
import { companyName, fmtDate, formatCnpj, formatPhone, titleCase } from './format';
import { LeadStatusBadge } from './status';
import { Badge, Button, cx } from './ui';

export function ResultCard({ result, onChange, onActivate }: { result: ProspectResult; onChange: (r: ProspectResult) => void; onActivate: (leadId: number) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<'cdd' | 'receita' | null>(null);
  const { company, primaryContact, lead } = result;
  const mobile = primaryContact?.phone ?? company.phones.find((p) => p.type === 'celular')?.phone ?? null;

  const fetchContacts = async (source: 'casa_dos_dados' | 'receita') => {
    setBusy(source === 'receita' ? 'receita' : 'cdd');
    try {
      const res = await api.post<{ status: string; result: ProspectResult }>(`/companies/${company.cnpj}/contacts/fetch`, { source });
      onChange(res.result);
      if (res.status === 'not_found') toast.info('Informação não encontrada nesta fonte.');
      else if (res.status === 'partial') toast.info('Dados obtidos, mas sem celular do sócio.');
      else toast.success('Sócio e celular identificados.');
    } catch (e) {
      toast.error((e as Error).message);
      onChange({ ...result, company: { ...company, enrichmentStatus: 'error', enrichmentError: (e as Error).message } });
    } finally {
      setBusy(null);
    }
  };

  const enrichment = company.enrichmentStatus;
  return (
    <div className={cx('rounded-xl border bg-white p-4 shadow-sm transition', result.alreadyWorked ? 'border-amber-200' : 'border-slate-200 hover:border-brand-200')}>
      <div className="grid gap-3 md:grid-cols-[1.3fr_1fr_1fr_auto] md:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 uppercase"><Building2 className="h-3 w-3" /> Empresa</p>
          <p className="truncate font-semibold text-slate-900" title={company.razaoSocial ?? ''}>{titleCase(companyName(company))}</p>
          <p className="truncate text-xs text-slate-500">
            {formatCnpj(company.cnpj)} · {[company.bairro, company.cidade, company.uf].filter(Boolean).map((s) => titleCase(s)).join(', ')}
          </p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 uppercase"><User className="h-3 w-3" /> Sócio</p>
          {primaryContact?.name ? (
            <p className="font-semibold text-slate-900">{titleCase(primaryContact.name)}</p>
          ) : (
            <p className="text-sm text-slate-400">{enrichment === 'pending' ? 'Trazer contatos' : enrichment === 'error' ? 'Erro na consulta' : 'Não encontrado'}</p>
          )}
          {primaryContact?.role && <p className="text-[11px] text-slate-500">{titleCase(primaryContact.role)}</p>}
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 uppercase"><Phone className="h-3 w-3" /> Celular</p>
          {mobile ? (
            <p className="font-mono font-semibold text-slate-900">{formatPhone(mobile)}</p>
          ) : (
            <p className="text-sm text-slate-400">{enrichment === 'pending' ? '—' : enrichment === 'error' ? 'Erro na consulta' : 'Não encontrado'}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 md:justify-end">
          {enrichment !== 'found' && (
            <>
              <Button size="sm" variant="secondary" loading={busy === 'cdd'} onClick={() => fetchContacts('casa_dos_dados')} icon={<UserSearch className="h-3.5 w-3.5" />}>
                Trazer contatos
              </Button>
              <Button size="sm" variant="ghost" loading={busy === 'receita'} onClick={() => fetchContacts('receita')} icon={<Landmark className="h-3.5 w-3.5" />}>
                Tentar pela Receita
              </Button>
            </>
          )}
          {lead && mobile && !result.alreadyWorked && !lead.doNotContact && (
            <Button size="sm" onClick={() => onActivate(lead.id)} icon={<Send className="h-3.5 w-3.5" />}>
              Ativar
            </Button>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
        {company.situacao && <Badge color={company.situacao === 'ATIVA' ? 'green' : 'red'}>{company.situacao}</Badge>}
        {company.porte && <Badge>{company.porte}</Badge>}
        {company.dataAbertura && <span>Aberta em {fmtDate(company.dataAbertura)}</span>}
        {company.cnaeDescricao && <span className="truncate">· {company.cnaeDescricao}</span>}
        <span className="flex-1" />
        {enrichment === 'error' && (
          <span className="flex items-center gap-1 text-red-600"><AlertCircle className="h-3 w-3" /> {company.enrichmentError ?? 'Consulta apresentou erro'}</span>
        )}
        {enrichment === 'not_found' && <Badge color="yellow">Informação não encontrada</Badge>}
        {result.contacts.length > 1 && <Badge color="blue">{result.contacts.length} contatos</Badge>}
        {result.alreadyWorked && <Badge color="yellow">Já trabalhada</Badge>}
        {lead?.doNotContact && <Badge color="red">Não contatar</Badge>}
        {lead && <LeadStatusBadge status={lead.status} />}
      </div>
    </div>
  );
}
