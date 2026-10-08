// O coração do fluxo: empresa → sócio → celular → mensagem de ativação → WhatsApp → enviar.
import { AlertTriangle, CheckCircle2, Send, Smartphone } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { api } from '../services/api';
import type { Channel, Template } from '../types';
import { formatPhone } from './format';
import { ChannelStatus } from './status';
import { Badge, Button, Field, Modal, Select, Spinner, Textarea } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
  leadId: number | null;
  onSent?: () => void;
}

interface Preview {
  company: string;
  socio: string | null;
  phone: string | null;
  message: string;
  missingVariables: string[];
  eligibility: { ok: boolean; reason: string | null };
  channel: { id: number; label: string; container: string | null } | null;
  next: { id: number; label: string } | null;
}

export function SendActivationModal({ open, onClose, leadId, onSent }: Props) {
  const toast = useToast();
  const { data: tpl } = useApi<{ templates: Template[] }>(open ? '/whatsapp/templates' : null);
  const { data: chs } = useApi<{ channels: Channel[] }>(open ? '/whatsapp/channels' : null, { refreshOn: ['channels.updated'] });
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [channelId, setChannelId] = useState<number | null>(null);
  const [custom, setCustom] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const templates = useMemo(() => tpl?.templates ?? [], [tpl]);
  useEffect(() => {
    if (open && templates.length && templateId === null) setTemplateId((templates.find((t) => t.favorite && t.category === 'ativacao') ?? templates[0]).id);
  }, [open, templates, templateId]);
  useEffect(() => {
    if (!open) {
      setPreview(null);
      setCustom(null);
      setChannelId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !leadId || templateId === null) return;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .post<Preview>('/whatsapp/messages/activation/preview', { leadId, templateId, channelId, body: custom })
        .then(setPreview)
        .catch((e) => toast.error(e.message))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [open, leadId, templateId, channelId, custom]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!leadId) return;
    setSending(true);
    try {
      const res = await api.post('/whatsapp/messages/activation/send', { leadId, templateId, channelId, body: custom });
      if (res.status === 'sent') toast.success(`Mensagem enviada pelo ${res.channelLabel}.`);
      else if (res.status === 'rescheduled') toast.info(`Mensagem na fila: ${res.reason}.`);
      else if (res.status === 'skipped') toast.error(`Não enviado: ${res.reason}.`);
      else toast.error(res.reason ?? 'Falha no envio.');
      onSent?.();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const channels = chs?.channels ?? [];
  const selected = channels.find((c) => c.id === channelId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Mensagem de ativação"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={send} loading={sending} disabled={!preview?.eligibility.ok || loading} icon={<Send className="h-4 w-4" />}>
            Enviar {preview?.channel ? `pelo ${preview.channel.label}` : ''}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-5">
        <div className="space-y-3 md:col-span-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="text-[11px] font-medium text-slate-500 uppercase">Empresa</p>
            <p className="font-semibold">{preview?.company ?? '…'}</p>
            <p className="mt-2 text-[11px] font-medium text-slate-500 uppercase">Sócio</p>
            <p className="font-semibold">{preview?.socio ?? <span className="text-slate-400">não encontrado</span>}</p>
            <p className="mt-2 text-[11px] font-medium text-slate-500 uppercase">Celular</p>
            <p className="font-mono font-semibold">{preview?.phone ? formatPhone(preview.phone) : <span className="text-slate-400">não encontrado</span>}</p>
          </div>
          <Field label="Mensagem">
            <Select value={templateId ?? ''} onChange={(e) => { setTemplateId(Number(e.target.value)); setCustom(null); }}>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.favorite ? '★ ' : ''}{t.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Enviar pelo">
            <Select value={channelId ?? ''} onChange={(e) => setChannelId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Automático (rodízio)</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id} disabled={!!c.paused}>
                  {c.label}{c.phone ? ` · ${formatPhone(c.phone)}` : ''}{c.availability.available ? '' : ` — ${c.availability.reason}`}
                </option>
              ))}
            </Select>
          </Field>
          {selected && <ChannelStatus channel={selected} />}
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 text-xs text-emerald-900">
            <p className="flex items-center gap-1.5 font-semibold"><Smartphone className="h-3.5 w-3.5" /> Canal previsto: {preview?.channel?.label ?? '—'}</p>
            <p className="mt-1">Container: {preview?.channel?.container ?? '—'}</p>
            {!channelId && <p>Próximo: {preview?.next?.label ?? '—'}</p>}
            {!preview?.channel && <p className="mt-1 text-amber-700">Nenhum WhatsApp disponível agora — a mensagem ficará na fila.</p>}
          </div>
        </div>
        <div className="md:col-span-3">
          <p className="mb-1 text-xs font-medium text-slate-600">Pré-visualização personalizada</p>
          <div className="chat-bg rounded-lg border border-slate-200 p-4">
            {loading && !preview ? (
              <Spinner />
            ) : (
              <div className="ml-auto max-w-[90%] rounded-lg rounded-tr-none bg-emerald-100 px-3 py-2 text-sm whitespace-pre-wrap text-slate-800 shadow-sm">
                {preview?.message || <span className="text-slate-400">Mensagem vazia</span>}
              </div>
            )}
          </div>
          <Field label="Ajustar texto apenas para este envio (opcional)" className="mt-3">
            <Textarea
              rows={5}
              placeholder="Deixe vazio para usar a mensagem selecionada. Variáveis: {nome} {socio} {empresa} {telefone}"
              value={custom ?? ''}
              onChange={(e) => setCustom(e.target.value || null)}
            />
          </Field>
          <div className="mt-3 space-y-2">
            {preview?.missingVariables.length ? (
              <p className="flex items-center gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" /> Sem valor para: {preview.missingVariables.map((v) => `{${v}}`).join(', ')}
              </p>
            ) : null}
            {preview && (preview.eligibility.ok ? (
              <Badge color="green"><CheckCircle2 className="h-3 w-3" /> Contato liberado para envio</Badge>
            ) : (
              <Badge color="red"><AlertTriangle className="h-3 w-3" /> Não enviar: {preview.eligibility.reason}</Badge>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
