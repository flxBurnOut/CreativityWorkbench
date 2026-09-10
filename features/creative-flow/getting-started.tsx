'use client';
import { useState } from 'react';
import { Button, Icon, type IconName } from '@/components/workbench/ui';
import type { Project, WorkType } from '@/features/projects/model';
import { FLOW_LABELS, TYPE_ORDER, WORK_GUIDES, hasStageDraft, optionalStage, stageInstruction, workBuddyRequest } from './flow-guide';

export const workIcons: Record<WorkType, IconName> = { novel: 'book', video: 'film', website: 'globe', craft: 'gift', undecided: 'leaf' };

export function CapabilityCards({ onCreate }: { onCreate: (type: WorkType) => void }) {
  return <section className="capabilities" aria-labelledby="capabilities-title">
    <div className="section-heading"><div><h2 id="capabilities-title">你想做出什么？</h2><p>选择一个目标，工作台会按对应流程带你开始。</p></div><Button variant="ghost" onClick={() => onCreate('undecided')}>还没确定，先记想法 <Icon name="arrow" size={15}/></Button></div>
    <div className="capability-grid">{TYPE_ORDER.filter(type => type !== 'undecided').map(type => <button type="button" className="capability-card" key={type} onClick={() => onCreate(type)}>
      <span className="capability-icon"><Icon name={workIcons[type]} size={23}/></span><span className="capability-heading"><strong>{WORK_GUIDES[type].title}</strong></span>
      <span className="capability-description">{WORK_GUIDES[type].description}</span><span className="capability-output">{WORK_GUIDES[type].output}</span><span className="capability-start">{type === 'craft' ? '开始生成资产' : type === 'novel' ? '开始写故事' : type === 'video' ? '开始做视频' : '开始做网站'} <Icon name="arrow" size={16}/></span>
    </button>)}</div>
    <details className="shared-capabilities"><summary>文化资料与其他能力</summary><p>文化资料、图片素材与详细编辑可在对应作品中按需打开。</p></details>
  </section>;
}

export function StageNavigation({ project, onStage }: { project: Project; onStage: (stage: number) => void }) {
  return <nav className="stage-navigation guided-navigation" aria-label="创作阶段">{FLOW_LABELS.map((label, stage) => <button type="button" key={label} className={project.stage === stage ? 'current' : ''} aria-current={project.stage === stage ? 'step' : undefined} onClick={() => onStage(stage)}>
    <span className="step-number">{stage + 1}</span><span className="step-copy"><span>{label}</span><small>{project.stage === stage ? '正在这一步' : hasStageDraft(project, stage) ? (stage === 4 ? '已有成果' : '已有草稿') : optionalStage(project.type, stage) ? '按需选做' : '待开始'}</small></span>
  </button>)}</nav>;
}

export function StepGuide({ project, onStage }: { project: Project; onStage: (stage: number) => void }) {
  const guide = stageInstruction(project);
  return <section className="step-guide" aria-label="当前步骤说明"><div><p className="eyebrow">第 {project.stage + 1} 步 · {FLOW_LABELS[project.stage]}</p><h2>{guide.title}</h2><p>{guide.action}</p>{project.stage<4&&<span className="step-result"><Icon name="check" size={15}/>本步得到：{guide.result}</span>}</div>
    {project.stage < 4 && <div className="step-shortcuts">{project.type === 'video' && <Button variant="secondary" onClick={() => onStage(4)}>已有镜头想法，直接做视频 <Icon name="arrow" size={16}/></Button>}{project.type === 'novel' && project.stage >= 1 && <Button variant="secondary" onClick={() => onStage(4)}>已有故事方案，直接写正文 <Icon name="arrow" size={16}/></Button>}{project.type === 'website' && project.stage >= 1 && <Button variant="secondary" onClick={() => onStage(4)}>已有需求，直接制作网站 <Icon name="arrow" size={16}/></Button>}</div>}
  </section>;
}

export function WorkflowHelp({ initialType = 'novel', project, notice, onSettings }: { initialType?: WorkType; project?: Project | null; notice: (message: string) => void; onSettings: () => void }) {
  const [type, setType] = useState<WorkType>(project?.type ?? initialType);
  const guide = WORK_GUIDES[type];
  const request = project ? workBuddyRequest(project) : `请使用创意工作台 Skills 和 MCP，先检查连接，再帮我${guide.title}。示例目标：${guide.example}。沿用明确的岭南文化依据，保存到工作台项目；生成后展示结果，需要我选择时再采用。`;
  return <div className="workflow-help">
    <p>先描述作品目标，直接制作并查看结果。详细设定按需展开，不要求逐阶段填表。</p>
    <div className="help-types" aria-label="查看各类作品流程">{TYPE_ORDER.map(value => <button type="button" key={value} aria-pressed={type === value} onClick={() => setType(value)}><Icon name={workIcons[value]} size={17}/>{WORK_GUIDES[value].title}</button>)}</div>
    <div className="help-route"><h3>{guide.title}</h3><p>{guide.route}</p><strong>最后交付：{guide.output}</strong><p className="muted">{guide.boundary}</p></div>
    <h3>在网页里怎么操作</h3><ol className="help-steps">{[
      ['描述目标', '写一次作品要求；网站自动匹配空项目的主题资料，小说直接创作正文，视频直接描述镜头，3D 资产直接描述器物或建筑。'],
      ['查看进度与初稿', '页面会说明正在做什么。需要 WorkBuddy 时复制已有交接请求，回传结果后直接显示预览。'],
      ['围绕结果修改', '在作品旁提出这次的修改要求。网站可选文字、配色、图片或功能范围，沿用实际旧源码。'],
      ['使用与交付', '小说、视频和网站确认使用后下载实际文件。3D 模型完成后直接展示和下载 Blender 文件，历史版本在本页保留；文件收到不等于所有功能已经验收。'],
    ].map(([title, detail], i) => <li key={title}><span>{i + 1}</span><div><h4>{title}</h4><p>{detail}</p></div></li>)}</ol>
    <Button variant="secondary" onClick={onSettings}>打开生成服务设置</Button>
    <h3>从哪里找文化依据</h3><p>网站可在“本次目标与资料”查看；其他作品可打开详细编辑，再在“确定创意”点击“选择文化资料”，按元素或地域筛选、查看出处并勾选。选中的事实会进入后续生成；自己的时代背景、人物与虚构设定继续写在“当前项目的文化语境”。可下载本次文化依据，网站任务包也会附上资料。WorkBuddy 对话可直接请求搜索并选用相关条目。</p>
    <details className="help-workbuddy"><summary>也可以在 WorkBuddy 对话中操作</summary><p>先导入本项目 Skills 并连接 MCP，再把下面这段话发给 WorkBuddy。它会读取并保存同一项目，回到网页即可查看成果。</p><p className="muted">对话文字创作使用 WorkBuddy 当前模型，无需额外文字密钥。图片和视频取决于已接入的实际服务。</p><textarea readOnly rows={6} aria-label="发给 WorkBuddy 的操作说明" value={request}/><Button icon="copy" onClick={() => void navigator.clipboard.writeText(request).then(() => notice('已复制，请粘贴到已连接创意工作台的 WorkBuddy 对话')).catch(() => notice('复制失败，请选中文字后复制。'))}>复制给 WorkBuddy</Button><p className="muted">首次使用需在 WorkBuddy 中加载本项目的两项技能与连接配置，再粘贴上面的操作说明。</p></details>
  </div>;
}
