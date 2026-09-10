'use client';
import {useRef,useState} from 'react';
import {Button,Field} from '@/components/workbench/ui';
import type {Project,VideoShot} from '@/features/projects/model';
import {api,outputUrl} from '@/features/projects/server-store';
import {buildVideoPrompt,videoPromptBasis} from '@/lib/workbench/prompts.mjs';
import {sameTaskSource,taskSource} from '@/lib/workbench/task-contract.mjs';
import {formatNovel} from '@/lib/workbench/novel-export.mjs';
import {suggestWebsiteMaterials} from '@/lib/workbench/website-studio.mjs';
import {applyKnowledge} from '@/lib/workbench/knowledge.mjs';
import {videoGoalSpecs,setVideoGoalSpec} from '@/lib/workbench/direct-video.mjs';
import type {GenerationControls} from './generation-api';
import type {EditProject,Notice} from './stages';

type Props={project:Project;edit:EditProject;notice:Notice;generation:GenerationControls;flush:()=>Promise<void>;synchronize:(force?:boolean)=>Promise<void>;onDetails:()=>void};
export function ResultStudio({project,edit,notice,generation,flush,synchronize,onDetails}:Props){
  const video=project.type==='video';
  const initial=useRef<VideoShot>({id:crypto.randomUUID(),title:'镜头 1',visual:project.idea,camera:'',duration:videoGoalSpecs(project.idea).duration||5,narration:'',subtitle:'',revision:''});
  const shot=project.video?.shots[0]||initial.current;
  const goal=video?shot.visual:project.idea,duration=shot.duration,ratio=project.video?.ratio||videoGoalSpecs(project.idea).ratio as '16:9'|'9:16'||'16:9';
  const specIssue=video?videoGoalSpecs(goal).issue:'';
  const change=project.studioRevision||'';
  const setChange=(value:string)=>edit(p=>({...p,studioRevision:value}));
  const editShot=(patch:Partial<VideoShot>,nextRatio=ratio)=>edit(p=>{
    const first=p.video?.shots[0]||initial.current;
    const visual=setVideoGoalSpec(first.visual,{...(patch.duration!==undefined?{duration:patch.duration}:{}),...(nextRatio!==ratio?{ratio:nextRatio}:{})});
    return {...p,idea:visual,video:{...(p.video||{ratio:nextRatio,shots:[],keepAudio:false,burnSubtitles:false}),ratio:nextRatio,shots:[{...first,...patch,visual},...(p.video?.shots.slice(1)||[])]}};
  });
  const [working,setWorking]=useState(false),[error,setError]=useState(''),[showHandoff,setShowHandoff]=useState(false);
  const kind=video?'video-shot':'novel';
  const tasks=(generation.tasks||[]).filter(t=>t.kind===kind&&t.workType===project.type&&!t.supersededBy&&(!video||t.args.objectId===shot.id)).sort((a,b)=>b.createdAt-a.createdAt);
  const task=tasks[0],busy=working||generation.busy||Boolean(task&&['queued','running','waiting_external','uncertain','waiting_provider'].includes(task.status));
  const novel=task?.status==='succeeded'?task.result?.novel:undefined,clip=task?.status==='succeeded'?task.result?.videoClip:undefined;
  const alreadyUsed=video?Boolean(clip&&shot.clip?.fileId===clip.fileId):Boolean(novel&&project.novel?.taskId===task?.id);
  const ready=Boolean((novel||clip)&&!alreadyUsed&&!task?.dismissed);
  const stale=ready&&!sameTaskSource(taskSource(project,kind,task!.args),task!.source);
  const visibleNovel=ready?novel:project.novel,visibleClip=ready?clip:shot.clip;
  const provider= generation.videoProvider||'workbuddy';
  const context=()=>`请通过创意工作台读取原项目 ${project.id}，不要新建副本。\n作品目标：${goal}\n${change.trim()?'本次修改：'+change:'请根据目标直接创作完整短篇，未指定细节由你合理补齐。'}\n沿用项目已保存的文化资料与设定，事实和虚构分开。将完整正文写回该项目 novel.title 和 novel.text，保留已有历史，不仅保存梗概。完成后读取项目核对并交付实际文件。`;
  const withKnowledge=(p:Project)=>p.knowledge?.length?p:applyKnowledge(p,suggestWebsiteMaterials(goal).knowledgeIds);
  const copyWriting=async()=>{try{edit(withKnowledge);await flush();await navigator.clipboard.writeText(context());notice('已复制完整要求，交给 WorkBuddy 写回原项目即可。');}catch{notice('请复制下方完整要求，继续同一项目。');}setShowHandoff(true);};
  const sync=async()=>{await synchronize(true);await generation.refresh?.(true);};
  async function start(){
    if(busy)return;if(specIssue){setError(specIssue);return;}setWorking(true);setError('');
    try{
      edit(p=>{
        p=withKnowledge(p);
        if(!video)return {...p,idea:goal,stage:4,requests:p.requests.map((v,i)=>i===4?change:v)};
        const v=p.video||{ratio,shots:[],keepAudio:false,burnSubtitles:false};
        const nextShot={...(v.shots[0]||initial.current),visual:goal,duration,revision:change};
        const draft={...p,idea:goal,stage:4,video:{...v,ratio,shots:[nextShot,...v.shots.slice(1)]}};
        nextShot.prompt=buildVideoPrompt(draft,nextShot);nextShot.promptBasis=videoPromptBasis(draft,nextShot);return draft;
      });
      await flush();generation.run(kind,video?{objectId:shot.id,provider}: {action:project.novel&&change.trim()?'revise':'generate'});
    }catch(e){setError(e instanceof Error?e.message:'尚未提交，请重试。');}finally{setWorking(false);}
  }
  async function useResult(){setWorking(true);setError('');try{await flush();const saved=await api<{projectVersion:string}>('core/project_get','POST',{projectId:project.id});await api('core/task_adopt','POST',{taskId:task!.id,expectedVersion:saved.projectVersion});await sync();notice(video?'已使用这个镜头，原文件保留。':'已使用这份正文，历史版本保留。');}catch(e){setError(e instanceof Error?e.message:'结果尚未保存');}finally{setWorking(false);}}
  function downloadNovel(){if(!visibleNovel)return;const url=URL.createObjectURL(new Blob([formatNovel(visibleNovel,'md')],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=(visibleNovel.title||'短篇')+'.md';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  const brief=(<section className="surface studio-brief"><div className="section-heading"><div><h2>{video?'想看到怎样的镜头？':'想写一个怎样的故事？'}</h2><p>{video?'描述主体、环境和动作，直接生成一个连续镜头。':'描述故事目标，直接得到正文；人物细节和表达方式可以在初稿上继续修改。'}</p></div></div><Field label={video?'镜头目标':'故事目标'}><textarea rows={4} value={goal} disabled={busy} onChange={e=>{if(!video)edit(p=>({...p,idea:e.target.value}));else {const specs=videoGoalSpecs(e.target.value);edit(p=>({...p,idea:e.target.value,video:{...(p.video||{ratio,shots:[],keepAudio:false,burnSubtitles:false}),ratio:(specs.ratio||ratio) as '16:9'|'9:16',shots:[{...(p.video?.shots[0]||initial.current),visual:e.target.value,...(specs.duration?{duration:specs.duration}:{})},...(p.video?.shots.slice(1)||[])]}}));}}}/></Field>
    {video&&<div className="delivery-fields"><Field label="画面方向"><select disabled={busy} value={ratio} onChange={e=>editShot({},e.target.value as '16:9'|'9:16')}><option value="16:9">横屏 16:9</option><option value="9:16">竖屏 9:16</option></select></Field><Field label="镜头时长（秒）"><input disabled={busy} type="number" min={2} max={10} value={duration} onChange={e=>editShot({duration:Math.min(10,Math.max(2,Math.round(Number(e.target.value)||5)))})}/></Field></div>}
    <p className="muted">{video?'得到：可播放的 MP4 镜头。时长和方向从描述识别，调整参数也会同步更新描述。现有首帧继续沿用。':'得到：完整短篇正文与可下载的 Markdown。已保存的设定继续沿用。'}</p>
    {specIssue&&<p role="alert">{specIssue}</p>}
    {!video&&generation.textAvailable===false?<><Button disabled={!goal.trim()} onClick={()=>void copyWriting()}>交给 WorkBuddy 写作</Button><p>当前未配置网页文字服务，WorkBuddy 可直接创作并写回同一项目，无需逐阶段填写。</p>{showHandoff&&<Field label="交给 WorkBuddy 的完整要求"><textarea readOnly rows={5} value={context()}/></Field>}</>:<Button disabled={busy||!goal.trim()||Boolean(specIssue)||!video&&generation.textAvailable===undefined} onClick={()=>void start()}>{busy?'正在处理…':video?'生成这个镜头':project.novel?'生成新的正文版本':'生成故事初稿'}</Button>}
    </section>);
  return <div className="website-studio">{!visibleNovel&&!visibleClip&&brief}
    {(error||generation.error)&&<p role="alert" className="creative-feedback creative-error">{error||generation.error}</p>}
    {task&&!task.dismissed&&<section className="surface" aria-label="当前制作状态"><h3>{task.status==='succeeded'?(ready?'新版本已收到':'已保存结果'):task.status==='failed'?'本次未完成':task.status==='cancelled'?'已结束等待':task.status==='waiting_external'?'等待 WorkBuddy 回传镜头':'正在处理这次创作'}</h3>{task.error&&<p>{task.error}</p>}{task.note&&<p>{task.note}</p>}{task.handoffMessage&&['waiting_external','uncertain'].includes(task.status)&&<><p>接续同一任务，结果回传后会显示在这里。</p><Button onClick={()=>void navigator.clipboard.writeText(task.handoffMessage!).then(()=>notice('已复制，请交给 WorkBuddy 继续原任务。')).catch(()=>setShowHandoff(true))}>复制交接请求</Button><Button variant="ghost" onClick={()=>setShowHandoff(!showHandoff)}>查看交接内容</Button>{showHandoff&&<textarea readOnly rows={5} aria-label="镜头交接请求" value={task.handoffMessage}/>}</>}<Button variant="ghost" onClick={()=>void sync()}>刷新进度</Button>{busy&&!working&&<Button variant="ghost" onClick={()=>void api('tasks/'+task.id+'/cancel','POST',{}).then(sync).catch(e=>setError(String(e)))}>结束本次等待</Button>}</section>}
    {(visibleNovel||visibleClip)&&<section className="surface studio-result"><h2>{ready?'新版本预览':'当前作品'}</h2>{visibleNovel&&<><h3>{visibleNovel.title}</h3><div className="studio-story">{visibleNovel.text}</div><Button variant="ghost" onClick={downloadNovel}>下载正文 Markdown</Button></>}{visibleClip&&<><video controls preload="none" src={outputUrl(visibleClip.fileId)} style={{width:'100%',maxHeight:560}} aria-label="视频镜头预览"/><p>实际 {visibleClip.width} × {visibleClip.height} · {visibleClip.duration.toFixed(2)} 秒</p>{visibleClip.validation?.status==='failed'&&<p role="alert">规格未通过：{visibleClip.validation.issues.join(' ')}</p>}<a href={outputUrl(visibleClip.fileId)} download="镜头.mp4">下载 MP4</a></>}{ready&&<><p>{stale?'制作依据已经变化，结果保留供查看，不能覆盖当前作品。':'核对内容和效果后使用这个版本，原版本保留。'}</p><Button disabled={working||stale||clip?.validation?.status==='failed'} onClick={()=>void useResult()}>使用这个版本</Button></>}
    <div className="studio-revision"><h3>哪里需要调整？</h3><Field label="本次修改要求"><textarea rows={3} maxLength={4000} value={change} onChange={e=>setChange(e.target.value)} placeholder={video?'例如：镜头移动慢一点，保留原场景。':'例如：结尾更含蓄，保留人物关系和文化背景。'}/></Field><p className="muted">{ready?'先使用当前初稿，即可据此继续修改。':'修改要求与当前作品一起提交，其他内容继续沿用。'}</p><Button disabled={busy||ready||!change.trim()} onClick={()=>void (!video&&generation.textAvailable===false?copyWriting():start())}>{!video&&generation.textAvailable===false?'把修改交给 WorkBuddy':'按此要求修改'}</Button></div></section>}
    {(visibleNovel||visibleClip)&&<details className="surface studio-goal-details"><summary>作品目标与制作设置</summary>{brief}</details>}
    <div className="studio-secondary"><Button variant="ghost" onClick={onDetails}>查看资料、素材与详细编辑</Button><span>配图、参考、分镜、声音和历史版本按需展开。</span></div></div>;
}
