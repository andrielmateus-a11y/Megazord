// Mensagens de Ativação: criar, editar, excluir, duplicar, favoritar, categorizar, visualizar e testar.
import { Copy, MessageSquareText, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ExportButtons, ImportButton } from '../components/ImportExport';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, SkeletonRows, Textarea, cx } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { useToast } from '../hooks/useToast';
import { api } from '../services/api';
import { renderTemplate, TEMPLATE_VARIABLES, missingVariables } from '../../shared/text';
import type { Template } from '../types';

const SAMPLE = { socio: 'JOÃO DA SILVA', empresa: 'ABC CONTABILIDADE LTDA', telefone: '5511999999999', cidade: 'SÃO PAULO', cnpj: '11222333000181' };
const CATEGORIES = [
  { id: 'ativacao', label: 'Ativação' },
  { id: 'follow-up', label: 'Follow-up' },
  { id: 'resposta', label: 'Resposta' },
  { id: 'outros', label: 'Outros' },
];

export function TemplatesPage() {
  const toast = useToast();
  const { data, reload, loading } = useApi<{ templates: Template[] }>('/whatsapp/templates');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [testVars, setTestVars] = useState(SAMPLE);

  const templates = useMemo(() => (data?.templates ?? []).filter((t) => !category || t.category === category), [data, category]);
  const current = data?.templates.find((t) => t.id === selected) ?? templates[0] ?? null;

  const save = async () => {
    if (!editing) return;
    try {
      const payload = { name: editing.name, category: editing.category ?? 'ativacao', body: editing.body, favorite: editing.favorite ?? false };
      const r = editing.id ? await api.patch(`/whatsapp/templates/${editing.id}`, payload) : await api.post('/whatsapp/templates', payload);
      setEditing(null);
      setSelected(r.template.id);
      reload();
      toast.success('Mensagem salva.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      reload();
      toast.success(msg);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="p-6">
      <PageHeader
        title="Mensagens de ativação"
        description="Mensagens de abertura personalizadas automaticamente com os dados da Casa dos Dados."
        actions={
          <>
            <ImportButton kind="templates" onDone={reload} />
            <ExportButtons kind="templates" />
            <ExportButtons kind="messages" label="Conversas" />
            <Button onClick={() => setEditing({ category: 'ativacao', body: 'Olá, {nome}! Tudo bem?\n\nEstou entrando em contato com a {empresa}.' })} icon={<Plus className="h-4 w-4" />}>Nova mensagem</Button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <Card>
          <div className="border-b border-slate-100 p-3">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Todas as categorias</option>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </div>
          {loading && !data ? <SkeletonRows /> : templates.length === 0 ? <EmptyState icon={<MessageSquareText className="h-6 w-6" />} title="Nenhuma mensagem" /> : (
            <div className="divide-y divide-slate-100">
              {templates.map((t) => (
                <button key={t.id} onClick={() => setSelected(t.id)} className={cx('w-full px-4 py-3 text-left hover:bg-slate-50', current?.id === t.id && 'bg-brand-50/60')}>
                  <div className="flex items-center gap-2">
                    {t.favorite && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
                    <p className="flex-1 truncate text-sm font-medium">{t.name}</p>
                    <Badge>{CATEGORIES.find((c) => c.id === t.category)?.label ?? t.category}</Badge>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{t.body}</p>
                </button>
              ))}
            </div>
          )}
        </Card>
        {current && (
          <Card
            title={current.name}
            actions={
              <>
                <Button size="sm" variant="ghost" onClick={() => act(() => api.patch(`/whatsapp/templates/${current.id}`, { favorite: !current.favorite }), current.favorite ? 'Removida dos favoritos.' : 'Favoritada.')} icon={<Star className={cx('h-3.5 w-3.5', current.favorite && 'fill-amber-400 text-amber-400')} />}>Favorita</Button>
                <Button size="sm" variant="ghost" onClick={() => act(() => api.post(`/whatsapp/templates/${current.id}/duplicate`), 'Mensagem duplicada.')} icon={<Copy className="h-3.5 w-3.5" />}>Duplicar</Button>
                <Button size="sm" variant="secondary" onClick={() => setEditing(current)} icon={<Pencil className="h-3.5 w-3.5" />}>Editar</Button>
                <Button size="sm" variant="ghost" onClick={() => confirm('Excluir esta mensagem?') && act(() => api.del(`/whatsapp/templates/${current.id}`), 'Mensagem excluída.')} icon={<Trash2 className="h-3.5 w-3.5 text-red-500" />} />
              </>
            }
          >
            <div className="grid gap-5 p-4 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium text-slate-600">Modelo</p>
                <pre className="rounded-lg bg-slate-50 p-3 font-sans text-sm whitespace-pre-wrap text-slate-700">{current.body}</pre>
                <p className="mt-4 mb-1 text-xs font-medium text-slate-600">Testar com dados</p>
                <div className="grid grid-cols-2 gap-2">
                  <Input value={testVars.socio} onChange={(e) => setTestVars({ ...testVars, socio: e.target.value })} placeholder="Sócio" />
                  <Input value={testVars.empresa} onChange={(e) => setTestVars({ ...testVars, empresa: e.target.value })} placeholder="Empresa" />
                  <Input value={testVars.telefone} onChange={(e) => setTestVars({ ...testVars, telefone: e.target.value })} placeholder="Telefone" />
                  <Input value={testVars.cidade} onChange={(e) => setTestVars({ ...testVars, cidade: e.target.value })} placeholder="Cidade" />
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-slate-600">Como o lead recebe</p>
                <div className="chat-bg rounded-lg border border-slate-200 p-4">
                  <div className="text-[11px] text-slate-500">
                    <p><b>Empresa:</b> {renderTemplate('{empresa}', testVars)}</p>
                    <p><b>Sócio:</b> {renderTemplate('{socio}', testVars)}</p>
                  </div>
                  <div className="mt-3 ml-auto max-w-[95%] rounded-lg rounded-tr-none bg-emerald-100 px-3 py-2 text-sm whitespace-pre-wrap shadow-sm">{renderTemplate(current.body, testVars)}</div>
                </div>
                {missingVariables(current.body, testVars).length > 0 && <p className="mt-2 text-xs text-amber-700">Sem valor: {missingVariables(current.body, testVars).join(', ')}</p>}
              </div>
            </div>
          </Card>
        )}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} size="lg" title={editing?.id ? 'Editar mensagem' : 'Nova mensagem'} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button onClick={save}>Salvar</Button></>}>
        {editing && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <Field label="Nome"><Input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Categoria">
                <Select value={editing.category ?? 'ativacao'} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </Select>
              </Field>
              <Field label="Mensagem">
                <Textarea rows={8} value={editing.body ?? ''} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
              </Field>
              <div className="flex flex-wrap gap-1">
                {TEMPLATE_VARIABLES.map((v) => (
                  <button key={v.key} title={v.description} onClick={() => setEditing({ ...editing, body: `${editing.body ?? ''}${v.key}` })} className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 hover:bg-slate-50">{v.key}</button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={!!editing.favorite} onChange={(e) => setEditing({ ...editing, favorite: e.target.checked })} /> Favorita</label>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">Pré-visualização</p>
              <div className="chat-bg rounded-lg border border-slate-200 p-4">
                <div className="ml-auto max-w-[95%] rounded-lg rounded-tr-none bg-emerald-100 px-3 py-2 text-sm whitespace-pre-wrap shadow-sm">{renderTemplate(editing.body ?? '', SAMPLE)}</div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
