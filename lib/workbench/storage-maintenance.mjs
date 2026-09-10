import { readdir, lstat, realpath, open, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, sep } from 'node:path';
import { digest, identifier } from './repository.mjs';
import { ServiceError } from './errors.mjs';

const zipId=value=>typeof value==='string'&&/^[a-f0-9]{64}\.zip$/.test(value);
const unfinished=task=>!task.supersededBy&&!task.recoveryClosed&&['queued','running','waiting_external','waiting_provider','uncertain','cancelled'].includes(task.status);
const changed=()=>new ServiceError(409,'cleanup_changed','请先预览清理范围并核对，再使用该 confirmationToken 执行；文件变化后需重新预览。');

// Clean only individually proven redundant source files. Request manifests,
// task records, histories, immutable outputs and active inputs remain intact.
export async function cleanupStorage(repository, { execute = false, confirmationToken, minimumAgeDays = 7 } = {}) {
  await repository.initialize();
  const root = await realpath(repository.root);
  const cutoff = Date.now() - minimumAgeDays * 86400000;
  const normalize=value=>process.platform==='win32'?value.toLowerCase():value;
  const entries = [], seen=new Set(), destinations=new Map();
  async function fingerprint(relative,applyAge=true) {
    const path=join(root,relative);
    let handle;
    try {
      const actual=await realpath(path);
      if(normalize(actual)!==normalize(path)||!normalize(actual).startsWith(normalize(root+sep)))return null;
      const before=await lstat(path);
      if(!before.isFile()||applyAge&&minimumAgeDays>0&&before.mtimeMs>cutoff)return null;
      handle=await open(path,'r');
      const hash=createHash('sha256');let size=0;
      for await(const chunk of handle.createReadStream({highWaterMark:64*1024,autoClose:false})){hash.update(chunk);size+=chunk.length;}
      const after=await handle.stat();
      if(size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ino!==before.ino)return null;
      return {size,hash:hash.digest('hex')};
    } catch(e) {if(e.code==='ENOENT')return null;throw e;}
    finally {await handle?.close();}
  }
  async function destination(fileId,media=false) {
    if(typeof fileId!=='string'||!(media?/^[a-f0-9]{64}$/:/^[a-f0-9]{64}\.(zip|mp4|wav)$/).test(fileId))return null;
    const path=media?'media/'+fileId+'.png':'files/'+fileId;
    if(destinations.has(path))return destinations.get(path);
    const actual=await fingerprint(path,false);
    const stored=actual?.hash===fileId.split('.')[0]?{path,hash:actual.hash}:null;
    destinations.set(path,stored);return stored;
  }
  async function add(path,expectedHash,stored) {
    if(seen.has(path)||!stored)return;
    const value=await fingerprint(path);
    if(!value||value.hash!==expectedHash)return;
    entries.push({path,bytes:value.size,hash:value.hash,destination:stored});seen.add(path);
  }
  const tasks=await repository.listTasks({summary:true});
  const activeProjects=new Set(tasks.filter(unfinished).map(task=>task.projectId));
  const websiteSources=new Map();
  function rememberSource(projectId,fileId) {
    if(!identifier(projectId)||!zipId(fileId))return;
    if(!websiteSources.has(projectId))websiteSources.set(projectId,new Set());
    websiteSources.get(projectId).add(fileId);
  }
  for(const task of tasks) {
    if(task.status!=='succeeded')continue;
    const website=task.kind==='website'?task.result?.websiteSource:undefined;
    if(website)rememberSource(task.projectId,website.fileId);
    if(!task.handoff||!identifier(task.id))continue;
    const result=website||task.result?.asset||task.result?.videoClip||task.result?.videoAudio;
    if(!result?.fileId)continue;
    const media=Boolean(task.result?.asset);
    const stored=await destination(result.fileId,media);
    if(!stored)continue;
    const extension=media?'png':result.fileId.split('.').pop();
    // Without a recorded import hash, do not infer equivalence between a
    // replaced source and a normalized result. Only identical copies qualify.
    await add('handoff/'+task.id+'/result.'+extension,stored.hash,stored);
  }
  const saved=await repository.loadWorkspace();
  for(const project of saved.workspace.projects) {
    for(const branch of [project,...Object.values(project.variants||{})])for(const source of [branch.websiteSource,branch.websiteSourceCandidate])rememberSource(project.id,source?.fileId);
    for(const record of project.flow?.records||[])if(record.target==='websiteSource')rememberSource(project.id,record.value?.fileId);
  }
  for(const receipt of Object.values(saved.coreReceipts||{})) {
    const source=receipt.result?.importedSource;
    if(!source||!identifier(source.projectId)||activeProjects.has(source.projectId)||!/^[a-zA-Z0-9_-]{1,80}\.(png|jpg|jpeg|webp|mp4|wav|mp3|m4a|zip)$/.test(source.filename))continue;
    const stored=await destination(receipt.result.fileId,/\.(png|jpg|jpeg|webp)$/.test(source.filename));
    await add('inbox/'+source.projectId+'/'+source.filename,source.hash,stored);
  }
  // Website completion historically had no inbox receipt. Exact byte matches
  // to successful tasks or saved website versions provide equivalent proof.
  for(const [projectId,sources] of websiteSources) {
    if(activeProjects.has(projectId))continue;
    let names;
    try {
      const path=join(root,'inbox',projectId);
      if(normalize(await realpath(path))!==normalize(path))continue;
      names=await readdir(path);
    }catch(e){if(e.code==='ENOENT')continue;throw e;}
    const confirmed=new Map();
    for(const fileId of sources){const stored=await destination(fileId);if(stored)confirmed.set(stored.hash,stored);}
    if(!confirmed.size)continue;
    for(const name of names) {
      if(!/^[a-zA-Z0-9_-]{1,80}\.zip$/.test(name))continue;
      const path='inbox/'+projectId+'/'+name;
      if(seen.has(path))continue;
      const value=await fingerprint(path);const stored=value&&confirmed.get(value.hash);
      if(stored){entries.push({path,bytes:value.size,hash:value.hash,destination:stored});seen.add(path);}
    }
  }
  entries.sort((a,b)=>a.path.localeCompare(b.path));
  const token=digest({minimumAgeDays,entries});
  if(execute&&confirmationToken!==token)throw changed();
  if(execute) {
    const latestActive=new Set((await repository.listTasks({summary:true})).filter(unfinished).map(task=>task.projectId));
    // Recheck every source and durable copy before deleting any file, then
    // check each selected source once more immediately before unlinking it.
    for(const entry of entries) {
      if(entry.path.startsWith('inbox/')&&latestActive.has(entry.path.split('/')[1]))throw changed();
      const source=await fingerprint(entry.path),stored=await fingerprint(entry.destination.path,false);
      if(source?.hash!==entry.hash||source.size!==entry.bytes||stored?.hash!==entry.destination.hash)throw changed();
    }
    for(const entry of entries) {
      const current=await fingerprint(entry.path);
      if(current?.hash!==entry.hash||current.size!==entry.bytes)throw changed();
      await unlink(join(root,entry.path));
    }
  }
  return {executed:execute,confirmationToken:token,minimumAgeDays,bytes:entries.reduce((sum,item)=>sum+item.bytes,0),entries:entries.map(({path,bytes})=>({path,bytes})),note:execute?'仅移除了已验证的冗余交接源文件；原请求、项目、任务、历史和成品仍保留。':'仅预览：已成功导入且超过保留天数的源副本。执行保留原请求和成品；未导入、无法验证或仍可能用于活动任务的文件不清理。'};
}
