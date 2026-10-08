// Gerenciamento dos WhatsApps (WA 01..WA 08), Firefox Containers e Evolution API.
import {
  BarChart3, Box, CheckCircle2, Link2, ListChecks, MessageSquare, MoreVertical, Pause, Pencil, Play, Plus, QrCode, RefreshCw,
  RotateCcw, Trash2, Unplug, XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { fmtDateTime, formatPhone, relative } from '../components/format';
import { ChannelStatus, StatusDot } from '../components/status';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Skeleton, Spinner, cx } from '../components/ui';
import { useApi, useRealtime } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { api } from '../services/api';
import { MAX_CHANNELS, type Channel } from '../types';

interface ChannelsResponse {
  channels: Channel[];
  rotation: { lastChannel: { label: string } | null; nextChannel: { label: string; container: string | null } | null; sequence: { label: string }[]; skipped: { label: string; reason: string }[] };
  bridge: { connected: boolean; lastHeartbeatAt: string | null; extensionVersion: string | null; containersDetected: number };
}

function nextFreeIndex(channels: Channel[]) {
  const used = new Set(channels.map((c) => c.orderIndex));
  let i = 1;
  while (used.has(i)) i++;
  return i;
}

const WA_STATUS: Record<string, string> = { ready: 'WhatsApp Web pronto', logged_out: 'Sessão inválida (QR Code)', loading: 'Carregando', not_open: 'WhatsApp não aberto', unknown: 'Desconhecido' };

export function ChannelsPage() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, reload } = useApi<ChannelsResponse>('/whatsapp/channels', { refreshOn: ['channels.updated', 'bridge.status'], intervalMs: 30000 });
  const [editing, setEditing] = useState<Channel | null>(null);
  const [qr, setQr] = useState<{ channel: Channel; qrcode: string | null; pairingCode: string | null } | null>(null);
  const [logs, setLogs] = useState<Channel | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [adding, setAdding] = useState(false);

  const add = async () => {
    setAdding(true);
    try {
      await api.post('/whatsapp/channels');
      await reload();
      toast.success('Novo WhatsApp adicionado com seu Firefox Container.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.post('/evolution/sync');
      toast[r.configured ? 'success' : 'info'](r.configured ? `${r.instances.length} instância(s) encontradas; ${r.synced} canal(is) sincronizado(s).` : 'Evolution API não configurada.');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const channels = data?.channels ?? [];

  return (
    <div className="p-6">
      <PageHeader
        title="WhatsApps"
        description="Cada número usa seu próprio Firefox Container. O envio automático segue o rodízio 1 → 2 → 3 → … pulando canais indisponíveis."
        actions={<Button variant="secondary" onClick={sync} loading={syncing} icon={<RefreshCw className="h-4 w-4" />}>Sincronizar instâncias</Button>}
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <div className="grid content-start gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {!data && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-56" />)}
          {channels.map((c) => (
            <ChannelCard key={c.id} channel={c} isNext={data?.rotation.nextChannel?.label === c.label} onEdit={() => setEditing(c)} onQr={(r) => setQr({ channel: c, ...r })} onLogs={() => setLogs(c)} reload={reload} />
          ))}
          {data && channels.length < MAX_CHANNELS && can('admin', 'supervisor') && (
            <button onClick={add} disabled={adding} className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 transition hover:border-brand-400 hover:bg-brand-50/40 hover:text-brand-600">
              {adding ? <Spinner /> : <Plus className="h-8 w-8" />}
              <span className="text-sm font-medium">Adicionar WA {String(nextFreeIndex(channels)).padStart(2, '0')}</span>
              <span className="text-xs">{channels.length} de {MAX_CHANNELS} em uso</span>
            </button>
          )}
        </div>
        <div className="space-y-4">
          <BridgePanel data={data} channels={channels} />
          <Card title="Rodízio">
            <div className="space-y-2 p-4 text-sm">
              <p className="flex justify-between"><span className="text-slate-500">Último canal utilizado</span><b>{data?.rotation.lastChannel?.label ?? '—'}</b></p>
              <p className="flex justify-between"><span className="text-slate-500">Próximo canal</span><b className="text-emerald-700">{data?.rotation.nextChannel?.label ?? '—'}</b></p>
              <div className="flex flex-wrap items-center gap-1 pt-1">
                {(data?.rotation.sequence ?? []).map((s, i) => (
                  <span key={i} className="flex items-center gap-1 text-xs">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">{s.label.replace('WA ', '')}</span>
                    {i < (data?.rotation.sequence.length ?? 0) - 1 && <span className="text-slate-300">→</span>}
                  </span>
                ))}
              </div>
              {(data?.rotation.skipped ?? []).map((s) => <p key={s.label} className="text-[11px] text-slate-500">{s.label} pulado: {s.reason}</p>)}
            </div>
          </Card>
        </div>
      </div>
      {editing && <EditChannelModal channel={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {qr && <QrModal state={qr} onClose={() => setQr(null)} />}
      {logs && <LogsModal channel={logs} onClose={() => setLogs(null)} />}
    </div>
  );
}

function ChannelCard({ channel: c, isNext, onEdit, onQr, onLogs, reload }: { channel: Channel; isNext: boolean; onEdit: () => void; onQr: (r: { qrcode: string | null; pairingCode: string | null }) => void; onLogs: () => void; reload: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const act = async (action: string, success?: string) => {
    setMenu(false);
    setBusy(action);
    try {
      const r = await api.post(`/whatsapp/channels/${c.id}/${action}`);
      if (action === 'connect' || action === 'reconnect') {
        if (r.connected) toast.success(`${c.label} já está conectado.`);
        else onQr(r);
      } else if (action === 'test-container') {
        toast[r.ok ? 'success' : 'error'](r.message);
      } else if (success) toast.success(success);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setMenu(false);
    if (!confirm(`Remover ${c.label}? O Container ${c.container?.name} deixa de ser usado.`)) return;
    try {
      await api.del(`/whatsapp/channels/${c.id}`);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const items: { label: string; icon: React.ReactNode; onClick: () => void; show?: boolean; danger?: boolean }[] = [
    { label: 'Conectar (QR Code)', icon: <QrCode className="h-3.5 w-3.5" />, onClick: () => act('connect'), show: c.transport === 'evolution' },
    { label: 'Reconectar', icon: <RotateCcw className="h-3.5 w-3.5" />, onClick: () => act('reconnect'), show: c.transport === 'evolution' && !!c.evolutionInstance },
    { label: 'Testar Container', icon: <Box className="h-3.5 w-3.5" />, onClick: () => act('test-container') },
    { label: c.paused ? 'Retomar' : 'Pausar', icon: c.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />, onClick: () => act(c.paused ? 'resume' : 'pause', c.paused ? 'Canal retomado.' : 'Canal pausado.') },
    { label: c.queueEnabled ? 'Desativar fila' : 'Ativar fila', icon: <ListChecks className="h-3.5 w-3.5" />, onClick: () => act(c.queueEnabled ? 'queue-off' : 'queue-on') },
    { label: 'Zerar erros', icon: <CheckCircle2 className="h-3.5 w-3.5" />, onClick: () => act('reset-errors'), show: !!c.lastError },
    { label: 'Editar', icon: <Pencil className="h-3.5 w-3.5" />, onClick: () => { setMenu(false); onEdit(); }, show: can('admin', 'supervisor') },
    { label: 'Ver conversas', icon: <MessageSquare className="h-3.5 w-3.5" />, onClick: () => navigate('/inbox') },
    { label: 'Estatísticas e log', icon: <BarChart3 className="h-3.5 w-3.5" />, onClick: () => { setMenu(false); onLogs(); } },
    { label: 'Desconectar', icon: <Unplug className="h-3.5 w-3.5" />, onClick: () => act('disconnect', 'Canal desconectado.'), show: c.transport === 'evolution' && !!c.evolutionInstance },
    { label: 'Remover', icon: <Trash2 className="h-3.5 w-3.5" />, onClick: remove, show: can('admin'), danger: true },
  ];

  return (
    <div className={cx('relative rounded-xl border bg-white p-4 shadow-sm', isNext ? 'border-emerald-300 ring-2 ring-emerald-100' : 'border-slate-200')}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-ink px-2 py-0.5 font-mono text-sm font-bold text-white">{c.label}</span>
            {isNext && <Badge color="green">Próximo</Badge>}
          </div>
          <p className="mt-1.5 text-sm font-medium">{c.name !== c.label ? c.name : c.phone ? formatPhone(c.phone) : 'Número não identificado'}</p>
          {c.name !== c.label && c.phone && <p className="text-xs text-slate-500">{formatPhone(c.phone)}</p>}
        </div>
        <div ref={menuRef} className="relative">
          <button onClick={() => setMenu((m) => !m)} className="rounded p-1 text-slate-400 hover:bg-slate-100">{busy ? <Spinner /> : <MoreVertical className="h-4 w-4" />}</button>
          {menu && (
            <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              {items.filter((i) => i.show !== false).map((i) => (
                <button key={i.label} onClick={i.onClick} className={cx('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50', i.danger ? 'text-red-600' : 'text-slate-700')}>
                  {i.icon} {i.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <ChannelStatus channel={c} />
        <Badge color={c.transport === 'firefox' ? 'brand' : 'purple'}>{c.transport === 'firefox' ? 'Firefox Container' : 'Evolution API'}</Badge>
      </div>
      <div className="mt-3 space-y-1 rounded-lg bg-slate-50 p-2.5 text-xs">
        <p className="flex items-center gap-1.5"><Box className="h-3 w-3 text-slate-400" /> <span className="font-medium">{c.container?.name ?? '—'}</span></p>
        <p className="flex items-center gap-1.5 text-slate-500">
          <StatusDot state={c.container?.status === 'ok' ? (c.container.waStatus === 'ready' ? 'connected' : 'connecting') : 'not_configured'} className="!h-2 !w-2" />
          {c.container?.status === 'ok' ? WA_STATUS[c.container.waStatus] : 'Container não detectado'}
        </p>
        {c.evolutionInstance && <p className="flex items-center gap-1.5 text-slate-500"><Link2 className="h-3 w-3" /> {c.evolutionInstance}</p>}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div><p className="font-semibold">{c.sentToday}/{c.dailyLimit}</p><p className="text-[10px] text-slate-500">hoje</p></div>
        <div><p className="font-semibold">{c.sentCount}</p><p className="text-[10px] text-slate-500">enviadas</p></div>
        <div><p className="font-semibold">{c.receivedCount}</p><p className="text-[10px] text-slate-500">recebidas</p></div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-500">
        <span>Fila: {c.queueCount} {!c.queueEnabled && '(desativada)'}</span>
        <span>Último envio {relative(c.lastSentAt)}</span>
      </div>
      {!c.availability.available && <p className="mt-1.5 text-[11px] text-amber-700">Fora do rodízio: {c.availability.reason}</p>}
      {c.lastError && <p className="mt-1 truncate text-[11px] text-red-600" title={c.lastError}>Erro: {c.lastError}</p>}
    </div>
  );
}

function BridgePanel({ data, channels }: { data: ChannelsResponse | null; channels: Channel[] }) {
  const toast = useToast();
  const b = data?.bridge;
  const syncContainers = async () => {
    const r = await api.post('/firefox/containers/sync');
    toast[r.ok ? 'success' : 'error'](r.ok ? 'Containers sincronizados.' : r.message);
  };
  return (
    <Card title="Firefox Bridge" actions={b?.connected && <Button size="sm" variant="ghost" onClick={syncContainers}>Criar/sincronizar Containers</Button>}>
      <div className="space-y-2 p-4 text-sm">
        <p className="flex items-center gap-2 font-medium">
          {b?.connected ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
          {b?.connected ? 'Conectado' : 'Desconectado'}
          {b?.extensionVersion && <span className="text-xs font-normal text-slate-400">v{b.extensionVersion}</span>}
        </p>
        {!b?.connected && <p className="text-xs text-slate-500">Firefox Bridge indisponível. Abra a extensão MEGAZORD no Firefox para continuar.</p>}
        <p className="text-xs text-slate-500">Containers detectados: <b className="text-slate-700">{b?.containersDetected ?? 0}</b> · último heartbeat {relative(b?.lastHeartbeatAt)}</p>
        <div className="space-y-1 pt-1 font-mono text-xs">
          {channels.map((c) => {
            const state = c.container?.status !== 'ok' ? 'not_configured' : c.container.waStatus === 'ready' ? 'connected' : c.container.waStatus === 'loading' ? 'connecting' : 'disconnected';
            return (
              <p key={c.id} className="flex items-center gap-2">
                <span>{c.label}</span> <span className="text-slate-300">→</span> <StatusDot state={state} />
                <span className="truncate font-sans text-[11px] text-slate-500">{c.container?.status !== 'ok' ? 'não configurado' : WA_STATUS[c.container.waStatus]}</span>
              </p>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function EditChannelModal({ channel, onClose, onSaved }: { channel: Channel; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: channel.name,
    phone: channel.phone ?? '',
    transport: channel.transport,
    evolutionInstance: channel.evolutionInstance ?? '',
    dailyLimit: channel.dailyLimit,
    cooldownSeconds: channel.cooldownSeconds,
    containerName: channel.container?.name ?? '',
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/whatsapp/channels/${channel.id}`, {
        ...form,
        phone: form.phone || null,
        evolutionInstance: form.evolutionInstance || null,
        containerName: form.containerName !== channel.container?.name ? form.containerName : undefined,
      });
      onSaved();
      onClose();
      toast.success('Canal atualizado.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Editar ${channel.label}`} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={busy}>Salvar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Número"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Detectado automaticamente (ownerJid)" /></Field>
        <Field label="Transporte de envio" hint="Um envio usa apenas um transporte — nunca os dois.">
          <Select value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value as Channel['transport'] })}>
            <option value="firefox">Firefox Container (WhatsApp Web local)</option>
            <option value="evolution">Evolution API</option>
          </Select>
        </Field>
        <Field label="Instância Evolution" hint="Opcional no modo Firefox: usada para status, QR Code e webhooks (recebimento).">
          <Input value={form.evolutionInstance} onChange={(e) => setForm({ ...form, evolutionInstance: e.target.value })} placeholder={`megazord-wa${String(channel.orderIndex).padStart(2, '0')}`} />
        </Field>
        <Field label="Firefox Container"><Input value={form.containerName} onChange={(e) => setForm({ ...form, containerName: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Limite diário"><Input type="number" min={1} value={form.dailyLimit} onChange={(e) => setForm({ ...form, dailyLimit: Number(e.target.value) })} /></Field>
          <Field label="Cooldown (s)"><Input type="number" min={0} value={form.cooldownSeconds} onChange={(e) => setForm({ ...form, cooldownSeconds: Number(e.target.value) })} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function QrModal({ state, onClose }: { state: { channel: Channel; qrcode: string | null; pairingCode: string | null }; onClose: () => void }) {
  const toast = useToast();
  const [qrcode, setQrcode] = useState(state.qrcode);
  useRealtime('channel.qrcode', (p) => p.channelId === state.channel.id && setQrcode(p.qrcode));
  useRealtime('channels.updated', (p) => {
    const ch = (p.channels as Channel[]).find((c) => c.id === state.channel.id);
    if (ch?.status === 'connected') {
      toast.success(`${state.channel.label} conectado${ch.phone ? `: ${formatPhone(ch.phone)}` : ''}.`);
      onClose();
    }
  });
  const src = qrcode ? (qrcode.startsWith('data:') ? qrcode : `data:image/png;base64,${qrcode}`) : null;
  return (
    <Modal open onClose={onClose} size="sm" title={`Conectar ${state.channel.label}`}>
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        {src ? <img src={src} alt="QR Code do WhatsApp" className="h-64 w-64 rounded-lg border border-slate-200" /> : <Spinner className="h-8 w-8" />}
        {state.pairingCode && <p className="font-mono text-lg tracking-widest">{state.pairingCode}</p>}
        <p className="text-xs text-slate-500">No celular: WhatsApp → Aparelhos conectados → Conectar aparelho. A janela fecha sozinha ao conectar.</p>
      </div>
    </Modal>
  );
}

function LogsModal({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const { data } = useApi<{ logs: any[] }>(`/whatsapp/channels/${channel.id}/logs`, { refreshOn: ['log.new'] });
  return (
    <Modal open onClose={onClose} size="lg" title={`${channel.label} — estatísticas e log`}>
      <div className="mb-4 grid grid-cols-4 gap-2 text-center text-xs">
        {[['Hoje', `${channel.sentToday}/${channel.dailyLimit}`], ['Enviadas', channel.sentCount], ['Recebidas', channel.receivedCount], ['Na fila', channel.queueCount]].map(([l, v]) => (
          <div key={l as string} className="rounded-lg bg-slate-50 p-2"><p className="text-base font-semibold">{v}</p><p className="text-slate-500">{l}</p></div>
        ))}
      </div>
      <div className="divide-y divide-slate-100 text-xs">
        {(data?.logs ?? []).map((l) => (
          <div key={l.id} className="py-1.5">
            <p className={l.level === 'error' ? 'text-red-600' : l.level === 'warn' ? 'text-amber-700' : 'text-slate-700'}>{l.message}</p>
            <p className="text-[10px] text-slate-400">
              {fmtDateTime(l.createdAt)} · {l.action}
              {l.meta?.container ? ` · ${l.meta.container}` : ''}
              {l.meta?.transport ? ` · ${l.meta.transport}` : ''}
              {l.meta?.ms ? ` · ${l.meta.ms}ms` : ''}
            </p>
          </div>
        ))}
        {!data?.logs.length && <p className="py-6 text-center text-slate-400">Sem registros para este canal.</p>}
      </div>
    </Modal>
  );
}
