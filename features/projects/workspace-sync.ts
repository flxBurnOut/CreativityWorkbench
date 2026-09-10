import type { Project, Workspace } from './model';

const ignored = new Set(['stage', 'updatedAt', 'flow']);
function comparable(project: Project | undefined) {
  if (!project) return undefined;
  return Object.fromEntries(Object.entries(project).filter(([key]) => !ignored.has(key)).map(([key, value]) => [key, key === 'assets' ? project.assets.map(asset => asset.fileId ? { id: asset.id, name: asset.name, fileId: asset.fileId, source: asset.source } : asset) : value]));
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Blob || b instanceof Blob) return false;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = Object.entries(a).filter(([, v]) => v !== undefined);
  const right = Object.entries(b).filter(([, v]) => v !== undefined);
  return left.length === right.length && left.every(([key, value]) => Object.hasOwn(b, key) && equal(value, (b as Record<string, unknown>)[key]));
}

function mergeWebsiteDraft(before:Project|undefined,mine:Project|undefined,theirs:Project|undefined) {
  if(!before||!mine||!theirs||[before,mine,theirs].some(p=>p.type!=='website'))return;
  const withoutDraft=(p:Project)=>comparable({...p,websiteEdit:undefined});
  if(!equal(withoutDraft(before),withoutDraft(mine)))return;
  // Incoming task results and the next instruction are independent. A run may
  // also have consumed the submitted instruction while the user types the next.
  const consumed=!theirs.websiteEdit&&theirs.websiteRequest?.taskId!==before.websiteRequest?.taskId&&
    theirs.websiteBrief?.change===before.websiteEdit?.change&&theirs.websiteBrief?.scope===before.websiteEdit?.scope;
  if(!equal(before.websiteEdit,theirs.websiteEdit)&&!equal(mine.websiteEdit,theirs.websiteEdit)&&!consumed)return;
  return {...theirs,websiteEdit:mine.websiteEdit,stage:mine.stage};
}

function mergeCraftDraft(before:Project|undefined,mine:Project|undefined,theirs:Project|undefined) {
  if(!before||!mine||!theirs||[before,mine,theirs].some(p=>p.type!=='craft'))return;
  const withoutDraft=(p:Project)=>comparable({...p,craftGoal:undefined});
  if(!equal(withoutDraft(before),withoutDraft(mine)))return;
  const goal=(p:Project)=>p.craftGoal??p.craftRequest?.goal??p.idea;
  // Receiving a file or recording the submitted request is independent of
  // typing the next requirement; two people changing the draft still conflict.
  if(goal(before)!==goal(theirs)&&goal(mine)!==goal(theirs))return;
  return {...theirs,craftGoal:mine.craftGoal,stage:mine.stage};
}

/** Preserve remote changes; an overlapping local edit becomes a separate, visible project. */
export function reconcileWorkspace(base: Workspace, local: Workspace, remote: Workspace, newId: () => string = () => crypto.randomUUID()) {
  const projects: Project[] = [];
  const copies: { from: string; to: string; title: string }[] = [];
  const preservedRemovals: string[] = [];
  const ids = new Set([...remote.projects.map(p => p.id), ...local.projects.map(p => p.id)]);
  for (const id of ids) {
    const before = base.projects.find(p => p.id === id);
    const mine = local.projects.find(p => p.id === id);
    const theirs = remote.projects.find(p => p.id === id);
    const localChanged = !equal(comparable(before), comparable(mine));
    const remoteChanged = !equal(comparable(before), comparable(theirs));
    if (!localChanged) { if (theirs) projects.push({ ...theirs, stage: mine?.stage ?? theirs.stage }); continue; }
    if (!remoteChanged || equal(comparable(mine), comparable(theirs))) { if (mine) projects.push(mine); continue; }
    const withDraft=mergeWebsiteDraft(before,mine,theirs)||mergeCraftDraft(before,mine,theirs);
    if(withDraft){projects.push(withDraft);continue;}
    if (theirs) projects.push(theirs);
    if (theirs && !mine) preservedRemovals.push(theirs.title);
    if (mine) {
      const copy = { ...mine, id: newId(), title: mine.title.slice(0, 180) + '（本机冲突副本）', updatedAt: Date.now() };
      projects.push(copy); copies.push({ from: id, to: copy.id, title: copy.title });
    }
  }
  const requested = copies.find(c => c.from === local.activeProjectId)?.to ?? local.activeProjectId;
  return { workspace: { projects, activeProjectId: projects.some(p => p.id === requested) ? requested : null }, copies, preservedRemovals };
}
