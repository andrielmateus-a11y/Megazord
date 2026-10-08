// Casa dos Dados — busca objetiva: SÓCIO, CELULAR e EMPRESA.
import { Building2, Database, Landmark, Phone, Search, Send, User } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { companyName, formatCnpj, formatPhone, relative, titleCase } from '../components/format';
import { SendActivationModal } from '../components/SendActivationModal';
import { LeadStatusBadge } from '../components/status';
import { Badge, Button, Card, EmptyState, Input, PageHeader } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { api } from '../services/api';
import type { ProspectResult } from '../types';

export function DataPage() {
  const toast = useToast();
  const [cnpj, setCnpj] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: string; result: ProspectResult } | null>(null);
  const [activate, setActivate] = useState<number | null>(null);
  const { data: status } = useApi<any>('/casa-dos-dados/status');

  const lookup = async (source: 'casa_dos_dados' | 'receita') => {
    setBusy(source);
    try {
      setResult(await api.post(`/casa-dos-dados/lookup/${cnpj.replace(/\D/g, '')}`, { source }));
    } catch (e) {
      toast.error((e as Error).message);
      setResult(null);
    } finally {
      setBusy(null);
    }
  };

  const r = result?.result;
  const mobile = r?.primaryContact?.phone ?? r?.company.phones.find((p) => p.type === 'celular')?.phone ?? null;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <PageHeader
        title="Casa dos Dados"
        description="Busca objetiva por CNPJ: o sócio, o celular e a empresa para iniciar a conversa."
        actions={
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Badge color={status?.status === 'ok' ? 'green' : status?.configured ? 'yellow' : 'red'}>
              {status?.configured ? (status.status === 'ok' ? 'Conectado' : status.status === 'error' ? 'Erro na chave' : 'Chave cadastrada') : 'Sem chave'}
            </Badge>
            {status && <span>{status.usageToday}/{status.dailyLimit} consultas hoje · última {relative(status.lastUsedAt)}</span>}
          </div>
        }
      />
      <Card>
        <div className="flex flex-wrap gap-2 p-4">
          <div className="relative min-w-64 flex-1">
            <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8 font-mono" placeholder="CNPJ da empresa" value={cnpj} onChange={(e) => setCnpj(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup('casa_dos_dados')} />
          </div>
          <Button onClick={() => lookup('casa_dos_dados')} loading={busy === 'casa_dos_dados'} icon={<Database className="h-4 w-4" />}>Buscar</Button>
          <Button variant="secondary" onClick={() => lookup('receita')} loading={busy === 'receita'} icon={<Landmark className="h-4 w-4" />}>Tentar pela Receita</Button>
        </div>
      </Card>

      {!r ? (
        <Card className="mt-4">
          <EmptyState icon={<Database className="h-6 w-6" />} title="Informe um CNPJ" description={status?.configured ? 'Os dados retornados são salvos no histórico da empresa.' : <>Nenhuma chave cadastrada. <Link className="text-brand-600 underline" to="/configuracoes?tab=integracoes">Cadastre em Integrações</Link>.</>} />
        </Card>
      ) : (
        <div className="mt-4 space-y-3">
          {result?.status === 'not_found' && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">Informação não encontrada nesta fonte para este CNPJ.</div>}
          <div className="grid gap-3 md:grid-cols-3">
            <BigField icon={<User className="h-4 w-4" />} label="Sócio" value={r.primaryContact?.name ? titleCase(r.primaryContact.name) : null} sub={r.primaryContact?.role ? titleCase(r.primaryContact.role) : undefined} />
            <BigField icon={<Phone className="h-4 w-4" />} label="Celular" value={mobile ? formatPhone(mobile) : null} mono />
            <BigField icon={<Building2 className="h-4 w-4" />} label="Empresa" value={titleCase(companyName(r.company))} sub={formatCnpj(r.company.cnpj)} />
          </div>
          <Card>
            <div className="flex flex-wrap items-center gap-2 p-4 text-xs text-slate-500">
              {r.lead && <LeadStatusBadge status={r.lead.status} />}
              {r.alreadyWorked && <Badge color="yellow">Já trabalhada</Badge>}
              <span>{[r.company.situacao, r.company.porte, titleCase(r.company.cidade), r.company.uf].filter(Boolean).join(' · ')}</span>
              {r.contacts.length > 1 && <span>· outros sócios: {r.contacts.filter((c) => !c.isPrimary).map((c) => titleCase(c.name)).join(', ')}</span>}
              <span className="flex-1" />
              {r.lead && mobile && !r.alreadyWorked && (
                <Button size="sm" onClick={() => setActivate(r.lead!.id)} icon={<Send className="h-3.5 w-3.5" />}>Gerar mensagem de ativação</Button>
              )}
            </div>
          </Card>
        </div>
      )}
      <SendActivationModal open={activate !== null} leadId={activate} onClose={() => setActivate(null)} onSent={() => lookup('casa_dos_dados')} />
    </div>
  );
}

function BigField({ icon, label, value, sub, mono }: { icon: React.ReactNode; label: string; value: string | null; sub?: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500 uppercase">{icon} {label}</p>
      <p className={`mt-1.5 text-lg font-semibold ${mono ? 'font-mono' : ''} ${value ? 'text-slate-900' : 'text-slate-400'}`}>{value ?? 'Não encontrado'}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
