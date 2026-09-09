import { unzipSync, zipSync, strToU8 } from 'fflate';
import { ServiceError } from './errors.mjs';
import { assetRoles } from './prompts.mjs';
import { workflowInputs, fingerprint } from './workflow.mjs';

const invalid=message=>{throw new ServiceError(400,'invalid_source',message);};
export function inspectWebsiteZip(bytes) {
  if(!bytes.length||bytes.length>128*1024*1024)invalid('源码 ZIP 须为非空实际文件，且不超过 128 MB。');
  let total=0,count=0;const names=new Set();let entries;
  try {
    entries=unzipSync(bytes,{filter:file=>{
      const name=file.name;
      if(!name||name.length>500||/[\\:]/.test(name)||[...name].some(c=>c.charCodeAt(0)<32)||name.startsWith('/')||name.split('/').some(p=>['..','.','__proto__','constructor','prototype'].includes(p)))invalid('源码 ZIP 含不安全的文件路径。');
      if(names.has(name.toLowerCase()))invalid('源码 ZIP 含重复文件名。');names.add(name.toLowerCase());
      count++;total+=file.originalSize;
      if(count>5000||total>128*1024*1024||file.originalSize>32*1024*1024)invalid('源码 ZIP 解压后超过限制；请移除 node_modules、构建缓存和无关大文件。');
      return true;
    }});
  }catch(e){if(e instanceof ServiceError)throw e;invalid('源码 ZIP 无法完整解码，请重新打包。');}
  const paths=Object.keys(entries).filter(n=>!n.endsWith('/'));
  if(!paths.length||!paths.some(n=>/\.(html?|[cm]?[jt]sx?|vue|svelte|astro|css|php|py|rb|go|rs)$/i.test(n)))invalid('包内没有可识别的网站源码；请勿将生成任务包当作网站成果。');
  if(Object.values(entries).reduce((sum,b)=>sum+b.length,0)>128*1024*1024)invalid('源码解码后超过限制。');
  const previewPath=paths.filter(n=>/(^|\/)index\.html$/i.test(n)&&!/(^|\/)(node_modules|\.git)\//.test(n)).sort((a,b)=>a.split('/').length-b.split('/').length||a.localeCompare(b))[0];
  return {entries,entryCount:paths.length,previewPath};
}
export async function importWebsiteSource(bytes,repository,metadata={}) {
  const inspected=inspectWebsiteZip(bytes);const stored=await repository.putOutput(bytes,'zip');
  return {...stored,entryCount:inspected.entryCount,...(inspected.previewPath?{previewPath:inspected.previewPath}:{}),description:metadata.description||'用户导入的网站源码',instructions:metadata.instructions||'',verification:metadata.verification||'未提供执行端验证记录；仅完成 ZIP 结构检查。',importedAt:Date.now(),...(metadata.taskId?{taskId:metadata.taskId}:{}),...(metadata.requestSource?{requestSource:metadata.requestSource}:{})};
}
export async function prepareDesignPackage(task,{repository}) {
  const p=task.snapshot;const inputs=workflowInputs(p,'design-package');const roles=assetRoles(p);
  const brief={type:p.type,title:p.title,idea:p.idea,brief:p.brief,culture:p.culture,content:p.content[p.type],art:p.art,delivery:p.delivery,assets:roles,
    status:p.type==='craft'?'3D 前期设计资料；没有生成模型、拓扑或制造验证。':'未确定媒介的创作资料；转入具体类型后按该类型适配。',
    pending:'尚未明确的尺寸、结构、工艺与交付条件仍待确定。图片之间的结构一致性需要核对，不将概念图视为工程模型。'};
  const files={'DESIGN.json':strToU8(JSON.stringify(brief,null,2)),'README.md':strToU8(`# ${p.title}\n\n${brief.status}\n\n读取 DESIGN.json 和实际图片，基于已采用形体、材质与文化依据继续完善。只修改本轮明确事项。未记录内容不自动成为事实。\n\n${brief.pending}\n`),'SOURCES.json':strToU8(JSON.stringify(inputs,null,2))};
  let total=0;for(const role of roles){const bytes=await repository.media(p.assets.find(a=>a.id===role.id).fileId);total+=bytes.length;if(total>120*1024*1024)throw new ServiceError(413,'too_large','设计资料图片超过 120 MB。');files[role.filename]=bytes;}
  const output=await repository.putOutput(Buffer.from(zipSync(files)),'zip');
  return {designPackage:{fileId:output.fileId,source:fingerprint(inputs),taskId:task.id}};
}
export const SOURCE_PREVIEW_CSP="sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
export const sourceMime=path=>({html:'text/html; charset=utf-8',htm:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',json:'application/json',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',gif:'image/gif',woff:'font/woff',woff2:'font/woff2',mp4:'video/mp4',mp3:'audio/mpeg',wav:'audio/wav'}[path.split('.').pop().toLowerCase()]||'application/octet-stream');
