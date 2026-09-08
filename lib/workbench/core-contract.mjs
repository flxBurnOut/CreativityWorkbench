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
const shot = z.object({ id, title: short, visual: short, camera: short, duration: z.number().int().min(2).max(10), narration: short, subtitle: short, revision: short, referenceAssetId: id.optional(), clip: media.optional(), audio: media.optional() }).strict();
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
  concepts: z.array(z.object({ id, category: z.enum(['character', 'map', 'object']), name: text, description: text, prompt: text, revisionRequest: text, candidateAssetId: id.optional(), savedAssetId: id.optional() }).strict()).max(100).optional(),
  coverAssetId: id.nullable().optional(), manualCover: z.boolean().optional(),
  novel: z.object({ title: z.string().max(200), text, taskId: z.string().max(80).default('workbuddy-conversation') }).strict().optional(),
  video: z.object({ ratio: z.enum(['16:9', '9:16']), shots: z.array(shot).max(12), burnSubtitles: z.boolean(), keepAudio: z.boolean(), music: media.nullable().optional(), final: finalMedia.optional() }).strict().optional(),
  website: z.object({ spec: siteSpec }).strict().optional(),
}).strict().refine(value => Object.keys(value).length > 0, '至少提交一个修改字段。');
const args = z.object({
  action: z.enum(['generate', 'improve', 'redirect', 'revise', 'alternative', 'check', 'section', 'selection', 'edit']).optional(),
  provider: z.enum(['workbuddy', 'external']).optional(), ratio: z.enum(['1:1', '3:2', '2:3']).optional(),
  objectId: id.optional(), newStyle: z.boolean().optional(), key: z.string().max(80).optional(),
  start: z.number().int().min(0).optional(), end: z.number().int().min(1).optional(), selectedText: z.string().max(8000).optional(),
}).strict();

// One schema catalog validates both MCP and HTTP core operations.
export const coreTools = {
  workbench_status: { description: '检查共享 Runtime、服务配置和核心能力。只返回配置状态，不返回密钥。', schema: z.object({}).strict(), readOnly: true },
  storage_cleanup: { description: '预览已成功导入的 handoff/inbox 冗余源文件，默认保留 7 天。核对范围后 execute=true 并传 confirmationToken 才删除；不删除项目、任务、未导入文件或已保存成品。', schema: z.object({ execute: z.boolean().default(false), confirmationToken: z.string().regex(/^[a-f0-9]{64}$/).optional(), minimumAgeDays: z.number().int().min(0).max(3650).default(7) }).strict(), destructive: true, idempotent: false },
  workspace_recover: { description: '检查上一版工作区快照；仅当前快照损坏或丢失时可恢复。先 inspect，再使用返回的 recoveryToken restore；保留损坏原文件。', schema: z.object({ action: z.enum(['inspect','restore']).default('inspect'), recoveryToken: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(), destructive: true },
  project_list: { description: '分页列出已有项目，返回 ID、名称、类型和版本、total 及 nextOffset；不创建演示项目。', schema: z.object({ offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(500).default(100) }).strict(), readOnly: true },
  project_get: { description: '读取项目完整草稿、projectVersion 和受控 inbox 路径。编辑或提交任务前调用。', schema: z.object({ projectId: id }).strict(), readOnly: true },
  project_create: { description: '保存新创意项目。requestId 用于幂等重试；craft 仅记录 3D 想法，尚无 3D 生成。', schema: z.object({ requestId: id, idea: z.string().trim().min(1).max(100000), title: z.string().max(200).default(''), type: workType.default('undecided') }).strict() },
  project_update: { description: '保存 WorkBuddy 对话创作的文字、概念设定、分镜或网站结构。嵌套对象合并，数组整体替换；保留未改字段。必须基于最近版本。', schema: z.object({ ...mutation, patch }).strict() },
  task_start: { description: '提交已有生成器任务；异步返回后查询 task_get，成功后 task_adopt。图片/镜头默认跟随设置；WorkBuddy 使用当前对话文件交接，不再发送消息。相同 ID 只查询原请求，失败后明确重新生成须使用新 requestId 和 retryOf；可能产生新费用。文字任务调用已配置 DeepSeek；video-compose / website-build 在本机执行。', schema: z.object({ ...mutation, kind: z.enum(taskKinds), args: args.default({}), retryOf: id.optional() }).strict(), openWorld: true },
  task_list: { description: '列出项目任务的状态。任务查询可能接收已写回的文件或查询现有供应商作业，不重新提交生成。', schema: z.object({ projectId: id }).strict(), openWorld: true },
  task_get: { description: '查询任务状态、生成结果及 WorkBuddy 文件交接路径。waiting 状态继续处理交接；uncertain 先核实，禁止换 ID 盲目重发。', schema: z.object({ taskId: id }).strict(), openWorld: true },
  task_cancel: { description: '取消本地等待；已发出的供应商/WorkBuddy 作业不保证被远程取消。后续 task_get 仍可找回已完成结果，采用需单独确认。', schema: z.object({ taskId: id }).strict(), destructive: true },
  task_dismiss: { description: '收起已结束或已核实的 uncertain 任务，释放同类任务占位。收起不取消供应商作业；新生成可能另行计费。', schema: z.object({ taskId: id }).strict() },
  task_adopt: { description: '采用成功任务结果，检查生成依据与当前项目；旧结果不会覆盖新稿。同一任务采用可安全重试。概念图采用后是候选图，定稿需 project_update 设置 savedAssetId。', schema: z.object({ taskId: id, expectedVersion: version }).strict() },
  media_import: { description: '导入 project_get 返回的 inbox 中的实际文件；仅简单文件名，图片 20 MB、音视频 128 MB。图像加入素材库；镜头/旁白/配乐直接挂到对应位置。媒体处理可能需要最多 3 分钟。', schema: z.object({ ...mutation, filename: z.string().regex(/^[a-zA-Z0-9_-]{1,80}\.(png|jpg|jpeg|webp|mp4|wav|mp3|m4a)$/), role: z.enum(['image', 'clip', 'audio', 'music']), name: z.string().max(500).default('导入素材'), objectId: id.optional() }).strict() },
  project_deliver: { description: '导出已保存的短篇 TXT/Markdown，或获取已采用图片、视频 MP4/SRT、网站 HTML/ZIP 的实际路径与下载地址。返回旧成品标记；缺失文件列入 missing，其余文件仍可交付，不发布网站。', schema: z.object({ projectId: id, format: z.enum(['all', 'txt', 'md']).default('all') }).strict() },
};
