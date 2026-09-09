'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyWorkspace, normalizeSavedAssets, type Workspace } from './model';
import { loadServerWorkspace, readServerWorkspace, saveServerWorkspace, WorkbenchApiError } from './server-store';
import { reconcileWorkspace } from './workspace-sync';

export function useProjectStore() {
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [status, setStatus] = useState<'loading'|'saved'|'saving'|'error'|'temporary'>('loading');
  const [error,setError] = useState(''); const [note,setNote] = useState(''); const [ready,setReady] = useState(false);
  const current = useRef(workspace); const pending = useRef<{ workspace: Workspace; writeId: string } | null>(null);
  const confirmed = useRef(workspace);
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
      current.current = result.workspace; confirmed.current = result.workspace; revision.current = result.revision; pending.current = null; failed.current = null;
      initialized.current = true; memoryOnly.current = false;
      setWorkspace(result.workspace); setReady(true); setStatus('saved'); setNote(result.note);
    } catch (e) { if (mounted.current) { setError(e instanceof Error ? e.message : '项目无法读取。'); setStatus('error'); } }
  },[]);
  const flush = useCallback(async () => {
    if (memoryOnly.current) throw new Error('临时体验不发起生成，请连接服务并保存项目。');
    if (!initialized.current) throw new Error('项目尚未读取完成。');
    if (timer.current) clearTimeout(timer.current);
    if (!writing.current) writing.current = (async () => {
      let rebases = 0;
      while (failed.current || pending.current) {
        const next = failed.current || pending.current!;
        if (next === pending.current) pending.current = null;
        if (mounted.current) setStatus('saving');
        try {
          revision.current = await saveServerWorkspace(next.workspace, revision.current, next.writeId, wire=>{
            confirmed.current = wire;
            current.current=normalizeSavedAssets(current.current,next.workspace,wire);
            if(pending.current)pending.current={...pending.current,workspace:normalizeSavedAssets(pending.current.workspace,next.workspace,wire)};
            if(mounted.current)setWorkspace(current.current);
          });
          failed.current = null;
        }
        catch (e) {
          if (e instanceof WorkbenchApiError && e.status === 409 && e.code === 'conflict' && rebases++ < 3) {
            try {
              const remote = await readServerWorkspace();
              const merged = reconcileWorkspace(confirmed.current, current.current, remote.workspace);
              const previousId = current.current.activeProjectId;
              revision.current = remote.revision; confirmed.current = remote.workspace; current.current = merged.workspace;
              failed.current = null; pending.current = { workspace: merged.workspace, writeId: crypto.randomUUID() };
              if (mounted.current) {
                setWorkspace(merged.workspace);
                setNote(merged.copies.length ? '另一端同时修改了项目。本机修改已转入“冲突副本”，远端版本保留。' : merged.preservedRemovals.length ? '要删除的项目在另一端有新修改，已保留。请查看最新内容后再决定是否删除。' : '已同步另一端的修改，并继续保存本机内容。');
                if (merged.workspace.activeProjectId !== previousId) window.history.replaceState(null, '', merged.workspace.activeProjectId ? '#project/' + merged.workspace.activeProjectId : '#projects');
              }
              continue;
            } catch { /* Preserve the pending local draft if reading the remote version fails. */ }
          }
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
  const synchronize = useCallback(async () => {
    if (!initialized.current || memoryOnly.current || pending.current || failed.current || writing.current || document.visibilityState !== 'visible') return;
    const before = current.current;
    try {
      const remote = await readServerWorkspace();
      if (!mounted.current || current.current !== before || pending.current || failed.current || writing.current || remote.revision === revision.current) return;
      const activeProjectId = remote.workspace.projects.some(p => p.id === before.activeProjectId) ? before.activeProjectId : null;
      current.current = { ...remote.workspace, activeProjectId, projects: remote.workspace.projects.map(p => ({ ...p, stage: before.projects.find(old => old.id === p.id)?.stage ?? p.stage })) };
      confirmed.current = remote.workspace; revision.current = remote.revision;
      if (activeProjectId !== before.activeProjectId) window.history.replaceState(null, '', activeProjectId ? '#project/' + activeProjectId : '#projects');
      setWorkspace(current.current); setNote('已同步 WorkBuddy 或另一页面保存的内容。');
    } catch { /* Background refresh never replaces a local draft or masks a save error. */ }
  }, []);
  useEffect(() => {
    mounted.current = true; void load();
    const hidden = () => { if (document.visibilityState === 'hidden' && initialized.current && !memoryOnly.current) void flush().catch(() => {}); };
    const refresh = () => { void synchronize(); };
    const poll = setInterval(refresh, 5000);
    const leave = (e:BeforeUnloadEvent) => { if (pending.current || failed.current || writing.current) { e.preventDefault(); e.returnValue = ''; } };
    document.addEventListener('visibilitychange',hidden); document.addEventListener('visibilitychange',refresh); window.addEventListener('focus',refresh); window.addEventListener('beforeunload',leave);
    return () => { mounted.current = false; clearInterval(poll); if (timer.current) clearTimeout(timer.current); document.removeEventListener('visibilitychange',hidden); document.removeEventListener('visibilitychange',refresh); window.removeEventListener('focus',refresh); window.removeEventListener('beforeunload',leave); };
  },[load,flush,synchronize]);
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
  return { workspace, change, status, error, note, ready, retry: ready ? flush : load, flush, useTemporary, dismissNote: () => setNote('') };
}
