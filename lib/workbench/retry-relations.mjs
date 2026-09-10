import {taskWorkType} from './image-results.mjs';
export function sameTaskTarget(a,b) {
  return a&&b&&a.id!==b.id&&a.projectId===b.projectId&&a.kind===b.kind&&taskWorkType(a)===taskWorkType(b)&&(a.args?.objectId||'')===(b.args?.objectId||'');
}
// A matching object alone is not a retry. Only explicit relationships may archive
// an old wait. This also recognizes retryOf records created by older versions.
export function withRetryRelations(tasks) {
  const byId=new Map(tasks.map(t=>[t.id,t])),next=new Map();
  for(const task of tasks) {
    const replacement=byId.get(task.supersededBy);
    if(sameTaskTarget(task,replacement))next.set(task.id,replacement.id);
  }
  for(const task of [...tasks].sort((a,b)=>(a.createdAt||0)-(b.createdAt||0))) {
    const original=byId.get(task.retryOf);
    if(sameTaskTarget(original,task))next.set(original.id,task.id);
  }
  return tasks.map(task=>{
    let id=task.id,last;const seen=new Set([id]);
    while(next.has(id)){id=next.get(id);if(seen.has(id)){last=undefined;break;}seen.add(id);last=id;}
    return {...task,supersededBy:last};
  });
}
