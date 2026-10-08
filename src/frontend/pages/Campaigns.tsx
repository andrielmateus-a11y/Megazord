// Campanhas de ativação com rodízio sequencial entre os WhatsApps participantes.
import { Eye, Megaphone, Pause, Pencil, Play, Plus, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatPhone, fmtDateTime, titleCase } from '../components/format';
import { CampaignStatusBadge, ChannelChip } from '../components/status';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, SkeletonRows, Spinner, cx } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { api } from '../services/api';
import { LEAD_STATUS_LABELS, LEAD_STATUSES, UFS, type Campaign, type Channel, type Template } from '../types';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

interface Form {
  id?: number;
  name: string;
  templateId: number | null;
  audience: { statuses: string[]; uf: string; cidade: string; onlyNeverContacted: boolean; limit: number };
  channelIds: number[];
  startAt: string;
  windowStart: string;
  windowEnd: string;
  weekdays: number[];
  intervalSeconds: number;
  dailyLimit: number;
  followup3: number | null;
  followup7: number | null;
}

const EMPTY: Form = {
  name: '',
  templateId: null,
  audience: { statuses: ['novo'], uf: '', cidade: '', onlyNeverContacted: true, limit: 200 },
  channelIds: [],
  startAt: '',
  windowStart: '09:00',
  windowEnd: '18:00',
  weekdays: [1, 2, 3, 4, 5],
  intervalSeconds: 90,
  dailyLimit: 100,
  followup3: null,
  followup7: null,
};

function toPayload(f: Form) {
  const cadence = [
    ...(f.followup3 ? [{ step: 2, dayOffset: 3, templateId: f.followup3 }] : []),
    ...(f.followup7 ? [{ step: f.followup3 ? 3 : 2, dayOffset: 7, templateId: f.followup7 }] : []),
  ];
  return {
    name: f.name,
    templateId: f.templateId,
    audience: { statuses: f.audience.statuses, uf: f.audience.uf || undefined, cidade: f.audience.cidade || undefined, onlyNeverContacted: f.audience.onlyNeverContacted, limit: f.audience.limit },
    channelIds: f.channelIds,
    startAt: f.startAt ? new Date(f.startAt).toISOString() : null,
    windowStart: f.windowStart,
    windowEnd: f.windowEnd,
    weekdays: f.weekdays,
    intervalSeconds: f.intervalSeconds,
    dailyLimit: f.dailyLimit,
    cadence,
  };
}

function fromCampaign(c: Campaign): Form {
  const step = (d: number) => c.cadence.find((s) => s.dayOffset === d)?.templateId ?? null;
  return {
    id: c.id,
    name: c.name,
    templateId: c.templateId,
    audience: { statuses: c.audience.statuses ?? [], uf: c.audience.uf ?? '', cidade: c.audience.cidade ?? '', onlyNeverContacted: c.audience.onlyNeverContacted !== false, limit: c.audience.limit ?? 200 },
    channelIds: c.channelIds,
    startAt: c.startAt ? new Date(c.startAt).toISOString().slice(0, 16) : '',
    windowStart: c.windowStart,
    windowEnd: c.windowEnd,
    weekdays: c.weekdays,
    intervalSeconds: c.intervalSeconds,
    dailyLimit: c.dailyLimit,
    followup3: step(3),
    followup7: step(7),
  };
}

export function CampaignsPage() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, reload } = useApi<{ campaigns: Campaign[] }>('/campaigns', { refreshOn: ['campaign.updated', 'queue.updated'] });
  const { data: chs } = useApi<{ channels: Channel[] }>('/whatsapp/channels');
  const [form, setForm] = useState<Form | null>(null);

  const act = async (c: Campaign, action: 'start' | 'pause' | 'cancel') => {
    if (action === 'cancel' && !confirm(`Cancelar a campanha "${c.name}"? Mensagens pendentes serão canceladas.`)) return;
    try {
      await api.post(`/campaigns/${c.id}/${action}`);
      toast.success({ start: 'Campanha iniciada.', pause: 'Campanha pausada.', cancel: 'Campanha cancelada.' }[action]);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (c: Campaign) => {
    if (!confirm(`Excluir a campanha "${c.name}"?`)) return;
    try {
      await api.del(`/campaigns/${c.id}`);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const channelLabel = (id: number) => chs?.channels.find((c) => c.id === id)?.label ?? `#${id}`;

  return (
    <div className="p-6">
      <PageHeader
        title="Campanhas"
        description="Disparos de ativação controlados: janela de horário, intervalo, limite diário e rodízio entre os WhatsApps escolhidos."
        actions={can('admin', 'supervisor') && <Button onClick={() => setForm({ ...EMPTY, channelIds: chs?.channels.map((c) => c.id) ?? [] })} icon={<Plus className="h-4 w-4" />}>Nova campanha</Button>}
      />
      <Card>
        {loading && !data ? <SkeletonRows /> : !data?.campaigns.length ? (
          <EmptyState icon={<Megaphone className="h-6 w-6" />} title="Nenhuma campanha" description="Crie uma campanha para ativar leads em lote com rodízio automático entre os números." />
        ) : (
          <div className="divide-y divide-slate-100">
            {data.campaigns.map((c) => {
              const done = c.stats.sent + c.stats.skipped + c.stats.error;
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
                  <div className="min-w-56 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{c.name}</p>
                      <CampaignStatusBadge status={c.status} />
                    </div>
                    <p className="text-xs text-slate-500">
                      {c.templateName ?? 'Sem mensagem'} · {c.windowStart}–{c.windowEnd} · a cada {c.intervalSeconds}s · até {c.dailyLimit}/dia
                      {c.cadence.length > 1 && ` · cadência ${c.cadence.map((s) => `D${s.dayOffset}`).join('/')}`}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">{c.channelIds.map((id) => <ChannelChip key={id} label={channelLabel(id)} />)}</div>
                  </div>
                  <div className="w-48">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-emerald-500" style={{ width: `${c.stats.total ? (done / c.stats.total) * 100 : 0}%` }} /></div>
                    <p className="mt-1 text-[11px] text-slate-500">{c.stats.sent} enviadas · {c.stats.pending} na fila · {c.stats.skipped} ignoradas · {c.stats.error} erros</p>
                  </div>
                  {can('admin', 'supervisor') && (
                    <div className="flex gap-1">
                      {['draft', 'paused', 'scheduled'].includes(c.status) && <Button size="sm" onClick={() => act(c, 'start')} icon={<Play className="h-3.5 w-3.5" />}>{c.status === 'paused' ? 'Retomar' : 'Iniciar'}</Button>}
                      {['running', 'scheduled'].includes(c.status) && <Button size="sm" variant="secondary" onClick={() => act(c, 'pause')} icon={<Pause className="h-3.5 w-3.5" />}>Pausar</Button>}
                      {['draft', 'paused', 'scheduled'].includes(c.status) && <Button size="sm" variant="ghost" onClick={() => setForm(fromCampaign(c))} icon={<Pencil className="h-3.5 w-3.5" />} />}
                      {['running', 'paused', 'scheduled'].includes(c.status) && <Button size="sm" variant="ghost" onClick={() => act(c, 'cancel')} icon={<XCircle className="h-3.5 w-3.5 text-red-500" />} />}
                      {c.status !== 'running' && <Button size="sm" variant="ghost" onClick={() => remove(c)} icon={<Trash2 className="h-3.5 w-3.5 text-slate-400" />} />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {form && <CampaignEditor initial={form} channels={chs?.channels ?? []} onClose={() => setForm(null)} onSaved={reload} />}
    </div>
  );
}

function CampaignEditor({ initial, channels, onClose, onSaved }: { initial: Form; channels: Channel[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data: tpl } = useApi<{ templates: Template[] }>('/whatsapp/templates');
  const [f, setF] = useState<Form>(() => ({ ...initial, templateId: initial.templateId }));
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | 'start' | null>(null);
  const templates = tpl?.templates ?? [];
  useEffect(() => {
    if (f.templateId === null && templates.length) setF((cur) => ({ ...cur, templateId: (templates.find((t) => t.favorite) ?? templates[0]).id }));
  }, [templates, f.templateId]);

  const toggle = <K extends 'channelIds' | 'weekdays'>(key: K, v: number) => setF({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v].sort() });
  const toggleStatus = (s: string) => setF({ ...f, audience: { ...f.audience, statuses: f.audience.statuses.includes(s) ? f.audience.statuses.filter((x) => x !== s) : [...f.audience.statuses, s] } });

  const runPreview = async () => {
    setBusy('preview');
    try {
      const p = toPayload(f);
      setPreview(await api.post('/campaigns/preview', { audience: p.audience, templateId: p.templateId, channelIds: p.channelIds }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = async (start: boolean) => {
    setBusy(start ? 'start' : 'save');
    try {
      const r = f.id ? await api.put(`/campaigns/${f.id}`, toPayload(f)) : await api.post('/campaigns', toPayload(f));
      if (start) await api.post(`/campaigns/${r.campaign.id}/start`);
      toast.success(start ? 'Campanha iniciada.' : 'Campanha salva.');
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={f.id ? 'Editar campanha' : 'Nova campanha'}
      footer={
        <>
          <Button variant="secondary" onClick={runPreview} loading={busy === 'preview'} icon={<Eye className="h-4 w-4" />}>Pré-visualizar</Button>
          <Button variant="secondary" onClick={() => save(false)} loading={busy === 'save'}>Salvar rascunho</Button>
          <Button onClick={() => save(true)} loading={busy === 'start'} disabled={!preview} icon={<Play className="h-4 w-4" />}>{f.startAt ? 'Agendar' : 'Iniciar campanha'}</Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Ativação Contadores SP" /></Field>
          <Field label="Mensagem de ativação">
            <Select value={f.templateId ?? ''} onChange={(e) => setF({ ...f, templateId: Number(e.target.value) })}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.favorite ? '★ ' : ''}{t.name}</option>)}
            </Select>
          </Field>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Público (leads com celular)</p>
            <div className="flex flex-wrap gap-1">
              {LEAD_STATUSES.filter((s) => !['nao_contatar', 'convertido'].includes(s)).map((s) => (
                <button key={s} onClick={() => toggleStatus(s)} className={cx('rounded-md border px-2 py-0.5 text-xs', f.audience.statuses.includes(s) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600')}>{LEAD_STATUS_LABELS[s]}</button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-[90px_1fr_100px] gap-2">
              <Select value={f.audience.uf} onChange={(e) => setF({ ...f, audience: { ...f.audience, uf: e.target.value } })}><option value="">UF</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Select>
              <Input placeholder="Cidade" value={f.audience.cidade} onChange={(e) => setF({ ...f, audience: { ...f.audience, cidade: e.target.value } })} />
              <Input type="number" min={1} title="Máximo de leads" value={f.audience.limit} onChange={(e) => setF({ ...f, audience: { ...f.audience, limit: Number(e.target.value) } })} />
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" className="accent-brand-600" checked={f.audience.onlyNeverContacted} onChange={(e) => setF({ ...f, audience: { ...f.audience, onlyNeverContacted: e.target.checked } })} /> Somente leads nunca contatados</label>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">WhatsApps participantes — distribuição: rodízio sequencial</p>
            <div className="flex flex-wrap gap-1.5">
              {channels.map((c) => (
                <button key={c.id} onClick={() => toggle('channelIds', c.id)} className={cx('rounded-md border px-2 py-1 font-mono text-xs', f.channelIds.includes(c.id) ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500')}>{c.label}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data inicial (opcional)"><Input type="datetime-local" value={f.startAt} onChange={(e) => setF({ ...f, startAt: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Início"><Input type="time" value={f.windowStart} onChange={(e) => setF({ ...f, windowStart: e.target.value })} /></Field>
              <Field label="Fim"><Input type="time" value={f.windowEnd} onChange={(e) => setF({ ...f, windowEnd: e.target.value })} /></Field>
            </div>
            <Field label="Intervalo entre mensagens (s)"><Input type="number" min={10} value={f.intervalSeconds} onChange={(e) => setF({ ...f, intervalSeconds: Number(e.target.value) })} /></Field>
            <Field label="Limite diário"><Input type="number" min={1} value={f.dailyLimit} onChange={(e) => setF({ ...f, dailyLimit: Number(e.target.value) })} /></Field>
          </div>
          <div className="flex gap-1">
            {WEEKDAYS.map((d, i) => (
              <button key={d} onClick={() => toggle('weekdays', i)} className={cx('rounded-md border px-2 py-1 text-xs', f.weekdays.includes(i) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500')}>{d}</button>
            ))}
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs font-semibold text-slate-700">Cadência (opcional)</p>
            <p className="mb-2 text-[11px] text-slate-500">Antes de cada follow-up a MEGAZORD verifica resposta, reunião, bloqueio, opt-out e telefone inválido — se houver, a sequência é cancelada.</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Dia 3 — follow-up">
                <Select value={f.followup3 ?? ''} onChange={(e) => setF({ ...f, followup3: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Não enviar</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
              <Field label="Dia 7 — último contato">
                <Select value={f.followup7 ?? ''} onChange={(e) => setF({ ...f, followup7: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Não enviar</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
            </div>
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold text-slate-700">Pré-visualização com dados reais</p>
          {busy === 'preview' ? <Spinner /> : !preview ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">Clique em “Pré-visualizar” para ver exemplos reais da mensagem e o canal previsto para cada contato. É obrigatório antes de iniciar.</div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge color="brand">{preview.audienceCount} lead(s) no público</Badge>
                <span className="text-slate-500">Rodízio: {preview.rotation.sequence.map((s: any) => s.label).join(' → ') || 'nenhum canal disponível agora'}</span>
              </div>
              {preview.rotation.skipped.length > 0 && <p className="text-[11px] text-amber-700">{preview.rotation.skipped.map((s: any) => `${s.label}: ${s.reason}`).join(' · ')}</p>}
              {preview.samples.map((s: any) => (
                <div key={s.leadId} className="rounded-lg border border-slate-200 p-3">
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <div><p className="text-slate-500">Empresa</p><p className="font-medium">{titleCase(s.empresa)}</p></div>
                    <div><p className="text-slate-500">Sócio</p><p className="font-medium">{titleCase(s.socio) || '—'}</p></div>
                    <div><p className="text-slate-500">Celular</p><p className="font-mono">{formatPhone(s.phone)}</p></div>
                  </div>
                  <div className="chat-bg mt-2 rounded-md p-2">
                    <div className="ml-auto max-w-[95%] rounded-lg bg-emerald-100 px-2.5 py-1.5 text-xs whitespace-pre-wrap">{s.message}</div>
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    Canal previsto: <b className="text-slate-700">{s.channel?.label ?? '—'}</b> · Container: {s.channel?.container ?? '—'} · Próximo: {s.next?.label ?? '—'}
                  </p>
                </div>
              ))}
              {!preview.samples.length && <p className="text-xs text-slate-500">Nenhum lead elegível para este público.</p>}
              <p className="text-[11px] text-slate-400">O canal definitivo é escolhido na hora do envio, considerando o estado real de cada WhatsApp. Gerado em {fmtDateTime(new Date().toISOString())}.</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
