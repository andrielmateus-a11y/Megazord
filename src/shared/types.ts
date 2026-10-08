// Tipos de API compartilhados.
import type { ChannelStatus, LeadStatus, QueueStatus, Role, Transport } from './constants.js';

export interface User {
  id: number;
  accountId: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  settings: Record<string, unknown>;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Channel {
  id: number;
  orderIndex: number;
  label: string;
  name: string;
  phone: string | null;
  transport: Transport;
  evolutionInstance: string | null;
  status: ChannelStatus;
  paused: boolean;
  queueEnabled: boolean;
  dailyLimit: number;
  cooldownSeconds: number;
  cooldownUntil: string | null;
  lastSentAt: string | null;
  sentCount: number;
  sentToday: number;
  receivedCount: number;
  queueCount: number;
  lastError: string | null;
  container: FirefoxContainer | null;
  availability: { available: boolean; reason: string | null };
}

export interface FirefoxContainer {
  id: number;
  channelId: number;
  name: string;
  cookieStoreId: string | null;
  color: string;
  icon: string;
  status: 'ok' | 'not_found' | 'unknown';
  waStatus: 'ready' | 'not_open' | 'logged_out' | 'loading' | 'unknown';
  lastSeenAt: string | null;
}

export interface Company {
  id: number;
  cnpj: string;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  situacao: string | null;
  cnae: string | null;
  cnaeDescricao: string | null;
  dataAbertura: string | null;
  porte: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  email: string | null;
  phones: { phone: string; type: 'celular' | 'fixo' | 'desconhecido' }[];
  source: string | null;
  enrichmentStatus: 'pending' | 'found' | 'not_found' | 'error';
  enrichmentError: string | null;
  enrichedAt: string | null;
  presentedAt: string | null;
}

export interface Contact {
  id: number;
  companyId: number | null;
  name: string | null;
  role: string | null;
  phone: string | null;
  phoneType: 'celular' | 'fixo' | 'desconhecido' | null;
  isPrimary: boolean;
  source: string | null;
}

export interface Lead {
  id: number;
  companyId: number;
  contactId: number | null;
  status: LeadStatus;
  ownerUserId: number | null;
  ownerName: string | null;
  lastChannelId: number | null;
  lastChannelLabel: string | null;
  firstContactAt: string | null;
  lastContactAt: string | null;
  lastReplyAt: string | null;
  contactCount: number;
  notes: string | null;
  doNotContact: boolean;
  optOut: boolean;
  createdAt: string;
  company: Company;
  contact: Contact | null;
}

export interface ProspectResult {
  company: Company;
  contacts: Contact[];
  primaryContact: Contact | null;
  lead: Pick<Lead, 'id' | 'status' | 'contactCount' | 'lastContactAt' | 'doNotContact'> | null;
  alreadyWorked: boolean;
}

export interface Template {
  id: number;
  name: string;
  category: string;
  body: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Chat {
  id: number;
  channelId: number;
  channelLabel: string;
  leadId: number | null;
  contactId: number | null;
  remotePhone: string;
  remoteName: string | null;
  companyName: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  status: 'open' | 'closed';
}

export interface Message {
  id: number;
  chatId: number;
  channelId: number | null;
  direction: 'in' | 'out';
  body: string | null;
  media: unknown;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';
  transport: string | null;
  containerName: string | null;
  error: string | null;
  userName: string | null;
  campaignId: number | null;
  createdAt: string;
}

export interface QueueItem {
  id: number;
  campaignId: number | null;
  campaignName: string | null;
  leadId: number | null;
  companyName: string | null;
  contactName: string | null;
  phone: string;
  channelMode: 'auto' | 'manual';
  channelId: number | null;
  channelLabel: string | null;
  kind: string;
  status: QueueStatus;
  attempts: number;
  scheduledAt: string;
  processedAt: string | null;
  lastError: string | null;
  skipReason: string | null;
  createdAt: string;
}

export interface Campaign {
  id: number;
  name: string;
  templateId: number | null;
  templateName: string | null;
  audience: CampaignAudience;
  channelIds: number[];
  startAt: string | null;
  windowStart: string;
  windowEnd: string;
  weekdays: number[];
  intervalSeconds: number;
  dailyLimit: number;
  cadence: CadenceStep[];
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';
  createdAt: string;
  stats: { total: number; pending: number; sent: number; skipped: number; error: number };
}

export interface CampaignAudience {
  leadIds?: number[];
  statuses?: LeadStatus[];
  uf?: string;
  cidade?: string;
  onlyNeverContacted?: boolean;
  limit?: number;
}

export interface CadenceStep {
  step: number;
  dayOffset: number;
  templateId: number;
}

export interface BridgeStatus {
  connected: boolean;
  lastHeartbeatAt: string | null;
  extensionVersion: string | null;
  containersDetected: number;
  containers: { name: string; cookieStoreId: string; waStatus: string }[];
}
