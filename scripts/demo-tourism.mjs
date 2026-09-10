// Builds this one authored demo through real core calls in an isolated data dir.
// It is never used by the Runtime to answer arbitrary website generation tasks.
import {mkdir,readFile,writeFile,cp,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {unzipSync,zipSync,strFromU8} from 'fflate';
import {createRepository} from '../lib/workbench/repository.mjs';
import {createTaskManager} from '../lib/workbench/tasks.mjs';
import {createCoreService} from '../lib/workbench/core-service.mjs';
import {themeAssets} from '../lib/workbench/theme-assets.mjs';
import {currentKnowledge} from '../lib/workbench/knowledge.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),output=join(root,'work/deliverables');await mkdir(output,{recursive:true});
const dataDirectory=join(root,'work/tourism-demo',String(Date.now()));const repo=createRepository(dataDirectory),tasks=createTaskManager(repo,{env:{}}),core=createCoreService(repo,tasks,{env:{}}),records=[];
const call=async(name,input)=>{const result=await core.call(name,input);records.push({tool:name,requestId:input.requestId,projectId:result.projectId,projectVersion:result.projectVersion,taskId:result.task?.id});return result;};
const story={title:'雨停之前',text:'雨来的时候，阿禾把写到一半的信折好，站进廊下。街上的伞一朵一朵挪过去，廊里的人却不急。一位老人收起伞，先抖掉边缘的水，才向身旁让了半步。\n\n阿禾原本想给远方的朋友画一幢漂亮的楼。现在，她在纸上添了一条长长的线：线的一边是雨，一边是可以继续走的路。店里递出来的一杯温水，让她忽然觉得，建筑也许不只供人观看，还会替日常留一点余地。\n\n雨停之前，她在信的末尾写下：“下次来，我们慢慢走。”没有约好哪一家店，也没有赶往哪一个景点。她只记下了廊柱之间那半步，和一个陌生人让出来的位置。',taskId:'authored-demo-story'};
try {
  let receipt=await call('project_create',{requestId:randomUUID(),title:'岭南行笺 · 文创文旅 Demo',type:'novel',idea:'把岭南文化知识、原创视觉素材与一篇虚构短篇，转为可以探索与收集阅读清单的文化专题网站。'});
  const projectId=receipt.projectId;
  const mutate=async(name,fields)=>{receipt=await call(name,{projectId,expectedVersion:receipt.projectVersion,requestId:randomUUID(),...fields});return receipt;};
  await mutate('knowledge_apply',{entryIds:['guangzhou-qilou']});
  await mutate('project_update',{patch:{culture:'当代广州的虚构叙事，延伸到广府文化专题。佛山工艺单列地域；不导入游戏规则，不提供未经核实的实地路线。',content:{novel:{story:'雨中廊下的短暂停留，让主人公发现建筑与日常生活的联系。'}},novel:story}});
  await mutate('project_update',{patch:{type:'website',stage:4,content:{website:{goal:'让文创文旅受众认识文化细节，并整理个人探索清单。',pages:'文化探索、廊下故事、我的行笺、阅读说明。',copy:'事实与虚构分开，图片附创作说明与事实出处。',behavior:'类别筛选、文字搜索、无结果提示、插画预览、清单加入移除与下载、反复开合 FAQ。'}},delivery:{notes:'静态 H5，可离线浏览；不含预约、支付或导航。保留所有实际使用的视觉文件及文化出处。'}}});
  await mutate('workflow_update',{action:'inherit',from:'novel',brief:false,content:true});
  await mutate('theme_asset_apply',{entryIds:themeAssets.map(e=>e.id)});
  const prepared=await call('prompt_prepare',{projectId,kind:'website'});
  await mutate('project_update',{patch:{websiteRequest:{prompt:prepared.prompt,basis:prepared.basis,assetIds:themeAssets.map(e=>'theme-'+e.id)}}});
  const taskId=randomUUID();await call('task_start',{projectId,expectedVersion:receipt.projectVersion,requestId:taskId,kind:'website',args:{provider:'workbuddy'}});
  let task;for(let i=0;i<300;i++){task=await core.call('task_get',{taskId});if(task.status==='succeeded')break;if(['failed','uncertain'].includes(task.status))throw Error(JSON.stringify(task));await new Promise(r=>setTimeout(r,20));}
  if(task?.status!=='succeeded')throw Error('Website bundle did not finish');
  receipt=await call('task_adopt',{taskId,expectedVersion:receipt.projectVersion});
  const bundle=task.result.websiteRequest.bundleFileId,files=unzipSync(await repo.output(bundle));
  const destination=join(output,'lingnan-visit');await cp(join(root,'examples/lingnan-visit'),destination,{recursive:true});await mkdir(join(destination,'assets'),{recursive:true});
  const transfers=JSON.parse(strFromU8(files['TRANSFER.json']));const entries=themeAssets.map(a=>({...a,kind:a.category==='工艺意象'?'craft':'space',facts:a.knowledgeIds.flatMap(id=>currentKnowledge.entries.find(e=>e.id===id).facts.map(f=>f.text))}));
  const data='window.LINGNAN_DEMO_DATA='+JSON.stringify({entries,story:transfers.find(t=>t.from==='novel').novel})+';\n';
  await writeFile(join(destination,'data.js'),data);await writeFile(join(root,'examples/lingnan-visit/data.js'),data);
  const zipFiles={};for(const name of ['index.html','styles.css','script.js','data.js','README.md'])zipFiles[name]=new Uint8Array(await readFile(join(destination,name)));
  for(const entry of entries){const name='assets/'+entry.id+'.svg',bytes=files['theme-original-theme-'+entry.id+'.svg'];if(!bytes)throw Error('Missing actual bundle image');zipFiles[name]=bytes;await writeFile(join(destination,name),bytes);}
  for(const name of ['KNOWLEDGE.md','TRANSFER.json','SOURCES.json','source-novel-novel.md']){zipFiles[name]=files[name];await writeFile(join(destination,name),files[name]);}
  const demoZip=join(output,'lingnan-cultural-tourism-demo.zip');await writeFile(demoZip,zipSync(zipFiles));await copyFile(join(repo.root,'files',bundle),join(output,'lingnan-website-handoff.zip'));
  const current=await core.call('project_get',{projectId});await copyFile(demoZip,join(current.inbox,'tourism-demo.zip'));
  await mutate('website_source_import',{filename:'tourism-demo.zip',description:'岭南行笺：具体文化专题 Demo',verification:'只完成文件打包与引用核对，浏览器实测单独记录。'});
  await mutate('workflow_update',{action:'adopt-website-source'});
  const evidence={createdAt:new Date().toISOString(),dataDirectory,projectId,taskId,websiteBundle:bundle,demoZip:resolve(demoZip),sha256:createHash('sha256').update(await readFile(demoZip)).digest('hex'),records,scope:'真实本机核心调用、文件交接与网站源码导入；网站为此 Demo 手工实现。没有调用媒体供应商，不代表 WorkBuddy 客户端加载验收。'};
  await writeFile(join(output,'workflow-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{await tasks.stop();}
