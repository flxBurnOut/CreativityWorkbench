import {taskSource,sameTaskSource} from './task-contract.mjs';
import {recordChanges} from './workflow.mjs';

export function taskWorkType(task) {
  if(task.workType||task.snapshot?.type)return task.workType||task.snapshot.type;
  try{return JSON.parse(task.source)[1];}catch{return undefined;}
}
const matchesProject=(p,t)=>t.projectId===p.id&&taskWorkType(t)===p.type;
const sameAsset=(p,id,asset)=>Boolean(id&&asset&&(id===asset.id||asset.fileId&&p.assets.find(a=>a.id===id)?.fileId===asset.fileId));
export function imageBinding(p,task) {
  if(!matchesProject(p,task)||task.kind!=='image'||!task.result?.asset)return 'unbound';
  const c=p.concepts.find(c=>c.id===task.args.objectId),asset=task.result.asset;
  if(sameAsset(p,c?.savedAssetId,asset))return 'selected';
  if(sameAsset(p,c?.candidateAssetId,asset))return 'candidate';
  return 'unbound';
}
export function imageOriginal(p,task) {
  let original;
  try{original=JSON.parse(task.source)[3];}catch{ /* Legacy metadata may be absent. */ }
  const id=task.result?.asset?.source?.parentAssetId||task.provenance?.parentAssetId||original?.candidateAssetId||original?.savedAssetId;
  return p.assets.find(a=>a.id===id);
}
// Adoption writes candidate IDs/prompt/review itself. Only reverse those exact
// self-writes for validation; preserve genuinely changed inputs or another image.
export function imageInputsMatch(p,task) {
  if(!matchesProject(p,task)||task.kind!=='image')return false;
  if(sameTaskSource(taskSource(p,task.kind,task.args),task.source))return true;
  if(imageBinding(p,task)==='unbound')return false;
  let original;try{original=JSON.parse(task.source)[3];}catch{return false;}
  if(!original||typeof original!=='object')return false;
  const asset=task.result.asset;
  const concepts=p.concepts.map(c=>{
    if(c.id!==task.args.objectId)return c;
    const next={...c};
    for(const key of ['candidateAssetId','savedAssetId'])if(sameAsset(p,c[key],asset))next[key]=original[key];
    if(c.prompt===asset.source?.prompt)next.prompt=original.prompt;
    if(sameAsset(p,c.imageReview?.assetId,asset))next.imageReview=original.imageReview;
    return next;
  });
  return sameTaskSource(taskSource({...p,concepts},task.kind,task.args),task.source);
}
export function imageResultState(p,task) {
  const binding=imageBinding(p,task);
  const ready=task.status==='succeeded'&&Boolean(task.result?.asset)&&matchesProject(p,task)&&task.kind==='image';
  const stale=ready&&!imageInputsMatch(p,task);
  return {binding,ready,stale,canSelect:ready&&!stale,bindingLabel:binding==='selected'?'已选用':binding==='candidate'?'已放入候选':ready?'新结果待选用':'等待结果'};
}
/** @param {import('../../features/projects/model').Project} p @param {import('../../features/creative-flow/task-results').GenerationTask[]} tasks @returns {Record<string,{task:import('../../features/creative-flow/task-results').GenerationTask;asset:import('../../features/projects/model').ImageAsset;binding:string;stale:boolean}>} */
export function latestImageResults(p,tasks) {
  const results={},settled=new Set();
  for(const task of [...tasks].sort((a,b)=>b.createdAt-a.createdAt)) {
    if(task.kind!=='image'||!matchesProject(p,task)||task.status!=='succeeded'||!task.result?.asset||task.supersededBy)continue;
    const id=String(task.args.objectId);if(!p.concepts.some(c=>c.id===id)||results[id]||settled.has(id))continue;
    const state=imageResultState(p,task);
    // A newer chosen result takes priority over older unused attempts. Those
    // attempts remain available in the task panel instead of replacing the card.
    if(state.binding==='selected'){settled.add(id);continue;}
    if(task.dismissed&&state.binding!=='candidate')continue;
    results[id]={task,asset:task.result.asset,...state};
  }
  return results;
}
/** @param {import('../../features/projects/model').Project} p @param {{objectId:string;task?:import('../../features/creative-flow/task-results').GenerationTask;assetId?:string;review?:import('../../features/projects/model').ImageReview}} input @returns {import('../../features/projects/model').Project} */
export function selectImageResult(p,{objectId,task,assetId,review}) {
  const concept=p.concepts.find(c=>c.id===objectId);
  if(!concept)throw new Error('图片对应的对象已不存在，请先同步项目。');
  if(task&&(task.args.objectId!==objectId||!imageResultState(p,task).canSelect))throw new Error('生成依据已改变或图片尚未成功，未替换当前选用图。请核对对象、原图和修改要求。');
  const asset=task?.result?.asset||p.assets.find(a=>a.id===assetId);
  if(!asset?.fileId)throw new Error('图片文件尚未保存，未改变选用状态。');
  const existing=p.assets.find(a=>a.id===asset.id);
  if(existing&&existing.fileId!==asset.fileId)throw new Error('素材标识与任务文件不一致，未覆盖已有图片。');
  const parent=task?imageOriginal(p,task):p.assets.find(a=>a.id===asset.source?.parentAssetId);
  if(asset.source?.parentAssetId||task?.args.action==='edit') {
    if(!parent||!review||review.assetId!==asset.id||review.parentAssetId!==parent.id||!review.changesVisible||!review.preserved||!review.notes?.trim())throw new Error('请先对比原图，记录可见变化与保留情况，再选用修改图。');
  }
  if(sameAsset(p,concept.savedAssetId,asset)&&concept.candidateAssetId!==asset.id)return p;
  const next={...p,assets:[...p.assets.filter(a=>a.id!==asset.id),asset],concepts:p.concepts.map(c=>c.id===objectId?{...c,candidateAssetId:asset.id,savedAssetId:asset.id,prompt:asset.source?.prompt||c.prompt,imageReview:review}:c),
    coverAssetId:!p.manualCover&&(!p.coverAssetId||p.coverAssetId===concept.savedAssetId)?asset.id:p.coverAssetId};
  return recordChanges(p,next,{origin:task?'generated':'manual',taskId:task?.id});
}
