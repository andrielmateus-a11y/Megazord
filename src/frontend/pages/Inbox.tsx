// Inbox unificado: conversas de todos os WhatsApps, com o canal sempre visível e o lead vinculado.
import { AlertCircle, Check, CheckCheck, Clock, FileText, Inbox as InboxIcon, Search, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { companyName, fmtDateTime, fmtTime, formatCnpj, formatPhone, titleCase } from '../components/format';
import { ChannelChip, LeadStatusBadge } from '../components/status';
import { Badge, Button, EmptyState, Input, Select, Spinner, cx } from '../components/ui';
import { useApi, useRealtime } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { api } from '../services/api';
import { renderTemplate } from '../../shared/text';
import type { Channel, Chat, Lead, Message, Template } from '../types';
import { LeadDrawer } from '../components/LeadDrawer';
import { SendActivationModal } from '../components/SendActivationModal';

export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const [channelFilter, setChannelFilter] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const selectedId = params.get('chat') ? Number(params.get('chat')) : null;
  const { data: chs } = useApi<{ channels: Channel[] }>('/whatsapp/channels', { refreshOn: ['channels.updated'] });
  const qs = new URLSearchParams({ ...(channelFilter && { channelId: String(channelFilter) }), ...(search && { search }) });
  const { data, loading } = useApi<{ chats: Chat[] }>(`/whatsapp/chats?${qs}`, { refreshOn: ['chat.updated', 'message.new'] });
  const channels = chs?.channels ?? [];

  return (
    <div className="flex h-full">
      <section className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="space-y-2 border-b border-slate-100 p-3">
          <h1 className="text-base font-semibold">Inbox</h1>
          <div className="relative">
            <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder="Buscar conversa" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="scroll-thin flex gap-1 overflow-x-auto pb-1">
            <FilterChip active={channelFilter === null} onClick={() => setChannelFilter(null)}>Todos</FilterChip>
            {channels.map((c) => (
              <FilterChip key={c.id} active={channelFilter === c.id} onClick={() => setChannelFilter(c.id)}>{c.label}</FilterChip>
            ))}
          </div>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto">
          {loading && !data ? (
            <div className="p-4"><Spinner /></div>
          ) : !data?.chats.length ? (
            <EmptyState icon={<InboxIcon className="h-6 w-6" />} title="Nenhuma conversa" description="As conversas aparecem aqui após o primeiro envio ou quando chegar uma mensagem." />
          ) : (
            data.chats.map((c) => (
              <button
                key={c.id}
                onClick={() => setParams({ chat: String(c.id) })}
                className={cx('flex w-full gap-3 border-b border-slate-50 px-3 py-2.5 text-left hover:bg-slate-50', selectedId === c.id && 'bg-brand-50/60')}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600">
                  {(c.remoteName ?? c.companyName ?? '#').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="flex-1 truncate text-sm font-medium">{c.remoteName ? titleCase(c.remoteName) : formatPhone(c.remotePhone)}</p>
                    <span className="text-[10px] text-slate-400">{fmtTime(c.lastMessageAt)}</span>
                  </div>
                  <p className="truncate text-[11px] text-slate-500">{c.companyName ? titleCase(c.companyName) : formatPhone(c.remotePhone)}</p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <ChannelChip label={c.channelLabel} />
                    <p className="flex-1 truncate text-xs text-slate-500">{c.lastMessagePreview}</p>
                    {c.unreadCount > 0 && <span className="rounded-full bg-emerald-500 px-1.5 text-[10px] font-semibold text-white">{c.unreadCount}</span>}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </section>
      {selectedId ? <Conversation key={selectedId} chatId={selectedId} channels={channels} /> : (
        <div className="chat-bg flex flex-1 items-center justify-center">
          <EmptyState icon={<InboxIcon className="h-6 w-6" />} title="Selecione uma conversa" description="Todas as conversas de todos os WhatsApps em um só lugar." />
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx('shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium', active ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
      {children}
    </button>
  );
}

function StatusIcon({ status }: { status: Message['status'] }) {
  if (status === 'pending') return <Clock className="h-3 w-3" />;
  if (status === 'sent') return <Check className="h-3 w-3" />;
  if (status === 'delivered') return <CheckCheck className="h-3 w-3" />;
  if (status === 'read') return <CheckCheck className="h-3 w-3 text-sky-500" />;
  if (status === 'failed') return <AlertCircle className="h-3 w-3 text-red-500" />;
  return null;
}

function Conversation({ chatId, channels }: { chatId: number; channels: Channel[] }) {
  const toast = useToast();
  const { data, reload } = useApi<{ chat: Chat; messages: Message[]; lead: Lead | null }>(`/whatsapp/chats/${chatId}`);
  const { data: tpl } = useApi<{ templates: Template[] }>('/whatsapp/templates');
  const [text, setText] = useState('');
  const [via, setVia] = useState<string>('chat');
  const [sending, setSending] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [activate, setActivate] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useRealtime('message.new', (p) => p.message?.chatId === chatId && reload());
  useRealtime('message.status', (p) => p.chatId === chatId && reload());
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [data?.messages.length]);

  const vars = useMemo(() => ({
    socio: data?.lead?.contact?.name ?? data?.chat.remoteName,
    empresa: data?.lead ? companyName(data.lead.company) : null,
    telefone: data?.chat.remotePhone,
    cidade: data?.lead?.company.cidade,
    cnpj: data?.lead?.company.cnpj,
  }), [data]);

  if (!data) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  const { chat, messages, lead } = data;

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const channelId = via === 'chat' ? undefined : via === 'auto' ? null : Number(via);
      const res = await api.post('/whatsapp/messages/send', { chatId, body: text, channelId });
      if (res.status === 'sent') setText('');
      else toast.error(res.reason ?? 'Não foi possível enviar.');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{chat.remoteName ? titleCase(chat.remoteName) : formatPhone(chat.remotePhone)}</p>
            <p className="truncate text-xs text-slate-500">{chat.companyName ? `${titleCase(chat.companyName)} · ` : ''}{formatPhone(chat.remotePhone)}</p>
          </div>
          <ChannelChip label={chat.channelLabel} className="text-xs" />
        </header>
        <div className="chat-bg scroll-thin flex-1 space-y-1.5 overflow-y-auto px-6 py-4">
          {messages.map((m) => (
            <div key={m.id} className={cx('flex', m.direction === 'out' ? 'justify-end' : 'justify-start')}>
              <div className={cx('max-w-[70%] rounded-lg px-3 py-1.5 text-sm shadow-sm', m.direction === 'out' ? (m.status === 'failed' ? 'bg-red-50 ring-1 ring-red-200' : 'bg-emerald-100') : 'bg-white')}>
                {m.body ? <p className="whitespace-pre-wrap text-slate-800">{m.body}</p> : <p className="text-xs text-slate-500 italic">[{(m.media as any)?.type ?? 'mídia'}]</p>}
                <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-500">
                  {m.campaignId && <Badge color="purple" className="!px-1 !py-0 !text-[9px]">campanha</Badge>}
                  {m.userName && <span>{m.userName.split(' ')[0]} ·</span>}
                  <span title={fmtDateTime(m.createdAt)}>{fmtTime(m.createdAt)}</span>
                  {m.direction === 'out' && <StatusIcon status={m.status} />}
                </div>
                {m.error && <p className="text-[10px] text-red-600">{m.error}</p>}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <footer className="border-t border-slate-200 bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Enviar pelo:</span>
            <Select className="!h-7 w-48 text-xs" value={via} onChange={(e) => setVia(e.target.value)}>
              <option value="chat">{chat.channelLabel} (desta conversa)</option>
              <option value="auto">Automático (rodízio)</option>
              {channels.filter((c) => c.id !== chat.channelId).map((c) => (
                <option key={c.id} value={c.id}>{c.label}{c.availability.available ? '' : ` — ${c.availability.reason}`}</option>
              ))}
            </Select>
            <Select className="!h-7 w-48 text-xs" value="" onChange={(e) => {
              const t = tpl?.templates.find((x) => x.id === Number(e.target.value));
              if (t) setText(renderTemplate(t.body, vars));
            }}>
              <option value="">Inserir mensagem pronta…</option>
              {(tpl?.templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Digite uma mensagem (Enter envia, Shift+Enter quebra linha)"
              className="max-h-40 min-h-11 flex-1 resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            <Button onClick={send} loading={sending} disabled={!text.trim()} icon={<Send className="h-4 w-4" />}>Enviar</Button>
          </div>
        </footer>
      </section>
      <aside className="scroll-thin hidden w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4 text-sm xl:block">
        <p className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">Lead</p>
        {lead ? (
          <div className="space-y-3">
            <Info label="Empresa" value={titleCase(companyName(lead.company))} />
            <Info label="Nome do sócio" value={lead.contact?.name ? titleCase(lead.contact.name) : '—'} />
            <Info label="Telefone" value={formatPhone(lead.contact?.phone ?? chat.remotePhone)} />
            <Info label="CNPJ" value={formatCnpj(lead.company.cnpj)} />
            <div><p className="text-[11px] text-slate-500">Status</p><LeadStatusBadge status={lead.status} /></div>
            <Info label="Último contato" value={fmtDateTime(lead.lastContactAt)} />
            <div><p className="text-[11px] text-slate-500">WhatsApp utilizado</p><ChannelChip label={lead.lastChannelLabel ?? chat.channelLabel} /></div>
            {lead.notes && <Info label="Observações" value={lead.notes} />}
            <Button size="sm" variant="secondary" className="w-full" onClick={() => setDrawer(true)} icon={<FileText className="h-3.5 w-3.5" />}>Histórico e detalhes</Button>
          </div>
        ) : (
          <div className="space-y-2 text-xs text-slate-500">
            <p>Esta conversa não está vinculada a uma empresa da prospecção.</p>
            <Info label="Telefone" value={formatPhone(chat.remotePhone)} />
          </div>
        )}
      </aside>
      {drawer && lead && <LeadDrawer leadId={lead.id} onClose={() => setDrawer(false)} onActivate={setActivate} onChanged={reload} />}
      <SendActivationModal open={activate !== null} leadId={activate} onClose={() => setActivate(null)} onSent={reload} />
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="font-medium break-words whitespace-pre-wrap text-slate-800">{value}</p>
    </div>
  );
}
