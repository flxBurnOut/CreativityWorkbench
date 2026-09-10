import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { generateJson } from './adapters/text.mjs';
import { CRAFT_KINDS, CRAFT_PLAN_SCHEMA, CRAFT_PARAMETER_RULES, normalizeCraftPlan } from './craft-contract.mjs';
import { buildCraftAsset, craftEngineStatus } from './craft-engine.mjs';
import { ServiceError } from './errors.mjs';
import { currentKnowledge, selectedKnowledge, knowledgeText } from './knowledge.mjs';
import { CULTURAL_RULES } from './prompts.mjs';
import { digest } from './repository.mjs';
import { sameTaskSource, taskSource } from './task-contract.mjs';
import { branchOf, projectForType, recordChanges, fingerprint, dependencySnapshot } from './workflow.mjs';
import {validateCraftAsset} from './craft-asset-contract.mjs';
import {craftTextureStatus} from './craft-texture-config.mjs';
import {startCraftTexture} from './craft-texture-runtime.mjs';
import {startCraftPattern,craftPatternStatus} from './craft-pattern-runtime.mjs';

const fail = (message, code = 'invalid_craft_plan', status = 400) => { throw new ServiceError(status, code, message); };
const normalizePath = value => process.platform === 'win32' ? value.toLowerCase() : value;
async function cleanupCraftDirectory(directory, owned, parent) {
  try {
    const actual = await realpath(directory);
    if (normalizePath(actual) !== normalizePath(owned) || !normalizePath(actual).startsWith(normalizePath(parent + sep))) throw Error('Model temporary directory changed ownership');
    await rm(actual, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export function parseCraftPlan(value) {
  try {
    if (typeof value === 'string') {
      if (value.length > 16000) fail('建模要求过长，请精简为一件资产。');
      value = JSON.parse(value);
    }
    return normalizeCraftPlan(value);
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    fail('建模结构无效：' + (error instanceof Error ? error.message : '请按支持的结构重新整理。'));
  }
}

export function validateCraftTask(input, project) {
  if (project.type !== 'craft') fail('请在 3D 文创项目中生成资产。');
  const args = input.args;
  if (!args || Object.keys(args).some(key => !['prompt', 'planJson', 'textureSource', 'texturePrompt','textureMode','provider','handoffOnly'].includes(key)) || typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 4000) fail('请用 4000 字以内描述一件器具或建筑资产。');
  if (project.craftRequest?.taskId !== input.id || project.craftRequest.goal !== args.prompt) fail('请使用 craft_generate 创建并关联本次 3D 任务，已有任务用 craft_complete_plan 接续。');
  if (args.planJson !== undefined) parseCraftPlan(args.planJson);
  if (args.textureSource) {
    if (args.planJson !== undefined) fail('纹理增强不能同时重新建模。');
    validateCraftAsset(args.textureSource);
    if (typeof args.texturePrompt !== 'string' || !args.texturePrompt.trim() || Array.from(args.texturePrompt).length > 200) fail('纹理描述须为 200 字以内。');
    if(args.textureMode!==undefined&&!['image','hy'].includes(args.textureMode))fail('纹理模式无效。');
    if(args.textureMode==='image'&&!['workbuddy','external'].includes(args.provider))fail('图案需要有效的图像服务。');
    if(args.handoffOnly!==undefined&&typeof args.handoffOnly!=='boolean')fail('图片交接方式无效。');
  } else if(args.textureMode!==undefined||args.provider!==undefined||args.handoffOnly!==undefined) {
    fail('图案选项需要指定已有模型。');
  }
}

export async function craftGenerationStatus(env = process.env) {
  const engine = await craftEngineStatus(env);
  return {
    available: engine.available, message: engine.message,
    planner: env.DEEPSEEK_API_KEY?.trim() ? 'deepseek' : 'workbuddy',
    supportedKinds: CRAFT_KINDS,
    texture: craftTextureStatus(env),
    pattern: craftPatternStatus(env),
    limits: { simultaneousBlenderProcesses: 1, fileMiB: 32, memoryMiB: 1024, processTimeoutSeconds: 180 },
    scope: '单件器皿、器具、建筑构件与简化建筑单体；生成真实 Mesh，查看与下载，不提供模型直接编辑。',
  };
}

export function craftKnowledge(project, prompt) {
  const generic = new Set(['岭南', '广东', '广州', '建筑', '传统', '文化', '文创', '器物']);
  const text = prompt.toLocaleLowerCase();
  const matched = currentKnowledge.entries.filter(entry => entry.tags.some(tag => tag.length >= 2 && !generic.has(tag) && text.includes(tag.toLocaleLowerCase())));
  const chosen = selectedKnowledge(project);
  return [...new Map([...chosen, ...matched.map(entry => ({ ...entry, version: currentKnowledge.version }))].map(entry => [entry.id, entry])).values()].slice(0, 6).map(({ id, version }) => ({ id, version }));
}

export function craftPlanningPrompt() {
  return `你是受控三维资产建模规划器。把用户的一句话转换为一件可制作的三维资产结构，不输出程序、Python、网址或任意可执行内容。
${CULTURAL_RULES}
只支持以下结构：碗/盘/盆/瓶/罐/锅/瓢/茶壶，以及简化骑楼单体、窗格、柱廊、屋顶。部件由内置建模规则构造；不支持任意雕塑、人物、整条街道、建筑测绘复原、定制文字雕刻或复杂动物浮雕。用户的核心要求无法表达时，返回 {"unsupported":"清楚说明目前不能实现的部分"}，不要擅自用相似形状假装完成。
每次只生成一件资产，器具上的盖子、把手、壶嘴属于同一件。尺寸单位为厘米。建筑与器具尺寸范围不同，按 schema 校验；未给尺寸时保守使用结构默认值，不凭空声称尺寸是史实。深度对器皿可等于宽度。
${CRAFT_PARAMETER_RULES}
title须避免声称是传统实物复原；广彩指装饰工艺，不能把任意纹样当作传统实物复刻。floral 为工作台原创花叶装饰，lattice 为原创几何装饰，plain 为纯色。只有用户要求时选择相关装饰，不强行添加无关文化元素。不将资料中的图片或外部链接作为贴图。
输出 {"plan":按以下 schema 的对象,"notes":["最多8条，说明简化或默认尺寸；每条不超过300字"]}。字段可省略以使用默认值；仅填有把握且受支持的参数。支持 schema：
${JSON.stringify(CRAFT_PLAN_SCHEMA)}`;
}

export function craftHandoffInstructions(task, knowledge) {
  return `请接续创意工作台已创建的原 3D 任务，不新建任务。\n任务 ID：${task.id}\n项目 ID：${task.projectId}\n本轮需求：${task.args.prompt}\n\n先 task_get({"taskId":"${task.id}"}) 核对任务状态。你只需理解需求并给出受控结构，Blender 由 Runtime 自动执行。严格遵守以下规划规则：\n${craftPlanningPrompt()}\n\n${knowledgeText({ knowledge })}\n\n若能表达，请调用 craft_complete_plan({"taskId":"${task.id}","planJson":"仅 plan 对象的 JSON 字符串"})；保留原任务 ID。不要返回 Python，不另造模型生成任务，不直接往媒体库导入文件。若明确不能表达核心需求，请告诉用户原因并结束原等待，不用可视相似物冒充。提交后 task_get 查询到 succeeded，再通过 project_deliver 或任务里的 blendFileId/glbFileId 查看交付；成功后网页自动展示，不需要 task_adopt。`;
}

export async function runCraftTask(task, { repository, env = process.env, fetchImpl = fetch, signal, update, buildImpl = buildCraftAsset }) {
  signal?.throwIfAborted();
  if (task.args.textureSource) {
    if(task.args.textureMode==='image') {
      return startCraftPattern(task,{repository,env,fetchImpl,signal,update});
    }
    return startCraftTexture(task, {repository, env, fetchImpl, signal, update});
  }
  if (buildImpl === buildCraftAsset) {
    const engine = await craftEngineStatus(env);
    if (!engine.available) fail(engine.message, 'craft_engine_unavailable', 503);
  }
  const knowledge = craftKnowledge(task.snapshot, task.args.prompt);
  await update({ phase: 'planning', note: '正在整理器形、部件和材质要求。' });
  let plan, notes = [], planner = 'workbuddy';
  if (task.craftPlan || task.args.planJson !== undefined) plan = parseCraftPlan(task.craftPlan || task.args.planJson);
  else if (env.DEEPSEEK_API_KEY?.trim()) {
    planner = 'deepseek';
    const { value } = await generateJson(craftPlanningPrompt(), { requirement: task.args.prompt, culturalKnowledge: knowledgeText({ knowledge }) }, { env, fetchImpl, signal });
    if (typeof value?.unsupported === 'string') fail(value.unsupported.slice(0, 1000), 'unsupported_craft');
    plan = parseCraftPlan(value?.plan);
    if (value.notes !== undefined && (!Array.isArray(value.notes) || value.notes.length > 8 || value.notes.some(note => typeof note !== 'string' || note.length > 300))) fail('规划说明格式无效，未执行建模。', 'invalid_response', 502);
    notes = value.notes || [];
  } else {
    await update({ status: 'waiting_external', phase: 'planning', handoffInstructions: craftHandoffInstructions(task, knowledge), note: '本机尚未配置文字解析服务。复制本次原任务指令给 WorkBuddy，提交结构后会自动建模。' });
    return null;
  }
  signal?.throwIfAborted();
  await update({ craftPlan: plan, planner, phase: 'building', handoffInstructions: undefined, note: '正在构建网格、内壁与部件；本机同一时间只运行一个建模进程。' });
  await repository.initialize();
  const root = await realpath(repository.root), parent = join(root, 'render');
  await mkdir(parent, { recursive: true });
  if (normalizePath(await realpath(parent)) !== normalizePath(parent)) fail('临时建模目录不能指向其他位置。');
  const directory = await mkdtemp(join(parent, 'craft-')), owned = await realpath(directory);
  try {
    const result = await buildImpl(plan, { directory, signal, env });
    signal?.throwIfAborted();
    await update({ phase: 'checking', note: '正在核对 Blender 文件、预览文件与网格统计，并保存结果。' });
    // Verify both owned outputs before publishing either. Do not read whole
    // .blend and GLB files into simultaneous Node buffers.
    for (const path of [result.blendPath, result.glbPath]) {
      const actual = await realpath(path), info = await stat(actual);
      if (!normalizePath(actual).startsWith(normalizePath(owned + sep)) || !info.isFile() || info.size === 0 || info.size > 32 * 1024 * 1024) fail('模型文件缺失、越界或超过 32 MiB 限制。', 'invalid_craft_output');
    }
    const blend = await repository.putOutputStream(createReadStream(result.blendPath, { highWaterMark: 64 * 1024 }), 'blend');
    signal?.throwIfAborted();
    const glb = await repository.putOutputStream(createReadStream(result.glbPath, { highWaterMark: 64 * 1024 }), 'glb');
    signal?.throwIfAborted();
    return { craftAsset: {
      taskId: task.id, title: plan.title, kind: plan.kind, prompt: task.args.prompt,
      createdAt: task.createdAt, blendFileId: blend.fileId, glbFileId: glb.fileId,
      plan, stats: result.stats, knowledge,
      warnings: [...new Set([...notes, ...(result.warnings || [])])].slice(0, 12),
    } };
  } finally {
    // The engine only returns/rejects once its guarded process has exited.
    // Delete only this operation's verified temporary directory.
    await cleanupCraftDirectory(directory, owned, parent);
  }
}

export async function attachCraftResult(task, repository, knownProject) {
  const asset = task.result?.craftAsset;
  if (task.status !== 'succeeded' || !asset || task.recoveredAfterCancel) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const project = attempt === 0 && knownProject !== undefined ? knownProject : (await repository.loadWorkspace()).workspace.projects.find(p => p.id === task.projectId);
    if (!project) return;
    const craft = projectForType(project, 'craft');
    if (craft.craftAsset?.taskId === task.id || project.flow?.records?.some(record => record.target === 'craftAsset' && record.value?.taskId === task.id)) return;
    try {
      await repository.mutateProject({ projectId: project.id, operationId: 'craft-result:' + task.id, requestHash: digest([asset.blendFileId, asset.glbFileId]), expectedVersion: digest(project) }, current => {
        const before = projectForType(current, 'craft');
        const canSelect = before.craftRequest?.taskId === task.id && before.craftRequest.goal === task.args.prompt && sameTaskSource(taskSource(before, 'craft-model', task.args), task.source);
        if (!canSelect) {
          // A late, valid asset remains deliverable and backed up, but cannot
          // replace the newer selected result or the next editable requirement.
          const record = { id: crypto.randomUUID(), type: 'craft', target: 'craftAsset', createdAt: Date.now(), origin: 'generated-history', taskId: task.id, fingerprint: fingerprint(asset), value: asset, dependencies: dependencySnapshot(task.snapshot, ['craftRequest', 'knowledge']) };
          return { project: { ...current, flow: { version: 1, records: [...(current.flow?.records || []), record] } } };
        }
        const after = recordChanges(before, { ...before, stage: 4, craftAsset: asset }, { origin: 'generated', taskId: task.id, snapshot: task.snapshot });
        return { project: current.type === 'craft' ? after : { ...current, variants: { ...current.variants, craft: branchOf(after) }, flow: after.flow } };
      });
      return;
    } catch (error) { if (error.code !== 'conflict') throw error; }
  }
}
