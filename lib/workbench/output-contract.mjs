// Shared by persistence, generation and the browser. No server dependencies.
import { finalVideoPrompt, videoPromptBasis } from './prompts.mjs';
export const outputId = v => typeof v === 'string' && /^[a-f0-9]{64}\.(mp4|wav|html|zip|srt)$/.test(v);
const text = (v, max = 4000) => typeof v === 'string' && v.length <= max;
const id = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
const check = (ok, message) => { if (!ok) throw new Error(message); };
export function validateVideo(v) {
  check(v && ['16:9','9:16'].includes(v.ratio) && Array.isArray(v.shots) && v.shots.length <= 12 && typeof v.burnSubtitles === 'boolean' && typeof v.keepAudio === 'boolean', '视频规格无效。');
  const ids = new Set();
  for (const s of v.shots) {
    check(s && id(s.id) && !ids.has(s.id) && Number.isInteger(s.duration) && s.duration >= 2 && s.duration <= 10 && ['title','visual','camera','narration','subtitle','revision'].every(k => text(s[k])) && (s.referenceAssetId === undefined || id(s.referenceAssetId)), '每个镜头需要完整描述和 2–10 秒整数时长。');
    ids.add(s.id);
    check((s.prompt === undefined || text(s.prompt,100000)) && (s.promptBasis === undefined || text(s.promptBasis,500000)), '镜头提示词或生成依据无效。');
    for (const k of ['clip','audio']) if (s[k] !== undefined) check(outputId(s[k]?.fileId) && s[k].fileId.endsWith(k === 'clip' ? '.mp4' : '.wav') && Number.isFinite(s[k].duration) && text(s[k].source || '', 500000), '镜头文件记录无效。');
  }
  if (v.music) check(outputId(v.music.fileId) && v.music.fileId.endsWith('.wav') && Number.isFinite(v.music.duration), '配乐文件无效。');
  if (v.final) check(outputId(v.final.fileId) && v.final.fileId.endsWith('.mp4') && outputId(v.final.subtitleFileId) && v.final.subtitleFileId.endsWith('.srt') && text(v.final.source, 500000), '视频成品记录无效。');
  return v;
}
export function validateSite(spec, assetIds) {
  check(spec && text(spec.title, 200) && spec.title.trim() && text(spec.description) && /^#[a-fA-F0-9]{6}$/.test(spec.accent) && ['paper','night'].includes(spec.theme) && Array.isArray(spec.pages) && spec.pages.length >= 1 && spec.pages.length <= 5 && Array.isArray(spec.limitations) && spec.limitations.length <= 10 && spec.limitations.every(t => text(t)), '网站需包含 1–5 个页面、主题与交付范围。');
  const ids = new Set();
  for (const p of spec.pages) {
    check(p && id(p.id) && !ids.has(p.id) && text(p.title, 100) && p.title.trim() && text(p.intro) && Array.isArray(p.sections) && p.sections.length >= 1 && p.sections.length <= 12, '网站页面结构无效。'); ids.add(p.id);
    for (const s of p.sections) {
      check(s && ['text','gallery','faq'].includes(s.kind) && text(s.title, 200) && text(s.body) && Array.isArray(s.items) && s.items.length <= 20, '网站内容区格式无效。');
      for (const item of s.items) check(item && text(item.title, 200) && text(item.text) && text(item.tag, 100) && (item.assetId === undefined || (id(item.assetId) && (!assetIds || assetIds.has(item.assetId)))), '网站素材或内容无效；只能引用项目中已有的图片。');
    }
  }
  check(JSON.stringify(spec).length <= 120000, '网站内容过长。'); return spec;
}
export function validateWebsite(site, assetIds) {
  validateSite(site.spec, assetIds);
  if (site.builtSpec) validateSite(site.builtSpec, assetIds);
  for (const [key, ext] of [['previewFileId','.html'],['zipFileId','.zip']]) if (site[key] !== undefined) check(outputId(site[key]) && site[key].endsWith(ext), '网站文件记录无效。');
  return site;
}
export function validateWebsitePrompt(request, assetIds) {
  check(request && text(request.prompt,100000) && text(request.basis,500000) && Array.isArray(request.assetIds) && request.assetIds.length<=100 && new Set(request.assetIds).size===request.assetIds.length && request.assetIds.every(a=>id(a)&&(!assetIds||assetIds.has(a))), '网站提示词或允许使用的素材无效。');
  check((request.bundleFileId===undefined || (outputId(request.bundleFileId)&&request.bundleFileId.endsWith('.zip'))) && (request.source===undefined||text(request.source,500000)) && (request.taskId===undefined||id(request.taskId)), '网站任务包记录无效。');
  return request;
}
export function projectOutputIds(p) {
  const own=q=>[...(q.video?.shots || []).flatMap(s => [s.clip?.fileId,s.audio?.fileId]),q.video?.music?.fileId,q.video?.final?.fileId,q.video?.final?.subtitleFileId,q.website?.previewFileId,q.website?.zipFileId,q.websiteRequest?.bundleFileId,q.websiteSource?.fileId,q.websiteSourceCandidate?.fileId,q.designPackage?.fileId];
  const history=(p.flow?.records||[]).flatMap(r=>['websiteSource','designPackage','videoFinal'].includes(r.target)?[r.value?.fileId,r.value?.subtitleFileId]:r.target==='websiteRequest'?[r.value?.bundleFileId]:r.target.startsWith('shot:')?[r.value?.clip?.fileId,r.value?.audio?.fileId]:[]);
  return [...new Set([...own(p),...Object.values(p.variants||{}).flatMap(own),...history].filter(Boolean))];
}
// Old signatures remain readable for historical records; current callers include the project.
export function shotSource(s, ratio, project) {
  if (!project) return JSON.stringify([ratio,s.id,s.title,s.visual,s.camera,s.duration,s.referenceAssetId || '',s.revision]);
  return JSON.stringify(['video-v2',ratio,s.id,videoPromptBasis(project,s),finalVideoPrompt(project,s),project.assets.find(a=>a.id===s.referenceAssetId)?.fileId || '']);
}
export function audioSource(s, project) { return JSON.stringify(project ? ['audio-v2',s.id,s.narration,s.duration,project.content.video.voiceover || '自然叙述'] : [s.id,s.narration]); }
export function composeSource(v, project) { return JSON.stringify([v.ratio,v.burnSubtitles,v.keepAudio,v.music || null,v.shots.map(s => [shotSource(s,v.ratio,project),s.clip || null,s.audio || null,s.narration,s.subtitle,...(project?[audioSource(s,project)]:[])])]); }
