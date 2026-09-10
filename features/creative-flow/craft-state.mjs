const terminal = new Set(['succeeded', 'failed', 'cancelled', 'superseded']);
const assetFile = (value, extension) => typeof value === 'string' && new RegExp('^[a-f0-9]{64}\\.' + extension + '$').test(value);
export function isCraftAsset(value) {
  return Boolean(value && typeof value.taskId === 'string' && assetFile(value.glbFileId, 'glb') && assetFile(value.blendFileId, 'blend'));
}

/**
 * Select metadata only; the viewer loads exactly one selected model.
 * @param {import('../projects/model').Project} project
 * @param {import('./task-results').GenerationTask[]} tasks
 * @param {import('./task-results').GenerationTask | null} receipt
 */
export function craftStudioState(project, tasks = [], receipt = null) {
  const byId = new Map(tasks.filter(task => task.projectId === project.id && task.kind === 'craft-model').map(task => [task.id, task]));
  if (receipt?.projectId === project.id && (!byId.has(receipt.id) || (receipt.updatedAt || 0) > (byId.get(receipt.id).updatedAt || 0))) byId.set(receipt.id, receipt);
  const ordered = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
  const requested = byId.get(project.craftRequest?.taskId);
  const task = requested && requested.createdAt >= (ordered[0]?.createdAt || 0) ? requested : ordered[0] || null;
  const versions = new Map();
  const add = asset => { if (isCraftAsset(asset)) versions.set(asset.taskId, asset); };
  for (const record of project.flow?.records || []) if (record.type === 'craft' && record.target === 'craftAsset') add(record.value);
  for (const item of ordered) if (item.status === 'succeeded') add(item.result?.craftAsset);
  add(project.craftAsset);
  // Preserve every valid result for explicit history preview. Publication to
  // the current preview has the same source/request guard as Runtime adoption.
  if (task?.status === 'succeeded') add(task.result?.craftAsset);
  const assets = [...versions.values()].sort((a, b) => b.createdAt - a.createdAt);
  const historyOnly = task && project.flow?.records?.some(record => record.type === 'craft' && record.target === 'craftAsset' && record.origin === 'generated-history' && (record.taskId === task.id || record.value?.taskId === task.id));
  let resultEligible = false;
  if (task?.status === 'succeeded' && isCraftAsset(task.result?.craftAsset) && !task.recoveredAfterCancel && !historyOnly && project.craftRequest?.taskId === task.id && project.craftRequest.goal === task.args?.prompt && typeof task.source === 'string') {
    try { resultEligible = sameTaskSource(taskSource(project, 'craft-model', task.args), task.source); }
    catch { /* Unreadable or outdated knowledge cannot authorize a new current preview. */ }
  }
  // A newer result may arrive before craftAsset is persisted. It can be shown
  // immediately only after the matching request and unchanged basis are known.
  // With no current asset, historical output stays in the history picker.
  const latest = resultEligible ? task.result.craftAsset : isCraftAsset(project.craftAsset) ? project.craftAsset : null;
  const historicalResult = Boolean(task?.status === 'succeeded' && isCraftAsset(task.result?.craftAsset) && !resultEligible && project.craftAsset?.taskId !== task.id);
  return { task, active: Boolean(task && !terminal.has(task.status)), assets, latest, resultEligible, historicalResult };
}
import {sameTaskSource, taskSource} from '../../lib/workbench/task-contract.mjs';
