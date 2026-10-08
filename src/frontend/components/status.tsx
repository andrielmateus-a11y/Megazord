// Badges de status reutilizáveis: canais, leads, fila.
import { CAMPAIGN_STATUS_LABELS, CHANNEL_STATUS_LABELS, LEAD_STATUS_LABELS, QUEUE_STATUS_LABELS, type LeadStatus, type QueueStatus } from '../types';
import type { Channel } from '../types';
import { Badge, cx } from './ui';

export function channelState(ch: Pick<Channel, 'status' | 'paused'>) {
  return ch.paused ? 'paused' : ch.status;
}

const DOT: Record<string, string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-400 animate-pulse',
  disconnected: 'bg-red-500',
  not_configured: 'bg-slate-300',
  paused: 'bg-slate-500',
};

export function StatusDot({ state, className }: { state: string; className?: string }) {
  return <span className={cx('inline-block h-2.5 w-2.5 shrink-0 rounded-full', DOT[state] ?? 'bg-slate-300', className)} />;
}

export function ChannelStatus({ channel }: { channel: Pick<Channel, 'status' | 'paused'> }) {
  const state = channelState(channel);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
      <StatusDot state={state} />
      {state === 'paused' ? '⏸ Pausado' : CHANNEL_STATUS_LABELS[state as keyof typeof CHANNEL_STATUS_LABELS]}
    </span>
  );
}

const LEAD_COLORS: Record<LeadStatus, 'gray' | 'blue' | 'yellow' | 'green' | 'red' | 'brand' | 'purple'> = {
  novo: 'gray',
  em_contato: 'blue',
  aguardando_resposta: 'yellow',
  interessado: 'green',
  reuniao_agendada: 'purple',
  sem_interesse: 'red',
  nao_respondeu: 'gray',
  nao_contatar: 'red',
  convertido: 'brand',
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <Badge color={LEAD_COLORS[status]}>{LEAD_STATUS_LABELS[status]}</Badge>;
}

const QUEUE_COLORS: Record<QueueStatus, 'gray' | 'blue' | 'yellow' | 'green' | 'red' | 'brand' | 'purple'> = {
  pending: 'yellow',
  processing: 'blue',
  sent: 'green',
  delivered: 'green',
  read: 'brand',
  error: 'red',
  cancelled: 'gray',
  paused: 'gray',
};

export function QueueStatusBadge({ status }: { status: QueueStatus }) {
  return <Badge color={QUEUE_COLORS[status]}>{QUEUE_STATUS_LABELS[status]}</Badge>;
}

export function CampaignStatusBadge({ status }: { status: string }) {
  const color = ({ running: 'green', scheduled: 'blue', paused: 'yellow', completed: 'brand', cancelled: 'red', draft: 'gray' } as const)[status as 'draft'] ?? 'gray';
  return <Badge color={color}>{CAMPAIGN_STATUS_LABELS[status] ?? status}</Badge>;
}

export function ChannelChip({ label, className }: { label: string | null | undefined; className?: string }) {
  if (!label) return null;
  return <span className={cx('inline-flex items-center rounded-md bg-emerald-600/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-700', className)}>{label}</span>;
}
