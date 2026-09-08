// Shared project defaults and result adoption: Web and MCP follow the same rules.
import { taskSource } from './task-contract.mjs';

/** @returns {import('../../features/projects/model').Project} */
export function createProject(idea, type = 'undecided', title = '', id = crypto.randomUUID()) {
  const now = Date.now();
  return {
    id, title: title.trim() || idea.trim().slice(0, 18) || '未命名创意', type, createdAt: now, updatedAt: now, stage: 0,
    idea: idea.trim(), brief: '', culture: '',
    content: { undecided: {}, novel: {}, video: {}, craft: {}, website: {} },
    art: { direction: '', material: '', palette: '', constraints: '', fullPrompt: '' },
    requests: ['', '', '', '', ''], references: [], assets: [], concepts: [], manualCover: false,
    delivery: { notes: '', textFormat: 'md', ratio: '16:9', duration: '' }, upstreamChanged: false,
  };
}

/**
 * @param {import('../../features/projects/model').Project} project
 * @param {import('../../features/creative-flow/task-results').GenerationTask} task
 * @returns {import('../../features/projects/model').Project}
 */
export function applyTaskResult(project, task) {
  if (task.projectId !== project.id || task.status !== 'succeeded' || !task.result || taskSource(project, task.kind, task.args) !== task.source) throw new Error('生成依据已改变，未覆盖当前项目；你仍可复制或下载结果。');
  const r = task.result; const next = { ...project };
  if (task.kind === 'creative') { next.brief = r.brief; next.culture = r.culture; }
  if (r.sections) next.content = { ...project.content, [project.type]: { ...project.content[project.type], ...r.sections } };
  if (r.replacement !== undefined) {
    const { key, start, end } = task.args; const value = project.content[project.type][key];
    next.content = { ...project.content, [project.type]: { ...project.content[project.type], [key]: value.slice(0, start) + r.replacement + value.slice(end) } };
  }
  if (r.art) next.art = r.art;
  if (r.objects) next.concepts = [...project.concepts, ...r.objects.filter(o => !project.concepts.some(c => c.name === o.name && c.category === o.category)).map(o => ({ ...o, prompt: '', revisionRequest: '' }))];
  if (r.novel) next.novel = r.novel;
  if (r.videoPlan) next.video = { ...r.videoPlan, final: project.video?.final };
  if ((r.videoClip || r.videoAudio) && project.video) next.video = { ...project.video, shots: project.video.shots.map(s => s.id === task.args.objectId ? { ...s, ...(r.videoClip ? { clip: r.videoClip } : { audio: r.videoAudio }) } : s) };
  if (r.videoFinal && project.video) next.video = { ...project.video, final: r.videoFinal };
  if (r.website) next.website = r.website;
  if (r.asset) {
    next.assets = [...project.assets.filter(a => a.id !== r.asset.id), r.asset];
    if (task.kind === 'cover') { next.coverAssetId = r.asset.id; next.manualCover = true; }
    else next.concepts = project.concepts.map(c => c.id === task.args.objectId ? { ...c, candidateAssetId: r.asset.id, prompt: r.asset.source?.prompt || c.prompt } : c);
  }
  if (['creative', 'content', 'art'].includes(task.kind)) next.upstreamChanged = project.upstreamChanged || project.concepts.some(c => c.savedAssetId);
  return next;
}
