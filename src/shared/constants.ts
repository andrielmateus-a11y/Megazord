// Constantes e regras compartilhadas entre frontend e backend.

export const MAX_CHANNELS = 8;
export const INITIAL_CHANNELS = 4;

export const ROLES = ['admin', 'supervisor', 'sdr'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  sdr: 'SDR',
};

export const LEAD_STATUSES = [
  'novo',
  'em_contato',
  'aguardando_resposta',
  'interessado',
  'reuniao_agendada',
  'sem_interesse',
  'nao_respondeu',
  'nao_contatar',
  'convertido',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  novo: 'Novo',
  em_contato: 'Em contato',
  aguardando_resposta: 'Aguardando resposta',
  interessado: 'Interessado',
  reuniao_agendada: 'Reunião agendada',
  sem_interesse: 'Sem interesse',
  nao_respondeu: 'Não respondeu',
  nao_contatar: 'Não contatar',
  convertido: 'Convertido',
};

/** Status em que um lead NÃO deve receber disparos automáticos. */
export const BLOCKING_LEAD_STATUSES: LeadStatus[] = [
  'nao_contatar',
  'sem_interesse',
  'reuniao_agendada',
  'convertido',
];

export const QUEUE_STATUSES = [
  'pending',
  'processing',
  'sent',
  'delivered',
  'read',
  'error',
  'cancelled',
  'paused',
] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];
export const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  pending: 'Pendente',
  processing: 'Processando',
  sent: 'Enviado',
  delivered: 'Entregue',
  read: 'Lido',
  error: 'Erro',
  cancelled: 'Cancelado',
  paused: 'Pausado',
};

export type ChannelStatus = 'connected' | 'connecting' | 'disconnected' | 'not_configured';
export const CHANNEL_STATUS_LABELS: Record<ChannelStatus | 'paused', string> = {
  connected: 'Conectado',
  connecting: 'Conectando',
  disconnected: 'Desconectado',
  not_configured: 'Não configurado',
  paused: 'Pausado',
};

export type Transport = 'firefox' | 'evolution';

export const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  running: 'Em execução',
  paused: 'Pausada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

/** CNAEs de atividade contábil priorizados pela prospecção. */
export const ACCOUNTING_CNAES = [
  { code: '6920601', label: 'Atividades de contabilidade' },
  { code: '6920602', label: 'Atividades de consultoria e auditoria contábil e tributária' },
];

export const PORTES = [
  { code: 'ME', label: 'Microempresa' },
  { code: 'EPP', label: 'Empresa de Pequeno Porte' },
  { code: 'DEMAIS', label: 'Demais' },
];

export const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

export function channelLabel(orderIndex: number): string {
  return `WA ${String(orderIndex).padStart(2, '0')}`;
}

export function containerLabel(orderIndex: number): string {
  return `MEGAZORD WA ${String(orderIndex).padStart(2, '0')}`;
}
