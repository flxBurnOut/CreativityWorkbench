import { ServiceError } from '../errors.mjs';
import { readJsonResponse } from './text.mjs';

export function videoConfig(env) { return { provider: env.VIDEO_PROVIDER === 'external' ? 'external' : 'workbuddy', externalConfigured: Boolean(env.VIDEO_API_KEY?.trim()), model: 'gen4.5', scope: '2–10 秒镜头，16:9 / 9:16；最多 12 镜头' }; }
function endpoint(env) {
  let url; try { url = new URL(env.VIDEO_API_BASE_URL || 'https://api.dev.runwayml.com/v1'); } catch { throw new ServiceError(400,'invalid_config','视频 API 地址无效。'); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw new ServiceError(400,'invalid_config','视频 API 地址须为 HTTPS，或本机 HTTP。');
  return url.href.replace(/\/$/,'');
}
async function request(path, body, {env,fetchImpl,signal}, baseOverride) {
  const key=env.VIDEO_API_KEY?.trim(); if(!key)throw new ServiceError(503,'not_configured','请配置服务端 VIDEO_API_KEY，或选择 WorkBuddy。');
  const base = endpoint(env);
  if(baseOverride && baseOverride !== base)throw new ServiceError(409,'provider_changed','视频服务地址已改变，请恢复原地址后查询旧任务。');
  let response;
  try { response=await fetchImpl(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','X-Runway-Version':'2024-11-06'},...(body?{body:JSON.stringify(body)}:{}),signal,redirect:'error'}); }
  catch { throw new ServiceError(502,body?'uncertain':'poll_error',body?'视频提交结果待核实，不会自动重新提交。':'视频状态暂时无法查询，任务编号已保存。'); }
  if(!response.ok)throw new ServiceError(502,body&&response.status>=500?'uncertain':'video_api_error',`视频服务返回 ${response.status}，请检查账户、额度或服务配置。`);
  let data; try { data=await readJsonResponse(response); } catch { throw new ServiceError(502,body?'uncertain':'poll_error','视频服务返回格式无效，请查询原任务。'); }
  return {data,base};
}
export async function submitVideo(prompt, image, shot, ratio, options) {
  if (!prompt.trim() || prompt.length>1000) throw new ServiceError(400,'prompt_too_long','外部视频服务的提示词最多 1000 字符，请精简文化、美术描述及镜头文字。');
  if(image && image.length > 3.5*1024*1024)throw new ServiceError(400,'image_too_large','此视频接口的首帧图片须小于 3.5 MB，请缩小后上传。');
  const {data,base}=await request(image?'/image_to_video':'/text_to_video',{model:'gen4.5',promptText:prompt,duration:shot.duration,ratio:ratio==='9:16'?'720:1280':'1280:720',...(image?{promptImage:'data:image/png;base64,'+image.toString('base64')}:{})},options);
  if(typeof data.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(data.id))throw new ServiceError(502,'uncertain','视频服务没有返回有效任务编号，请核实后再发起新请求。');
  return {id:data.id,base,model:'gen4.5'};
}
export async function pollVideo(job,options) {
  const {data}=await request('/tasks/'+encodeURIComponent(job.id),null,options,job.base);
  if(data.id!==job.id || !['PENDING','THROTTLED','RUNNING','SUCCEEDED','FAILED','CANCELLED'].includes(data.status))throw new ServiceError(502,'poll_error','视频任务响应不匹配，保留原任务继续查询。');
  return data;
}
export async function downloadVideo(url, {env,fetchImpl,signal}) {
  let target; try {target=new URL(url);}catch {throw new ServiceError(502,'invalid_output','视频服务未返回有效下载地址。');}
  const configured=(env.VIDEO_OUTPUT_HOSTS || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  const trusted=['cloudfront.net','runwayml.com','runwaycdn.com'];
  const hostname=target.hostname.toLowerCase();
  if(target.protocol!=='https:'||target.username||target.password||target.port||!(configured.includes(hostname)||trusted.some(host=>hostname===host||hostname.endsWith('.'+host))))throw new ServiceError(502,'output_host','视频下载域名不在允许列表，请在 VIDEO_OUTPUT_HOSTS 填写供应商实际下载域名。');
  // Never forward account credentials to the output CDN, or follow an unvalidated redirect.
  const response=await fetchImpl(target.href,{signal,redirect:'error'});
  if(!response.ok)throw new ServiceError(502,'download_failed','视频下载未完成，将使用已保存的任务编号重新查询下载地址。');
  const reader=response.body?.getReader(); if(!reader)throw new ServiceError(502,'invalid_output','视频响应为空。');
  const chunks=[];let size=0;
  try { for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>128*1024*1024){await reader.cancel();throw new ServiceError(413,'too_large','视频文件超过 128 MB。');}chunks.push(value);} } finally {reader.releaseLock();}
  return Buffer.concat(chunks);
}
