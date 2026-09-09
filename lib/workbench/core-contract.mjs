import { z } from 'zod';
import { taskKinds } from './task-contract.mjs';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const version = z.string().regex(/^[a-f0-9]{64}$/).describe('最近一次 project_get 或写入返回的 projectVersion。冲突后重新读取并合并；修改操作内容须使用新的 requestId。');
const text = z.string().max(100000);
const short = z.string().max(4000);
const workType = z.enum(['undecided', 'novel', 'video', 'website', 'craft']);
const mutation = { requestId: id.describe('本次操作唯一 ID；丢失响应时重放同一操作不会再次执行。修改内容或重新生成须使用新 ID；expectedVersion 可更新。'), projectId: id, expectedVersion: version };
const outputFile = z.string().regex(/^[a-f0-9]{64}\.(mp4|wav|srt)$/);
const mediaFields = { fileId: outputFile, duration: z.number().finite().positive(), source: z.string().max(500000), taskId: id.optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), videoCodec: z.string().max(80).optional(), audio: z.boolean().optional(), prompt: z.string().max(100000).optional(), provider: z.string().max(80).optional() };
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
  concepts: z.array(z.object({ id, category: z.enum(['character', 'map', 'object']), name: text, description: text, prompt: text, revisionRequest: text, candidateAssetId: id.optional(), savedAssetId: id.optional(),sourceKeys:z.array(z.string().max(80)).max(10).optional(),referenceAssetIds:z.array(id).max(5).optional(),usage:short.optional(),inheritedFrom:z.object({type:workType,id}).strict().optional() }).strict()).max(100).optional(),
  novelReferenceIds:z.array(id).max(100).optional(),
  coverAssetId: id.nullable().optional(), manualCover: z.boolean().optional(),
  novel: z.object({ title: z.string().max(200), text, taskId: z.string().max(80).default('workbuddy-conversation') }).strict().optional(),
  video: z.object({ ratio: z.enum(['16:9', '9:16']), shots: z.array(shot).max(12), burnSubtitles: z.boolean(), keepAudio: z.boolean(), music: media.nullable().optional(), final: finalMedia.optional() }).strict().optional(),
  website: z.object({ spec: siteSpec }).strict().optional(),
  websiteRequest: z.object({ prompt:text, basis:z.string().max(500000), assetIds:z.array(id).max(100) }).strict().optional(),
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
  workflow_get:{description:'读取连续创作依据、相关更新和各类型成果版本。inputManifest 与实际任务解析共用；图片仅在 role=attached-image 时作为实际附件，小说只使用确认文字。',schema:z.object({projectId:id,kind:z.enum(taskKinds).optional(),args:args.default({})}).strict(),readOnly:true},
  workflow_update:{description:'显式继承另一类型资料、恢复历史版本或采用导入的网站源码。继承不自动覆盖类型专属内容，而是作为下一次内容适配依据；旧版本保留。',schema:z.object({...mutation,action:z.enum(['inherit','restore','adopt-website-source']),from:workType.optional(),brief:z.boolean().default(true),content:z.boolean().default(true),art:z.boolean().default(false),conceptIds:z.array(id).max(100).default([]),recordId:id.optional()}).strict()},
  website_source_import:{description:'从项目 inbox 导入实际网站源码 ZIP 为候选，不执行代码，不自动采用。输入运行说明和执行端检查记录；之后 workflow_update adopt-website-source，下一轮 website 任务会附上真实源码。',schema:z.object({...mutation,filename:z.string().regex(/^[a-zA-Z0-9_-]{1,80}\.zip$/),description:short.default('导入的网站源码'),instructions:text.default(''),verification:text.default('未提供执行端验证记录'),taskId:id.optional()}).strict()},
  prompt_prepare: { description: '读取当前项目，整理概念图、镜头首帧、单镜头或网站提示词及素材用途。返回 basis 和 projectVersion；不调用模型。可编辑后将视频 prompt/promptBasis 或 websiteRequest 保存，再 task_start。网站交付提示词与素材包，由当前 agent 完整实现，不套工作台模板。', schema:z.object({projectId:id,kind:z.enum(['image','cover','video-frame','video-shot','website']),args:args.default({})}).strict(),readOnly:true },
  workbench_status: { description: '检查共享 Runtime、服务配置和核心能力。只返回配置状态，不返回密钥。', schema: z.object({}).strict(), readOnly: true },
  storage_cleanup: { description: '预览已成功导入的 handoff/inbox 冗余源文件，默认保留 7 天。核对范围后 execute=true 并传 confirmationToken 才删除；不删除项目、任务、未导入文件或已保存成品。', schema: z.object({ execute: z.boolean().default(false), confirmationToken: z.string().regex(/^[a-f0-9]{64}$/).optional(), minimumAgeDays: z.number().int().min(0).max(3650).default(7) }).strict(), destructive: true, idempotent: false },
  workspace_recover: { description: '检查上一版工作区快照；仅当前快照损坏或丢失时可恢复。先 inspect，再使用返回的 recoveryToken restore；保留损坏原文件。', schema: z.object({ action: z.enum(['inspect','restore']).default('inspect'), recoveryToken: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(), destructive: true },
  project_list: { description: '分页列出已有项目，返回 ID、名称、类型和版本、total 及 nextOffset；不创建演示项目。', schema: z.object({ offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(500).default(100) }).strict(), readOnly: true },
  project_get: { description: '读取项目完整草稿、projectVersion 和受控 inbox 路径。编辑或提交任务前调用。', schema: z.object({ projectId: id }).strict(), readOnly: true },
  project_create: { description: '保存新创意项目。requestId 用于幂等重试；craft 仅记录 3D 想法，尚无 3D 生成。', schema: z.object({ requestId: id, idea: z.string().trim().min(1).max(100000), title: z.string().max(200).default(''), type: workType.default('undecided') }).strict() },
  project_update: { description: '保存当前对话创作的文字、概念设定、单镜头或 websiteRequest 提示词。视频 promptBasis 与网站 basis 由 prompt_prepare 返回。嵌套对象合并，数组整体替换；保留未改字段。website.spec 仅用于旧模板记录。必须基于最近版本。', schema: z.object({ ...mutation, patch }).strict() },
  task_start: { description: '提交生成或交接任务，再 task_get / task_adopt。website 只准备网站提示词与实际素材包，不生成网站代码；由当前 agent 完整实现。website-build 仅保留旧模板重建。单镜头 video-shot 无需生成分镜，先保存一个镜头即可。WorkBuddy 使用当前对话交接。文字调用已配置 DeepSeek。相同 requestId 只查询原请求，明确重试用新 ID 和 retryOf；可能产生费用。', schema: z.object({ ...mutation, kind: z.enum(taskKinds), args: args.default({}), retryOf: id.optional() }).strict(), openWorld: true },
  task_list: { description: '列出项目任务的状态。任务查询可能接收已写回的文件或查询现有供应商作业，不重新提交生成。', schema: z.object({ projectId: id }).strict(), openWorld: true },
  task_get: { description: '查询任务状态、生成结果及 WorkBuddy 文件交接路径。waiting 状态继续处理交接；uncertain 先核实，禁止换 ID 盲目重发。', schema: z.object({ taskId: id }).strict(), openWorld: true },
  task_cancel: { description: '取消本地等待；已发出的供应商/WorkBuddy 作业不保证被远程取消。后续 task_get 仍可找回已完成结果，采用需单独确认。', schema: z.object({ taskId: id }).strict(), destructive: true },
  task_dismiss: { description: '收起已结束或已核实的 uncertain 任务，释放同类任务占位。收起不取消供应商作业；新生成可能另行计费。', schema: z.object({ taskId: id }).strict() },
  task_adopt: { description: '采用成功任务结果，检查依据与当前项目。对象更新可选 objectIds，正文反向设定建议可选 sectionKeys；一次采用提交选定项。同一采用可安全重试。图像结果先成为候选，定稿需设置 savedAssetId；首帧候选定稿设置 referenceAssetId。', schema: z.object({ taskId: id, expectedVersion: version,objectIds:z.array(id).max(100).optional(),sectionKeys:z.array(z.string().max(80)).max(10).optional() }).strict() },
  media_import: { description: '导入 project_get 返回的 inbox 中的实际文件；仅简单文件名，图片 20 MB、音视频 128 MB。图像加入素材库；镜头/旁白/配乐直接挂到对应位置。媒体处理可能需要最多 3 分钟。', schema: z.object({ ...mutation, filename: z.string().regex(/^[a-zA-Z0-9_-]{1,80}\.(png|jpg|jpeg|webp|mp4|wav|mp3|m4a)$/), role: z.enum(['image', 'clip', 'audio', 'music']), name: z.string().max(500).default('导入素材'), objectId: id.optional() }).strict() },
  project_deliver: { description: '交付已保存短篇、图片、视频、网站提示词与素材包，或旧网站 HTML/ZIP 的实际路径。网站任务包不代表网站已生成。返回旧结果标记和 missing，不发布网站。', schema: z.object({ projectId: id, format: z.enum(['all', 'txt', 'md']).default('all') }).strict() },
};
