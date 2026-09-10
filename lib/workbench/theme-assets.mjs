import {themeAssets,themeAssetVersion,themeAssetRights} from '../../workbench/theme-assets/catalog.mjs';
import {applyKnowledge} from './knowledge.mjs';
export {themeAssets,themeAssetVersion};
export function searchThemeAssets(query='') {
  const words=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return {version:themeAssetVersion,rights:themeAssetRights,entries:themeAssets.filter(a=>words.every(w=>[a.name,a.region,a.category,a.description,a.alt,a.usage].join(' ').toLocaleLowerCase().includes(w)))};
}
export function themeAssetRecord(entry,file) {
  return {id:'theme-'+entry.id,name:entry.name,...file,source:{kind:'theme-original-vector',catalogId:entry.id,catalogVersion:entry.version,description:entry.description,rights:entry.rights,usage:entry.usage,alt:entry.alt,region:entry.region,sourceLinks:JSON.stringify(entry.sources),knowledgeIds:JSON.stringify(entry.knowledgeIds)}};
}
/** @param {import('../../features/projects/model').Project} project @param {import('../../features/projects/model').ImageAsset[]} assets @returns {import('../../features/projects/model').Project} */
export function applyThemeAssets(project,assets) {
  const entries=assets.map(a=>themeAssets.find(e=>e.id===a.source?.catalogId));
  if(entries.some(e=>!e)||new Set(assets.map(a=>a.id)).size!==assets.length)throw new Error('主题素材选择无效。');
  let next={...project,assets:[...project.assets.filter(a=>!assets.some(n=>n.id===a.id)),...assets]};
  next=applyKnowledge(next,[...new Set(entries.flatMap(e=>e.knowledgeIds))]);
  const concepts=assets.map(a=>{
    const existing=next.concepts.find(c=>c.id==='theme-object-'+a.source.catalogId);
    return existing?{...existing,savedAssetId:a.id}:{id:'theme-object-'+a.source.catalogId,category:'object',name:a.name,description:a.source.description,prompt:'',revisionRequest:'',usage:a.source.usage,savedAssetId:a.id};
  });
  next={...next,concepts:[...next.concepts.filter(c=>!concepts.some(n=>n.id===c.id)),...concepts]};
  if(next.websiteRequest)next={...next,websiteRequest:{...next.websiteRequest,assetIds:[...new Set([...next.websiteRequest.assetIds,...assets.map(a=>a.id)])]}};
  return next;
}
