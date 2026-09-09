import { loadWorkspace as loadLegacy } from './local-store';
import { emptyWorkspace, parseStoredWorkspace, type ImageAsset, type Workspace, type MediaFile } from './model';
import { projectOutputIds, outputId } from '../../lib/workbench/output-contract.mjs';

const uploaded = new WeakMap<Blob, string>();
export class WorkbenchApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code; }
}
export async function api<T = Record<string,unknown>>(path: string, method = 'GET', input?: unknown):Promise<T> {
  const options = method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: input === undefined ? undefined : JSON.stringify(input) };
  const response = await fetch('/api/workbench/data/' + path, { method, cache: 'no-store', ...options, signal: AbortSignal.timeout(30000) });
  let data: unknown;
  try { data = await response.json(); } catch { throw new WorkbenchApiError('服务返回了无法读取的响应，请检查服务连接后重试。', response.status); }
  const { error, code } = (data ?? {}) as {error?:unknown;code?:unknown};
  if (!response.ok) throw new WorkbenchApiError(typeof error === 'string' ? error : '服务未完成请求。', response.status, typeof code === 'string' ? code : undefined);
  return data as T;
}
export const imageUrl = (asset: ImageAsset) => asset.fileId ? '/api/workbench/data/media/' + asset.fileId : asset.demoSrc || '';
export const outputUrl = (id:string) => '/api/workbench/data/files/'+id;
export async function uploadOutput(file:Blob,kind:string) {
  if(file.size>128*1024*1024)throw new Error('媒体文件请小于 128 MB。');
  const response=await fetch('/api/workbench/data/files/'+kind,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file,signal:AbortSignal.timeout(240000)});
  const data=await response.json() as MediaFile & {error?:string};if(!response.ok)throw new Error(data.error||'文件保存失败。');return data;
}
const dataUrl=(blob:Blob)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob);});
export async function restoreOutputFiles(files:{fileId:string;data:string}[], requiredIds:string[] = []) {
  if(!Array.isArray(files)||files.length>1000)throw new Error('备份文件列表无效。');
  const ids=new Set(files.map(f=>f?.fileId));if(requiredIds.some(id=>!ids.has(id)))throw new Error('备份缺少被项目引用的成品文件，未导入不完整项目。');
  for(const file of files){if(!outputId(file.fileId)||typeof file.data!=='string'||!/^data:[^,]*;base64,/.test(file.data))throw new Error('备份成品文件无效。');const response=await fetch(file.data);await uploadOutput(await response.blob(),'restore/'+file.fileId);}
}
async function serializeAsset(asset: ImageAsset): Promise<ImageAsset> {
  if (asset.fileId) return { id: asset.id, name: asset.name, fileId: asset.fileId, ...(asset.source ? { source: asset.source } : {}) };
  if (!asset.blob) throw new Error('演示图片不能混入真实项目，请上传真实图片。');
  let fileId = uploaded.get(asset.blob);
  if (!fileId) {
    const response = await fetch('/api/workbench/data/media', { method: 'POST', headers: { 'Content-Type': asset.blob.type }, body: asset.blob, signal: AbortSignal.timeout(30000) });
    const data = await response.json() as {fileId?:string;error?:string};
    if (!response.ok || typeof data.fileId !== 'string') throw new Error(data.error || '图片保存失败。');
    fileId = data.fileId; uploaded.set(asset.blob, fileId!);
  }
  return { id: asset.id, name: asset.name, fileId, ...(asset.source ? { source: asset.source } : {}) };
}
export async function serializeWorkspace(workspace: Workspace): Promise<Workspace> {
  const projects = [];
  for (const p of workspace.projects) projects.push({ ...p, assets: await Promise.all(p.assets.map(serializeAsset)) });
  return { ...workspace, projects };
}
export async function saveServerWorkspace(workspace: Workspace, expectedRevision: number, writeId: string, onSerialized?:(wire:Workspace)=>void): Promise<number> {
  const wire = await serializeWorkspace(workspace);
  const data = await api<{revision:number;flows?:{id:string;flow:Workspace['projects'][number]['flow'];assets:ImageAsset[]}[]}>('workspace', 'PUT', { workspace: wire, expectedRevision, writeId });
  if (!Number.isSafeInteger(data.revision)) throw new Error('保存结果无法确认，请保留当前页面。');
  onSerialized?.({...wire,projects:wire.projects.map(p=>({...p,flow:data.flows?.find(f=>f.id===p.id)?.flow||p.flow,assets:data.flows?.find(f=>f.id===p.id)?.assets||p.assets}))});
  return data.revision;
}
export async function readServerWorkspace() {
  return parseStoredWorkspace(await api<{version:1;revision:number;workspace:Workspace}>('workspace'));
}
export async function loadServerWorkspace(): Promise<{ workspace: Workspace; revision: number; note: string }> {
  const data = await api<{version:1;revision:number;workspace:Workspace}>('workspace');
  if (data.revision > 0) return { ...parseStoredWorkspace(data), note: '' };
  let legacy;
  try { legacy = await loadLegacy(); }
  catch { return { workspace: emptyWorkspace(), revision: 0, note: '本地服务已就绪；旧浏览器草稿未能读取，原有数据未改动。' }; }
  if (!legacy.workspace.projects.length) return { workspace: emptyWorkspace(), revision: 0, note: '' };
  const revision = await saveServerWorkspace(legacy.workspace, 0, crypto.randomUUID());
  return { workspace: legacy.workspace, revision, note: '旧浏览器草稿已复制到本机服务，浏览器原副本仍然保留。' };
}
export async function legacyProjects() { return (await loadLegacy()).workspace.projects; }
export async function backupWorkspace(workspace: Workspace) {
  const projects = [];
  let size=0;const files=[];const seen=new Set();
  for (const p of workspace.projects) {
    for(const fileId of projectOutputIds(p))if(!seen.has(fileId)){seen.add(fileId);const response=await fetch(outputUrl(fileId));if(!response.ok)throw new Error('成品文件读取失败，未生成不完整备份。');const blob=await response.blob();size+=blob.size;if(size>140*1024*1024)throw new Error('全部媒体超过 JSON 备份容量，请备份完整 work/data 文件夹。');files.push({fileId,data:await dataUrl(blob)});}
    const assets = [];
    for (const a of p.assets) {
      const response = a.blob ? null : await fetch(imageUrl(a));
      if (response && !response.ok) throw new Error('备份图片读取失败，未生成不完整备份。');
      const blob = a.blob || await response!.blob();
      size+=blob.size;if(size>140*1024*1024)throw new Error('全部媒体超过 JSON 备份容量，请备份完整 work/data 文件夹。');
      const data = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
      assets.push({ id:a.id,name:a.name,source:a.source,data });
    }
    projects.push({ ...p, assets });
  }
  return { format:'lingnan-workbench-backup',version:2,workspace:{ ...workspace,projects },files };
}
