import { readdir, lstat, realpath, readFile, rm } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { digest, identifier } from './repository.mjs';
import { ServiceError } from './errors.mjs';

// Only redundant, already-imported sources are eligible. Projects, task records,
// unresolved jobs and immutable media/results are never cleanup targets.
export async function cleanupStorage(repository, { execute = false, confirmationToken, minimumAgeDays = 7 } = {}) {
  await repository.initialize();
  const root = await realpath(repository.root);
  const cutoff = Date.now() - minimumAgeDays * 86400000;
  const entries = [];
  const unchangedPath = async path => {
    const actual = await realpath(path);
    const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
    return normalize(actual) === normalize(path) && actual.startsWith(root + sep);
  };
  async function fingerprint(path) {
    if (!await unchangedPath(path)) return null;
    const info = await lstat(path);
    if (!info.isFile() || minimumAgeDays > 0 && info.mtimeMs > cutoff) return null;
    return { size: info.size, hash: digest(await readFile(path)) };
  }
  for (const task of await repository.listTasks()) {
    if (task.status !== 'succeeded' || !task.handoff || !identifier(task.id)) continue;
    const result = task.result?.asset || task.result?.videoClip || task.result?.videoAudio;
    if (!result?.fileId) continue;
    try { if (task.result.asset) await repository.media(result.fileId); else await repository.output(result.fileId); }
    catch { continue; }
    const path = join(root, 'handoff', task.id);
    try {
      if (!await unchangedPath(path)) continue;
      const names = (await readdir(path)).sort();
      if (!names.length || names.some(name => !/^(request\.json|error\.json|input-\d+\.png|result\.(png|mp4|wav))$/.test(name))) continue;
      const files = [];
      for (const name of names) { const value = await fingerprint(join(path, name)); if (!value) break; files.push({ name, ...value }); }
      if (files.length === names.length) entries.push({ path: 'handoff/' + task.id, bytes: files.reduce((sum, f) => sum + f.size, 0), files });
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const saved = await repository.loadWorkspace();
  const seen = new Set();
  for (const receipt of Object.values(saved.coreReceipts || {})) {
    const source = receipt.result?.importedSource;
    if (!source || !identifier(source.projectId) || !/^[a-zA-Z0-9_-]{1,80}\.(png|jpg|jpeg|webp|mp4|wav|mp3|m4a)$/.test(source.filename)) continue;
    const relative = `inbox/${source.projectId}/${source.filename}`;
    if (seen.has(relative)) continue;
    try {
      // The normalized output must still exist, and the inbox file must still be
      // exactly the bytes that were imported; a replacement file is never removed.
      if (/\.(png|jpg|jpeg|webp)$/.test(source.filename)) await repository.media(receipt.result.fileId);
      else await repository.output(receipt.result.fileId);
      const value = await fingerprint(join(root, relative));
      if (!value || value.hash !== source.hash) continue;
      entries.push({ path: relative, bytes: value.size, hash: value.hash }); seen.add(relative);
    } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof ServiceError && e.status === 404)) throw e; }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const token = digest({ minimumAgeDays, entries });
  if (execute && confirmationToken !== token) throw new ServiceError(409, 'cleanup_changed', '请先预览清理范围并核对，再使用该 confirmationToken 执行；文件变化后需重新预览。');
  if (execute) for (const entry of entries) await rm(join(root, entry.path), { recursive: entry.path.startsWith('handoff/'), force: true });
  return { executed: execute, confirmationToken: token, minimumAgeDays, bytes: entries.reduce((sum, item) => sum + item.bytes, 0), entries: entries.map(({ path, bytes }) => ({ path, bytes })), note: execute ? '仅移除了已导入的冗余交接源文件；项目、任务和成品仍保留。' : '仅预览：已成功导入且超过保留天数的交接源文件。执行会删除这些源副本，保留规范化后的素材与成品；未导入文件不会清理。' };
}
