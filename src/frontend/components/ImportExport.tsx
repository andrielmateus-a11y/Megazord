import { Download, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useToast } from '../hooks/useToast';
import { api, fileToBase64 } from '../services/api';
import { Button } from './ui';

export function ExportButtons({ kind, label = 'Exportar' }: { kind: 'leads' | 'history' | 'messages' | 'templates'; label?: string }) {
  const toast = useToast();
  const run = (format: 'csv' | 'xlsx') => api.download(`/settings/export/${kind}?format=${format}`, `megazord-${kind}.${format}`).catch((e) => toast.error(e.message));
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <span className="flex items-center gap-1.5 border-r border-slate-200 px-2.5 text-xs text-slate-600"><Download className="h-3.5 w-3.5" /> {label}</span>
      <button onClick={() => run('csv')} className="px-2 py-1.5 text-xs font-medium hover:bg-slate-50">CSV</button>
      <button onClick={() => run('xlsx')} className="border-l border-slate-200 px-2 py-1.5 text-xs font-medium hover:bg-slate-50">Excel</button>
    </div>
  );
}

export function ImportButton({ kind, label = 'Importar', onDone }: { kind: 'leads' | 'templates'; label?: string; onDone?: () => void }) {
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const onFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await api.post(`/settings/import/${kind}`, { fileName: file.name, contentBase64: await fileToBase64(file) });
      toast.success(`Importação: ${res.created} novo(s), ${res.updated} atualizado(s)${res.errors.length ? `, ${res.errors.length} erro(s)` : ''}.`);
      onDone?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };
  return (
    <>
      <input ref={ref} type="file" accept=".csv,.xlsx,.txt" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      <Button variant="secondary" size="sm" loading={busy} onClick={() => ref.current?.click()} icon={<Upload className="h-3.5 w-3.5" />}>{label}</Button>
    </>
  );
}
