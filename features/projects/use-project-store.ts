'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyWorkspace, type Workspace } from './model';
import { loadWorkspace, saveWorkspace } from './local-store';

export function useProjectStore() {
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [status, setStatus] = useState<'loading' | 'saved' | 'saving' | 'error' | 'temporary'>('loading');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const current = useRef(workspace);
  const pending = useRef<Workspace | null>(null);
  const revision = useRef(0);
  const writing = useRef(false);
  const memoryOnly = useRef(false);
  const initialized = useRef(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setStatus('loading'); setError('');
    try {
      const result = await loadWorkspace();
      if (!mounted.current) return;
      current.current = result.workspace; revision.current = result.revision;
      initialized.current = true; pending.current = null; memoryOnly.current = false;
      setWorkspace(result.workspace); setReady(true); setStatus('saved');
    } catch (reason) { if (mounted.current) { setError(reason instanceof Error ? reason.message : '本地草稿无法读取。'); setStatus('error'); } }
  }, []);

  const flush = useCallback(async () => {
    if (writing.current || memoryOnly.current || !initialized.current) return;
    writing.current = true;
    while (pending.current) {
      const next = pending.current;
      pending.current = null;
      if (mounted.current) setStatus('saving');
      try { revision.current = await saveWorkspace(next, revision.current); }
      catch (reason) {
        pending.current ??= next;
        if (mounted.current) { setError(reason instanceof Error ? reason.message : '本地暂存失败。'); setStatus('error'); }
        writing.current = false;
        return;
      }
    }
    writing.current = false;
    if (mounted.current) { setStatus('saved'); setError(''); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const handleHidden = () => { if (document.visibilityState === 'hidden') void flush(); };
    const handleLeave = (event: BeforeUnloadEvent) => { if (pending.current || writing.current) { event.preventDefault(); event.returnValue = ''; } };
    document.addEventListener('visibilitychange', handleHidden);
    window.addEventListener('beforeunload', handleLeave);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', handleHidden); window.removeEventListener('beforeunload', handleLeave); };
  }, [load, flush]);

  const change = useCallback((update: (previous: Workspace) => Workspace) => {
    if (!initialized.current) return;
    const next = update(current.current);
    current.current = next; setWorkspace(next);
    if (memoryOnly.current) { setStatus('temporary'); return; }
    pending.current = next;
    void flush();
  }, [flush]);

  const useTemporary = () => {
    memoryOnly.current = true; initialized.current = true;
    current.current = emptyWorkspace(); setWorkspace(current.current);
    pending.current = null; setReady(true); setError(''); setStatus('temporary');
  };
  return { workspace, change, status, error, ready, retry: ready ? flush : load, useTemporary };
}
