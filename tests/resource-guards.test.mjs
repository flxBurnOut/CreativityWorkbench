import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMediaProcess } from '../lib/workbench/media-process.mjs';
import { createTaskManager } from '../lib/workbench/tasks.mjs';
import { createRepository } from '../lib/workbench/repository.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test('guard preserves Unicode, spaces, quotes and trailing backslashes without a shell', async () => {
  const args = ['中文 空格', 'quote"literal', 'trailing\\', '$(literal)'];
  const output = await runMediaProcess(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...args]);
  assert.deepEqual(JSON.parse(output), args);
});

test('media commands run one at a time and failure releases the queue', async () => {
  const code = 'const start=Date.now();setTimeout(()=>console.log(JSON.stringify([start,Date.now()])),100)';
  const results = await Promise.all([runMediaProcess(process.execPath, ['-e', code]), runMediaProcess(process.execPath, ['-e', code])]);
  const [first, second] = results.map(JSON.parse);
  assert.ok(second[0] >= first[1]);
  await assert.rejects(runMediaProcess(process.execPath, ['-e', 'process.exit(1)']));
  assert.equal((await runMediaProcess(process.execPath, ['-e', 'console.log("ready")'])).trim(), 'ready');
});

test('Windows job denies allocations beyond its commit limit', { skip: process.platform !== 'win32' }, async () => {
  const options = { memoryLimit: 256 * 1024 * 1024 };
  assert.equal((await runMediaProcess(process.execPath, ['-e', 'console.log("guarded")'], options)).trim(), 'guarded');
  // At most 512 MiB requested, under a 256 MiB OS job limit. Never attempt to
  // reproduce the reported 41 GiB exhaustion on the developer machine.
  await assert.rejects(runMediaProcess(process.execPath, ['-e', 'const blocks=[];try{for(let i=0;i<64;i++)blocks.push(Buffer.alloc(8*1024*1024,1));}catch{process.exit(23)}'], options), e => e.code === 'media_processing_failed');
});

test('cancelling the Windows guard terminates the actual media child', { skip: process.platform !== 'win32' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-guard-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const marker = join(directory, 'pid.txt');
  const controller = new AbortController();
  const command = runMediaProcess(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)', marker], { signal: controller.signal });
  const rejected = assert.rejects(command, e => e.code === 'media_processing_failed');
  let pid;
  try {
    for (let i = 0; i < 200; i++) {
      try { pid = Number(await readFile(marker, 'utf8')); if (pid) break; } catch { }
      await delay(25);
    }
    assert.ok(pid, 'guarded child started');
  } finally { controller.abort(); }
  await rejected;
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') return; throw e; }
    await delay(20);
  }
  assert.fail('child survived guard cancellation');
});

test('parallel task queries return before image decoding and import a result only once', async () => {
  const task = { id: 'image-a', projectId: 'p', kind: 'cover', args: {}, snapshot: { title: 'cover', concepts: [] }, status: 'waiting_external', dispatch: 'manual', handoff: {}, createdAt: 1 };
  let saved = task, imports = 0, release;
  const blocked = new Promise(resolve => { release = resolve; });
  const repository = {
    listTasks: async () => [structuredClone(saved)], task: async () => structuredClone(saved),
    saveTask: async value => { saved = value; return value; },
    readHandoff: async () => ({ bytes: Buffer.from('fixture') }),
    putImage: async () => { imports++; await blocked; return { fileId: 'a'.repeat(64) }; },
  };
  const manager = createTaskManager(repository);
  try {
    const queries = Promise.all(Array.from({ length: 12 }, () => manager.get(task.id)));
    let timer;
    const values = await Promise.race([queries, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('query blocked on image decode')), 1000); })]).finally(() => clearTimeout(timer));
    assert.ok(values.every(value => value.status === 'waiting_external'));
    assert.equal(imports, 1);
    await manager.cancel(task.id);
  } finally { release(); await manager.stop(); }
  assert.equal(saved.status, 'succeeded');
  assert.equal(saved.recoveredAfterCancel, true);
  assert.equal(imports, 1);
});

test('failed media processing is not restarted by subsequent status queries', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-media-failure-'));
  const repo = createRepository(directory);
  await repo.saveTask({ id: 'video-a', projectId: 'p', kind: 'video-shot', args: { objectId: 'shot-a' }, status: 'waiting_external', dispatch: 'manual', handoff: {}, snapshot: { video: { ratio: '16:9', shots: [{ id: 'shot-a', duration: 2 }] } } });
  let reads = 0;
  const repository = { ...repo, readHandoff: async () => { reads++; return { bytes: Buffer.from('0000ftyp0000') }; } };
  const manager = createTaskManager(repository, { env: { FFPROBE_PATH: join(directory, 'missing-probe.exe') } });
  t.after(async () => { await manager.stop(); await rm(directory, { recursive: true, force: true }); });
  let task;
  for (let i = 0; i < 200; i++) {
    task = await manager.get('video-a');
    if (task.status === 'failed') break;
    await delay(25);
  }
  assert.equal(task.status, 'failed');
  assert.equal(task.recoveryClosed, true);
  for (let i = 0; i < 10; i++) await manager.get('video-a');
  assert.equal(reads, 1);
});
