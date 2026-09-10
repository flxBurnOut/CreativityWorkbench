import {themeAssets} from './theme-assets.mjs';
import {searchKnowledge} from './knowledge.mjs';
import {websiteRequestSource} from './prompts.mjs';

export const WEBSITE_SCOPES={all:'整个网站',appearance:'配色与排版',content:'文字内容',images:'图片素材',interaction:'功能与交互'};
export function studioGoal(p){return p.websiteBrief?.goal||p.delivery.notes.trim()||p.idea;}
export function suggestWebsiteMaterials(goal) {
  const vocabulary=['骑楼','满洲窗','园林','广彩','佛山','剪纸','粤剧','醒狮','客家','围屋','潮州','木雕','潮绣'];
  const excluded=vocabulary.filter(t=>new RegExp('(?:不要|不使用|不采用|不包含|不含|排除|避免|无需)[^，。；;\\n]{0,12}'+t).test(goal));
  const terms=vocabulary.filter(t=>goal.includes(t)&&!excluded.includes(t));
  const broad=!terms.length&&/岭南|广府|广州/.test(goal);
  const queries=(terms.length?terms:broad?['骑楼','满洲窗','广彩']:[]).filter(t=>!excluded.includes(t));
  const knowledgeIds=[...new Set(queries.flatMap(query=>searchKnowledge(query).entries.map(e=>e.id)))].slice(0,8);
  const matching=themeAssets.filter(a=>a.knowledgeIds.some(id=>knowledgeIds.includes(id))&&!excluded.some(t=>[a.name,a.description,a.alt].join(' ').includes(t)));
  const diverse=[...new Set(knowledgeIds.flatMap(id=>{const found=matching.find(a=>a.knowledgeIds.includes(id));return found?[found]:[];}))];
  const assets=[...diverse,...matching.filter(a=>!diverse.includes(a))].slice(0,4),assetIds=assets.map(a=>a.id);
  return {knowledgeIds,assetIds,assets};
}
export function websiteStudioState(p,tasks,receipt) {
  // Show the acknowledged task immediately, even while the project refresh is
  // waiting for a local draft to save. A late poll must not undo a newer receipt.
  const acknowledged=receipt?.projectId===p.id&&receipt.kind==='website'&&receipt.args?.guided?receipt:undefined;
  const polled=tasks.find(t=>t.id===(acknowledged?.id||p.websiteRequest?.taskId)&&t.projectId===p.id&&t.kind==='website'&&t.args?.guided);
  const task=acknowledged&&(!polled||(acknowledged.updatedAt||0)>(polled.updatedAt||0))?acknowledged:polled;
  const received=task?.result?.websiteSource;
  const selected=Boolean(received&&p.websiteSource?.fileId===received.fileId);
  const usedBefore=Boolean(received&&p.flow?.records.some(r=>r.target==='websiteSource'&&r.value?.fileId===received.fileId));
  const incoming=received&&!task.dismissed&&(!usedBefore||p.websiteSourceCandidate?.fileId===received.fileId)?received:undefined;
  const candidate=incoming||(!task||p.websiteSourceCandidate?.taskId===task.id?p.websiteSourceCandidate:undefined);
  const stale=Boolean(candidate?.requestSource&&!selected&&candidate.requestSource!==websiteRequestSource(p));
  const busy=Boolean(task&&['queued','running','waiting_external','waiting_provider','uncertain'].includes(task.status));
  const needsHandoff=Boolean(task&&['waiting_external','uncertain'].includes(task.status)&&['manual','conversation'].includes(task.dispatch));
  const canHandoff=Boolean(task?.handoffMessage&&['waiting_external','uncertain','cancelled'].includes(task.status));
  return {task,candidate,preview:candidate||p.websiteSource||p.websiteSourceCandidate,selected,stale,busy,needsHandoff,canHandoff,
    phase:candidate&&!selected?'review':busy?'making':p.websiteSource?'complete':'describe'};
}

export function websiteDispatchMessage(task) {
  if(task?.status==='cancelled')return '已结束网页等待；这不会取消 WorkBuddy 中已开始的工作。可以修改要求后再提交。';
  if(task?.status==='uncertain')return '发送结果尚未确认。先在 WorkBuddy 核对原任务；如需手动接续，请复制同一任务的交接内容。';
  if(task?.dispatch==='sent')return '请求已发送给 WorkBuddy，正在等待网站结果。如果那里没有开始，请先核对原任务，再用下方交接内容接续。';
  if(task?.dispatch==='pending')return '正在尝试发送给 WorkBuddy。交接内容已备好；手动接续前请先核对是否已收到，避免重复执行。';
  if(task?.dispatch==='conversation')return '请在 WorkBuddy 当前对话中接续这个任务，生成后回传到交接内容指定的位置。';
  return '这次请求尚未自动发送。复制下方完整要求，粘贴到 WorkBuddy 即可继续，不用重新描述网站。';
}
