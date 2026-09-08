# 多媒体功能与本机配置

更新日期：2026-09-08。代码已接通保存、文字及图像流程；真实 DeepSeek、WorkBuddy 和外部图像服务均待账户实测。模拟验证记录见 [MULTIMEDIA_VERIFICATION.md](MULTIMEDIA_VERIFICATION.md)。

## 启动与配置

使用 Node.js 22.13 以上版本。在仓库运行 `npm install`，复制 `.env.example` 为 `.env.local`，只在本机填写需要的配置，再运行 `npm run dev`。页面为 <http://localhost:3001/>，Runtime 默认监听 `127.0.0.1:8791`。配置变更后重启。不要把密钥放进聊天、项目内容、浏览器存储或提交到 Git。

| 配置 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | 创意、内容、美术提示词、对象提取和短篇；固定 `deepseek-v4-flash` |
| `WORKBENCH_IMAGE_PROVIDER` | 初始图像入口，默认 `workbuddy`；页面可切换 `external` |
| `WORKBUDDY_ACCESS_TOKEN` | 官方 Open Platform OAuth access token，需 `user.localassistant.invokable` 范围；留空可手动交接 |
| `IMAGE_API_BASE_URL` | 可选外部 Images API 基地址，默认 `https://api.openai.com/v1` |
| `IMAGE_API_KEY` / `IMAGE_API_MODEL` | 外部服务的密钥和模型；默认模型 `gpt-image-2` |
| `WORKBENCH_DATA_DIR` | 可选绝对数据目录，默认仓库下 `work/data` |
| `WORKBENCH_RUNTIME_PORT` / `WORKBENCH_RUNTIME_URL` | 改端口时同时指定，例如 `8793` 与 `http://127.0.0.1:8793` |

服务配置页只显示是否配置，不能证明令牌有效、账户有余额或调用成功。Web Worker 仅显式转入 Runtime 地址；生成密钥由独立 Node Runtime 读取。构建只完成本机产物，不代表已部署。

## WorkBuddy 图像请求

1. 在同一台电脑运行 WorkBuddy，确保已登录、具备实际图片生成／编辑能力，并允许读取本次任务的输入、写入任务目录。工作台不会安装生图能力或替用户开通账号。
2. 自动发送使用官方 `POST https://www.workbuddy.cn/openapi/v2/localassistant/message`，Bearer token，请求体为 `{ "content": "任务说明", "msg_type": "text" }`。成功确认后保存返回的 `data.message_id`。OAuth 应用注册、用户授权和令牌获取遵循 [WorkBuddy 官方 Open API 文档](https://open.workbuddy.cn/docs/openapi)；本轮未内置授权页或刷新令牌。
3. 工作台在 `handoff/<任务 ID>/` 创建 `request.json`、原图和参考图。消息要求 WorkBuddy 读取这些输入，生成真实 PNG，先写临时文件再重命名为该目录的 `result.png`。原图返工明确要求读取编辑目标。
4. 页面按任务 ID 查询，检测到指定 PNG 后解码保存为媒体文件。WorkBuddy 无法完成时可写同目录 `error.json`。此文件约定由工作台定义，**不是官方 API 的图片回调协议**；尚未通过真实 WorkBuddy 实测。
5. 未配置 token，或官方接口明确拒绝接收时，页面显示可复制的手动请求；不会标成已自动发送。网络中断导致送达不明时标为待核实，先在 WorkBuddy 查看，避免重复发起。工作台取消等待不会取消 WorkBuddy 内的实际执行。

只读取指定的 `result.png`，不自动下载回复中的任意 URL，也不让回复指定读取其他磁盘文件。每项任务仍需要 WorkBuddy 实际生成并按约定保存；若其生图能力只提供聊天预览而无法导出本机文件，需后续针对真实返回方式调整适配器。

## 外部图像 API

兼容范围以 [OpenAI Images 文档](https://developers.openai.com/api/docs/guides/image-generation)为依据：无输入图片时请求 `images/generations`；存在原图或参考图时请求 `images/edits`，multipart 中以 `image[]` 传入真实 PNG。请求包含模型、提示词、数量 1、画幅、`quality=medium` 与 `output_format=png`，响应需包含 `data[0].b64_json`。

支持 1:1、3:2、2:3，外部请求尺寸分别为 1024×1024、1536×1024、1024×1536。最多四张美术参考，编辑目标作为第一张图额外传入。其他服务即使叫“兼容 API”，也需确认这些字段和参考图能力；仅返回图片 URL 的接口当前不兼容。外部地址允许 HTTPS 或本机 HTTP；不跟随重定向。

## 文字与使用流程

创意完善后先预览、采用；内容支持完整生成、整篇修改、当前小节修改、选中文字修改和遗漏检查。选区须仍与提交位置和文字一致；生成依据改变后，旧结果只供复制，不能覆盖。美术阶段只生成文字，参考图片用途作为文字约束，未接入自动视觉分析。

概念图先提取／手工创建对象，再逐一生图。结果先加入候选，点击“保存”才进入选定参考集。返工基于当前候选或已选定图，携带实际原图和修改要求；新候选不立即替换旧选定图。封面生成可在项目管理的“更换封面”中使用。

小说可跳过图片直接生成完整短篇，采用后可编辑标题及正文，下载 TXT 或 Markdown。当前一次短篇任务，不支持长篇分章队列、DOCX 或自动章节完整性审读。模型声明完整和字段校验不能替代实际阅读检查。文字使用 [DeepSeek JSON 模式](https://api-docs.deepseek.com/guides/json_mode/)，不依赖模型直接覆盖用户稿件。

## 保存、恢复与边界

- 真实项目保存于 `workspace.json`，保留上一确认快照 `workspace.previous.json`；图片为 `media/` 下的哈希 PNG，任务在 `tasks/`。同一目录仅运行一个 Runtime。
- 旧浏览器项目在空服务首次读取时自动复制；设置页可再次主动导入为独立新项目，原浏览器副本保留。演示项目不迁入真实工作区。
- 设置中的备份导出包含项目及被项目引用的图片、视频、音频、网站成品和字幕；导入生成新项目 ID 并保留现有项目。它不包括任务历史、尚未采用的结果或 WorkBuddy 交接目录。完整备份应停服务后复制整个数据目录。
- 保存失败保留当前页面内容，多页面版本冲突不会覆盖服务端；先导出当前草稿再刷新读取。临时体验不发起生成。
- 同一请求 ID 去重；服务中断后同步任务为待核实，WorkBuddy 已发送任务继续检查指定文件。查询不会自动再次付费生成。取消停止接收后不采用迟到结果。
- 上传界面当前限制 8 MB，Runtime 接收上限 20 MB，限制 4000 万像素；图片解码为静态 PNG。移除引用暂不清理磁盘文件，历史和撤销继续可用；没有垃圾回收或多用户权限系统。
- 视频与网站已实现，配置和使用见[视频与网站交付](VIDEO_WEBSITE_RUNTIME.md)；真实供应商及作品质量尚未验证。长篇及 3D 文创成品尚未实现。开发顺序：保存／任务 → 文字 → 图像 → 视频 → 网站 → 3D 文创。
