// Shared project defaults and result adoption: Web and MCP follow the same rules.
import { taskSource } from './task-contract.mjs';
import { recordChanges } from './workflow.mjs';
import { videoSpec } from './media-validation.mjs';

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
export function applyTaskResult(project, task, selection = {}) {
  if (task.projectId !== project.id || task.status !== 'succeeded' || !task.result || taskSource(project, task.kind, task.args) !== task.source) throw new Error('生成依据已改变，未覆盖当前项目；你仍可复制或下载结果。');
  const r = task.result; const next = { ...project };
  if(r.videoClip) {
    const shot=project.video?.shots.find(s=>s.id===task.args.objectId);
    const check=shot&&videoSpec(r.videoClip,project.video.ratio,shot.duration);
    if(check?.status==='failed')throw new Error('视频规格未通过，文件保留，请修正后再采用。'+check.issues.join(' '));
  }
  if(selection.objectIds&&(!selection.objectIds.length||selection.objectIds.some(id=>!r.objects?.some(o=>o.id===id))))throw new Error('请选择有效的对象更新。');
  if(selection.sectionKeys&&(!selection.sectionKeys.length||selection.sectionKeys.some(key=>!Object.hasOwn(r.sections||{},key))))throw new Error('请选择有效的设定小节。');
  if (task.kind === 'creative') { next.brief = r.brief; next.culture = r.culture; }
  if (r.sections) next.content = { ...project.content, [project.type]: { ...project.content[project.type], ...Object.fromEntries(Object.entries(r.sections).filter(([key])=>!selection.sectionKeys||selection.sectionKeys.includes(key))) } };
  if (r.replacement !== undefined) {
    const { key, start, end } = task.args; const value = project.content[project.type][key];
    next.content = { ...project.content, [project.type]: { ...project.content[project.type], [key]: value.slice(0, start) + r.replacement + value.slice(end) } };
  }
  if (r.art) next.art = r.art;
  if (r.objects) {
    const chosen=r.objects.filter(o=>!selection.objectIds||selection.objectIds.includes(o.id));
    next.concepts=project.concepts.map(c=>{const o=chosen.find(o=>o.id===c.id);return o?{...c,...o}:c;});
    for(const o of chosen)if(!next.concepts.some(c=>c.id===o.id||c.name===o.name&&c.category===o.category))next.concepts.push({...o,prompt:'',revisionRequest:''});
  }
  if (r.novel) next.novel = r.novel;
  if (r.videoPlan) next.video = { ...r.videoPlan, final: project.video?.final };
  if ((r.videoClip || r.videoAudio) && project.video) next.video = { ...project.video, shots: project.video.shots.map(s => s.id === task.args.objectId ? { ...s, ...(r.videoClip ? { clip: r.videoClip } : { audio: r.videoAudio }) } : s) };
  if (r.videoFinal && project.video) next.video = { ...project.video, final: r.videoFinal };
  if (r.website) next.website = r.website;
  if (r.websiteRequest) next.websiteRequest = r.websiteRequest;
  if (r.designPackage) next.designPackage=r.designPackage;
  if (r.asset) {
    next.assets = [...project.assets.filter(a => a.id !== r.asset.id), r.asset];
    if (task.kind === 'cover') { next.coverAssetId = r.asset.id; next.manualCover = true; }
    else if(task.kind==='video-frame'&&project.video)next.video={...project.video,shots:project.video.shots.map(s=>s.id===task.args.objectId?{...s,frameCandidate:r.asset.id}:s)};
    else next.concepts = project.concepts.map(c => c.id === task.args.objectId ? { ...c, candidateAssetId: r.asset.id, prompt: r.asset.source?.prompt || c.prompt } : c);
  }
  if (['creative', 'content', 'art'].includes(task.kind)) next.upstreamChanged = project.upstreamChanged || project.concepts.some(c => c.savedAssetId);
  return recordChanges(project,next,{origin:'generated',taskId:task.id});
}
