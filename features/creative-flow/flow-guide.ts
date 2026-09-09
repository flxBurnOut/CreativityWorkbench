import type { Project, WorkType } from '@/features/projects/model';

export const FLOW_LABELS = ['确定创意', '整理内容', '设定画风', '准备图片', '制作与交付'];
export const TYPE_ORDER: WorkType[] = ['novel', 'video', 'website', 'craft', 'undecided'];
export const WORK_GUIDES: Record<WorkType, { title: string; description: string; output: string; route: string; boundary: string; example: string }> = {
  novel: { title: '写一篇故事', description: '从想法整理人物、情节与背景，再创作和修改短篇正文。', output: '短篇正文 · TXT / Markdown', route: '确定创意 → 整理故事 → 创作正文 → 下载', boundary: '配图可选；目前支持短篇，长篇编排尚未实现。', example: '写一个发生在当代岭南街巷的短篇，一把旧葵扇串起两代人的回忆。' },
  video: { title: '做一段视频', description: '描述一个镜头，可选一张参考图，生成、修改并下载视频。', output: '单镜头视频 · MP4', route: '确定画面 → 可选参考图 → 生成镜头 → 下载', boundary: '单镜头 2–10 秒；可展开配音、多镜头合成等进阶操作。', example: '一个 5 秒连续镜头：雨后的岭南骑楼下，一位年轻人收起葵扇，镜头缓慢拉远。' },
  website: { title: '做一个网站', description: '整理网站需求与素材，交给 WorkBuddy 制作，再收回源码继续修改。', output: '网站源码 ZIP · 静态页面预览', route: '确定需求 → 准备素材 → WorkBuddy 制作 → 导入与预览', boundary: '工作台整理任务和文件；网站由 WorkBuddy 完成，发布需另行处理。', example: '为岭南手作做一个文化专题网站，展示作品与文化依据，支持按作品类别筛选。' },
  craft: { title: '准备 3D 文创设计', description: '整理形体、材质、文化依据和概念参考，交付三维制作前期资料。', output: '设计说明与参考图片 · ZIP', route: '确定设计 → 整理形体 → 准备参考 → 导出资料', boundary: '当前只做前期资料，不生成 3D 模型、拓扑或纹理。', example: '以葵扇为灵感整理一件三维文创的形体、材质和参考图，先交付设计资料。' },
  undecided: { title: '先整理一个想法', description: '保存创意与资料，确定作品形式后再继续。', output: '创作资料包 · ZIP', route: '记录想法 → 整理资料 → 选择作品类型', boundary: '可随时切换作品类型，原类型草稿会保留。', example: '围绕岭南手艺人与街巷生活整理创意，作品形式稍后决定。' },
};

export function hasStageDraft(project: Project, stage: number): boolean {
  if (stage === 0) return Boolean(project.brief.trim());
  if (stage === 1) return Object.values(project.content[project.type]).some(value => value.trim());
  if (stage === 2) return Object.values(project.art).some(value => value.trim());
  if (stage === 3) return project.concepts.some(concept => concept.savedAssetId);
  if (project.type === 'novel') return Boolean(project.novel?.text.trim());
  if (project.type === 'video') return Boolean(project.video?.final || project.video?.shots.some(shot => shot.clip));
  if (project.type === 'website') return Boolean(project.websiteSource || project.website?.zipFileId);
  return Boolean(project.designPackage);
}

export const optionalStage = (type: WorkType, stage: number) => (stage === 2 || stage === 3) && ['novel', 'video', 'website', 'undecided'].includes(type);
export const nextStage = (project: Project) => project.type === 'novel' && project.stage === 1 ? 4 : Math.min(project.stage + 1, 4);

export function stageInstruction(project: Project) {
  const type = project.type;
  return [
    { title: '先确定这次要创作什么', action: '写下想法，点击“展开创意方案”，或者直接填写方案。生成后选择采用，再整理内容。', result: '一份明确的创意方案和文化背景' },
    { title: type === 'novel' ? '整理故事，再写正文' : type === 'website' ? '写清网站内容与实际功能' : type === 'video' ? '整理视频要表达的内容' : '把创意整理成制作依据', action: '可以生成整份初稿，也可以直接粘贴已有内容。切换小节，下方提出修改，比较建议后采用。', result: type === 'novel' ? '故事梗概、人物和背景；正文在最后一步创作' : '下一步可直接使用的内容方案' },
    { title: '确定图片应该是什么样子', action: '先生成或填写视觉方向，再按需要调整材质、配色和保持项。参考图片可选；这一步只整理画风文字。', result: '后续图片与视频共用的美术要求' },
    { title: '为作品准备真正要用的图片', action: '从内容提取对象，或手动添加人物、场景、物件。生成或上传图片后，点击“选用此图”，再带入作品。需要局部调整时点击“修改图片”。', result: '已选用的概念图；可用于视频首帧或网站素材' },
    { title: type === 'novel' ? '创作正文，确认后下载' : type === 'video' ? '描述镜头，生成并下载视频' : type === 'website' ? '把需求做成网站，再收回源码' : type === 'craft' ? '导出 3D 制作前期资料' : '导出资料，或选择下一种作品形式', action: type === 'novel' ? '填写补充要求并生成短篇。采用结果后可直接修改正文，下载 TXT 或 Markdown。' : type === 'video' ? '填写单镜头要求与时长，可选首帧。生成结果会显示在本页，采用后可以下载；更多镜头和声音按需展开。' : type === 'website' ? '按下方三步完成：准备任务 → 交给 WorkBuddy 制作 → 导入源码预览。任务包准备好后，还需要执行网站制作。' : '打包当前已保存的内容与实际图片，采用结果后下载资料 ZIP。', result: WORK_GUIDES[type].output },
  ][project.stage];
}

export function taskStage(kind: string, args: Record<string, unknown> = {}) {
  if (args.fromNovel) return 4;
  return ({ creative: 0, content: 1, art: 2, objects: 3, image: 3, cover: 3 } as Record<string, number>)[kind] ?? 4;
}

export function taskMatchesStep(project: Project, task: { kind: string; args: Record<string, unknown>; workType?: string; source: string }) {
  let type = task.workType;
  if (!type && task.kind === 'content') {
    try { type = JSON.parse(task.source)[1]; } catch { return false; }
  }
  return (!type || type === project.type) && (task.kind === 'cover' || taskStage(task.kind, task.args) === project.stage);
}

export function workBuddyRequest(project: Project) {
  return `请通过创意工作台的 MCP 和 Skills 继续项目 ${JSON.stringify(project.title)}（项目 ID：${project.id}）。先检查连接并读取最新项目，不要新建同名副本。\n当前作品：${WORK_GUIDES[project.type].title}；当前步骤：${FLOW_LABELS[project.stage]}。\n${stageInstruction(project).action}\n沿用项目已保存的文化依据、内容与实际素材。先说明准备做什么，再按我的要求完成、保存并交付；需要我做审美选择时展示候选。不要把任务包、概念图或待执行请求当成已完成的成品。`;
}
