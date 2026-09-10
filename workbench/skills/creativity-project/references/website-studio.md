# 一次目标与网站连续制作

版本：核心协议 11、31 个工具、Skills 0.8.0。网页默认使用作品预览入口，五阶段为详细编辑。

## 接到已有网页任务

先 task_get 原 ID。若 kind=website 且 args.guided=true，这是一个完整网站制作任务，优先按本文执行。不要套用图片 PNG 交接规则，不要 task_start 或 website_run 新建任务替代。

1. 读取 handoffMessage 指向的需求与素材 ZIP，完整查看 PROMPT.md、materials.json、KNOWLEDGE.md、SOURCES.json 及实际图片；若附 existing-website.zip，先读取原代码。
2. 项目 websiteBrief.goal 是统一目标，change 和 scope 是本轮修改。按 scope 保留未涉及的内容、配图与功能。详细阶段资料作为补充，不能反复让用户填阶段表单；标题、初稿文案与合理版式由执行者补齐。无法满足的必要功能如实说明。
3. 实现实际网站，交付含 index.html、相对路径 CSS/JS 和素材的静态 ZIP。知识有出处，虚构与事实分开。无存储权限时回退为当前浏览内状态，不让清单等功能报错。检查重复操作、键盘和手机布局；记录实际检查，不伪造浏览器通过。
4. 把 ZIP 写入同目录临时文件，写完后原子重命名到原 handoff.output 的 result.zip；或复制到原项目 inbox，再 website_complete({taskId:原ID,filename:简单文件名,description,instructions,verification,verificationMethod,verificationResult,verificationEvidence})。
5. 持续查询原任务，result.websiteSource 存在且 status=succeeded 才表示实际网站已接收。仅 result.websiteRequest 存在是中间资料包，网站仍未完成。
6. Runtime 自动保存初稿并回传网页，无需 task_adopt 或手动写 workspace.json。用户在网页“使用这个版本”后才替换当前版本。对话中已有明确使用该版本的意图时，先 project_get 核对候选，再 workflow_update(action="adopt-website-source")；没有候选时不要重复采用。

只有网站文件结构被 Runtime 检查，不等于真实业务功能通过。WorkBuddy 的检查报告保留其实际验证方式；图片、付费媒体、后端与发布不因一段提示词自动获得额外能力。

## 新网站需求

没有已有任务 ID 时，可以 project_create(type="website")，随后 website_run({projectId,expectedVersion,requestId,goal,change:"",scope:"all",autoAssets:true,dispatch:"conversation",base:"current"})。

website_run 自动为资料为空的新项目匹配内置知识与视觉资产，保留已有资料、图片和历史。它只组织并交接任务，当前 WorkBuddy agent 负责真正写出网站。conversation 避免向自己再次发送消息。auto 为网页的自动发送或手动交接回退。

修改未使用的初稿时 base="draft"，修改已使用版本时 base="current"。scope 为 all / appearance / content / images / interaction；变更主要目标填 goal，本轮局部要求填 change。复用原 ZIP 进行修改，不把新初稿提前写成最终版本。

## 恢复与历史

超时先查询原 requestId，同一次请求重试保持参数和 ID。waiting_external / uncertain 继续原交接，不重新生成。失败或取消后明确重试，才传新 requestId 和 retryOf。

旧任务晚到的结果仍保存在原任务中；如果目标或当前任务已变化，不会覆盖新的初稿。相同任务回传相同文件可重放，不同文件拒绝覆盖。网站源码仍可从网页直接导入本次任务；旧 website_source_import 流程继续兼容普通源码导入。

## 网页其他作品

小说默认直接生成或接收完整正文；没有网页文字服务时，按页面交接请求在当前对话创作并写回原项目。视频默认一个镜头，保留横竖屏、时长及现有首帧；按原媒体 handoff 回传，规格不符不能冒充通过。详细人物、美术、素材和分镜仍可按需编辑。三维资产走独立的 [craft_generate 流程](craft-assets.md)，网页只查看并下载 Blender 文件。
