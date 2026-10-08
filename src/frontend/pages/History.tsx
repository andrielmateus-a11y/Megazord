import { Ban, History as HistoryIcon, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { companyName, fmtDateTime, formatCnpj, formatPhone, titleCase } from '../components/format';
import { ExportButtons, ImportButton } from '../components/ImportExport';
import { LeadDrawer } from '../components/LeadDrawer';
import { SendActivationModal } from '../components/SendActivationModal';
import { ChannelChip, LeadStatusBadge } from '../components/status';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, SkeletonRows, Tabs } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { api } from '../services/api';
import { LEAD_STATUS_LABELS, LEAD_STATUSES, UFS, type Lead } from '../types';

export function HistoryPage() {
  const [tab, setTab] = useState<'leads' | 'optouts'>('leads');
  return (
    <div className="p-6">
      <PageHeader
        title="Histórico e contatos"
        description="Todas as empresas trabalhadas, seus sócios, telefones, status e canal utilizado."
        actions={
          <>
            <ImportButton kind="leads" label="Importar histórico" />
            <ExportButtons kind="leads" label="Leads" />
            <ExportButtons kind="history" label="Histórico" />
          </>
        }
      />
      <Tabs tabs={[{ id: 'leads', label: 'Empresas e leads' }, { id: 'optouts', label: 'Opt-out' }]} value={tab} onChange={setTab} />
      <div className="mt-4">{tab === 'leads' ? <LeadsTable /> : <OptOuts />}</div>
    </div>
  );
}

function LeadsTable() {
  const [f, setF] = useState({ status: '', search: '', uf: '', mine: false, worked: false, offset: 0 });
  const [open, setOpen] = useState<number | null>(null);
  const [activate, setActivate] = useState<number | null>(null);
  const qs = new URLSearchParams({
    ...(f.status && { status: f.status }),
    ...(f.search && { search: f.search }),
    ...(f.uf && { uf: f.uf }),
    ...(f.mine && { mine: 'true' }),
    ...(f.worked && { worked: 'true' }),
    limit: '50',
    offset: String(f.offset),
  });
  const { data, loading, reload } = useApi<{ total: number; items: Lead[] }>(`/leads?${qs}`, { refreshOn: ['lead.updated'] });

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <div className="relative w-72">
          <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-slate-400" />
          <Input className="pl-8" placeholder="Empresa, sócio, CNPJ ou telefone" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value, offset: 0 })} />
        </div>
        <Select className="w-48" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, offset: 0 })}>
          <option value="">Todos os status</option>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
        </Select>
        <Select className="w-24" value={f.uf} onChange={(e) => setF({ ...f, uf: e.target.value, offset: 0 })}>
          <option value="">UF</option>
          {UFS.map((u) => <option key={u}>{u}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" className="accent-brand-600" checked={f.worked} onChange={(e) => setF({ ...f, worked: e.target.checked, offset: 0 })} /> Somente contatadas</label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" className="accent-brand-600" checked={f.mine} onChange={(e) => setF({ ...f, mine: e.target.checked, offset: 0 })} /> Meus leads</label>
        <span className="flex-1" />
        <span className="text-xs text-slate-500">{data?.total ?? 0} registros</span>
      </div>
      {loading && !data ? (
        <SkeletonRows />
      ) : !data?.items.length ? (
        <EmptyState icon={<HistoryIcon className="h-6 w-6" />} title="Nenhuma empresa encontrada" description="Empresas aparecem aqui ao trazer contatos na prospecção ou importar o histórico." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2">Empresa</th>
                <th className="px-3 py-2">Sócio</th>
                <th className="px-3 py-2">Telefone</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Contatos</th>
                <th className="px-3 py-2">Último contato</th>
                <th className="px-3 py-2">Canal</th>
                <th className="px-3 py-2">Responsável</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((l) => (
                <tr key={l.id} onClick={() => setOpen(l.id)} className="cursor-pointer hover:bg-slate-50">
                  <td className="max-w-72 px-4 py-2.5">
                    <p className="truncate font-medium">{titleCase(companyName(l.company))}</p>
                    <p className="text-[11px] text-slate-500">{formatCnpj(l.company.cnpj)}</p>
                  </td>
                  <td className="px-3 py-2.5">{l.contact?.name ? titleCase(l.contact.name) : <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{l.contact?.phone ? formatPhone(l.contact.phone) : <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      <LeadStatusBadge status={l.status} />
                      {(l.doNotContact || l.optOut) && <Badge color="red"><Ban className="h-3 w-3" /></Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">{l.contactCount}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{fmtDateTime(l.lastContactAt)}</td>
                  <td className="px-3 py-2.5"><ChannelChip label={l.lastChannelLabel} /></td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{l.ownerName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > 50 && (
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 p-3 text-xs">
          <Button size="sm" variant="secondary" disabled={f.offset === 0} onClick={() => setF({ ...f, offset: Math.max(0, f.offset - 50) })}>Anterior</Button>
          <span>{f.offset + 1}–{Math.min(f.offset + 50, data.total)} de {data.total}</span>
          <Button size="sm" variant="secondary" disabled={f.offset + 50 >= data.total} onClick={() => setF({ ...f, offset: f.offset + 50 })}>Próxima</Button>
        </div>
      )}
      {open && <LeadDrawer leadId={open} onClose={() => setOpen(null)} onActivate={setActivate} onChanged={reload} />}
      <SendActivationModal open={activate !== null} leadId={activate} onClose={() => setActivate(null)} onSent={reload} />
    </Card>
  );
}

function OptOuts() {
  const toast = useToast();
  const { data, reload } = useApi<{ optOuts: any[] }>('/leads/opt-outs');
  const [form, setForm] = useState({ phone: '', cnpj: '', reason: '' });
  const add = async () => {
    try {
      await api.post('/leads/opt-outs', { phone: form.phone || undefined, cnpj: form.cnpj || undefined, reason: form.reason || undefined });
      setForm({ phone: '', cnpj: '', reason: '' });
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Card title="Contatos em opt-out" subtitle="Nenhum disparo (manual de ativação ou automático) é feito para estes telefones/CNPJs.">
      <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
        <Input className="w-44" placeholder="Telefone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <Input className="w-48" placeholder="CNPJ" value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} />
        <Input className="w-64" placeholder="Motivo" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <Button onClick={add} disabled={!form.phone && !form.cnpj}>Adicionar</Button>
      </div>
      <div className="divide-y divide-slate-100">
        {(data?.optOuts ?? []).map((o) => (
          <div key={o.id} className="flex items-center gap-4 px-4 py-2 text-sm">
            <span className="w-40 font-mono text-xs">{o.phone ? formatPhone(o.phone) : '—'}</span>
            <span className="w-44 text-xs">{o.cnpj ? formatCnpj(o.cnpj) : '—'}</span>
            <span className="flex-1 text-xs text-slate-500">{o.reason}</span>
            <span className="text-xs text-slate-400">{fmtDateTime(o.created_at)}</span>
            <button onClick={() => api.del(`/leads/opt-outs/${o.id}`).then(reload)} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        {!data?.optOuts.length && <EmptyState title="Nenhum opt-out registrado" />}
      </div>
    </Card>
  );
}
