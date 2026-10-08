// Painel lateral do lead: dados, contatos, status, observações, histórico, bloqueio e opt-out.
import { Ban, MessageSquare, Plus, Send, Star, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { api } from '../services/api';
import { LEAD_STATUS_LABELS, LEAD_STATUSES, type Chat, type Lead } from '../types';
import { companyName, fmtDate, fmtDateTime, formatCnpj, formatPhone, titleCase } from './format';
import { ChannelChip, LeadStatusBadge } from './status';
import { Badge, Button, Field, Input, Select, Spinner, Textarea } from './ui';

export function LeadDrawer({ leadId, onClose, onActivate, onChanged }: { leadId: number; onClose: () => void; onActivate: (leadId: number) => void; onChanged?: () => void }) {
  const toast = useToast();
  const { data, reload } = useApi<{ lead: Lead; history: any[]; chats: Chat[] }>(`/leads/${leadId}`, { refreshOn: ['lead.updated', 'message.new'] });
  const { data: company, reload: reloadCompany } = useApi<any>(data ? `/companies/${data.lead.companyId}` : null);
  const [notes, setNotes] = useState('');
  const [newContact, setNewContact] = useState<{ name: string; phone: string } | null>(null);
  useEffect(() => setNotes(data?.lead.notes ?? ''), [data?.lead.notes]);

  if (!data) {
    return (
      <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md items-center justify-center border-l border-slate-200 bg-white shadow-2xl">
        <Spinner />
      </div>
    );
  }
  const { lead, history, chats } = data;

  const update = async (patch: Partial<Lead>) => {
    try {
      await api.patch(`/leads/${lead.id}`, patch);
      await reload();
      onChanged?.();
      toast.success('Lead atualizado.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const optOut = async () => {
    if (!confirm('Registrar opt-out? O contato nunca mais receberá disparos.')) return;
    await api.post('/leads/opt-outs', { leadId: lead.id, reason: 'Solicitado pelo contato' });
    await reload();
    onChanged?.();
    toast.success('Opt-out registrado.');
  };

  const makePrimary = async (contactId: number) => {
    await api.patch(`/contacts/${contactId}`, { makePrimary: true });
    await Promise.all([reload(), reloadCompany()]);
    onChanged?.();
  };

  const addContact = async () => {
    if (!newContact) return;
    try {
      await api.post(`/companies/${lead.companyId}/contacts`, { name: newContact.name || null, phone: newContact.phone || null, makePrimary: true });
      setNewContact(null);
      await Promise.all([reload(), reloadCompany()]);
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between border-b border-slate-100 p-4">
        <div className="min-w-0">
          <p className="truncate font-semibold">{titleCase(companyName(lead.company))}</p>
          <p className="text-xs text-slate-500">{formatCnpj(lead.company.cnpj)} · {titleCase(lead.company.cidade)} {lead.company.uf}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <LeadStatusBadge status={lead.status} />
            {lead.doNotContact && <Badge color="red">Não contatar</Badge>}
            {lead.optOut && <Badge color="red">Opt-out</Badge>}
          </div>
        </div>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
      </div>
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-4 text-sm">
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
          <div><p className="text-[11px] text-slate-500">Sócio</p><p className="font-semibold">{lead.contact?.name ? titleCase(lead.contact.name) : '—'}</p></div>
          <div><p className="text-[11px] text-slate-500">Celular</p><p className="font-mono font-semibold">{lead.contact?.phone ? formatPhone(lead.contact.phone) : '—'}</p></div>
          <div><p className="text-[11px] text-slate-500">Primeiro contato</p><p>{fmtDateTime(lead.firstContactAt)}</p></div>
          <div><p className="text-[11px] text-slate-500">Último contato</p><p>{fmtDateTime(lead.lastContactAt)}</p></div>
          <div><p className="text-[11px] text-slate-500">Contatos</p><p>{lead.contactCount}</p></div>
          <div><p className="text-[11px] text-slate-500">Canal usado</p><ChannelChip label={lead.lastChannelLabel} />{!lead.lastChannelLabel && '—'}</div>
          <div><p className="text-[11px] text-slate-500">Responsável</p><p>{lead.ownerName ?? '—'}</p></div>
          <div><p className="text-[11px] text-slate-500">Abertura</p><p>{fmtDate(lead.company.dataAbertura)}</p></div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onActivate(lead.id)} disabled={!lead.contact?.phone || lead.doNotContact || lead.optOut} icon={<Send className="h-3.5 w-3.5" />}>
            {lead.contactCount ? 'Enviar mensagem' : 'Mensagem de ativação'}
          </Button>
          {chats.map((c) => (
            <Link key={c.id} to={`/inbox?chat=${c.id}`}>
              <Button size="sm" variant="secondary" icon={<MessageSquare className="h-3.5 w-3.5" />}>Conversa {c.channelLabel}</Button>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <Select value={lead.status} onChange={(e) => update({ status: e.target.value as Lead['status'] })}>
              {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
            </Select>
          </Field>
          <Field label="Bloqueio">
            <Button variant={lead.doNotContact ? 'danger' : 'secondary'} className="w-full" onClick={() => update({ doNotContact: !lead.doNotContact })} icon={<Ban className="h-3.5 w-3.5" />}>
              {lead.doNotContact ? 'Não contatar (ativo)' : 'Não contatar'}
            </Button>
          </Field>
        </div>
        <Field label="Observações">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (lead.notes ?? '') && update({ notes })} />
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-700">Contatos da empresa</p>
            <button className="flex items-center gap-1 text-xs font-medium text-brand-600" onClick={() => setNewContact({ name: '', phone: '' })}><Plus className="h-3 w-3" /> Adicionar</button>
          </div>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {(company?.contacts ?? []).map((c: any) => (
              <div key={c.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name ? titleCase(c.name) : 'Sem nome'}</p>
                  <p className="text-slate-500">{c.role ? titleCase(c.role) : ''} {c.phone ? `· ${formatPhone(c.phone)}` : ''}</p>
                </div>
                {c.isPrimary ? <Badge color="brand"><Star className="h-3 w-3" /> Principal</Badge> : <button onClick={() => makePrimary(c.id)} className="text-[11px] text-brand-600 hover:underline">Tornar principal</button>}
              </div>
            ))}
            {(company?.company?.phones ?? []).length > 0 && (
              <div className="px-3 py-2 text-[11px] text-slate-500">Telefones da empresa: {company.company.phones.map((p: any) => `${formatPhone(p.phone)} (${p.type})`).join(' · ')}</div>
            )}
          </div>
          {newContact && (
            <div className="mt-2 space-y-2 rounded-lg border border-brand-100 bg-brand-50/40 p-3">
              <Input placeholder="Nome do sócio" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} />
              <Input placeholder="Celular com DDD" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setNewContact(null)}>Cancelar</Button>
                <Button size="sm" onClick={addContact}>Salvar como principal</Button>
              </div>
            </div>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-slate-700">Histórico</p>
          <ol className="space-y-2 border-l border-slate-200 pl-3">
            {history.map((h) => (
              <li key={h.id} className="text-xs">
                <p className="text-slate-700">{h.description}</p>
                <p className="text-[11px] text-slate-400">{fmtDateTime(h.createdAt)}{h.userName ? ` · ${h.userName}` : ''}{h.channelLabel ? ` · ${h.channelLabel}` : ''}</p>
              </li>
            ))}
            {!history.length && <li className="text-xs text-slate-400">Sem eventos.</li>}
          </ol>
        </div>

        {!lead.optOut && (
          <button onClick={optOut} className="text-xs font-medium text-red-600 hover:underline">Registrar opt-out (não receber mais mensagens)</button>
        )}
      </div>
    </div>
  );
}
