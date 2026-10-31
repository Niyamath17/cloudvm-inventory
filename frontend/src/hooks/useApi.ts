/**
 * Minimal data-fetching hook: loading / error / data + reload. Deliberately small –
 * no extra state library for a handful of screens.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError } from '../api/client';

export interface ApiState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => void;
}

export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []): ApiState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const id = ++latest.current;
    setLoading(true);
    fetcher()
      .then((d) => {
        if (id !== latest.current) return; // a newer request superseded this one
        setData(d);
        setError(undefined);
      })
      .catch((e: ApiError) => id === latest.current && setError(e))
      .finally(() => id === latest.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Polls `check` every `intervalMs` until it returns true (or the component unmounts). */
export async function pollUntil(check: () => Promise<boolean>, intervalMs = 700, maxTries = 60): Promise<void> {
  for (let i = 0; i < maxTries; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
