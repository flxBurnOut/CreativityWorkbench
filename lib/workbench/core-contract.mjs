import { z } from 'zod';
import { taskKinds } from './task-contract.mjs';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const version = z.string().regex(/^[a-f0-9]{64}$/).describe('最近一次 project_get 或写入返回的 projectVersion。冲突后重新读取并合并；修改操作内容须使用新的 requestId。');
const text = z.string().max(100000);
const short = z.string().max(4000);
const workType = z.enum(['undecided', 'novel', 'video', 'website', 'craft']);
const websiteScope=z.enum(['all','appearance','content','images','interaction']);
const websiteBrief=z.object({goal:text,change:short,scope:websiteScope,autoAssets:z.boolean()}).strict();
const mutation = { requestId: id.describe('本次操作唯一 ID；丢失响应时重放同一操作不会再次执行。修改内容或重新生成须使用新 ID；expectedVersion 可更新。'), projectId: id, expectedVersion: version };
const outputFile = z.string().regex(/^[a-f0-9]{64}\.(mp4|wav|srt)$/);
const mediaValidation = z.object({status:z.enum(['passed','failed','unverified']),requested:z.object({ratio:z.enum(['16:9','9:16']),duration:z.number().positive()}).strict(),actual:z.object({width:z.number().positive().optional(),height:z.number().positive().optional(),duration:z.number().positive(),displayAspectRatio:z.number().positive()}).strict(),issues:z.array(short).max(20)}).strict();
const mediaFields = { fileId: outputFile, duration: z.number().finite().positive(), source: z.string().max(500000), taskId: id.optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), displayAspectRatio:z.number().positive().optional(), validation:mediaValidation.optional(), videoCodec: z.string().max(80).optional(), audio: z.boolean().optional(), prompt: z.string().max(100000).optional(), provider: z.string().max(80).optional() };
const media = z.object(mediaFields).strict();
const finalMedia = z.object({ ...mediaFields, subtitleFileId: z.string().regex(/^[a-f0-9]{64}\.srt$/) }).strict();
const shot = z.object({ id, title: short, visual: short, camera: short, duration: z.number().int().min(2).max(10), narration: short, subtitle: short, revision: short, prompt:text.optional(), promptBasis:z.string().max(500000).optional(), referenceAssetId: id.optional(),referenceConceptId:id.optional(), conceptIds:z.array(id).max(100).optional(),contentKeys:z.array(z.string().max(80)).max(4).optional(),frameReferenceIds:z.array(id).max(5).optional(),frameInstruction:short.optional(),frameCandidate:id.optional(),clip: media.optional(), audio: media.optional() }).strict();
const siteItem = z.object({ title: z.string().max(200), text: short, tag: z.string().max(100), assetId: id.optional() }).strict();
const siteSpec = z.object({
  title: z.string().min(1).max(200), description: short, accent: z.string().regex(/^#[a-fA-F0-9]{6}$/), theme: z.enum(['paper', 'night']),
  pages: z.array(z.object({ id, title: z.string().min(1).max(100), intro: short, sections: z.array(z.object({ kind: z.enum(['text', 'gallery', 'faq']), title: z.string().max(200), body: short, items: z.array(siteItem).max(20) }).strict()).min(1).max(12) }).strict()).min(1).max(5),
  limitations: z.array(short).max(10),
}).strict();
const contentPart = keys => z.object(Object.fromEntries(keys.map(k => [k, text.optional()]))).strict().optional();
const patch = z.object({
  title: z.string().max(200).optional(), type: workType.optional(), stage: z.number().int().min(0).max(4).optional(),
  idea: text.optional(), brief: text.optional(), culture: text.optional(),
  content: z.object({
    undecided: contentPart(['overview', 'keep']), novel: contentPart(['story', 'characters', 'world', 'chapters', 'voice']),
    video: contentPart(['script', 'shots', 'voiceover', 'spec']), website: contentPart(['goal', 'pages', 'copy', 'behavior']), craft: contentPart(['theme', 'motifs', 'copy', 'display']),
  }).strict().optional(),
  art: contentPart(['direction', 'material', 'palette', 'constraints', 'fullPrompt']),
  requests: z.array(text).length(5).optional(),
  delivery: contentPart(['notes', 'textFormat', 'ratio', 'duration']),
  references: z.array(z.object({ id, assetId: id, purpose: short }).strict()).max(100).optional(),
  concepts: z.array(z.object({ id, category: z.enum(['character', 'map', 'object']), name: text, description: text, prompt: text, revisionRequest: text, candidateAssetId: id.optional(), savedAssetId: id.optional(),sourceKeys:z.array(z.string().max(80)).max(10).optional(),referenceAssetIds:z.array(id).max(5).optional(),usage:short.optional(),imageReview:z.object({assetId:id,parentAssetId:id,changesVisible:z.boolean(),preserved:z.boolean(),notes:short,checkedAt:z.number().finite().nonnegative()}).strict().optional(),inheritedFrom:z.object({type:workType,id}).strict().optional() }).strict()).max(100).optional(),
  novelReferenceIds:z.array(id).max(100).optional(),
  coverAssetId: id.nullable().optional(), manualCover: z.boolean().optional(),
  novel: z.object({ title: z.string().max(200), text, taskId: z.string().max(80).default('workbuddy-conversation') }).strict().optional(),
  video: z.object({ ratio: z.enum(['16:9', '9:16']), shots: z.array(shot).max(12), burnSubtitles: z.boolean(), keepAudio: z.boolean(), music: media.nullable().optional(), final: finalMedia.optional() }).strict().optional(),
  website: z.object({ spec: siteSpec }).strict().optional(),
  websiteBrief:websiteBrief.optional(),
  websiteEdit:z.object({change:short,scope:websiteScope}).strict().optional(),studioRevision:short.optional(),
  websiteRequest: z.object({ prompt:text, basis:z.string().max(500000), assetIds:z.array(id).max(100), bundleFileId:z.string().regex(/^[a-f0-9]{64}\.zip$/).optional(), baseFileId:z.string().regex(/^[a-f0-9]{64}\.zip$/).optional(), source:z.string().max(500000).optional(), taskId:id.optional() }).strict().optional(),
}).strict().refine(value => Object.keys(value).length > 0, '至少提交一个修改字段。');
const args = z.object({
  action: z.enum(['generate', 'improve', 'redirect', 'revise', 'alternative', 'check', 'section', 'selection', 'edit']).optional(),
  provider: z.enum(['workbuddy', 'external']).optional(), ratio: z.enum(['1:1', '3:2', '2:3']).optional(),
  objectId: id.optional(), newStyle: z.boolean().optional(), key: z.string().max(80).optional(),
  fromNovel:z.boolean().optional(),
  instruction:z.string().max(8000).optional(),
  start: z.number().int().min(0).optional(), end: z.number().int().min(1).optional(), selectedText: z.string().max(8000).optional(),
}).strict();

// One schema catalog validates both MCP and HTTP core operations.
export const coreTools = {
  website_run:{description:'根据一份完整目标开始网站制作，自动匹配新项目所需的内置知识/素材并准备交接。保留已选资料与旧网站；change 和 scope 指定本轮修改。任务包完成后继续 waiting_external，实际源码回传后才 succeeded；网页自动展示初稿供确认。dispatch=conversation 用于当前 WorkBuddy 对话，auto 用于网页自动发送或显示手动交接。',schema:z.object({...mutation,goal:text.trim().min(1),change:short.default(''),scope:websiteScope.default('all'),autoAssets:z.boolean().default(true),dispatch:z.enum(['conversation','auto']).default('conversation'),base:z.enum(['current','draft']).default('current'),retryOf:id.optional()}).strict(),openWorld:true},
  website_complete:{description:'将原网站制作任务的真实源码 ZIP 交回，taskId 必须是原任务，filename 为原项目 inbox 文件名。自动验证结构并回传网页初稿；不新建任务、不替用户使用最终版本。检查记录如实填写，不把结构通过写成浏览器通过。同 ID 同文件可重放。',schema:z.object({taskId:id,filename:z.string().regex(/^[a-zA-Z0-9_-]{1,80}\.zip$/),description:short.default('网站初稿'),instructions:text.default(''),verification:text.default('未提供执行端检查记录'),verificationMethod:z.enum(['not-tested','static','browser','user-browser']).default('not-tested'),verificationResult:z.enum(['not-tested','passed','failed']).default('not-tested'),verificationEvidence:text.default('')}).strict()},
  image_select:{description:'将已成功图片任务的结果直接选用于指定对象，或选用本项目已保存图片；taskId 与 assetId 二选一。保持原图和历史，修改图须提供实际原图对比记录 review。写入、版本校验与幂等在 Runtime 完成，不生成图片。网页与 WorkBuddy 共用该操作；候选或文件入库不等于选用。',schema:z.object({...mutation,objectId:id,taskId:id.optional(),assetId:id.optional(),review:z.object({assetId:id,parentAssetId:id,changesVisible:z.boolean(),preserved:z.boolean(),notes:short,checkedAt:z.number().finite().nonnegative()}).strict().optional()}).strict().refine(v=>Boolean(v.taskId)!==Boolean(v.assetId),'taskId 与 assetId 必须且只能填写一个。')},
  theme_asset_list:{description:'查找内置原创岭南视觉素材。返回实际 PNG/SVG 路径、缩略图、地域、适用场景和文化出处；是原创设计示意，不是实景照片或文物复原。',schema:z.object({query:z.string().max(200).default('')}).strict(),readOnly:true},
  theme_asset_apply:{description:'将明确选择的内置主题视觉素材及文化依据加入项目，并保存为可使用的概念图。网站会附实际 PNG、原始 SVG 和出处。仅处理本机内置文件，不调用付费模型；不覆盖已有网站提示词编辑稿，素材变化后须核对。',schema:z.object({...mutation,entryIds:z.array(id).min(1).max(6)}).strict()},
  video_frame_fit:{description:'把镜头当前首帧补边或居中裁切为项目目标画幅，生成独立图片并设为该镜头首帧，保留原图与概念定稿；不调用模型。pad 保留全部画面，crop 会切去边缘，按用户选择。保留已编辑提示词，首帧变化后需重新核对。',schema:z.object({...mutation,objectId:id,fit:z.enum(['pad','crop'])}).strict()},
  knowledge_search: {description:'搜索内置岭南文化资料，返回事实摘要、来源、地域、版本、创作建议和使用边界；不自动写入项目。空 query 列出全部。不是图片素材授权库。',schema:z.object({query:z.string().max(200).default(''),region:z.enum(['','广府','潮汕','客家','跨区域']).default('')}).strict(),readOnly:true},
  knowledge_apply: {description:'将明确选择的文化资料加入、移除或替换项目引用，保留 culture 自由设定。知识按版本保存并参与生成依据；不自动采用或重新生成已有成品。',schema:z.object({...mutation,entryIds:z.array(id).max(12),mode:z.enum(['add','remove','replace']).default('add')}).strict()},
  workflow_get:{description:'读取连续创作依据、相关更新和各类型成果版本。inputManifest 与实际任务解析共用；图片仅在 role=attached-image 时作为实际附件，小说只使用确认文字。',schema:z.object({projectId:id,kind:z.enum(taskKinds).optional(),args:args.default({})}).strict(),readOnly:true},
  workflow_update:{description:'显式继承另一类型的完整内容（含小说正文）、选定概念图及已采用音视频，或恢复历史/采用网站源码。多次选择不同来源并存；remove-inherited 按 from 停止引用，保留原稿与文件；mediaIds 是来源类型实际文件 ID，不包含候选。资料直接进入网站任务包，不要求先生成网站小节；旧版本保留。',schema:z.object({...mutation,action:z.enum(['inherit','remove-inherited','restore','adopt-website-source']),from:workType.optional(),brief:z.boolean().default(true),content:z.boolean().default(true),art:z.boolean().default(false),conceptIds:z.array(id).max(100).default([]),mediaIds:z.array(outputFile).max(26).default([]),recordId:id.optional()}).strict()},
  website_source_import:{description:'从项目 inbox 导入实际网站源码 ZIP 为候选，不执行代码，不自动采用。输入运行说明和执行端检查记录；之后 workflow_update adopt-website-source，下一轮 website 任务会附上真实源码。',schema:z.object({...mutation,filename:z.string().regex(/^[a-zA-Z0-9_-]{1,80}\.zip$/),description:short.default('导入的网站源码'),instructions:text.default(''),verification:text.default('未提供执行端验证记录'),verificationMethod:z.enum(['not-tested','static','browser','user-browser']).default('not-tested'),verificationResult:z.enum(['not-tested','passed','failed']).default('not-tested'),verificationEvidence:text.default(''),taskId:id.optional()}).strict()},
  prompt_prepare: { description: '读取当前项目，整理概念图、镜头首帧、单镜头或网站提示词及素材用途。返回 basis 和 projectVersion；不调用模型。可编辑后将视频 prompt/promptBasis 或 websiteRequest 保存，再 task_start。网站交付提示词与素材包，由当前 agent 完整实现，不套工作台模板。', schema:z.object({projectId:id,kind:z.enum(['image','cover','video-frame','video-shot','website']),args:args.default({})}).strict(),readOnly:true },
  workbench_status: { description: '检查共享 Runtime、服务配置和核心能力。只返回配置状态，不返回密钥。', schema: z.object({}).strict(), readOnly: true },
  storage_cleanup: { description: '预览已成功导入的 handoff/inbox 冗余源文件，默认保留 7 天。核对范围后 execute=true 并传 confirmationToken 才删除；不删除项目、任务、未导入文件或已保存成品。', schema: z.object({ execute: z.boolean().default(false), confirmationToken: z.string().regex(/^[a-f0-9]{64}$/).optional(), minimumAgeDays: z.number().int().min(0).max(3650).default(7) }).strict(), destructive: true, idempotent: false },
  workspace_recover: { description: '检查上一版工作区快照；仅当前快照损坏或丢失时可恢复。先 inspect，再使用返回的 recoveryToken restore；保留损坏原文件。', schema: z.object({ action: z.enum(['inspect','restore']).default('inspect'), recoveryToken: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(), destructive: true },
  project_list: { description: '分页列出已有项目，返回 ID、名称、类型和版本、total 及 nextOffset；不创建演示项目。', schema: z.object({ offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(500).default(100) }).strict(), readOnly: true },
  project_get: { description: '读取项目完整草稿、projectVersion 和受控 inbox 路径。编辑或提交任务前调用。', schema: z.object({ projectId: id }).strict(), readOnly: true },
  project_create: { description: '保存新创意项目。requestId 用于幂等重试；craft 仅记录 3D 想法，尚无 3D 生成。', schema: z.object({ requestId: id, idea: z.string().trim().min(1).max(100000), title: z.string().max(200).default(''), type: workType.default('undecided') }).strict() },
  project_update: { description: '保存当前对话创作的文字、概念设定、单镜头或 websiteRequest 提示词。视频 promptBasis 与网站 basis 由 prompt_prepare 返回。嵌套对象合并，数组整体替换；保留未改字段。website.spec 仅用于旧模板记录。必须基于最近版本。', schema: z.object({ ...mutation, patch }).strict() },
  task_start: { description: '仅用于新生成意图。收到网页任务 ID、request.json 或等待交接请求时，先 task_get 接续原任务，不调用本工具另建任务；已出图用 task_complete_handoff 写回原交接。提交新生成或交接任务后 task_get / task_adopt。website 只准备网站提示词与实际素材包，不生成网站代码；由当前 agent 完整实现。website-build 仅保留旧模板重建。单镜头 video-shot 无需生成分镜，先保存一个镜头即可。WorkBuddy 使用当前对话交接。文字调用已配置 DeepSeek。相同 requestId 只查询原请求，明确重试用新 ID 和 retryOf；可能产生费用。', schema: z.object({ ...mutation, kind: z.enum(taskKinds), args: args.default({}), retryOf: id.optional() }).strict(), openWorld: true },
  task_list: { description: '列出项目任务的状态。任务查询可能接收已写回的文件或查询现有供应商作业，不重新提交生成。', schema: z.object({ projectId: id }).strict(), openWorld: true },
  task_get: { description: '收到网页原任务 ID 或 request.json 时先调用本工具，按 handoffContract 接续该任务；不要 task_start 新任务代替。返回原项目、对象、提示词和唯一交接输出路径。已出图应写回原任务，或用 task_complete_handoff 完成；查到原任务 succeeded 才算交接完成。', schema: z.object({ taskId: id }).strict(), openWorld: true },
  task_complete_handoff: {description:'完成已有 WorkBuddy 图片任务，不生成、不新建任务、不直接采用。taskId 必须是网页或原交接的 ID。filename 为原项目 inbox 中已生成的 PNG，或 assetId 为该项目已入库的对应图片，两者选一。Runtime 原子写入原任务 result.png 并按正常链路校验；继续 task_get 至 succeeded。以任务 ID 和图片内容幂等，拒绝覆盖不同结果。',schema:z.object({taskId:id,filename:z.string().regex(/^[a-zA-Z0-9_-]{1,80}\.png$/).optional(),assetId:id.optional()}).strict().refine(v=>Boolean(v.filename)!==Boolean(v.assetId),'filename 与 assetId 必须且只能填写一个。')},
  task_cancel: { description: '取消本地等待；已发出的供应商/WorkBuddy 作业不保证被远程取消。后续 task_get 仍可找回已完成结果，采用需单独确认。', schema: z.object({ taskId: id }).strict(), destructive: true },
  task_dismiss: { description: '收起已结束或已核实的 uncertain 任务。确认原等待已有后续同对象任务时，可传 replacementTaskId 标记被接替并移入历史；不根据图片相似猜测关系。不取消远端作业或删除文件。', schema: z.object({ taskId: id, replacementTaskId:id.optional() }).strict() },
  task_adopt: { description: '采用成功任务结果，检查依据与当前项目。对象更新可选 objectIds，正文反向设定建议可选 sectionKeys；一次采用提交选定项。同一采用可安全重试。图像仅放入候选，最终选用请用 image_select 或网页选用此图；首帧候选定稿设置 referenceAssetId。', schema: z.object({ taskId: id, expectedVersion: version,objectIds:z.array(id).max(100).optional(),sectionKeys:z.array(z.string().max(80)).max(10).optional() }).strict() },
  media_import: { description: '导入 project_get 返回的 inbox 中的实际文件；仅简单文件名，图片 20 MB、音视频 128 MB。图像加入素材库；镜头/旁白/配乐直接挂到对应位置。媒体处理可能需要最多 3 分钟。', schema: z.object({ ...mutation, filename: z.string().regex(/^[a-zA-Z0-9_-]{1,80}\.(png|jpg|jpeg|webp|mp4|wav|mp3|m4a)$/), role: z.enum(['image', 'clip', 'audio', 'music']), name: z.string().max(500).default('导入素材'), objectId: id.optional() }).strict() },
  project_deliver: { description: '交付已保存短篇、图片、视频、网站提示词与素材包，或旧网站 HTML/ZIP 的实际路径。网站任务包不代表网站已生成。返回旧结果标记和 missing，不发布网站。', schema: z.object({ projectId: id, format: z.enum(['all', 'txt', 'md']).default('all') }).strict() },
};

// Fixed allowlist: this compatibility entry cannot call itself or bypass core validation.
coreTools.workbench_call_json = {
  description:'WorkBuddy 参数序列化兼容入口。仅在标准工具数组/对象传参失败时使用：tool 选已有核心工具，argumentsJson 为完整 JSON 对象字符串，数组写为真正 JSON 数组。沿用相同 requestId 和 expectedVersion，仍执行全部校验、权限边界与幂等规则；不执行代码，不发任意 HTTP 请求。',
  schema:z.object({tool:z.enum(Object.keys(coreTools)),argumentsJson:z.string().min(2).max(2*1024*1024)}).strict(),
  destructive:true,openWorld:true,
};
