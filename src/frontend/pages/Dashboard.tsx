import { Building2, Inbox, ListOrdered, Megaphone, MessageCircle, Radar, Send, Smartphone, Users } from 'lucide-react';
import { Link } from 'react-router';
import { ChannelStatus } from '../components/status';
import { Button, Card, PageHeader, Skeleton, Stat } from '../components/ui';
import { formatPhone, relative } from '../components/format';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { LEAD_STATUS_LABELS, LEAD_STATUSES, type Channel } from '../types';

export function DashboardPage() {
  const { user } = useAuth();
  const { data: d } = useApi<any>('/dashboard', { refreshOn: ['queue.updated', 'message.new', 'channels.updated', 'campaign.updated', 'lead.updated'] });
  const { data: ch } = useApi<{ channels: Channel[]; rotation: any }>('/whatsapp/channels', { refreshOn: ['channels.updated', 'bridge.status'] });

  const totalLeads = d ? Object.values(d.leadsByStatus as Record<string, number>).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="p-6">
      <PageHeader
        title={`Olá, ${user?.name.split(' ')[0] ?? ''}`}
        description="Central operacional de prospecção e comunicação."
        actions={
          <>
            <Link to="/prospeccao/descobrir"><Button icon={<Radar className="h-4 w-4" />}>Descobrir empresas</Button></Link>
            <Link to="/automacao/campanhas"><Button variant="secondary" icon={<Megaphone className="h-4 w-4" />}>Nova campanha</Button></Link>
            <Link to="/inbox"><Button variant="secondary" icon={<Inbox className="h-4 w-4" />}>Abrir Inbox</Button></Link>
            <Link to="/whatsapp/canais"><Button variant="secondary" icon={<Smartphone className="h-4 w-4" />}>Gerenciar WhatsApps</Button></Link>
          </>
        }
      />
      {!d ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Leads disponíveis" value={d.leadsAvailable} icon={<Users className="h-4 w-4" />} hint="Com celular e nunca contatados" />
          <Stat label="Empresas trabalhadas" value={d.companiesWorked} icon={<Building2 className="h-4 w-4" />} tone="violet" hint={`${d.companiesTotal} empresas na base`} />
          <Stat label="Mensagens enviadas" value={d.messagesSent} icon={<Send className="h-4 w-4" />} tone="green" hint={`${d.messagesSentToday} hoje`} />
          <Stat label="Mensagens recebidas" value={d.messagesReceived} icon={<MessageCircle className="h-4 w-4" />} tone="sky" hint={`${d.messagesReceivedToday} hoje`} />
          <Stat label="Conversas abertas" value={d.openChats} icon={<Inbox className="h-4 w-4" />} tone="sky" hint={`${d.unreadChats} com mensagens não lidas`} />
          <Stat label="Mensagens na fila" value={d.queue} icon={<ListOrdered className="h-4 w-4" />} tone="amber" />
          <Stat label="Campanhas ativas" value={d.activeCampaigns} icon={<Megaphone className="h-4 w-4" />} tone="violet" />
          <Stat label="WhatsApps conectados" value={`${d.channelsConnected}/${d.channelsTotal}`} icon={<Smartphone className="h-4 w-4" />} tone="green" hint={d.bridge.connected ? 'Firefox Bridge conectado' : 'Firefox Bridge desconectado'} />
        </div>
      )}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="WhatsApps" subtitle={ch?.rotation?.nextChannel ? `Próximo no rodízio: ${ch.rotation.nextChannel.label}` : 'Nenhum canal disponível para o rodízio'} actions={<Link to="/whatsapp/canais" className="text-xs font-medium text-brand-600">Gerenciar</Link>}>
          <div className="divide-y divide-slate-100">
            {(ch?.channels ?? []).map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-12 font-mono text-xs font-semibold">{c.label}</span>
                <span className="w-32"><ChannelStatus channel={c} /></span>
                <span className="flex-1 truncate text-xs text-slate-500">{c.phone ? formatPhone(c.phone) : c.container?.name}</span>
                <span className="text-xs text-slate-500">{c.sentToday}/{c.dailyLimit} hoje</span>
                <span className="w-20 text-right text-[11px] text-slate-400">{relative(c.lastSentAt)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Funil de leads" subtitle={`${totalLeads} leads`}>
          <div className="space-y-2 p-4">
            {LEAD_STATUSES.map((s) => {
              const n = d?.leadsByStatus?.[s] ?? 0;
              return (
                <div key={s} className="flex items-center gap-3 text-xs">
                  <span className="w-36 text-slate-600">{LEAD_STATUS_LABELS[s]}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${totalLeads ? (n / totalLeads) * 100 : 0}%` }} />
                  </div>
                  <span className="w-8 text-right font-medium">{n}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
