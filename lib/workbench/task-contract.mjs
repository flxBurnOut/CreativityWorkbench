import { knowledgeText } from './knowledge.mjs';
import { shotSource, audioSource, composeSource } from './output-contract.mjs';
import { websiteRequestSource, assetRoles, savedConceptIds } from './prompts.mjs';
import { selectedTransfers, workflowInputs, conceptValue, fingerprint } from './workflow.mjs';
export const taskKinds = ['creative','content','art','objects','novel','image','cover','video-frame','video-plan','video-shot','video-audio','video-compose','website','website-build','design-package','craft-model'];
export const contentKeys = {
  undecided: ['overview','keep'], novel: ['story','characters','world','chapters','voice'],
  video: ['script','shots','voiceover','spec'], craft: ['theme','motifs','copy','display'], website: ['goal','pages','copy','behavior'],
};
// Persisted source strings are JSON, not order-sensitive wire protocols. WorkBuddy
// may reorder object keys while preserving every input value.
export function sameTaskSource(a,b) {
  if(a===b)return true;
  try{return fingerprint(JSON.parse(a))===fingerprint(JSON.parse(b));}catch{return false;}
}
export function taskSource(p, kind, args) {
  // Ignore navigation and timestamps; media inputs include their persisted content hashes.
  const common = [p.id, p.type, p.title, p.idea, p.brief, p.culture, knowledgeText(p)];
  if(kind==='craft-model')return JSON.stringify([p.id,p.type,p.craftRequest??null,knowledgeText(p),args]);
  if(kind==='video-frame')return JSON.stringify([p.id,p.type,workflowInputs(p,kind,args),p.video?.ratio,args]);
  if(kind==='design-package')return JSON.stringify([p.id,p.type,workflowInputs(p,kind,args),args]);
  if (kind==='website') return JSON.stringify([p.id,websiteRequestSource(p),args]);
  if (kind==='website-build') return JSON.stringify([...common,p.website?.spec??null,p.assets.map(a=>[a.id,a.fileId]),args]);
  if (kind === 'video-plan') return JSON.stringify([...common,p.content.video,p.art,p.video??null,p.delivery,p.requests[4],assetRoles(p,[...savedConceptIds(p),...(p.video?.shots||[]).map(s=>s.referenceAssetId).filter(Boolean)]),args]);
  if (kind === 'video-compose') return JSON.stringify([p.id,p.video?composeSource(p.video,p):null,args]);
  if (kind === 'video-shot' || kind === 'video-audio') {
    const shot=p.video?.shots.find(s=>s.id===args.objectId);
    return JSON.stringify([p.id,shot?(kind==='video-shot'?shotSource(shot,p.video.ratio,p):audioSource(shot,p)):null,args]);
  }
  if (kind === 'creative') return JSON.stringify([...common, p.requests[0]]);
  if (kind === 'content') return JSON.stringify([...common, p.content[p.type],selectedTransfers(p),args.fromNovel?p.novel:null, args.instruction ?? p.requests[1], args]);
  if (kind === 'novel') return JSON.stringify([p.id,p.type,workflowInputs(p,kind,args),p.requests[4],args]);
  if (kind === 'art') return args.instruction !== undefined
    ? JSON.stringify([...common, p.content[p.type], p.art, args.instruction, args])
    : JSON.stringify([...common, p.content[p.type], p.art, p.references, p.requests[2]]);
  if (kind === 'objects') return JSON.stringify([...common,p.content[p.type],p.concepts.map(c=>({id:c.id,...conceptValue(c)})),p.requests[3],args]);
  const c = p.concepts.find(c => c.id === args.objectId);
  const imageIds=[...p.references.map(r=>r.assetId),...(args.action==='edit'?[c?.candidateAssetId??c?.savedAssetId]:[])];
  return JSON.stringify([p.id,p.type,workflowInputs(p,kind,args),c??null,imageIds.map(id=>[id,p.assets.find(a=>a.id===id)?.fileId||'']), kind === 'cover' ? p.coverAssetId ?? null : null, args]);
}
