// Fila central + Monitor de envio (tempo real).
import { CheckCheck, Eye, ListOrdered, Pause, Play, RotateCcw, Send, TriangleAlert, X, Zap } from 'lucide-react';
import { useState } from 'react';
import { fmtDateTime, formatPhone, relative, titleCase } from '../components/format';
import { ChannelChip, QueueStatusBadge, StatusDot } from '../components/status';
import { Button, Card, EmptyState, PageHeader, Select, SkeletonRows, Stat } from '../components/ui';
import { useApi, useRealtime } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { api } from '../services/api';
import { QUEUE_STATUS_LABELS, QUEUE_STATUSES, type QueueItem } from '../types';

export function QueuePage() {
  const toast = useToast();
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const { data: mon } = useApi<any>('/queue/monitor', { refreshOn: ['queue.updated', 'channels.updated', 'message.status'], intervalMs: 20000 });
  const { data, loading, reload } = useApi<{ items: QueueItem[] }>(`/queue${status ? `?status=${status}` : ''}`, { refreshOn: ['queue.updated'] });
  const [feed, setFeed] = useState<any[]>([]);
  useRealtime('log.new', (l) => ['whatsapp', 'queue', 'campaign', 'firefox'].includes(l.category) && setFeed((f) => [l, ...f].slice(0, 30)));

  const act = async (path: string, msg?: string) => {
    try {
      const r = await api.post(path);
      if (msg) toast.success(typeof r?.affected === 'number' ? `${msg} (${r.affected})` : msg);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const s = mon?.stats;
  return (
    <div className="p-6">
      <PageHeader
        title="Fila e monitor"
        description="A fila é persistente: fechar o navegador não apaga o estado. O canal é escolhido no momento do processamento."
        actions={can('admin', 'supervisor') && (
          <>
            <Button variant="secondary" onClick={() => act('/queue/pause', 'Fila pausada')} icon={<Pause className="h-4 w-4" />}>Pausar tudo</Button>
            <Button variant="secondary" onClick={() => act('/queue/resume', 'Fila retomada')} icon={<Play className="h-4 w-4" />}>Retomar</Button>
            <Button onClick={() => act('/queue/process', 'Ciclo executado')} icon={<Zap className="h-4 w-4" />}>Processar agora</Button>
          </>
        )}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Mensagens na fila" value={s ? s.pending + s.processing + s.paused : '…'} icon={<ListOrdered className="h-4 w-4" />} tone="amber" hint={s ? `${s.paused} pausada(s)` : undefined} />
        <Stat label="Enviadas" value={s ? s.sent + s.delivered + s.read : '…'} icon={<Send className="h-4 w-4" />} tone="green" />
        <Stat label="Entregues" value={s ? s.delivered + s.read : '…'} icon={<CheckCheck className="h-4 w-4" />} tone="sky" />
        <Stat label="Lidas" value={s?.read ?? '…'} icon={<Eye className="h-4 w-4" />} tone="violet" />
        <Stat label="Com erro" value={s?.error ?? '…'} icon={<TriangleAlert className="h-4 w-4" />} tone="red" />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_320px]">
        <Card
          title="Fila de envio"
          actions={
            <Select className="!h-8 w-40 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todos</option>
              {QUEUE_STATUSES.map((q) => <option key={q} value={q}>{QUEUE_STATUS_LABELS[q]}</option>)}
            </Select>
          }
        >
          {loading && !data ? <SkeletonRows /> : !data?.items.length ? <EmptyState icon={<ListOrdered className="h-6 w-6" />} title="Fila vazia" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] font-semibold text-slate-500 uppercase">
                  <tr><th className="px-4 py-2">Contato</th><th className="px-3 py-2">Origem</th><th className="px-3 py-2">Canal</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Agendado</th><th className="px-3 py-2" /></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((i) => (
                    <tr key={i.id}>
                      <td className="px-4 py-2">
                        <p className="font-medium">{i.contactName ? titleCase(i.contactName) : formatPhone(i.phone)}</p>
                        <p className="text-[11px] text-slate-500">{i.companyName ? titleCase(i.companyName) : ''} · {formatPhone(i.phone)}</p>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{i.campaignName ?? (i.kind === 'manual' ? 'Inbox' : 'Envio individual')}{i.kind === 'followup' ? ' · follow-up' : ''}</td>
                      <td className="px-3 py-2">{i.channelLabel ? <ChannelChip label={i.channelLabel} /> : <span className="text-xs text-slate-400">{i.channelMode === 'auto' ? 'Automático' : '—'}</span>}</td>
                      <td className="px-3 py-2">
                        <QueueStatusBadge status={i.status} />
                        {(i.skipReason || i.lastError) && <p className="mt-0.5 max-w-56 truncate text-[11px] text-slate-500" title={i.skipReason ?? i.lastError ?? ''}>{i.skipReason ?? i.lastError}</p>}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{fmtDateTime(i.processedAt ?? i.scheduledAt)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {['pending', 'paused', 'error'].includes(i.status) && <button title="Cancelar" onClick={() => act(`/queue/${i.id}/cancel`)} className="p-1 text-slate-400 hover:text-red-600"><X className="h-4 w-4" /></button>}
                        {['error', 'cancelled'].includes(i.status) && <button title="Reenviar" onClick={() => act(`/queue/${i.id}/retry`, 'Reenfileirado')} className="p-1 text-slate-400 hover:text-brand-600"><RotateCcw className="h-4 w-4" /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Por canal">
            <div className="space-y-2 p-4 text-sm">
              <p className="flex justify-between text-xs"><span className="text-slate-500">Último canal utilizado</span><b>{mon?.rotation.lastChannel?.label ?? '—'}</b></p>
              <p className="flex justify-between text-xs"><span className="text-slate-500">Próximo canal</span><b className="text-emerald-700">{mon?.rotation.nextChannel?.label ?? '—'}</b></p>
              <div className="divide-y divide-slate-100 pt-1">
                {(mon?.channels ?? []).map((c: any) => (
                  <div key={c.id} className="flex items-center gap-2 py-1.5 text-xs">
                    <span className="w-11 font-mono font-semibold">{c.label}</span>
                    <StatusDot state={c.status} />
                    <span className="flex-1 text-slate-600">{c.status === 'paused' ? 'pausado' : c.status === 'connected' ? `${c.sentToday} envios hoje` : c.availability.reason ?? c.status}</span>
                    <span className="text-slate-400">{c.queueCount ? `${c.queueCount} na fila` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
          <Card title="Atividade em tempo real">
            <div className="scroll-thin max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {feed.map((l) => (
                <div key={l.id} className="px-4 py-2 text-xs">
                  <p className={l.level === 'error' ? 'text-red-600' : l.level === 'warn' ? 'text-amber-700' : 'text-slate-700'}>{l.message}</p>
                  <p className="text-[10px] text-slate-400">{relative(l.createdAt)}{l.meta?.container ? ` · ${l.meta.container}` : ''}</p>
                </div>
              ))}
              {!feed.length && <p className="px-4 py-6 text-center text-xs text-slate-400">Aguardando eventos…</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
