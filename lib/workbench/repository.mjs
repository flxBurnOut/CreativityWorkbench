import { mkdir, readFile, rename, writeFile, readdir, realpath, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ServiceError } from './errors.mjs';
import { outputId, validateVideo, validateWebsite, validateWebsitePrompt, projectOutputIds } from './output-contract.mjs';
import { recordChanges, projectForType, FLOW_TYPES, BRANCH_FIELDS, validateFlowState } from './workflow.mjs';
import {inspectWebsiteZip} from './workflow-delivery.mjs';

export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
export const fileIdentifier = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const types = ['undecided', 'novel', 'video', 'craft', 'website'];
const string = (value, max = 100000) => typeof value === 'string' && value.length <= max;
const strings = value => record(value) && Object.values(value).every(v => string(v));
function requireValid(ok, message = '项目数据格式无效，未覆盖已有文件。') { if (!ok) throw new ServiceError(400, 'invalid_input', message); }

export function validateWorkspace(ws) {
  requireValid(record(ws) && Array.isArray(ws.projects) && ws.projects.length <= 500 && (ws.activeProjectId === null || identifier(ws.activeProjectId)));
  const projectIds = new Set();
  for (const p of ws.projects) {
    requireValid(record(p) && identifier(p.id) && !p.id.startsWith('demo-') && !projectIds.has(p.id) && types.includes(p.type));
    projectIds.add(p.id);
    requireValid(string(p.title, 200) && ['idea', 'brief', 'culture'].every(k => string(p[k])) && Number.isInteger(p.stage) && p.stage >= 0 && p.stage < 5 && Number.isFinite(p.createdAt) && Number.isFinite(p.updatedAt));
    requireValid(record(p.content) && types.every(t => strings(p.content[t])) && record(p.art) && ['direction','material','palette','constraints','fullPrompt'].every(k => string(p.art[k])));
    requireValid(record(p.delivery) && ['notes','textFormat','ratio','duration'].every(k => string(p.delivery[k])) && Array.isArray(p.requests) && p.requests.length === 5 && p.requests.every(v => string(v)));
    requireValid(typeof p.manualCover === 'boolean' && typeof p.upstreamChanged === 'boolean' && Array.isArray(p.assets) && p.assets.length <= 500);
    const assetIds = new Set();
    for (const a of p.assets) {
      requireValid(record(a) && identifier(a.id) && !assetIds.has(a.id) && string(a.name, 500) && fileIdentifier(a.fileId) && !a.blob && !a.demoSrc);
      if (a.source !== undefined) requireValid(strings(a.source) && JSON.stringify(a.source).length <= 100000);
      assetIds.add(a.id);
    }
    const optionalAsset = id => id === undefined || assetIds.has(id);
    requireValid(optionalAsset(p.coverAssetId), `项目 ${p.id} 的 coverAssetId 引用不存在的素材 ${p.coverAssetId}，请先清除封面引用。`);
    for (const r of Array.isArray(p.references) ? p.references : []) if (record(r)) requireValid(assetIds.has(r.assetId), `项目 ${p.id} 的 references.${r.id}.assetId 引用不存在的素材 ${r.assetId}，请先移除该参考。`);
    requireValid(Array.isArray(p.references) && p.references.length <= 100 && p.references.every(r => record(r) && identifier(r.id) && assetIds.has(r.assetId) && string(r.purpose, 4000)));
    requireValid(Array.isArray(p.concepts) && p.concepts.length <= 100);
    const conceptIds = new Set();
    for (const c of p.concepts) {
      if (record(c)) for (const key of ['candidateAssetId','savedAssetId']) requireValid(optionalAsset(c[key]), `项目 ${p.id} 的 concepts.${c.id}.${key} 引用不存在的素材 ${c[key]}，请先清除该引用。`);
      requireValid(record(c) && identifier(c.id) && !conceptIds.has(c.id) && ['character','map','object'].includes(c.category) && ['name','description','prompt','revisionRequest'].every(k => string(c[k])) && optionalAsset(c.candidateAssetId) && optionalAsset(c.savedAssetId));
      conceptIds.add(c.id);
    }
    if (p.novel !== undefined) requireValid(record(p.novel) && string(p.novel.title, 200) && string(p.novel.text, 100000) && string(p.novel.taskId, 80));
    try { if (p.video) { validateVideo(p.video); for (const s of p.video.shots) requireValid(optionalAsset(s.referenceAssetId), `镜头 ${s.id} 的首帧引用不存在。`); } if (p.website) validateWebsite(p.website, assetIds); if(p.websiteRequest)validateWebsitePrompt(p.websiteRequest,assetIds); }
    catch (e) { requireValid(false, e.message); }
    try { validateFlowState(p); } catch(e) { requireValid(false,e.message); }
    if(p.variants!==undefined) {
      requireValid(record(p.variants)&&Object.keys(p.variants).every(k=>FLOW_TYPES.includes(k)),'类型草稿无效。');
      requireValid(Object.values(p.variants).every(b=>record(b)&&Object.keys(b).every(k=>BRANCH_FIELDS.includes(k))),'类型草稿包含不允许的项目字段。');
      for(const type of Object.keys(p.variants))if(type!==p.type){const branch={...projectForType(p,type)};delete branch.variants;delete branch.flow;validateWorkspace({projects:[branch],activeProjectId:null});}
    }
  }
  requireValid(ws.activeProjectId === null || projectIds.has(ws.activeProjectId));
  return ws;
}

export function createRepository(directory) {
  const root = resolve(directory);
  let queue = Promise.resolve();
  const serial = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  const fileLocks = new Map();
  const taskCache = new Map();
  const inspectedSources = new Set();
  async function checkSources(p) {
    for(const branch of [p,...Object.values(p.variants||{})])for(const source of [branch.websiteSource,branch.websiteSourceCandidate].filter(Boolean))if(!inspectedSources.has(source.fileId)){inspectWebsiteZip(await output(source.fileId));inspectedSources.add(source.fileId);}
  }
  async function locked(path, action) {
    const operation = (fileLocks.get(path) || Promise.resolve()).then(action);
    const settled = operation.catch(() => {}); fileLocks.set(path, settled);
    try { return await operation; } finally { if (fileLocks.get(path) === settled) fileLocks.delete(path); }
  }
  const file = (...parts) => join(root, ...parts);
  async function json(path, fallback) {
    return locked(path, async () => {
    try { return JSON.parse(await readFile(path, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw new ServiceError(500, 'storage_error', '保存记录无法读取，请保留数据目录并检查文件。'); }
    });
  }
  async function atomic(path, data) {
    return locked(path, async () => {
    const temp = path + '.' + randomUUID() + '.tmp';
    await writeFile(temp, data, { flag: 'wx' });
    // Windows can briefly deny replacement while another reader has the destination open.
    for (let attempt = 0; ; attempt++) {
      try { await rename(temp, path); break; }
      catch (e) {
        if (!['EPERM','EACCES','EBUSY'].includes(e.code) || attempt >= 7) throw e;
        await new Promise(r => setTimeout(r, Math.min(10 * 2 ** attempt, 100)));
      }
    }
    });
  }
  const initialize = async () => { await Promise.all(['media','tasks','handoff','files','render'].map(p => mkdir(file(p), { recursive: true }))); };
  const loadWorkspace = async () => {
    const saved = await json(file('workspace.json'), { version: 1, revision: 0, workspace: { projects: [], activeProjectId: null } });
    requireValid(saved.version === 1 && Number.isSafeInteger(saved.revision) && saved.revision >= 0);
    validateWorkspace(saved.workspace);
    return saved;
  };
  async function recoveryState() {
    const read = async name => { try { return await readFile(file(name), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
    const current = await read('workspace.json');
    const previous = await read('workspace.previous.json');
    const valid = raw => { try { const value = JSON.parse(raw); requireValid(value.version === 1 && Number.isSafeInteger(value.revision) && value.revision >= 0); validateWorkspace(value.workspace); return value; } catch { return null; } };
    const backup = valid(previous);
    return { current, previous, backup, healthy: valid(current), token: digest([current, previous]) };
  }
  async function recoverWorkspace({ action = 'inspect', recoveryToken } = {}) {
    return serial(async () => {
      const state = await recoveryState();
      if (action === 'inspect') return { recoverable: !state.healthy && Boolean(state.backup), recoveryToken: state.token, backupRevision: state.backup?.revision, projectCount: state.backup?.workspace.projects.length || 0, note: state.healthy ? '当前快照可正常读取，无需恢复。' : state.backup ? '可恢复上一版快照；损坏文件会另存，恢复后请检查最近修改。' : '没有可用的上一版快照，请保留数据目录并从备份导入。' };
      if (action !== 'restore' || typeof recoveryToken !== 'string') throw new ServiceError(400, 'invalid_input', '请先检查恢复快照，再提交 recoveryToken。');
      if (state.healthy?.recoveryToken === recoveryToken) return { restored: true, replayed: true, revision: state.healthy.revision };
      if (state.token !== recoveryToken) throw new ServiceError(409, 'conflict', '快照已变化，请重新检查，未覆盖当前数据。');
      if (state.healthy || !state.backup) throw new ServiceError(409, 'recovery_unavailable', '当前无需恢复或没有可用的上一版快照。');
      await initialize();
      const preserved = state.current === null ? undefined : 'workspace.damaged.' + randomUUID() + '.json';
      if (preserved) await atomic(file(preserved), state.current);
      const restored = { ...state.backup, revision: state.backup.revision + 1, recoveryToken };
      delete restored.writeId; delete restored.hash;
      await atomic(file('workspace.json'), JSON.stringify(restored));
      return { restored: true, revision: restored.revision, preserved, note: '已恢复上一版快照，原损坏文件已保留。请刷新工作台并检查最近修改。' };
    });
  }
  async function saveWorkspace(workspace, expectedRevision, writeId) {
    validateWorkspace(workspace);
    requireValid(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 && identifier(writeId));
    return serial(async () => {
      await initialize();
      const old = await loadWorkspace();
      const hash = digest(workspace);
      if (old.writeId === writeId) {
        if (old.hash !== hash) throw new ServiceError(409, 'conflict', '同一保存请求的内容发生变化。');
        return old.revision;
      }
      if (old.revision !== expectedRevision) throw new ServiceError(409, 'conflict', '另一页面已保存新版本。请先导出当前草稿，再刷新读取；未覆盖已有项目。');
      workspace={...workspace,projects:workspace.projects.map(p=>recordChanges(old.workspace.projects.find(o=>o.id===p.id),p))};
      validateWorkspace(workspace);
      for (const p of workspace.projects) for (const asset of p.assets) await media(asset.fileId);
      for (const p of workspace.projects) for (const id of projectOutputIds(p)) await output(id);
      for(const p of workspace.projects)await checkSources(p);
      // Keep the previous confirmed snapshot for recovery. Unreferenced media are retained for undo/history.
      if (old.revision) await atomic(file('workspace.previous.json'), JSON.stringify(old));
      const revision = old.revision + 1;
      await atomic(file('workspace.json'), JSON.stringify({ version: 1, revision, writeId, hash, workspace, coreReceipts: old.coreReceipts || {} }));
      return revision;
    });
  }
  // Core operations and Web saves share this lock and one atomic workspace file.
  // Receipts make a lost MCP response safe to retry, even after later Web saves.
  async function coreReceipt(operationId, requestHash, legacyHash) {
    const saved = await loadWorkspace();
    const prior = saved.coreReceipts?.[digest(operationId)];
    if (prior && prior.requestHash !== requestHash && prior.requestHash !== legacyHash) throw new ServiceError(409, 'conflict', '此 requestId 已用于另一项操作，请勿改变重试参数。');
    return prior?.result;
  }
  async function mutateProject({ operationId, requestHash, projectId, expectedVersion, create = false, legacyHash }, transform) {
    return serial(async () => {
      await initialize();
      const old = await loadWorkspace();
      const prior = old.coreReceipts?.[digest(operationId)];
      if (prior) {
        if (prior.requestHash !== requestHash && prior.requestHash !== legacyHash) throw new ServiceError(409, 'conflict', '此 requestId 已用于另一项操作，请勿改变重试参数。');
        return { ...prior.result, replayed: true };
      }
      const current = old.workspace.projects.find(p => p.id === projectId);
      if (create ? Boolean(current) : !current) throw new ServiceError(409, 'conflict', create ? '项目 ID 已存在。' : '项目已不存在，请重新读取项目列表。');
      if (!create && digest(current) !== expectedVersion) throw new ServiceError(409, 'conflict', '项目已有新版本，请重新读取并合并修改；未覆盖已有内容。');
      const { project, ...details } = await transform(current);
      requireValid(project.id === projectId);
      const updated = { ...recordChanges(current,project), updatedAt: Date.now() };
      const workspace = { ...old.workspace, projects: create ? [...old.workspace.projects, updated] : old.workspace.projects.map(p => p.id === projectId ? updated : p), activeProjectId: old.workspace.activeProjectId || projectId };
      validateWorkspace(workspace);
      for (const asset of updated.assets) await media(asset.fileId);
      for (const id of projectOutputIds(updated)) await output(id);
      await checkSources(updated);
      const revision = old.revision + 1;
      const result = { projectId, projectVersion: digest(updated), revision, ...details };
      const coreReceipts = { ...old.coreReceipts, [digest(operationId)]: { requestHash, result } };
      // Bounded receipts; old retries still fail version/ID checks instead of overwriting.
      const entries = Object.entries(coreReceipts).slice(-1000);
      if (old.revision) await atomic(file('workspace.previous.json'), JSON.stringify(old));
      await atomic(file('workspace.json'), JSON.stringify({ version: 1, revision, workspace, coreReceipts: Object.fromEntries(entries) }));
      return result;
    });
  }
  async function inbox(projectId) {
    requireValid(identifier(projectId));
    const directory = file('inbox', projectId);
    await mkdir(directory, { recursive: true });
    await assignedDirectory('inbox', projectId);
    return directory;
  }
  // Canonicalize the trusted data root, not the user-selected file. macOS /var
  // and /tmp aliases are valid roots; links inside inbox/handoff remain forbidden.
  async function assignedDirectory(category, id) {
    const expected = join(await realpath(root), category, id);
    const actual = await realpath(file(category, id));
    const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (normalize(actual) !== normalize(expected)) throw new ServiceError(400, 'invalid_file', '交接目录不能链接到其他目录。');
  }
  async function assignedFile(category, id, name) {
    const target = file(category, id, name);
    const expected = join(await realpath(root), category, id, name);
    const actual = await realpath(target);
    const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (normalize(actual) !== normalize(expected)) throw new ServiceError(400, 'invalid_file', '交接文件不能链接到其他文件或目录。');
    return actual;
  }
  async function readInbox(projectId, name) {
    requireValid(/^[a-zA-Z0-9_-]{1,80}\.(png|jpg|jpeg|webp|mp4|wav|mp3|m4a|zip)$/.test(name), '请使用 inbox 内的简单文件名，如 reference.png；不接受任意文件路径。');
    await inbox(projectId);
    try {
      const target = await assignedFile('inbox', projectId, name);
      const info = await stat(target);
      const image = /\.(png|jpg|jpeg|webp)$/.test(name);
      if (!info.isFile() || info.size > (image ? 20 : 128) * 1024 * 1024) throw new ServiceError(413, 'too_large', '导入文件超过大小限制。');
      return await readFile(target);
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError(404, 'missing_file', '请先将实际文件完整写入项目 inbox，再执行导入。');
    }
  }
  async function exportText(text, extension) {
    requireValid(['txt', 'md'].includes(extension));
    const id = digest(text) + '.' + extension;
    await mkdir(file('exports'), { recursive: true });
    await atomic(file('exports', id), text);
    return { fileId: id, path: file('exports', id), url: '/v1/exports/' + id };
  }
  async function readExport(id) {
    requireValid(/^[a-f0-9]{64}\.(md|txt)$/.test(id));
    try { return await locked(file('exports', id), () => readFile(file('exports', id))); }
    catch { throw new ServiceError(404, 'missing_file', '导出文件不存在，请重新导出。'); }
  }
  async function putImage(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length > 20 * 1024 * 1024 || !bytes.length) throw new ServiceError(413, 'too_large', '图片须小于 20 MB。');
    let result;
    try {
      const image = sharp(bytes, { limitInputPixels: 40000000, failOn: 'warning', animated: false });
      const metadata = await image.metadata();
      if (!['png','jpeg','webp'].includes(metadata.format) || (metadata.pages ?? 1) > 1) throw new Error('format');
      result = await image.rotate().png().toBuffer({ resolveWithObject: true });
    } catch { throw new ServiceError(400, 'invalid_image', '图片无法解码，请使用有效的 PNG、JPG 或 WebP 静态图片。'); }
    if (result.data.length > 32 * 1024 * 1024) throw new ServiceError(413, 'too_large', '解码后的图片过大，请缩小后重试。');
    await initialize();
    const id = digest(result.data);
    await atomic(file('media', id + '.png'), result.data);
    return { fileId: id, width: result.info.width, height: result.info.height, mime: 'image/png' };
  }
  async function media(id) {
    if (!fileIdentifier(id)) throw new ServiceError(400, 'invalid_input', '图片标识无效。');
    try { const path = file('media', id + '.png'); return await locked(path, () => readFile(path)); }
    catch { throw new ServiceError(404, 'missing_image', '原始图片不存在，请重新上传。'); }
  }
  async function listTasks() {
    await initialize();
    const names = (await readdir(file('tasks'))).filter(n => /^[a-zA-Z0-9_-]{1,80}\.json$/.test(n));
    const live = new Set(names);
    for (const name of taskCache.keys()) if (!live.has(name)) taskCache.delete(name);
    return Promise.all(names.map(async name => {
      const path = file('tasks', name);
      const info = await stat(path);
      const signature = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
      const cached = taskCache.get(name);
      if (cached?.signature === signature) return structuredClone(cached.value);
      const value = await json(path);
      taskCache.set(name, { signature, value });
      return structuredClone(value);
    }));
  }
  async function task(id) { if (!identifier(id)) throw new ServiceError(400, 'invalid_input', '任务标识无效。'); return json(file('tasks', id + '.json'), null); }
  async function saveTask(value) {
    if (!identifier(value.id)) throw new ServiceError(400, 'invalid_input', '任务标识无效。');
    await initialize(); await atomic(file('tasks', value.id + '.json'), JSON.stringify(value));
    return value;
  }
  async function putOutput(bytes, extension) {
    if (!['mp4','wav','html','zip','srt'].includes(extension) || !Buffer.isBuffer(bytes) || bytes.length > 128 * 1024 * 1024 || (!bytes.length && extension !== 'srt')) throw new ServiceError(400, 'invalid_file', '成品文件格式或大小无效。');
    await initialize(); const fileId = digest(bytes) + '.' + extension;
    await atomic(file('files', fileId), bytes); return { fileId };
  }
  async function output(id) {
    if (!outputId(id)) throw new ServiceError(400, 'invalid_file', '成品文件标识无效。');
    try { return await locked(file('files', id), () => readFile(file('files', id))); }
    catch { throw new ServiceError(404, 'missing_file', '成品文件不存在，请恢复备份或重新生成。'); }
  }
  async function handoff(id, prompt, images, extension = 'png') {
    if (!['png','mp4','wav'].includes(extension)) throw new ServiceError(400, 'invalid_file', '交接格式无效。');
    if (!identifier(id)) throw new ServiceError(400, 'invalid_input', '任务标识无效。');
    await initialize();
    const directory = file('handoff', id); await mkdir(directory, { recursive: true });
    await assignedDirectory('handoff', id);
    const inputs = [];
    for (let i = 0; i < images.length; i++) {
      const path = join(directory, `input-${i + 1}.png`); await atomic(path, images[i]); inputs.push(path);
    }
    const output = join(directory, 'result.' + extension);
    await atomic(join(directory, 'request.json'), JSON.stringify({ taskId: id, prompt, inputImages: inputs, output, failureFile: join(directory, 'error.json') }, null, 2));
    return { directory, requestPath: join(directory, 'request.json'), output };
  }
  async function readHandoff(id, extension = 'png') {
    if (!['png','mp4','wav'].includes(extension)) return null;
    if (!identifier(id)) return null;
    try {
      // Accept only the assigned file, never paths supplied by model text or arbitrary reply URLs.
      const target = await assignedFile('handoff', id, 'result.' + extension);
      const info = await stat(target);
      if (!info.isFile()) throw new ServiceError(400, 'invalid_file', '交接结果必须是文件。');
      if (info.size > (extension === 'png' ? 20 : 128) * 1024 * 1024) throw new ServiceError(413,'too_large','交接文件超过接收大小，请减小后写回。');
      return { bytes: await readFile(target) };
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      if (e.code !== 'ENOENT') throw e;
      try {
        const failure = await assignedFile('handoff', id, 'error.json');
        const info = await stat(failure);
        if (!info.isFile() || info.size > 4096) throw new ServiceError(400, 'invalid_file', '交接错误记录无效。');
        return (await json(failure, null)) ? { failed: true } : null;
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    }
  }
  return { root, initialize, loadWorkspace, recoverWorkspace, saveWorkspace, coreReceipt, mutateProject, inbox, readInbox, exportText, readExport, putImage, media, putOutput, output, listTasks, task, saveTask, handoff, readHandoff };
}
