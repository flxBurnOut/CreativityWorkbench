import {importWebsiteSource} from './workflow-delivery.mjs';
import {websiteRequestSource} from './prompts.mjs';
import {digest} from './repository.mjs';
import {ServiceError} from './errors.mjs';

export async function attachWebsiteResult(task,repository,knownProject) {
  const source=task.result?.websiteSource;if(!source)return;
  for(let attempt=0;attempt<3;attempt++) {
    // A task-list poll already read the workspace. Old completed tasks should
    // not each read and parse that same workspace again. A conflict reloads it.
    const p=attempt===0&&knownProject!==undefined?knownProject:(await repository.loadWorkspace()).workspace.projects.find(p=>p.id===task.projectId);
    if(!p||p.type!=='website'||p.websiteRequest?.taskId!==task.id||p.websiteSource?.fileId===source.fileId||(p.websiteSourceCandidate?.fileId===source.fileId&&p.websiteSourceCandidate?.taskId===task.id))return;
    // Late files stay on their task without replacing a new run or changed draft.
    if(websiteRequestSource(p)!==source.requestSource)return;
    try {
      await repository.mutateProject({operationId:'website-result:'+task.id,requestHash:source.fileId,projectId:p.id,expectedVersion:digest(p)},current=>({project:{...current,websiteSourceCandidate:source,websiteRequest:task.result.websiteRequest}}));return;
    } catch(e){if(e.code!=='conflict')throw e;}
  }
}
export async function receiveWebsiteResult(task,{repository,update}) {
  if(task.status==='succeeded'){await attachWebsiteResult(task,repository);return task;}
  const output=await repository.readHandoff(task.id,'zip');
  if(!output)return task;
  if(output.failed)return update(task.id,{status:'failed',error:'WorkBuddy 未完成网站制作。已保留本次任务与资料，可核对后继续。'});
  const source=await importWebsiteSource(output.bytes,repository,{...task.websiteCompletionReport,taskId:task.id,requestSource:task.result.websiteRequest.source,description:task.websiteCompletionReport?.description||'网站初稿',instructions:task.websiteCompletionReport?.instructions||'解压后在浏览器打开 index.html；工作台内也可预览静态页面。'});
  if(!source.previewPath)throw new ServiceError(400,'invalid_source','已收到 ZIP，但没有 index.html 静态入口。请让 WorkBuddy 补齐可预览的网站，原任务保留。');
  const done=await update(task.id,{status:'succeeded',result:{...task.result,websiteSource:source},note:undefined,error:undefined});
  await attachWebsiteResult(done,repository);return done;
}
