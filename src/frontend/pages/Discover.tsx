import { Eraser, FilterX, Radar, RefreshCw, Search, SkipForward, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { companyName, formatCnpj, fmtDateTime } from '../components/format';
import { ResultCard } from '../components/ResultCard';
import { SendActivationModal } from '../components/SendActivationModal';
import { LeadStatusBadge } from '../components/status';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, SkeletonRows } from '../components/ui';
import { useToast } from '../hooks/useToast';
import { api } from '../services/api';
import { ACCOUNTING_CNAES, PORTES, UFS, type ProspectResult } from '../types';

interface Filters {
  uf: string;
  municipio: string;
  bairro: string;
  cnaes: string[];
  situacao: string;
  portes: string[];
  minAgeMonths: string;
  maxAgeMonths: string;
  onlyWithMobile: boolean;
  count: number;
}

const DEFAULT: Filters = {
  uf: '',
  municipio: '',
  bairro: '',
  cnaes: ACCOUNTING_CNAES.map((c) => c.code),
  situacao: 'ATIVA',
  portes: [],
  minAgeMonths: '',
  maxAgeMonths: '',
  onlyWithMobile: true,
  count: 20,
};
const STORAGE = 'megazord.discover.filters';

const AGE_PRESETS = [
  { label: 'Qualquer', min: '', max: '' },
  { label: 'Até 1 ano', min: '', max: '12' },
  { label: '1 a 3 anos', min: '12', max: '36' },
  { label: '3 a 10 anos', min: '36', max: '120' },
  { label: 'Mais de 10 anos', min: '120', max: '' },
];

export function DiscoverPage() {
  const toast = useToast();
  const [filters, setFilters] = useState<Filters>(() => {
    try {
      return { ...DEFAULT, ...JSON.parse(localStorage.getItem(STORAGE) ?? '{}') };
    } catch {
      return DEFAULT;
    }
  });
  const [results, setResults] = useState<ProspectResult[]>([]);
  const [meta, setMeta] = useState<{ searchId: number; criteria: any; total: number | null; skippedDuplicates: number; exhausted: boolean } | null>(null);
  const [loading, setLoading] = useState<'new' | 'next' | 'initial' | null>('initial');
  const [cnpjCheck, setCnpjCheck] = useState('');
  const [checkResult, setCheckResult] = useState<any>(null);
  const [activate, setActivate] = useState<number | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    api
      .get('/companies/recent')
      .then((r) => {
        setResults(r.results);
        if (r.lastSearch) setMeta({ searchId: r.lastSearch.id, criteria: r.lastSearch.filters, total: r.lastSearch.total, skippedDuplicates: 0, exhausted: false });
      })
      .catch(() => undefined)
      .finally(() => setLoading(null));
  }, []);

  const payload = (count: number) => ({
    uf: filters.uf || undefined,
    municipio: filters.municipio || undefined,
    bairro: filters.bairro || undefined,
    cnaes: filters.cnaes,
    situacao: filters.situacao,
    portes: filters.portes,
    minAgeMonths: filters.minAgeMonths ? Number(filters.minAgeMonths) : undefined,
    maxAgeMonths: filters.maxAgeMonths ? Number(filters.maxAgeMonths) : undefined,
    onlyWithMobile: filters.onlyWithMobile,
    count,
  });

  const discover = async (count: number) => {
    setLoading('new');
    try {
      const res = await api.post('/companies/discover', payload(count));
      setResults(res.results);
      setMeta(res);
      toast.success(`${res.results.length} empresa(s) inédita(s) encontrada(s).`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const next = async () => {
    setLoading('next');
    try {
      const res = await api.post('/companies/discover/next', { searchId: meta?.searchId, count: 20 });
      setResults(res.results);
      setMeta(res);
      if (!res.results.length) toast.info('Não há mais empresas inéditas para estes critérios.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const checkCnpj = async () => {
    try {
      setCheckResult(await api.get(`/companies/check/${cnpjCheck.replace(/\D/g, '')}`));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const clearCache = async () => {
    const r = await api.post('/companies/cache/clear');
    toast.success(`Cache limpo (${r.removed} consulta(s)). O histórico comercial foi mantido.`);
  };

  const toggle = (key: 'cnaes' | 'portes', value: string) =>
    setFilters((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }));

  const updateResult = (r: ProspectResult) => setResults((list) => list.map((x) => (x.company.id === r.company.id ? r : x)));

  const reloadResult = async (leadId: number) => {
    const target = results.find((r) => r.lead?.id === leadId);
    if (!target) return;
    const fresh = await api.get(`/companies/${target.company.id}`);
    updateResult(fresh);
  };

  return (
    <div className="p-6">
      <PageHeader
        title="Descobrir empresas"
        description="Escritórios contábeis ativos e ainda não trabalhados. Empresas já apresentadas nunca se repetem."
        actions={
          <Button variant="ghost" size="sm" onClick={clearCache} icon={<Eraser className="h-3.5 w-3.5" />}>
            Limpar cache
          </Button>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Card title="Filtros" actions={<Button size="sm" variant="ghost" onClick={() => setFilters(DEFAULT)} icon={<FilterX className="h-3.5 w-3.5" />}>Limpar</Button>}>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-[90px_1fr] gap-2">
                <Field label="Estado">
                  <Select value={filters.uf} onChange={(e) => setFilters({ ...filters, uf: e.target.value })}>
                    <option value="">Todos</option>
                    {UFS.map((uf) => <option key={uf}>{uf}</option>)}
                  </Select>
                </Field>
                <Field label="Município">
                  <Input value={filters.municipio} onChange={(e) => setFilters({ ...filters, municipio: e.target.value })} placeholder="Ex.: São Paulo" />
                </Field>
              </div>
              <Field label="Bairro">
                <Input value={filters.bairro} onChange={(e) => setFilters({ ...filters, bairro: e.target.value })} placeholder="Opcional" />
              </Field>
              <Field label="Tempo desde abertura">
                <Select
                  value={AGE_PRESETS.findIndex((p) => p.min === filters.minAgeMonths && p.max === filters.maxAgeMonths)}
                  onChange={(e) => {
                    const p = AGE_PRESETS[Number(e.target.value)];
                    if (p) setFilters({ ...filters, minAgeMonths: p.min, maxAgeMonths: p.max });
                  }}
                >
                  {AGE_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
                  <option value={-1} disabled>Personalizado</option>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Mín. (meses)"><Input type="number" min={0} value={filters.minAgeMonths} onChange={(e) => setFilters({ ...filters, minAgeMonths: e.target.value })} /></Field>
                <Field label="Máx. (meses)"><Input type="number" min={0} value={filters.maxAgeMonths} onChange={(e) => setFilters({ ...filters, maxAgeMonths: e.target.value })} /></Field>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-slate-600">Porte</p>
                <div className="flex flex-wrap gap-1.5">
                  {PORTES.map((p) => (
                    <button key={p.code} onClick={() => toggle('portes', p.code)} className={`rounded-md border px-2 py-1 text-xs ${filters.portes.includes(p.code) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Nenhum selecionado = todos os portes.</p>
              </div>
              <Field label="Situação cadastral">
                <Select value={filters.situacao} onChange={(e) => setFilters({ ...filters, situacao: e.target.value })}>
                  {['ATIVA', 'INAPTA', 'SUSPENSA', 'BAIXADA'].map((s) => <option key={s}>{s}</option>)}
                </Select>
              </Field>
              <div>
                <p className="mb-1 text-xs font-medium text-slate-600">CNAE</p>
                {ACCOUNTING_CNAES.map((c) => (
                  <label key={c.code} className="flex items-start gap-2 py-0.5 text-xs text-slate-700">
                    <input type="checkbox" className="mt-0.5 accent-brand-600" checked={filters.cnaes.includes(c.code)} onChange={() => toggle('cnaes', c.code)} />
                    <span><span className="font-mono">{c.code}</span> — {c.label}</span>
                  </label>
                ))}
                <Input
                  className="mt-1.5"
                  placeholder="Outros CNAEs (7 dígitos, separados por vírgula)"
                  defaultValue={filters.cnaes.filter((c) => !ACCOUNTING_CNAES.some((a) => a.code === c)).join(', ')}
                  onBlur={(e) => {
                    const extra = e.target.value.split(/[,\s]+/).map((s) => s.replace(/\D/g, '')).filter((s) => s.length === 7);
                    setFilters((f) => ({ ...f, cnaes: [...new Set([...f.cnaes.filter((c) => ACCOUNTING_CNAES.some((a) => a.code === c)), ...extra])] }));
                  }}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" className="accent-brand-600" checked={filters.onlyWithMobile} onChange={(e) => setFilters({ ...filters, onlyWithMobile: e.target.checked })} />
                Somente empresas com celular
              </label>
              <Field label="Quantidade de resultados">
                <Input type="number" min={1} max={100} value={filters.count} onChange={(e) => setFilters({ ...filters, count: Math.min(100, Math.max(1, Number(e.target.value) || 20)) })} />
              </Field>
              <div className="grid gap-2 pt-1">
                <Button onClick={() => discover(filters.count)} loading={loading === 'new'} disabled={!filters.cnaes.length} icon={<Radar className="h-4 w-4" />}>
                  Descobrir novos
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => discover(20)} disabled={!!loading} icon={<Sparkles className="h-3.5 w-3.5" />}>Buscar 20 novos</Button>
                  <Button variant="secondary" onClick={next} loading={loading === 'next'} disabled={!meta} icon={<SkipForward className="h-3.5 w-3.5" />}>Próximos 20</Button>
                </div>
              </div>
            </div>
          </Card>
          <Card title="Já usamos este CNPJ?">
            <div className="space-y-2 p-4">
              <div className="flex gap-2">
                <Input value={cnpjCheck} onChange={(e) => setCnpjCheck(e.target.value)} placeholder="00.000.000/0000-00" onKeyDown={(e) => e.key === 'Enter' && checkCnpj()} />
                <Button variant="secondary" onClick={checkCnpj} icon={<Search className="h-4 w-4" />} />
              </div>
              {checkResult && (
                <div className={`rounded-lg p-3 text-xs ${checkResult.used || checkResult.optOut ? 'bg-amber-50 text-amber-900' : checkResult.company ? 'bg-sky-50 text-sky-900' : 'bg-emerald-50 text-emerald-900'}`}>
                  <p className="font-semibold">
                    {checkResult.optOut ? 'CNPJ em opt-out — não contatar.' : checkResult.used ? 'Sim — este CNPJ já foi trabalhado.' : checkResult.company ? 'Já apresentado, mas ainda não contatado.' : 'Não — CNPJ inédito.'}
                  </p>
                  {checkResult.company && (
                    <div className="mt-1 space-y-0.5">
                      <p>{companyName(checkResult.company.company)} · {formatCnpj(checkResult.cnpj)}</p>
                      {checkResult.lead && (
                        <p className="flex items-center gap-1">
                          <LeadStatusBadge status={checkResult.lead.status} /> {checkResult.lead.contactCount} contato(s) · último {fmtDateTime(checkResult.lead.lastContactAt)}
                          {checkResult.lead.ownerName ? ` · ${checkResult.lead.ownerName}` : ''}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-3">
          {meta && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">Critérios utilizados:</span>
              {meta.criteria?.uf && <Badge>{meta.criteria.uf}</Badge>}
              {meta.criteria?.municipio && <Badge>{meta.criteria.municipio}</Badge>}
              {meta.criteria?.bairro && <Badge>{meta.criteria.bairro}</Badge>}
              <Badge>{meta.criteria?.situacao ?? 'ATIVA'}</Badge>
              {(meta.criteria?.cnaes ?? []).map((c: string) => <Badge key={c} color="brand">{c}</Badge>)}
              {(meta.criteria?.portes ?? []).map((p: string) => <Badge key={p}>{p}</Badge>)}
              {meta.criteria?.onlyWithMobile && <Badge color="green">com celular</Badge>}
              <span className="flex-1" />
              {meta.total != null && <span>{meta.total.toLocaleString('pt-BR')} na base</span>}
              {meta.skippedDuplicates > 0 && <span>· {meta.skippedDuplicates} já vistas ignoradas</span>}
              <Button size="sm" variant="ghost" onClick={() => discover(filters.count)} icon={<RefreshCw className="h-3 w-3" />}>Pesquisar novamente</Button>
            </div>
          )}
          {loading === 'initial' || loading === 'new' ? (
            <Card><SkeletonRows rows={6} /></Card>
          ) : results.length === 0 ? (
            <Card>
              <EmptyState icon={<Radar className="h-6 w-6" />} title="Nenhuma empresa na tela" description="Defina os filtros e clique em “Descobrir novos”. A busca usa a chave da Casa dos Dados cadastrada pelo administrador." />
            </Card>
          ) : (
            results.map((r) => <ResultCard key={r.company.id} result={r} onChange={updateResult} onActivate={setActivate} />)
          )}
        </div>
      </div>
      <SendActivationModal open={activate !== null} leadId={activate} onClose={() => setActivate(null)} onSent={() => activate && reloadResult(activate)} />
    </div>
  );
}
