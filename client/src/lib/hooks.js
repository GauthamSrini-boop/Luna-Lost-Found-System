import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

/** Load data on mount / when deps change. Returns {data, loading, error, reload}. */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fnRef.current().then(
      (data) => alive && setState({ data, loading: false, error: null }),
      (error) => alive && setState({ data: null, loading: false, error }),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

let metaPromise = null;
/** Categories and locations (cached for the session; call resetMeta() after admin edits). */
export function useMeta() {
  const [meta, setMeta] = useState(null);
  useEffect(() => {
    metaPromise ||= api.get('/api/meta');
    metaPromise.then(setMeta).catch(() => { metaPromise = null; setMeta({ categories: [], locations: [] }); });
  }, []);
  return meta;
}
export const resetMeta = () => { metaPromise = null; };

export function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
