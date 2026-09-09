'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyWorkspace, normalizeSavedAssets, type Workspace } from './model';
import { loadServerWorkspace, saveServerWorkspace } from './server-store';

export function useProjectStore() {
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [status, setStatus] = useState<'loading'|'saved'|'saving'|'error'|'temporary'>('loading');
  const [error,setError] = useState(''); const [note,setNote] = useState(''); const [ready,setReady] = useState(false);
  const current = useRef(workspace); const pending = useRef<{ workspace: Workspace; writeId: string } | null>(null);
  const failed = useRef<{ workspace: Workspace; writeId: string } | null>(null);
  const revision = useRef(0); const writing = useRef<Promise<void> | null>(null);
  const reading = useRef<ReturnType<typeof loadServerWorkspace> | null>(null);
  const memoryOnly = useRef(false); const initialized = useRef(false); const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(async () => {
    setStatus('loading'); setError('');
    try {
      const request = reading.current ??= loadServerWorkspace();
      let result;
      try { result = await request; } finally { if (reading.current === request) reading.current = null; }
      if (!mounted.current) return;
      current.current = result.workspace; revision.current = result.revision; pending.current = null; failed.current = null;
      initialized.current = true; memoryOnly.current = false;
      setWorkspace(result.workspace); setReady(true); setStatus('saved'); setNote(result.note);
    } catch (e) { if (mounted.current) { setError(e instanceof Error ? e.message : '项目无法读取。'); setStatus('error'); } }
  },[]);
  const flush = useCallback(async () => {
    if (memoryOnly.current) throw new Error('临时体验不发起生成，请连接服务并保存项目。');
    if (!initialized.current) throw new Error('项目尚未读取完成。');
    if (timer.current) clearTimeout(timer.current);
    if (!writing.current) writing.current = (async () => {
      while (failed.current || pending.current) {
        const next = failed.current || pending.current!;
        if (next === pending.current) pending.current = null;
        if (mounted.current) setStatus('saving');
        try {
          revision.current = await saveServerWorkspace(next.workspace, revision.current, next.writeId, wire=>{
            current.current=normalizeSavedAssets(current.current,next.workspace,wire);
            if(pending.current)pending.current={...pending.current,workspace:normalizeSavedAssets(pending.current.workspace,next.workspace,wire)};
            if(mounted.current)setWorkspace(current.current);
          });
          failed.current = null;
        }
        catch (e) {
          failed.current = next;
          if (mounted.current) { setError(e instanceof Error ? e.message : '项目未保存，请保留页面。'); setStatus('error'); }
          throw e;
        }
      }
      if (mounted.current) { setStatus('saved'); setError(''); }
    })();
    const request = writing.current;
    try { await request; } finally { if (writing.current === request) writing.current = null; }
  },[]);
  useEffect(() => {
    mounted.current = true; void load();
    const hidden = () => { if (document.visibilityState === 'hidden' && initialized.current && !memoryOnly.current) void flush().catch(() => {}); };
    const leave = (e:BeforeUnloadEvent) => { if (pending.current || failed.current || writing.current) { e.preventDefault(); e.returnValue = ''; } };
    document.addEventListener('visibilitychange',hidden); window.addEventListener('beforeunload',leave);
    return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); document.removeEventListener('visibilitychange',hidden); window.removeEventListener('beforeunload',leave); };
  },[load,flush]);
  const change = useCallback((update:(previous:Workspace)=>Workspace) => {
    if (!initialized.current) return;
    const next = update(current.current); current.current = next; setWorkspace(next);
    if (memoryOnly.current) { setStatus('temporary'); return; }
    pending.current = { workspace:next,writeId:crypto.randomUUID() };
    if (failed.current) return;
    setStatus('saving'); if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush().catch(() => {}); },300);
  },[flush]);
  const useTemporary = () => {
    memoryOnly.current = true; initialized.current = true; current.current = emptyWorkspace();
    setWorkspace(current.current); pending.current = null; failed.current = null; setReady(true); setError(''); setStatus('temporary');
  };
  return { workspace, change, status, error, note, ready, retry: ready ? flush : load, flush, useTemporary };
}
