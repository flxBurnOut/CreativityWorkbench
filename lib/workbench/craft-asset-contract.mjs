import { normalizeCraftPlan } from './craft-contract.mjs';
import { validateKnowledge } from './knowledge.mjs';

const check=(value,message)=>{if(!value)throw new Error(message);};
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);
const text=(value,max)=>typeof value==='string'&&value.length<=max;
// Metadata only. Mesh buffers belong to immutable files, never workspace JSON.
export function validateCraftState(project) {
  if(project.craftGoal!==undefined)check(text(project.craftGoal,4000),'三维资产需求超过 4000 字。');
  if(project.craftRequest!==undefined) {
    const r=project.craftRequest;
    check(r&&Object.keys(r).every(k=>['goal','taskId','requestedAt'].includes(k))&&id(r.taskId)&&text(r.goal,4000)&&r.goal.trim()&&Number.isFinite(r.requestedAt)&&r.requestedAt>=0,'三维资产任务记录无效。');
  }
  if(project.craftAsset!==undefined)validateCraftAsset(project.craftAsset);
  for(const record of project.flow?.records||[])if(record.target==='craftAsset')validateCraftAsset(record.value);
}
export function validateCraftAsset(asset) {
  check(asset&&Object.keys(asset).every(k=>['taskId','title','kind','prompt','createdAt','blendFileId','glbFileId','plan','stats','warnings','knowledge','texture'].includes(k))&&id(asset.taskId)&&text(asset.title,200)&&text(asset.prompt,4000)&&Number.isFinite(asset.createdAt)&&asset.createdAt>=0,'三维资产记录无效。');
  check(/^[a-f0-9]{64}\.blend$/.test(asset.blendFileId)&&/^[a-f0-9]{64}\.glb$/.test(asset.glbFileId),'三维资产缺少 Blender 或预览文件。');
  const plan=normalizeCraftPlan(asset.plan);
  check(plan.kind===asset.kind&&JSON.stringify(asset.plan).length<=16000,'三维资产建模方案无效。');
  const s=asset.stats;
  check(s&&Object.keys(s).every(k=>['vertices','triangles','objects','materials','dimensions','unit'].includes(k))&&['vertices','triangles','objects','materials'].every(k=>Number.isSafeInteger(s[k])&&s[k]>0&&s[k]<=1000000)&&s.triangles<=40000&&s.objects<=240&&Array.isArray(s.dimensions)&&s.dimensions.length===3&&s.dimensions.every(v=>Number.isFinite(v)&&v>0&&v<=1000)&&s.unit==='m','三维资产规格无效。');
  check(Array.isArray(asset.warnings)&&asset.warnings.length<=30&&asset.warnings.every(v=>text(v,4000)),'三维资产说明无效。');
  validateKnowledge(asset.knowledge);
  if (asset.texture !== undefined) {
    const t = asset.texture;
    check(t && Object.keys(t).every(k => ['sourceTaskId','sourceBlendFileId','sourceGlbFileId','prompt','model','size','geometryHash','method','imageFileId'].includes(k)) && id(t.sourceTaskId) && /^[a-f0-9]{64}\.blend$/.test(t.sourceBlendFileId) && /^[a-f0-9]{64}\.glb$/.test(t.sourceGlbFileId) && text(t.prompt,400) && Array.from(t.prompt).length <= 200 && t.size === 1024 && /^[a-f0-9]{64}$/.test(t.geometryHash), '纹理来源或规格记录无效。');
    if(t.method==='image-wrap')check(text(t.model,200)&&t.model.trim()&&/^[a-f0-9]{64}$/.test(t.imageFileId),'图案生成来源或图片记录无效。');
    else check(t.method===undefined&&t.imageFileId===undefined&&t.model==='hy-3d-texture','纹理生成方式无效。');
  }
  return asset;
}
