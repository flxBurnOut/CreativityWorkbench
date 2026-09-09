import { validateWebsiteVerification } from './website-verification.mjs';
import { knowledgeText } from './knowledge.mjs';
// Browser-safe workflow state. Cultural/system rules remain in prompts.mjs.
export const FLOW_TYPES = ['undecided','novel','video','website','craft'];
export const BRANCH_FIELDS = ['brief','art','references','concepts','delivery','requests','novel','novelReferenceIds','video','website','websiteRequest','websiteSource','websiteSourceCandidate','designPackage','transfer'];
const copy = value => value === undefined ? undefined : structuredClone(value);
const emptyBranch = () => ({brief:'',art:{direction:'',material:'',palette:'',constraints:'',fullPrompt:''},references:[],concepts:[],delivery:{notes:'',textFormat:'md',ratio:'16:9',duration:''},requests:['','','','','']});
const owner={novel:'novel',novelReferenceIds:'novel',video:'video',website:'website',websiteRequest:'website',websiteSource:'website',websiteSourceCandidate:'website'};
export function branchOf(p) { return Object.fromEntries(BRANCH_FIELDS.filter(k=>p[k]!==undefined&&(!owner[k]||owner[k]===p.type)).map(k=>[k,copy(p[k])])); }
/** @param {import('../../features/projects/model').Project} p @returns {import('../../features/projects/model').Project} */
export function projectForType(p,type) {
  if(type===p.type)return p;
  const next={...p,type};for(const key of BRANCH_FIELDS)delete next[key];
  const legacy=Object.fromEntries(Object.entries(owner).filter(([k,t])=>t===type&&p[k]!==undefined).map(([k])=>[k,copy(p[k])]));
  return {...next,...emptyBranch(),...legacy,...p.variants?.[type]};
}
export function switchWorkType(p,type) {
  if(!FLOW_TYPES.includes(type))throw new Error('作品类型无效。');
  if(type===p.type)return p;
  const variants={...p.variants,[p.type]:branchOf(p)};
  for(const other of FLOW_TYPES)if(other!==p.type&&!variants[other]) {
    const fields=Object.entries(owner).filter(([k,t])=>t===other&&p[k]!==undefined);
    if(fields.length)variants[other]={...emptyBranch(),...Object.fromEntries(fields.map(([k])=>[k,copy(p[k])]))};
  }
  const next=projectForType({...p,variants},type);
  return {...next,variants,upstreamChanged:false};
}
/** @param {import('../../features/projects/model').Project} p @param {string} from @param {{brief?:boolean,content?:boolean,art?:boolean,conceptIds?:string[]}} options @returns {import('../../features/projects/model').Project} */
export function inheritWorkType(p,from,{brief=true,content=true,art=false,conceptIds=[]}={}) {
  if(!FLOW_TYPES.includes(from)||from===p.type)throw new Error('请选择另一类型的已有草稿。');
  const source=projectForType(p,from);
  const selected=source.concepts.filter(c=>conceptIds.includes(c.id));
  // New object IDs avoid accidentally binding tasks from another type.
  const concepts=selected.map(c=>({...copy(c),id:p.concepts.find(o=>o.inheritedFrom?.type===from&&o.inheritedFrom?.id===c.id)?.id||crypto.randomUUID(),candidateAssetId:undefined,sourceKeys:[],referenceAssetIds:[],inheritedFrom:{type:from,id:c.id}}));
  return {...p,...(brief?{brief:source.brief}:{}),...(art?{art:copy(source.art),references:copy(source.references)}:{}),concepts:[...p.concepts.filter(c=>!concepts.some(o=>o.id===c.id)),...concepts],
    transfer:content?{from,content:copy(p.content[from]),source:fingerprint(p.content[from]),note:'用户选择的类型转入资料；需要适配当前作品类型，不直接替换专属小节。'}:p.transfer};
}
function stable(value) {
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,stable(value[k])]));
  return value;
}
// Change detection only; security/file identity continues to use SHA-256 at the repository boundary.
export function fingerprint(value) {
  const s=JSON.stringify(stable(value))??'null';let a=2166136261,b=2246822519;
  for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b^s.charCodeAt(i),3266489917);}
  return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
export const conceptValue=c=>c?{name:c.name,category:c.category,description:c.description,usage:c.usage||'',sourceKeys:c.sourceKeys||[]}:null;
export function sourceValue(p,key) {
  if(key==='knowledge')return knowledgeText(p);
  const [kind,id]=key.split(':');
  if(kind==='content')return p.content[p.type]?.[id]||'';
  if(kind==='concept')return conceptValue(p.concepts.find(c=>c.id===id));
  if(kind==='image'){const a=p.assets.find(a=>a.id===id);return a?.fileId||null;}
  if(kind==='reference')return p.references.find(r=>r.id===id)||null;
  if(kind==='shot'){const s=p.video?.shots.find(s=>s.id===id);if(!s)return null;const {clip:_clip,audio:_audio,frameCandidate:_frame,...inputs}=s;return inputs;}
  if(kind==='audio'){const s=p.video?.shots.find(s=>s.id===id);return s?{narration:s.narration,duration:s.duration}:null;}
  if(kind==='frame'){const s=p.video?.shots.find(s=>s.id===id);return s?{visual:s.visual,frameInstruction:s.frameInstruction,frameReferenceIds:s.frameReferenceIds,conceptIds:s.conceptIds,contentKeys:s.contentKeys}:null;}
  if(key==='videoRatio')return p.video?.ratio||'16:9';
  if(kind==='clip'||kind==='audioFile')return p.video?.shots.find(s=>s.id===id)?.[kind==='clip'?'clip':'audio']||null;
  if(key==='videoSettings')return p.video?{ratio:p.video.ratio,burnSubtitles:p.video.burnSubtitles,keepAudio:p.video.keepAudio,music:p.video.music}:null;
  if(key==='websiteSource')return p.websiteSource?{fileId:p.websiteSource.fileId,description:p.websiteSource.description,instructions:p.websiteSource.instructions,verification:p.websiteSource.verification}:null;
  return p[key]??null;
}
const contentLabels={story:'故事梗概',characters:'人物与关系',world:'背景设定',chapters:'章节与结局',voice:'叙事与语言',script:'视频脚本',shots:'场景与镜头',voiceover:'旁白与对白',spec:'节奏与规格',goal:'目标与受众',pages:'页面与导航',copy:'必要文案',behavior:'交互与交付',theme:'主题与形体',motifs:'文化依据',display:'使用与展示',overview:'内容概述',keep:'保留与排除'};
export function sourceLabel(p,key) {
  const [kind,id]=key.split(':');
  if(kind==='content')return contentLabels[id]||id;
  if(kind==='concept')return p.concepts.find(c=>c.id===id)?.name||'已移除对象';
  if(kind==='image')return p.assets.find(a=>a.id===id)?.name||'已移除图片';
  if(kind==='reference')return '参考用途';
  if(['shot','frame','audio','clip','audioFile'].includes(kind))return (p.video?.shots.find(s=>s.id===id)?.title||'镜头')+' · '+{shot:'镜头要求',frame:'首帧要求',audio:'旁白要求',clip:'视频片段',audioFile:'音频文件'}[kind];
  return {idea:'原始创意',title:'项目名称',brief:'创意方案',knowledge:'已选文化资料',culture:'文化背景',art:'美术规范',novel:'当前正文',delivery:'交付要求',websiteSource:'已采用网站源码',websiteRequest:'网站任务包',designPackage:'设计资料包',videoFinal:'视频成品',videoRatio:'视频画幅',videoSettings:'视频合成设置',transfer:'类型转入资料'}[key]||key;
}
export function objectSourceKeys(p,c) {
  if(c?.sourceKeys?.length)return c.sourceKeys.map(k=>'content:'+k);
  const mapping={novel:c?.category==='character'?['characters']:c?.category==='map'?['world']:['world','story'],video:['script','shots'],website:['goal','pages'],craft:['theme','motifs'],undecided:['overview','keep']};
  return (mapping[p.type]||[]).filter(k=>p.content[p.type]?.[k]).map(k=>'content:'+k);
}
/** @param {import('../../features/projects/model').Project} p */
export function selectedNovelConcepts(p) {
  const ids=p.novelReferenceIds??p.concepts.filter(c=>c.savedAssetId).map(c=>c.id);
  return p.concepts.filter(c=>ids.includes(c.id));
}
export function relatedShotConcepts(p,s) {
  return p.concepts.filter(c=>(s?.conceptIds||[]).includes(c.id)||Boolean(c.savedAssetId&&(c.savedAssetId===s?.referenceAssetId||(s?.frameReferenceIds||[]).includes(c.savedAssetId))));
}
export function relatedShotContext(p,s) {
  return {content:Object.fromEntries((s?.contentKeys||[]).filter(k=>Object.hasOwn(p.content.video,k)).map(k=>[k,p.content.video[k]])),objects:relatedShotConcepts(p,s).map(conceptValue)};
}
export function imageInputIds(p,args,kind='image') {
  const c=p.concepts.find(c=>c.id===args.objectId);
  const s=p.video?.shots.find(s=>s.id===args.objectId);
  if(kind==='video-frame')return [...new Set([...(args.action==='edit'&&s?.referenceAssetId?[s.referenceAssetId]:[]),...(s?.frameReferenceIds||[]),...p.references.map(r=>r.assetId)])];
  return [...new Set([...(kind==='image'&&args.action==='edit'?[c?.candidateAssetId??c?.savedAssetId].filter(Boolean):[]),...p.references.map(r=>r.assetId),...(kind==='image'?c?.referenceAssetIds||[]:[])])];
}
export function inputKeys(p,kind,args={}) {
  const content=Object.keys(p.content[p.type]||{}).filter(k=>p.content[p.type][k]).map(k=>'content:'+k);
  const base=['idea','brief','culture','knowledge'];const c=p.concepts.find(c=>c.id===args.objectId);const s=p.video?.shots.find(s=>s.id===args.objectId);
  if(kind==='creative')return ['idea','brief','culture','knowledge'];
  if(kind==='content')return [...base,...content,...(p.transfer?['transfer']:[]),...(args.fromNovel?['novel']:[])];
  if(kind==='objects')return [...base,...content,...p.concepts.map(c=>'concept:'+c.id)];
  if(kind==='art')return [...base,...content,'art',...p.references.map(r=>'reference:'+r.id)];
  if(kind==='novel')return [...base,...content,...selectedNovelConcepts(p).map(c=>'concept:'+c.id),'novel','delivery'];
  if(kind==='image'||kind==='cover')return [...base,...(c?['concept:'+c.id,...objectSourceKeys(p,c)]:[]),'art',...p.references.map(r=>'reference:'+r.id),...imageInputIds(p,args,kind).map(id=>'image:'+id)];
  if(kind==='video-shot'||kind==='video-frame')return [p.culture?'culture':p.brief?'brief':'idea','knowledge','art','videoRatio',...(s?.contentKeys||[]).map(k=>'content:'+k),...relatedShotConcepts(p,s).map(c=>'concept:'+c.id),...(s?[(kind==='video-frame'?'frame:':'shot:')+s.id]:[]),...(kind==='video-frame'?imageInputIds(p,args,kind):s?.referenceAssetId?[s.referenceAssetId]:[]).map(id=>'image:'+id)];
  if(kind==='video-audio')return ['audio:'+args.objectId,'content:voiceover'];
  if(kind==='video-compose')return ['videoSettings',...(p.video?.shots||[]).flatMap(s=>['shot:'+s.id,'clip:'+s.id,'audio:'+s.id,'audioFile:'+s.id])];
  if(kind==='website'||kind==='design-package')return ['title',...base,...content,'art','delivery',...(p.type==='website'&&p.websiteSource?['websiteSource']:[]),...p.concepts.filter(c=>c.savedAssetId).map(c=>'concept:'+c.id),...p.references.map(r=>'reference:'+r.id),...p.assets.filter(a=>(p.websiteRequest?.assetIds??p.concepts.map(c=>c.savedAssetId)).includes(a.id)||p.references.some(r=>r.assetId===a.id)).map(a=>'image:'+a.id)];
  return base;
}
export function workflowInputs(p,kind,args={}) {
  const keys=[...new Set(inputKeys(p,kind,args))];
  return keys.map(key=>({key,label:sourceLabel(p,key),value:sourceValue(p,key),fingerprint:fingerprint(sourceValue(p,key)),role:key.startsWith('image:')?'attached-image':'text'}));
}
export const dependencySnapshot=(p,keys)=>[...new Set(keys)].map(key=>({key,label:sourceLabel(p,key),fingerprint:fingerprint(sourceValue(p,key))}));
export function changedDependencies(p,record) { return (record?.dependencies||[]).filter(d=>fingerprint(sourceValue(p,d.key))!==d.fingerprint); }

function targets(p) {
  return [{key:'brief',kind:'creative',value:p.brief},{key:'art',kind:'art',value:p.art},...Object.entries(p.content[p.type]||{}).map(([k,value])=>({key:'content:'+k,kind:'content',value})),
    ...p.concepts.map(c=>({key:'concept:'+c.id,kind:'objects',value:copy(c),args:{objectId:c.id}})),
    ...(p.novel?[{key:'novel',kind:'novel',value:p.novel}]:[]),
    ...(p.video?.shots||[]).map(s=>({key:'shot:'+s.id,kind:'video-shot',value:s,args:{objectId:s.id}})),
    ...(p.websiteSource?[{key:'websiteSource',kind:'website',value:p.websiteSource}]:[]),
    ...(p.websiteRequest?.bundleFileId?[{key:'websiteRequest',kind:'website',value:p.websiteRequest}]:[]),
    ...(p.designPackage?[{key:'designPackage',kind:'design-package',value:p.designPackage}]:[]),
    ...(p.video?.final?[{key:'videoFinal',kind:'video-compose',value:p.video.final}]:[])];
}
export function recordChanges(before,after,meta={}) {
  if(!before)return after;
  // Type switches restore their own branch; they are not newly authored outputs.
  const prior=before.type===after.type?before:projectForType(before,after.type);
  const old=targets(prior);let records=[...new Map([...(before.flow?.records||[]),...(after.flow?.records||[])].map(r=>[r.id,r])).values()];
  const present=targets(after);
  for(const previous of old)if(!present.some(t=>t.key===previous.key)&&!records.some(r=>r.type===after.type&&r.target===previous.key))records.push({id:crypto.randomUUID(),type:after.type,target:previous.key,createdAt:Date.now(),origin:'legacy',fingerprint:fingerprint(previous.value),value:copy(previous.value),dependencies:[]});
  for(const t of present) {
    const previous=old.find(o=>o.key===t.key);
    if(fingerprint(previous?.value)===fingerprint(t.value))continue;
    // A task adoption may already have recorded this exact result.
    const last=records.findLast(r=>r.type===after.type&&r.target===t.key);
    if(last&&last.fingerprint===fingerprint(t.value))continue;
    if(previous&&!records.some(r=>r.type===after.type&&r.target===t.key))records.push({id:crypto.randomUUID(),type:after.type,target:t.key,createdAt:Date.now(),origin:'legacy',fingerprint:fingerprint(previous.value),value:copy(previous.value),dependencies:[]});
    const keys=inputKeys(after,t.kind,t.args).filter(k=>k!==t.key&&!k.startsWith('image:'));
    // Object extraction depends on its source content, not unrelated object edits.
    const deps=t.key.startsWith('concept:')?['culture','knowledge',...objectSourceKeys(after,t.value)]:keys;
    records.push({id:crypto.randomUUID(),type:after.type,target:t.key,createdAt:Date.now(),origin:meta.origin||'manual',taskId:meta.taskId,fingerprint:fingerprint(t.value),value:copy(t.value),dependencies:copy(meta.dependencies??dependencySnapshot(meta.snapshot||after,deps))});
  }
  if(!records.length)return after;
  const retained=new Set(records.flatMap(r=>r.target.startsWith('concept:')?[r.value?.savedAssetId,r.value?.candidateAssetId,...(r.value?.referenceAssetIds||[])]:r.target.startsWith('shot:')?[r.value?.referenceAssetId,r.value?.frameCandidate,...(r.value?.frameReferenceIds||[])]:[]));
  const assets=[...after.assets,...before.assets.filter(a=>retained.has(a.id)&&!after.assets.some(n=>n.id===a.id))];
  return {...after,assets,flow:{version:1,records}};
}
export function latestRecord(p,target) { return p.flow?.records?.findLast(r=>r.type===p.type&&r.target===target); }
export function restoreRecord(p,id) {
  const r=p.flow?.records?.find(r=>r.id===id&&r.type===p.type);if(!r)throw new Error('版本不存在。');
  const [kind,key]=r.target.split(':');let next={...p};
  if(kind==='content')next.content={...p.content,[p.type]:{...p.content[p.type],[key]:copy(r.value)}};
  else if(kind==='concept')next.concepts=p.concepts.some(c=>c.id===key)?p.concepts.map(c=>c.id===key?copy(r.value):c):[...p.concepts,copy(r.value)];
  else if(kind==='shot'){if(!p.video)throw new Error('请先恢复视频草稿。');next.video={...p.video,shots:p.video.shots.some(s=>s.id===key)?p.video.shots.map(s=>s.id===key?copy(r.value):s):[...p.video.shots,copy(r.value)]};}
  else if(kind==='videoFinal'){if(!p.video)throw new Error('请先恢复视频草稿。');next.video={...p.video,final:copy(r.value)};}
  else if(['brief','art','novel','websiteSource','websiteRequest','designPackage'].includes(kind))next[kind]=copy(r.value);
  else throw new Error('此版本不能直接恢复。');
  return recordChanges(p,next,{origin:'restore',dependencies:r.dependencies});
}
/** @returns {{target:string,origin:string,changes:import('../../features/projects/model').FlowRecord['dependencies']}[]} */
export function flowWarnings(p) {
  const current=new Set(targets(p).map(t=>t.key));
  const records=new Map();for(const r of p.flow?.records||[])if(r.type===p.type&&current.has(r.target))records.set(r.target,r);
  const selected=new Set([...p.concepts.map(c=>c.savedAssetId),...(p.video?.shots||[]).map(s=>s.referenceAssetId)]);
  const images=p.assets.filter(a=>selected.has(a.id)).map(a=>({target:'image:'+a.id,origin:'generated',changes:assetChanges(p,a)}));
  return [...[...records.values()].map(r=>({target:r.target,origin:r.origin,changes:changedDependencies(p,r)})),...images].filter(r=>r.changes.length);
}
/** @returns {import('../../features/projects/model').FlowRecord['dependencies']} */
export function assetChanges(p,asset) {try{return changedDependencies(p,{dependencies:JSON.parse(asset?.source?.inputs||'[]')});}catch{return [];}}
export function validateFlowState(p) {
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  const list=(v,max=100)=>Array.isArray(v)&&v.length<=max&&v.every(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(id));
  if(p.flow)check(p.flow.version===1&&Array.isArray(p.flow.records)&&p.flow.records.length<=3000&&p.flow.records.every(r=>r&&typeof r.id==='string'&&FLOW_TYPES.includes(r.type)&&/^(brief|art|novel|websiteSource|websiteRequest|designPackage|videoFinal|content:[a-z]+|concept:[a-zA-Z0-9_-]+|shot:[a-zA-Z0-9_-]+)$/.test(r.target)&&Number.isFinite(r.createdAt)&&typeof r.origin==='string'&&typeof r.fingerprint==='string'&&Array.isArray(r.dependencies)&&r.dependencies.length<=500&&r.dependencies.every(d=>typeof d.key==='string'&&typeof d.label==='string'&&typeof d.fingerprint==='string')),'成果版本记录无效或超过 3000 条，请保留并导出项目。');
  if(p.transfer)check(FLOW_TYPES.includes(p.transfer.from)&&p.transfer.content&&Object.values(p.transfer.content).every(v=>typeof v==='string')&&typeof p.transfer.source==='string','类型转入资料无效。');
  if(p.novelReferenceIds)check(list(p.novelReferenceIds),'正文对象引用无效。');
  for(const c of p.concepts||[]) {
    if(c.sourceKeys)check(list(c.sourceKeys)&&c.sourceKeys.every(k=>Object.hasOwn(p.content[p.type],k)),'对象的内容来源无效。');
    if(c.referenceAssetIds)check(list(c.referenceAssetIds)&&c.referenceAssetIds.every(id=>p.assets.some(a=>a.id===id)),'对象参考图片不存在。');
    if(c.usage!==undefined)check(typeof c.usage==='string'&&c.usage.length<=4000,'对象用途过长。');
    if(c.imageReview!==undefined){const r=c.imageReview;check(r&&list([r.assetId,r.parentAssetId])&&typeof r.changesVisible==='boolean'&&typeof r.preserved==='boolean'&&typeof r.notes==='string'&&r.notes.length<=4000&&Number.isFinite(r.checkedAt)&&r.checkedAt>=0,'图像对比记录无效。');}
  }
  for(const s of p.video?.shots||[]) {
    if(s.conceptIds)check(list(s.conceptIds)&&s.conceptIds.every(id=>p.concepts.some(c=>c.id===id)),'镜头对象引用无效。');
    if(s.contentKeys)check(list(s.contentKeys)&&s.contentKeys.every(k=>Object.hasOwn(p.content.video,k)),'镜头内容来源无效。');
    if(s.frameReferenceIds)check(list(s.frameReferenceIds)&&s.frameReferenceIds.every(id=>p.assets.some(a=>a.id===id)),'首帧参考图片不存在。');
    if(s.frameCandidate)check(p.assets.some(a=>a.id===s.frameCandidate),'首帧候选不存在。');
    if(s.frameInstruction!==undefined)check(typeof s.frameInstruction==='string'&&s.frameInstruction.length<=4000,'首帧要求过长。');
  }
  for(const source of [p.websiteSource,p.websiteSourceCandidate].filter(Boolean))validateWebsiteVerification(source);
  for(const source of [p.websiteSource,p.websiteSourceCandidate].filter(Boolean))check(/^[a-f0-9]{64}\.zip$/.test(source.fileId)&&Number.isFinite(source.importedAt)&&Number.isInteger(source.entryCount)&&['description','instructions','verification'].every(k=>typeof source[k]==='string'&&source[k].length<=100000)&&(source.previewPath===undefined||typeof source.previewPath==='string'&&source.previewPath.length<=500),'网站源码交付记录无效。');
  if(p.designPackage)check(/^[a-f0-9]{64}\.zip$/.test(p.designPackage.fileId)&&typeof p.designPackage.source==='string'&&typeof p.designPackage.taskId==='string','设计资料包记录无效。');
}
