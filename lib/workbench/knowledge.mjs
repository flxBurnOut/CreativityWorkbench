import lingnan from '../../workbench/knowledge/lingnan-2026-09-09.mjs';
import latest from '../../workbench/knowledge/lingnan-2026-09-10.mjs';

// Keep published versions here so project backups retain their original evidence.
export const knowledgePacks = [lingnan,latest];
export const currentKnowledge = latest;
/** @param {unknown} refs @returns {{id:string;version:string}[]} */
export function validateKnowledge(refs = []) {
  if (!Array.isArray(refs) || refs.length > 12) throw new Error('一个项目最多选择 12 条文化资料。');
  const seen = new Set();
  for (const ref of refs) {
    if (!ref || Object.keys(ref).some(k => !['id','version'].includes(k)) || typeof ref.id !== 'string' || typeof ref.version !== 'string' || seen.has(ref.id) || !knowledgePacks.some(pack => pack.version === ref.version && pack.entries.some(e => e.id === ref.id))) throw new Error('文化资料引用无效或版本不可用；请使用包含该知识版本的工作台，不覆盖原项目。');
    seen.add(ref.id);
  }
  return refs;
}
/** @returns {(typeof lingnan.entries[number] & {version:string})[]} */
export function selectedKnowledge(project) {
  return validateKnowledge(project.knowledge).map(ref => ({ ...knowledgePacks.find(p => p.version === ref.version).entries.find(e => e.id === ref.id), version: ref.version }));
}
export function applyKnowledge(project, entryIds, mode = 'add') {
  if (!['add','remove','replace'].includes(mode) || !Array.isArray(entryIds) || new Set(entryIds).size !== entryIds.length) throw new Error('文化资料选择无效。');
  if (entryIds.some(id => !currentKnowledge.entries.some(e => e.id === id) && !(mode === 'remove' && project.knowledge?.some(e => e.id === id)))) throw new Error('找不到指定文化条目，请先搜索知识库。');
  const before = validateKnowledge(project.knowledge);
  const kept = mode === 'replace' ? [] : before.filter(ref => !entryIds.includes(ref.id) || mode === 'add');
  const added = mode === 'remove' ? [] : entryIds.filter(id => !kept.some(ref => ref.id === id)).map(id => ({id, version:currentKnowledge.version}));
  return { ...project, knowledge: validateKnowledge([...kept, ...added]) };
}
export function searchKnowledge(query = '', region = '') {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return { version:currentKnowledge.version, scope:currentKnowledge.scope, entries:currentKnowledge.entries.filter(e => (!region || e.region === region) && words.every(word => [e.title,e.region,e.category,...e.tags,...e.facts.map(f=>f.text)].join(' ').toLocaleLowerCase().includes(word))) };
}
export function knowledgeText(project) {
  const entries = selectedKnowledge(project);
  if (!entries.length) return '';
  return ['## 已选文化资料（有来源的事实与创作建议分别列出）', '本资料独立于游戏设定，仅使用与本作品有关的内容。转译建议不是文化事实，不要求将所有元素堆进作品。引用知识介绍时保留出处；故事情节与新设计注明原创或虚构。', ...entries.map(e => [
    `### ${e.title} · ${e.region} · ${e.version}`,
    ...e.facts.map(f => { const s=e.sources.find(s=>s.id===f.sourceId);return `- 事实摘要：${f.text} [${s.title}](${s.url})`; }),
    `- 创作建议（项目整理）：${e.creativeUses.join('；')}`,
    `- 使用边界：${e.avoid.join('；')}`,
    `- 媒体状态：${e.mediaRights}`,
    ...e.sources.map(s=>`- 来源：${s.publisher}；核对日期 ${s.accessedAt}；定位：${s.evidence}`),
  ].join('\n'))].join('\n\n');
}

// Visual providers need concise scene facts; the task inputManifest retains full sources.
export function visualKnowledge(project) {
  const entries=selectedKnowledge(project);
  return entries.length ? '选定文化事实（仅取本镜头相关内容）：\n'+entries.map(e=>`${e.title}〔${e.region}〕：${e.facts.map(f=>f.text).join('')}`).join('\n') : '';
}
