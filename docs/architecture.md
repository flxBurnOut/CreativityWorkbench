# 当前架构

更新日期：2026-09-08。Web 页面 → 同源 HTTP 代理 → 本机共享 Runtime → 持久化与模型适配器；WorkBuddy Skills → stdio MCP → 同一 Runtime 的核心接口。CLI 保留发现／诊断，并提供本机接入包生成命令。

| 模块 | 职责 |
| --- | --- |
| `features/creative-flow/workbench.tsx` / `stages.tsx` | 岭南主题项目管理、五阶段编辑、概念图及短篇交付 |
| `features/creative-flow/generation-api.tsx` | 任务提交、查询、取消等待、结果预览／采用、服务状态 |
| `lib/workbench/project-core.mjs` | Web 与 MCP 共享项目默认值、当前输入校验和结果采用 |
| `lib/workbench/core-contract.mjs` / `core-service.mjs` | 12 项核心工具的参数约束、项目更新、采用、媒体导入与交付 |
| `scripts/workbench-mcp.mjs` / `lib/workbench/mcp-runtime.mjs` | stdio 协议、共享 Runtime 发现与按需启动，不另建数据写入器 |
| `workbench/skills/` / `scripts/workbench-setup.mjs` | 两项 WorkBuddy Skills、ZIP 与本机连接配置 |
| `features/projects/server-store.ts` / `use-project-store.ts` | 文件上传、服务端快照、保存串行化、旧草稿迁移 |
| `features/projects/storage-actions.tsx` | 项目及图片备份导出、独立副本导入 |
| `app/api/workbench/data/[...path]/route.ts` | 同源代理、路由及请求大小限制 |
| `lib/workbench/http-server.mjs` | 本机 HTTP 接口，项目、媒体、任务和配置状态 |
| `lib/workbench/repository.mjs` | 版本快照、文件读写互斥、原子替换、图片解码与哈希文件 |
| `lib/workbench/tasks.mjs` / `task-contract.mjs` | 持久任务、输入快照、提交去重、恢复和取消 |
| `lib/workbench/generation.mjs` | 各阶段编排、输出校验、原图与美术参考输入 |
| `lib/workbench/adapters/` | DeepSeek 文字、WorkBuddy 官方消息、外部 Images API |

项目保存在 `work/data/workspace.json`，保留上一确认快照；图片解码后规范化为独立 PNG，以内容哈希引用。任务及生成依据独立保存。每次保存携带修订号和写入 ID，多页面冲突时拒绝覆盖，提示导出当前草稿后刷新。当前设计只支持一个 Runtime 写同一目录，不是多用户共享数据库。

旧 IndexedDB 仅用于迁移或主动导入，原副本保留。空服务首次读取可迁移旧项目；服务已有数据时由设置页显式导入为新项目。显式 JSON 备份可以包含图片数据；日常项目快照不内嵌 Base64。删除项目或引用不立即清除媒体文件，以保留撤销、历史及任务输入；尚未提供磁盘垃圾回收。完整灾备需停服务后复制整个数据目录。

任务在调用供应商前持久化，重复请求 ID 不重复生成。运行时同时处理至多两项调用；刷新只查询已有任务。服务重启后，已发送 WorkBuddy 的任务可检查既定结果文件；中断的同步调用标为待核实，不能假装找回供应商结果或自动重发。取消表示停止接收，WorkBuddy 自身任务需在那里取消。外部执行状态不明确时保留任务。

WorkBuddy 使用官方本地助理消息接口发送任务说明，输入和输出限制在当前任务目录。这是工作台定义的本机文件交接约定，官方接口没有被假定提供图片返回字段。外部接口支持 Images generations JSON 和 edits multipart，原图及参考图作为实际 PNG 输入。外部模型只能提供候选结果，用户采用后才进入当前项目。

上述消息派发仍供 Web 使用。MCP 从 WorkBuddy 内调用时强制使用 conversation 交接，不再给 WorkBuddy 自身发消息。文字、分镜与网站结构可由当前对话模型写回，后台文字生成器继续保留。核心写入与 Web 保存共用 Repository 队列；核心操作回执和项目原子保存，按项目哈希检查版本，防止并发覆盖。输入文件仅从项目专属 inbox 接收，输出包括受控 exports 下的 TXT/Markdown。实际安装步骤和验证边界见 [WorkBuddy 核心接入](WORKBUDDY_CORE.md)。

前端演示独立于真实项目；服务密钥仅在本机服务端环境中配置，浏览器不保存密钥。Runtime 限本机访问并拒绝 Origin，Web 代理校验同源。未部署云站点或数据库。详细协议、限制与启动方式见[多媒体运行说明](MULTIMEDIA_RUNTIME.md)。

## 视频与网站扩展

`output-generation.mjs` 编排分镜、镜头、配音、合成及网站任务；`output-contract.mjs` 在前后端共享结构、媒体引用和版本依据。`adapters/video.mjs` 实现 Runway Gen-4.5 的 POST / GET 和受限 CDN 下载。外部任务编号持久化后，刷新与重启只查询，不自动重发。音视频文件回收与转码在后台处理，查询接口及时返回；取消不接受迟到输出。

`video-media.mjs` 用实际 FFprobe / FFmpeg 解码、规范化与合成。临时处理目录随机生成并限制在数据根的 render 内，执行使用参数数组，不使用 shell 拼接。`website.mjs` 校验 JSON 后编译静态 HTML，转义文本，只嵌入项目图片；预览受 iframe 和响应 CSP 双层 sandbox 约束，不接触父页面或密钥。

`delivery-stages.tsx` 提供分镜编辑、逐镜头生成／导入、声音、合成和网站生成／编辑／预览／下载。文件放入 `files/<sha256>.<ext>`，Web 代理传递 Range、Content-Range 及安全响应头。备份版本2加入已采用的媒体与网站文件，导入检查哈希和解码；原版本1仍可读取。完整服务说明见 [VIDEO_WEBSITE_RUNTIME.md](VIDEO_WEBSITE_RUNTIME.md)。
