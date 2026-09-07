export const WORK_TYPES = ['undecided', 'novel', 'video', 'craft', 'website'] as const;
export type WorkType = typeof WORK_TYPES[number];
export const TYPE_LABELS: Record<WorkType, string> = { undecided: '暂未确定', novel: '小说', video: '视频', craft: '文创作品', website: '网站' };
export const STAGES = ['创意', '内容', '美术提示词', '概念图', '成品'] as const;
export type Category = 'character' | 'map' | 'object';
export const CATEGORIES: Record<Category, string> = { character: '角色', map: '地图', object: '物件' };
export const CONTENT_SECTIONS: Record<WorkType, { key: string; label: string; hint: string }[]> = {
  undecided: [{ key: 'overview', label: '内容概述', hint: '先写下你想表达的内容，作品形式可以稍后决定。' }, { key: 'keep', label: '保留与排除', hint: '有哪些一定要保留的内容？又有哪些不希望出现？' }],
  novel: [{ key: 'story', label: '故事梗概', hint: '故事从哪里开始？人物经历了什么，又将走向哪里？' }, { key: 'characters', label: '人物与关系', hint: '主要人物的愿望、性格，以及彼此的关系。' }, { key: 'world', label: '背景设定', hint: '记录已确定的地域、时代、生活环境与文化依据。' }, { key: 'chapters', label: '章节与结局', hint: '按章节整理事件，写下结局方向与必须保留的情节。' }, { key: 'voice', label: '叙事与语言', hint: '叙述视角、语言气质、节奏与目标读者。' }],
  video: [{ key: 'script', label: '核心表达与脚本', hint: '这段视频想让观众看到、感受到什么？' }, { key: 'shots', label: '场景与镜头', hint: '按顺序描述场景、景别、画面与转场。' }, { key: 'voiceover', label: '旁白与对白', hint: '写下需要出现的旁白、对白与声音要求。' }, { key: 'spec', label: '节奏与规格', hint: '目标时长、画幅、节奏与必要限制。' }],
  craft: [{ key: 'theme', label: '主题与载体', hint: '作品的主题是什么？希望呈现在什么载体上？' }, { key: 'motifs', label: '图案与文化依据', hint: '需要表达的符号、图案和已经确认的文化参考。' }, { key: 'copy', label: '必要文字', hint: '记录需要保留的文字，包括准确的名称与标点。' }, { key: 'display', label: '使用与展示', hint: '使用场景、展示视图和数字设计交付要求。' }],
  website: [{ key: 'goal', label: '目标与受众', hint: '网站为谁服务？用户应当能在这里完成什么？' }, { key: 'pages', label: '页面与导航', hint: '列出页面结构、主要内容区和导航关系。' }, { key: 'copy', label: '页面文案', hint: '整理标题、正文、按钮文字与其他必要文案。' }, { key: 'behavior', label: '交互与交付', hint: '明确需要运行的功能，以及源码和运行说明的交付要求。' }],
};

export interface ImageAsset { id: string; name: string; blob?: Blob; demoSrc?: string }
export interface StyleReference { id: string; assetId: string; purpose: string }
export interface Concept {
  id: string; category: Category; name: string; description: string;
  candidateAssetId?: string; savedAssetId?: string; prompt: string; revisionRequest: string;
}
export interface Project {
  id: string; title: string; type: WorkType; createdAt: number; updatedAt: number; stage: number;
  idea: string; brief: string; culture: string;
  content: Record<WorkType, Record<string, string>>;
  art: { direction: string; material: string; palette: string; constraints: string; fullPrompt: string };
  requests: string[]; references: StyleReference[]; assets: ImageAsset[]; concepts: Concept[];
  coverAssetId?: string; manualCover: boolean;
  delivery: { notes: string; textFormat: string; ratio: string; duration: string };
  upstreamChanged: boolean;
}
export interface Workspace { projects: Project[]; activeProjectId: string | null }
export interface StoredWorkspace { version: 1; revision: number; workspace: Workspace }
export const emptyWorkspace = (): Workspace => ({ projects: [], activeProjectId: null });

export function createProject(idea: string, type: WorkType = 'undecided', title = '', id = crypto.randomUUID()): Project {
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

export function updateProject(workspace: Workspace, id: string, update: (project: Project) => Project): Workspace {
  return { ...workspace, projects: workspace.projects.map(project => project.id === id ? { ...update(project), updatedAt: Date.now() } : project) };
}

export function pruneAssets(project: Project): Project {
  const referenced = new Set([project.coverAssetId, ...project.references.map(ref => ref.assetId), ...project.concepts.flatMap(concept => [concept.candidateAssetId, concept.savedAssetId])]);
  return { ...project, assets: project.assets.filter(asset => referenced.has(asset.id)) };
}

export function removeConcept(project: Project, id: string): Project {
  const concepts = project.concepts.filter(concept => concept.id !== id);
  const removed = project.concepts.find(concept => concept.id === id);
  const coverWasRemoved = removed && [removed.candidateAssetId, removed.savedAssetId].includes(project.coverAssetId) && !project.manualCover;
  return pruneAssets({ ...project, concepts, coverAssetId: coverWasRemoved ? concepts.find(concept => concept.savedAssetId)?.savedAssetId : project.coverAssetId });
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
    if (!record(p.content) || !WORK_TYPES.every(type => strings((p.content as Record<string, unknown>)[type])) || !record(p.art) || !['direction', 'material', 'palette', 'constraints', 'fullPrompt'].every(key => typeof (p.art as Record<string, unknown>)[key] === 'string') || !record(p.delivery) || !['notes', 'textFormat', 'ratio', 'duration'].every(key => typeof (p.delivery as Record<string, unknown>)[key] === 'string') || !Array.isArray(p.requests) || p.requests.length !== 5 || !p.requests.every(item => typeof item === 'string')) throw new Error('阶段草稿格式不完整。');
    if (!Array.isArray(p.assets) || !p.assets.every(a => record(a) && typeof a.id === 'string' && typeof a.name === 'string' && (a.blob instanceof Blob || (typeof a.demoSrc === 'string' && a.demoSrc.startsWith('/art/'))))) throw new Error('图片草稿格式无法读取。');
    if (!Array.isArray(p.references) || !p.references.every(r => record(r) && ['id', 'assetId', 'purpose'].every(key => typeof r[key] === 'string'))) throw new Error('参考图片记录无法读取。');
    if (!Array.isArray(p.concepts) || !p.concepts.every(c => record(c) && ['id', 'name', 'description', 'prompt', 'revisionRequest'].every(key => typeof c[key] === 'string') && typeof c.category === 'string' && Object.hasOwn(CATEGORIES, c.category) && optionalString(c.candidateAssetId) && optionalString(c.savedAssetId))) throw new Error('概念图记录无法读取。');
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
