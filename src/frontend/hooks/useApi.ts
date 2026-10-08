import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { realtime } from '../services/realtime';

/** Carrega dados de um endpoint, com recarga manual e por eventos de tempo real. */
export function useApi<T>(path: string | null, options: { refreshOn?: string[]; intervalMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const pathRef = useRef(path);
  pathRef.current = path;

  const reload = useCallback(async (silent = true) => {
    const p = pathRef.current;
    if (!p) return;
    if (!silent) setLoading(true);
    try {
      const res = await api.get<T>(p);
      if (pathRef.current === p) {
        setData(res);
        setError(null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!path) return;
    void reload(false);
  }, [path, reload]);

  const events = (options.refreshOn ?? []).join(',');
  useEffect(() => {
    if (!events) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reload(), 250);
    };
    const offs = events.split(',').map((e) => realtime.on(e, debounced));
    return () => {
      offs.forEach((o) => o());
      if (timer) clearTimeout(timer);
    };
  }, [events, reload]);

  useEffect(() => {
    if (!options.intervalMs) return;
    const t = setInterval(() => void reload(), options.intervalMs);
    return () => clearInterval(t);
  }, [options.intervalMs, reload]);

  return { data, error, loading, reload, setData };
}

export function useRealtime(event: string, handler: (payload: any) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => realtime.on(event, (p) => ref.current(p)), [event]);
}
