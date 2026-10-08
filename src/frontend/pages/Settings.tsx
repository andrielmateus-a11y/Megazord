// Configurações: Perfil, Usuários, WhatsApp (Evolution), Firefox Containers, Integrações (Casa dos Dados), Segurança e Dados.
import { Copy, Eye, EyeOff, KeyRound, PlugZap, RefreshCw, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { fmtDateTime, relative } from '../components/format';
import { ExportButtons, ImportButton } from '../components/ImportExport';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Tabs } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { api } from '../services/api';
import { ROLE_LABELS, ROLES, type User } from '../types';

type Tab = 'perfil' | 'usuarios' | 'whatsapp' | 'firefox' | 'integracoes' | 'seguranca' | 'dados';

export function SettingsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'perfil';
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'perfil', label: 'Perfil', show: true },
    { id: 'usuarios', label: 'Usuários', show: can('admin', 'supervisor') },
    { id: 'whatsapp', label: 'WhatsApp', show: true },
    { id: 'firefox', label: 'Firefox Containers', show: true },
    { id: 'integracoes', label: 'Integrações', show: true },
    { id: 'seguranca', label: 'Segurança', show: true },
    { id: 'dados', label: 'Importar/Exportar', show: true },
  ];
  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader title="Configurações" />
      <Tabs tabs={tabs.filter((t) => t.show)} value={tab} onChange={(t) => setParams({ tab: t })} />
      <div className="mt-5">
        {tab === 'perfil' && <Profile />}
        {tab === 'usuarios' && <Users />}
        {tab === 'whatsapp' && <Evolution />}
        {tab === 'firefox' && <Firefox />}
        {tab === 'integracoes' && <CasaDosDados />}
        {tab === 'seguranca' && <Security />}
        {tab === 'dados' && <DataIO />}
      </div>
    </div>
  );
}

function Profile() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const save = async () => {
    try {
      await api.patch('/auth/me', { name });
      await refresh();
      toast.success('Perfil atualizado.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Card title="Seu perfil">
      <div className="grid max-w-xl gap-3 p-4">
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="E-mail"><Input value={user?.email ?? ''} disabled /></Field>
        <Field label="Perfil de acesso"><Input value={user ? ROLE_LABELS[user.role] : ''} disabled /></Field>
        <div><Button onClick={save}>Salvar</Button></div>
      </div>
    </Card>
  );
}

function Users() {
  const toast = useToast();
  const { user: me, can } = useAuth();
  const { data, reload } = useApi<{ users: User[] }>('/users');
  const [form, setForm] = useState<{ name: string; email: string; password: string; role: User['role'] } | null>(null);
  const create = async () => {
    try {
      await api.post('/users', form);
      setForm(null);
      reload();
      toast.success('Usuário criado.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const update = async (id: number, patch: Record<string, unknown>) => {
    try {
      await api.patch(`/users/${id}`, patch);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Card title="Usuários" subtitle="Administrador · Supervisor · SDR" actions={can('admin') && <Button size="sm" onClick={() => setForm({ name: '', email: '', password: '', role: 'sdr' })} icon={<UserPlus className="h-3.5 w-3.5" />}>Novo usuário</Button>}>
      <div className="divide-y divide-slate-100">
        {(data?.users ?? []).map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <div className="flex-1">
              <p className="font-medium">{u.name} {u.id === me?.id && <span className="text-xs text-slate-400">(você)</span>}</p>
              <p className="text-xs text-slate-500">{u.email} · último acesso {relative(u.lastLoginAt)}</p>
            </div>
            {can('admin') && u.id !== me?.id ? (
              <>
                <Select className="!h-8 w-36 text-xs" value={u.role} onChange={(e) => update(u.id, { role: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </Select>
                <Button size="sm" variant={u.active ? 'secondary' : 'success'} onClick={() => update(u.id, { active: !u.active })}>{u.active ? 'Desativar' : 'Ativar'}</Button>
                <Button size="sm" variant="ghost" onClick={() => { const p = prompt('Nova senha (mín. 8 caracteres, letras e números):'); if (p) void update(u.id, { password: p }); }} icon={<KeyRound className="h-3.5 w-3.5" />} />
              </>
            ) : (
              <Badge>{ROLE_LABELS[u.role]}</Badge>
            )}
            {!u.active && <Badge color="red">Inativo</Badge>}
          </div>
        ))}
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} title="Novo usuário" size="sm" footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button><Button onClick={create}>Criar</Button></>}>
        {form && (
          <div className="space-y-3">
            <Field label="Nome"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="E-mail"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Senha inicial"><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="Perfil">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </Select>
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function Evolution() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, reload } = useApi<any>('/evolution/status');
  const [url, setUrl] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (name: string, fn: () => Promise<any>) => {
    setBusy(name);
    try {
      const r = await fn();
      if (r?.message) toast[r.ok === false ? 'error' : 'success'](r.message);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card title="Evolution API" subtitle="Instâncias, QR Code, status, sincronização e webhooks dos WhatsApps.">
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div className="space-y-3">
          <Field label="URL da Evolution API"><Input value={url ?? data?.url ?? ''} onChange={(e) => setUrl(e.target.value)} placeholder="https://evolution.suaempresa.com" disabled={!can('admin')} /></Field>
          <Field label="API Key global" hint={data?.masked ? `Atual: ${data.masked} (${data.source === 'env' ? 'variável de ambiente' : 'banco, criptografada'})` : 'Não configurada'}>
            <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Deixe vazio para manter" disabled={!can('admin')} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {can('admin') && <Button loading={busy === 'save'} onClick={() => run('save', async () => { await api.put('/evolution/config', { url: url ?? data?.url, apiKey: key || undefined }); setKey(''); return { message: 'Configuração salva.' }; })}>Salvar</Button>}
            <Button variant="secondary" loading={busy === 'test'} onClick={() => run('test', () => api.post('/evolution/test'))} icon={<PlugZap className="h-4 w-4" />}>Testar conexão</Button>
            <Button variant="secondary" loading={busy === 'sync'} onClick={() => run('sync', async () => { const r = await api.post('/evolution/sync'); return { message: r.configured ? `${r.instances.length} instância(s); ${r.synced} sincronizada(s).` : 'Evolution não configurada.' }; })} icon={<RefreshCw className="h-4 w-4" />}>Sincronizar instâncias</Button>
          </div>
        </div>
        <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <p className="flex items-center gap-2">Status: <Badge color={data?.status === 'ok' ? 'green' : data?.status === 'error' ? 'red' : 'gray'}>{data?.status === 'ok' ? 'Conectado' : data?.status === 'error' ? 'Erro' : data?.configured ? 'Não testado' : 'Não configurado'}</Badge></p>
          {data?.lastError && <p className="text-red-600">{data.lastError}</p>}
          <p>Última verificação: {fmtDateTime(data?.lastCheckedAt)}</p>
          <p className="pt-2 font-medium text-slate-700">Webhook (configurado automaticamente ao conectar):</p>
          <code className="block rounded bg-white p-2 break-all">{data?.webhookUrl}?token=WEBHOOK_SECRET</code>
          <p>Eventos: MESSAGES_UPSERT, MESSAGES_UPDATE, SEND_MESSAGE, CONNECTION_UPDATE, QRCODE_UPDATED.</p>
          <p className="pt-2">Cada canal pode enviar por <b>Firefox Container</b> ou <b>Evolution API</b> (escolha em Canais → Editar). Um envio nunca sai pelos dois.</p>
        </div>
      </div>
    </Card>
  );
}

function Firefox() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, reload } = useApi<any>('/firefox/status', { refreshOn: ['bridge.status'] });
  const [token, setToken] = useState<string | null>(null);
  const generate = async () => {
    if (data?.token?.configured && !confirm('Gerar um novo token desconecta a extensão atual até ela receber o novo token. Continuar?')) return;
    const r = await api.post('/firefox/token');
    setToken(r.token);
    reload();
  };
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card title="Firefox Bridge" subtitle="A extensão MEGAZORD conecta cada WhatsApp ao seu Firefox Container.">
        <div className="space-y-3 p-4 text-sm">
          <p className="flex items-center gap-2">Status: <Badge color={data?.connected ? 'green' : 'red'}>{data?.connected ? '🟢 conectado' : 'desconectado'}</Badge> {data?.extensionVersion && <span className="text-xs text-slate-400">v{data.extensionVersion}</span>}</p>
          <p className="text-xs text-slate-500">Containers detectados: {data?.containersDetected ?? 0} · último heartbeat {relative(data?.lastHeartbeatAt)}</p>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs font-medium text-slate-700">Token do bridge</p>
            <p className="text-xs text-slate-500">{data?.token?.masked ?? 'Nenhum token gerado'}</p>
            {token && (
              <div className="mt-2 rounded bg-amber-50 p-2 text-xs">
                <p className="mb-1 font-medium text-amber-800">Copie agora — ele não será exibido novamente:</p>
                <div className="flex gap-2"><code className="flex-1 break-all">{token}</code><button onClick={() => { void navigator.clipboard.writeText(token); toast.success('Copiado.'); }}><Copy className="h-4 w-4" /></button></div>
              </div>
            )}
            {can('admin') && <Button size="sm" className="mt-2" onClick={generate} icon={<KeyRound className="h-3.5 w-3.5" />}>{data?.token?.configured ? 'Gerar novo token' : 'Gerar token'}</Button>}
          </div>
        </div>
      </Card>
      <Card title="Como conectar">
        <ol className="list-decimal space-y-1.5 p-4 pl-8 text-xs text-slate-600">
          <li>No Firefox, ative <b>Abas de contêiner</b> (about:preferences → Abas de contêiner).</li>
          <li>Instale a extensão da pasta <code>extension/</code> do projeto (about:debugging → Carregar extensão temporária → <code>manifest.json</code>) ou o pacote assinado.</li>
          <li>Abra o popup da extensão, informe a URL do backend ({window.location.origin.replace(':5173', ':3001')}) e o token gerado ao lado.</li>
          <li>A MEGAZORD cria os Containers <b>MEGAZORD WA 01…08</b> automaticamente.</li>
          <li>Em <b>Canais</b>, use <b>Testar Container</b> em cada WhatsApp e leia o QR Code do WhatsApp Web dentro do Container.</li>
          <li>Pronto: cada número mantém sua própria sessão e o envio vai para o Container correto, reaproveitando a aba existente.</li>
        </ol>
      </Card>
    </div>
  );
}

function CasaDosDados() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, reload } = useApi<any>('/casa-dos-dados/status');
  const [key, setKey] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; balance: number | null; message: string } | null>(null);

  const save = async () => {
    try {
      await api.put('/casa-dos-dados/key', { apiKey: key || undefined, dailyLimit: limit ?? undefined });
      setKey('');
      reload();
      toast.success('Configuração salva.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const reveal = async () => {
    if (revealed) return setRevealed(null);
    const r = await api.post('/casa-dos-dados/key/reveal');
    setRevealed(r.apiKey || '(vazia)');
  };
  const copy = async () => {
    const value = revealed ?? (await api.post('/casa-dos-dados/key/reveal')).apiKey;
    await navigator.clipboard.writeText(value);
    toast.success('Chave copiada.');
  };
  const test = async () => {
    setTesting(true);
    try {
      setTestResult(await api.post('/casa-dos-dados/test'));
      reload();
    } finally {
      setTesting(false);
    }
  };
  const remove = async () => {
    if (!confirm('Remover a chave da Casa dos Dados?')) return;
    await api.del('/casa-dos-dados/key');
    setRevealed(null);
    reload();
  };
  const balance = testResult?.balance ?? data?.meta?.balance;
  return (
    <Card title="Casa dos Dados" subtitle="Fonte principal de sócio, celular e dados da empresa. A chave fica criptografada no backend e nunca é registrada em logs.">
      <div className="grid gap-5 p-4 md:grid-cols-2">
        <div className="space-y-3">
          <Field label="API Key" hint={data?.source === 'env' ? 'Usando a chave da variável de ambiente CASA_DOS_DADOS_API_KEY.' : undefined}>
            <div className="flex gap-2">
              <Input
                type={revealed ? 'text' : 'password'}
                value={revealed ?? key}
                onChange={(e) => { setRevealed(null); setKey(e.target.value); }}
                placeholder={data?.masked ?? 'Cole a chave da Casa dos Dados'}
                disabled={!can('admin')}
              />
              {can('admin') && data?.configured && (
                <>
                  <Button variant="secondary" onClick={reveal} icon={revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} title="Mostrar/ocultar" />
                  <Button variant="secondary" onClick={copy} icon={<Copy className="h-4 w-4" />} title="Copiar" />
                </>
              )}
            </div>
          </Field>
          <Field label="Limite diário de consultas"><Input type="number" min={1} value={limit ?? data?.dailyLimit ?? ''} onChange={(e) => setLimit(Number(e.target.value))} disabled={!can('admin')} /></Field>
          <div className="flex flex-wrap gap-2">
            {can('admin') && <Button onClick={save} disabled={!key && limit === null}>Salvar</Button>}
            <Button variant="secondary" onClick={test} loading={testing} icon={<PlugZap className="h-4 w-4" />}>Testar conexão / consultar saldo</Button>
            {can('admin') && data?.source === 'database' && <Button variant="ghost" onClick={remove} icon={<Trash2 className="h-4 w-4 text-red-500" />} />}
          </div>
          {testResult && <div className={`rounded-lg px-3 py-2 text-xs ${testResult.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{testResult.message}</div>}
        </div>
        <div className="space-y-2 rounded-lg bg-slate-50 p-4 text-sm">
          <p className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${data?.status === 'ok' ? 'bg-emerald-500' : data?.status === 'error' ? 'bg-red-500' : data?.configured ? 'bg-amber-400' : 'bg-slate-300'}`} />
            {data?.status === 'ok' ? 'Conectado' : data?.status === 'error' ? 'Erro de conexão' : data?.configured ? 'Chave cadastrada (não testada)' : 'Não configurado'}
          </p>
          <p className="text-xs text-slate-600">Saldo: <b>{balance != null ? balance.toLocaleString('pt-BR') : '—'}</b></p>
          <p className="text-xs text-slate-600">Consultas hoje: <b>{data?.usageToday ?? 0}</b> / {data?.dailyLimit ?? '—'}</p>
          <p className="text-xs text-slate-600">Última consulta: {fmtDateTime(data?.lastUsedAt)}</p>
          <p className="text-xs text-slate-600">Última verificação: {fmtDateTime(data?.lastCheckedAt)}</p>
          <ErrorBox message={data?.lastError ?? null} />
        </div>
      </div>
    </Card>
  );
}

function Security() {
  const toast = useToast();
  const { can } = useAuth();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [category, setCategory] = useState('');
  const { data } = useApi<{ logs: any[] }>(can('admin', 'supervisor') ? `/settings/logs?limit=200${category ? `&category=${category}` : ''}` : null, { refreshOn: ['log.new'] });
  const change = async () => {
    try {
      await api.post('/auth/change-password', pw);
      setPw({ currentPassword: '', newPassword: '' });
      toast.success('Senha alterada. Outras sessões foram encerradas.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="space-y-5">
      <Card title="Alterar senha">
        <div className="grid max-w-xl gap-3 p-4 sm:grid-cols-2">
          <Field label="Senha atual"><Input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
          <Field label="Nova senha"><Input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
          <div><Button onClick={change} icon={<ShieldCheck className="h-4 w-4" />}>Alterar senha</Button></div>
        </div>
      </Card>
      {can('admin', 'supervisor') && (
        <Card title="Logs do sistema" subtitle="Senhas e chaves nunca são registradas." actions={
          <Select className="!h-8 w-44 text-xs" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas as categorias</option>
            {['auth', 'security', 'casa_dos_dados', 'prospeccao', 'whatsapp', 'firefox', 'queue', 'campaign', 'leads', 'settings', 'import'].map((c) => <option key={c}>{c}</option>)}
          </Select>
        }>
          <div className="scroll-thin max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
            {(data?.logs ?? []).map((l) => (
              <div key={l.id} className="flex gap-3 px-4 py-2 text-xs">
                <span className="w-28 shrink-0 text-slate-400">{fmtDateTime(l.createdAt)}</span>
                <Badge color={l.level === 'error' ? 'red' : l.level === 'warn' ? 'yellow' : 'gray'}>{l.category}</Badge>
                <span className="flex-1 text-slate-700">{l.message}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function DataIO() {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card title="Exportar">
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between text-sm"><span>Leads (empresas, sócios, status)</span><ExportButtons kind="leads" label="" /></div>
          <div className="flex items-center justify-between text-sm"><span>Histórico de contatos</span><ExportButtons kind="history" label="" /></div>
          <div className="flex items-center justify-between text-sm"><span>Mensagens enviadas/recebidas</span><ExportButtons kind="messages" label="" /></div>
          <div className="flex items-center justify-between text-sm"><span>Mensagens de ativação</span><ExportButtons kind="templates" label="" /></div>
        </div>
      </Card>
      <Card title="Importar">
        <div className="space-y-3 p-4 text-sm">
          <div className="flex items-center justify-between"><span>Histórico / leads (CSV ou Excel)</span><ImportButton kind="leads" /></div>
          <p className="text-[11px] text-slate-500">Colunas: <code>cnpj</code> (obrigatória), razao_social, nome_fantasia, socio, telefone, status, observacoes, cidade, uf, quantidade_contatos, ultimo_contato. CNPJs importados não aparecem mais em “Descobrir novos”.</p>
          <div className="flex items-center justify-between"><span>Mensagens de ativação</span><ImportButton kind="templates" /></div>
          <p className="text-[11px] text-slate-500">Colunas: nome, categoria, mensagem, favorita.</p>
        </div>
      </Card>
    </div>
  );
}
