// Shared by persistence, generation and the browser. No server dependencies.
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
export function projectOutputIds(p) {
  return [...new Set([...(p.video?.shots || []).flatMap(s => [s.clip?.fileId,s.audio?.fileId]),p.video?.music?.fileId,p.video?.final?.fileId,p.video?.final?.subtitleFileId,p.website?.previewFileId,p.website?.zipFileId].filter(Boolean))];
}
export function shotSource(s, ratio) { return JSON.stringify([ratio,s.id,s.title,s.visual,s.camera,s.duration,s.referenceAssetId || '',s.revision]); }
export function audioSource(s) { return JSON.stringify([s.id,s.narration]); }
export function composeSource(v) { return JSON.stringify([v.ratio,v.burnSubtitles,v.keepAudio,v.music || null,v.shots.map(s => [shotSource(s,v.ratio),s.clip || null,s.audio || null,s.narration,s.subtitle])]); }
