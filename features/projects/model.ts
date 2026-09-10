import { createProject } from '../../lib/workbench/project-core.mjs';
import { validateKnowledge } from '../../lib/workbench/knowledge.mjs';
export { createProject };
import { validateVideo, validateWebsite, validateWebsitePrompt } from '../../lib/workbench/output-contract.mjs';
import { switchWorkType, validateFlowState, projectForType, BRANCH_FIELDS } from '../../lib/workbench/workflow.mjs';
export { switchWorkType };
export const WORK_TYPES = ['undecided', 'novel', 'video', 'website', 'craft'] as const;
export type WorkType = typeof WORK_TYPES[number];
export const TYPE_LABELS: Record<WorkType, string> = { undecided: '暂未确定', novel: '小说', video: '视频', website: '网站', craft: '3D 文创' };
export const STAGES = ['创意', '内容', '美术提示词', '概念图', '成品'] as const;
export type Category = 'character' | 'map' | 'object';
export const CATEGORIES: Record<Category, string> = { character: '角色', map: '地图', object: '物件' };
export const CONTENT_SECTIONS: Record<WorkType, { key: string; label: string; hint: string }[]> = {
  undecided: [{ key: 'overview', label: '内容概述', hint: '先写下你想表达的内容，作品形式可以稍后决定。' }, { key: 'keep', label: '保留与排除', hint: '有哪些一定要保留的内容？又有哪些不希望出现？' }],
  novel: [{ key: 'story', label: '故事梗概', hint: '故事从哪里开始？人物经历了什么，又将走向哪里？' }, { key: 'characters', label: '人物与关系', hint: '主要人物的愿望、性格，以及彼此的关系。' }, { key: 'world', label: '背景设定', hint: '记录已确定的地域、时代、生活环境与文化依据。' }, { key: 'chapters', label: '章节与结局', hint: '按章节整理事件，写下结局方向与必须保留的情节。' }, { key: 'voice', label: '叙事与语言', hint: '叙述视角、语言气质、节奏与目标读者。' }],
  video: [{ key: 'script', label: '核心表达与脚本', hint: '这段视频想让观众看到、感受到什么？' }, { key: 'shots', label: '场景与镜头', hint: '按顺序描述场景、景别、画面与转场。' }, { key: 'voiceover', label: '旁白与对白', hint: '写下需要出现的旁白、对白与声音要求。' }, { key: 'spec', label: '节奏与规格', hint: '目标时长、画幅、节奏与必要限制。' }],
  craft: [{ key: 'theme', label: '主题与形体', hint: '文化主题和三维形体是什么？模型开发在最后阶段进行。' }, { key: 'motifs', label: '图案与文化依据', hint: '需要表达的符号、图案和已经确认的文化参考。' }, { key: 'copy', label: '必要文字', hint: '记录需要保留的文字，包括准确的名称与标点。' }, { key: 'display', label: '使用与展示', hint: '使用场景、模型细节、拓扑与预期三维文件要求。' }],
  website: [{ key: 'goal', label: '目标与受众', hint: '网站为谁服务？用户应当能在这里完成什么？' }, { key: 'pages', label: '页面与导航', hint: '列出页面结构、主要内容区和导航关系。' }, { key: 'copy', label: '页面文案', hint: '整理标题、正文、按钮文字与其他必要文案。' }, { key: 'behavior', label: '交互与交付', hint: '明确需要运行的功能，以及源码和运行说明的交付要求。' }],
};

export interface ImageAsset { id: string; name: string; blob?: Blob; demoSrc?: string; fileId?: string; source?: Record<string,string> }
export interface StyleReference { id: string; assetId: string; purpose: string }
export interface MediaValidation { status:'passed'|'failed'|'unverified'; requested:{ratio:string;duration:number}; actual:{width?:number;height?:number;duration:number;displayAspectRatio:number}; issues:string[] }
export interface MediaFile { fileId:string; duration:number; source:string; taskId?:string; width?:number;height?:number;displayAspectRatio?:number;videoCodec?:string;audio?:boolean;validation?:MediaValidation }
export interface VideoShot { id:string; title:string; visual:string; camera:string; duration:number; narration:string; subtitle:string; revision:string; prompt?:string; promptBasis?:string; referenceAssetId?:string; referenceConceptId?:string; conceptIds?:string[]; contentKeys?:string[]; frameReferenceIds?:string[]; frameInstruction?:string; frameCandidate?:string; clip?:MediaFile; audio?:MediaFile }
export interface VideoDraft { ratio:'16:9'|'9:16'; shots:VideoShot[]; burnSubtitles:boolean; keepAudio:boolean; music?:MediaFile; final?:MediaFile & {subtitleFileId:string} }
export interface SiteItem { title:string; text:string; tag:string; assetId?:string }
export interface SiteSection {kind:'text'|'gallery'|'faq';title:string;body:string;items:SiteItem[]}
export interface SiteSpec {title:string;description:string;accent:string;theme:'paper'|'night';pages:{id:string;title:string;intro:string;sections:SiteSection[]}[];limitations:string[]}
export interface WebsiteDraft {spec:SiteSpec;builtSpec?:SiteSpec;previewFileId?:string;zipFileId?:string}
export interface WebsiteRequest {prompt:string;basis:string;assetIds:string[];bundleFileId?:string;source?:string;taskId?:string}
export interface WebsiteSource {verificationMethod?:'not-tested'|'static'|'browser'|'user-browser';verificationResult?:'not-tested'|'passed'|'failed';verificationEvidence?:string;fileId:string;entryCount:number;description:string;instructions:string;verification:string;taskId?:string;requestSource?:string;importedAt:number;previewPath?:string}
export interface FlowRecord {id:string;type:WorkType;target:string;createdAt:number;origin:string;taskId?:string;fingerprint:string;value:any;dependencies:{key:string;label:string;fingerprint:string}[]}
export interface TypeBranch {brief?:string;art?:Project['art'];references?:StyleReference[];concepts?:Concept[];delivery?:Project['delivery'];requests?:string[];novel?:Project['novel'];novelReferenceIds?:string[];video?:VideoDraft;website?:WebsiteDraft;websiteRequest?:WebsiteRequest;websiteSource?:WebsiteSource;websiteSourceCandidate?:WebsiteSource;designPackage?:Project['designPackage'];transfer?:Project['transfer'];transfers?:Project['transfers']}
export interface Concept {
  id: string; category: Category; name: string; description: string;
  candidateAssetId?: string; savedAssetId?: string; prompt: string; revisionRequest: string;
  sourceKeys?:string[]; referenceAssetIds?:string[]; usage?:string; inheritedFrom?:{type:string;id:string};
  imageReview?:ImageReview;
}
export interface ImageReview {assetId:string;parentAssetId:string;changesVisible:boolean;preserved:boolean;notes:string;checkedAt:number}
export interface WorkflowTransfer {version?:number;from:WorkType;content:Record<string,string>;novel?:{title:string;text:string;taskId?:string};media?:{fileId:string;name:string;kind:string;duration?:number;sourceTaskId?:string;sourceObjectId?:string}[];includeContent?:boolean;source:string;note:string}
export interface Project {
  id: string; title: string; type: WorkType; createdAt: number; updatedAt: number; stage: number;
  idea: string; brief: string; culture: string;
  knowledge?: {id:string;version:string}[];
  content: Record<WorkType, Record<string, string>>;
  art: { direction: string; material: string; palette: string; constraints: string; fullPrompt: string };
  requests: string[]; references: StyleReference[]; assets: ImageAsset[]; concepts: Concept[];
  coverAssetId?: string; manualCover: boolean;
  delivery: { notes: string; textFormat: string; ratio: string; duration: string };
  upstreamChanged: boolean;
  novel?: { title: string; text: string; taskId: string };
  video?:VideoDraft; website?:WebsiteDraft; websiteRequest?:WebsiteRequest;
  websiteSource?:WebsiteSource; websiteSourceCandidate?:WebsiteSource; novelReferenceIds?:string[]; variants?:Partial<Record<WorkType,TypeBranch>>;
  transfer?:WorkflowTransfer;transfers?:WorkflowTransfer[];
  flow?:{version:1;records:FlowRecord[]}; designPackage?:{fileId:string;source:string;taskId:string};
}
export interface Workspace { projects: Project[]; activeProjectId: string | null }
export interface StoredWorkspace { version: 1; revision: number; workspace: Workspace }
export const emptyWorkspace = (): Workspace => ({ projects: [], activeProjectId: null });

export function updateProject(workspace: Workspace, id: string, update: (project: Project) => Project): Workspace {
  return { ...workspace, projects: workspace.projects.map(project => project.id === id ? { ...update(project), updatedAt: Date.now() } : project) };
}

// Saving resolves Blob assets to their content hashes without replacing newer edits.
export function normalizeSavedAssets(current:Workspace,snapshot:Workspace,wire:Workspace):Workspace {
  return {...current,projects:current.projects.map(p=>{
    const original=snapshot.projects.find(item=>item.id===p.id);
    const saved=wire.projects.find(item=>item.id===p.id);
    if(!original||!saved)return p;
    const flow=p.flow||saved.flow?{version:1 as const,records:[...new Map([...(saved.flow?.records||[]),...(p.flow?.records||[])].map(r=>[r.id,r])).values()]}:undefined;
    return {...p,flow,assets:[...p.assets.map(a=>{
      const before=original.assets.find(item=>item.id===a.id);
      const after=saved.assets.find(item=>item.id===a.id);
      return a.blob&&a.blob===before?.blob&&after?.fileId?{...a,fileId:after.fileId}:a;
    }),...saved.assets.filter(a=>!p.assets.some(current=>current.id===a.id)&&!original.assets.some(before=>before.id===a.id))]};
  })};
}

export function pruneAssets(project: Project): Project {
  const referenced = new Set([project.coverAssetId, ...project.references.map(ref => ref.assetId), ...project.concepts.flatMap(concept => [concept.candidateAssetId, concept.savedAssetId]),...(project.video?.shots.map(s=>s.referenceAssetId)||[]),...(project.websiteRequest?.assetIds||[]),...[project.website?.spec,project.website?.builtSpec].flatMap(spec=>spec?.pages.flatMap(p=>p.sections.flatMap(s=>s.items.map(i=>i.assetId)))||[])]);
  for(const branch of Object.values(project.variants||{})) {
    for(const c of branch.concepts||[])for(const id of [c.savedAssetId,c.candidateAssetId,...(c.referenceAssetIds||[])])referenced.add(id);
    for(const r of branch.references||[])referenced.add(r.assetId);
    for(const s of branch.video?.shots||[])for(const id of [s.referenceAssetId,s.frameCandidate,...(s.frameReferenceIds||[])])referenced.add(id);
    for(const id of branch.websiteRequest?.assetIds||[])referenced.add(id);
  }
  for(const c of project.concepts)for(const id of c.referenceAssetIds||[])referenced.add(id);
  for(const s of project.video?.shots||[])for(const id of [s.frameCandidate,...(s.frameReferenceIds||[])])referenced.add(id);
  // History restoration must keep its actual image files addressable.
  for(const r of project.flow?.records||[])if(r.target.startsWith('concept:')||r.target.startsWith('shot:'))for(const id of [r.value?.savedAssetId,r.value?.candidateAssetId,r.value?.referenceAssetId,...(r.value?.referenceAssetIds||[]),...(r.value?.frameReferenceIds||[])])referenced.add(id);
  // Keep every referenced edit's ancestors available for visual comparison.
  const byId=new Map(project.assets.map(asset=>[asset.id,asset]));
  for(const id of referenced) {const parent=id?byId.get(id)?.source?.parentAssetId:undefined;if(parent)referenced.add(parent);}
  return { ...project, assets: project.assets.filter(asset => referenced.has(asset.id)) };
}

export function removeConcept(project: Project, id: string): Project {
  const concepts = project.concepts.filter(concept => concept.id !== id);
  const removed = project.concepts.find(concept => concept.id === id);
  const coverWasRemoved = removed && [removed.candidateAssetId, removed.savedAssetId].includes(project.coverAssetId) && !project.manualCover;
  return pruneAssets({ ...project, concepts, novelReferenceIds:project.novelReferenceIds?.filter(value=>value!==id),video:project.video?{...project.video,shots:project.video.shots.map(s=>({...s,conceptIds:s.conceptIds?.filter(value=>value!==id)}))}:undefined, coverAssetId: coverWasRemoved ? concepts.find(concept => concept.savedAssetId)?.savedAssetId : project.coverAssetId });
}

// Validate every persisted shape before editing. Unknown or damaged records must never be silently overwritten.
export function parseStoredWorkspace(value: unknown): StoredWorkspace {
  const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object';
  const strings = (v: unknown) => record(v) && Object.values(v).every(item => typeof item === 'string');
  const optionalString = (v: unknown) => v === undefined || typeof v === 'string';
  if (!record(value) || value.version !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !record(value.workspace) || !Array.isArray(value.workspace.projects)) throw new Error('草稿格式无法读取，请保留当前浏览器数据并重试。');
  const ws = value.workspace;
  if (!(ws.activeProjectId === null || typeof ws.activeProjectId === 'string')) throw new Error('项目位置记录损坏。');
  const ids = new Set<string>();
  for (const p of ws.projects as unknown[]) {
    if (!record(p) || typeof p.id !== 'string' || ids.has(p.id) || typeof p.title !== 'string' || !WORK_TYPES.includes(p.type as WorkType) || !Number.isInteger(p.stage) || Number(p.stage) < 0 || Number(p.stage) > 4 || !Number.isFinite(p.createdAt) || !Number.isFinite(p.updatedAt) || !['idea', 'brief', 'culture'].every(key => typeof p[key] === 'string') || typeof p.manualCover !== 'boolean' || typeof p.upstreamChanged !== 'boolean' || !optionalString(p.coverAssetId)) throw new Error('有项目数据无法读取，未覆盖原有草稿。');
    ids.add(p.id);
    validateKnowledge(p.knowledge);
    if(p.video)validateVideo(p.video);
    if(p.website)validateWebsite(p.website);
    if(p.websiteRequest)validateWebsitePrompt(p.websiteRequest);
    validateFlowState(p);
    if (!record(p.content) || !WORK_TYPES.every(type => strings((p.content as Record<string, unknown>)[type])) || !record(p.art) || !['direction', 'material', 'palette', 'constraints', 'fullPrompt'].every(key => typeof (p.art as Record<string, unknown>)[key] === 'string') || !record(p.delivery) || !['notes', 'textFormat', 'ratio', 'duration'].every(key => typeof (p.delivery as Record<string, unknown>)[key] === 'string') || !Array.isArray(p.requests) || p.requests.length !== 5 || !p.requests.every(item => typeof item === 'string')) throw new Error('阶段草稿格式不完整。');
    if (!Array.isArray(p.assets) || !p.assets.every(a => record(a) && typeof a.id === 'string' && typeof a.name === 'string' && (a.blob instanceof Blob || (typeof a.fileId === 'string' && /^[a-f0-9]{64}$/.test(a.fileId)) || (typeof a.demoSrc === 'string' && a.demoSrc.startsWith('/art/'))))) throw new Error('图片草稿格式无法读取。');
    if (p.novel !== undefined && (!record(p.novel) || !['title','text','taskId'].every(key => typeof (p.novel as Record<string,unknown>)[key] === 'string'))) throw new Error('正文记录无法读取。');
    if (!Array.isArray(p.references) || !p.references.every(r => record(r) && ['id', 'assetId', 'purpose'].every(key => typeof r[key] === 'string'))) throw new Error('参考图片记录无法读取。');
    if (!Array.isArray(p.concepts) || !p.concepts.every(c => record(c) && ['id', 'name', 'description', 'prompt', 'revisionRequest'].every(key => typeof c[key] === 'string') && typeof c.category === 'string' && Object.hasOwn(CATEGORIES, c.category) && optionalString(c.candidateAssetId) && optionalString(c.savedAssetId))) throw new Error('概念图记录无法读取。');
    if(p.variants!==undefined){if(!record(p.variants)||!Object.keys(p.variants).every(t=>WORK_TYPES.includes(t as WorkType))||!Object.values(p.variants).every(b=>record(b)&&Object.keys(b).every(k=>BRANCH_FIELDS.includes(k))))throw new Error('类型草稿无效。');for(const type of Object.keys(p.variants))if(type!==p.type){const branch={...projectForType(p as unknown as Project,type)};delete branch.variants;delete branch.flow;parseStoredWorkspace({version:1,revision:1,workspace:{projects:[branch],activeProjectId:null}});}}
  }
  if (ws.activeProjectId !== null && !ids.has(ws.activeProjectId as string)) throw new Error('上次打开的项目记录缺失。');
  return value as unknown as StoredWorkspace;
}

export function createDemoProject(type: Exclude<WorkType, 'undecided'>): Project {
  const names = { novel: '雨落西关', video: '骑楼下的午后', craft: '一扇清风', website: '巷里有间小店' };
  const ideas = { novel: '写一个发生在当代西关的温暖短篇：修伞的年轻人，和一封迟到的信。', video: '用一分钟记录骑楼下一个安静的午后，让光线和生活的小声音成为主角。', craft: '以葵扇和广彩花色为灵感，设计一组适合夏日赠礼的数字文创展示。', website: '为一家虚构的岭南街区手作小店设计网站，介绍手艺、作品和到店方式。' };
  const p = createProject(ideas[type], type, names[type], 'demo-' + type);
  p.brief = '从岭南日常生活里的一件小事出发，关注人与物之间缓慢建立的联系。\n\n保持当代背景，以细腻、温暖的表达邀请读者或观众靠近。文化细节从具体生活出发，不额外添加古装或无依据的民俗。';
  p.culture = '本示例采用当代广府街区的虚构语境。骑楼、庭院光影与地方手工艺作为创作参考；具体人物、店铺和故事均为虚构。';
  for (const section of CONTENT_SECTIONS[type]) p.content[type][section.key] = `${section.label}\n\n${ideas[type]}\n\n从一场雨后的光线开始。镜头或文字沿着廊下的阴影，慢慢走近人们正在做的小事。让细节推进内容，留下安静的停顿。\n\n保留：当代街区、自然光、人与人之间的联系。\n避免：无依据的历史说明、过量装饰和戏剧化冲突。`;
  p.art = { direction: '温柔的当代岭南生活插画，以骑楼与庭院的空间层次组织画面。', material: '平涂与轻微纸感结合，造型简洁，保留手工器物的轮廓。', palette: '瓷白、柔青绿与浅葵米为主，少量胭脂与暖金点缀。柔和自然光。', constraints: '保持当代背景与生活气息，不添加品牌、文字水印或未经确认的文化符号。', fullPrompt: '为当代岭南街区的虚构作品制作概念参考。以清楚的轮廓、柔和的自然光、瓷白与青绿配色表达安静的生活气息。保留已确定的对象设定，不擅自添加人物和文化符号。' };
  p.assets = [{ id: 'demo-courtyard', name: '庭院与骑楼 · 原创示意', demoSrc: '/art/courtyard.svg' }, { id: 'demo-fan', name: '葵扇与彩瓷 · 原创示意', demoSrc: '/art/craft.svg' }];
  p.coverAssetId = type === 'craft' ? 'demo-fan' : 'demo-courtyard';
  p.references = [{ id: 'demo-ref', assetId: 'demo-fan', purpose: '只参考配色与材质，不复制对象或故事。' }];
  p.concepts = [{ id: 'demo-object', category: 'object', name: '葵扇', description: '自然葵色，叶脉清楚，用作生活物件概念参考。', candidateAssetId: 'demo-fan', savedAssetId: 'demo-fan', prompt: p.art.fullPrompt, revisionRequest: '' }, { id: 'demo-map', category: 'map', name: '雨后的街巷', description: '骑楼与庭院之间的空间关系示意，不是可用关卡或工程图。', candidateAssetId: 'demo-courtyard', prompt: p.art.fullPrompt, revisionRequest: '' }, { id: 'demo-character', category: 'character', name: '街区里的年轻人', description: '当代日常服装，安静自然的气质，具体造型待确定。', prompt: '', revisionRequest: '' }];
  return p;
}
