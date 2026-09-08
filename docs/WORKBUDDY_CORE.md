# WorkBuddy 核心 Skills 与 MCP 接入

本轮提供本地 stdio MCP、两项 Skills 和本机连接配置。目标是在 WorkBuddy 对话中完成项目、文字、图像、视频与静态网站的核心流程。连接器市场发布、专家插件、3D 生成、长篇编排、动态网站后台不在本轮范围。

## 准备与安装

在仓库根目录使用 Node 22.13+，先 `npm ci`，再 `npm run workbench:setup`。脚本在 `work/workbuddy-core/` 生成：

- `mcp.json`：使用本机 Node 与仓库入口的绝对路径，支持 Windows 空格和中文路径，不依赖 WorkBuddy 工作目录。不会包含 API 密钥。
- `creativity-project.zip`：项目、创意、文字与美术设定。
- `creativity-media.zip`：图片、视频和网站交付。
- `TESTING.md`：本说明副本。

在 WorkBuddy 的技能管理中选择添加／上传技能，分别导入两个 ZIP 并启用。然后打开 MCP 配置入口，将生成的 `mcp.json` 中 `creativity-workbench` 这一项合并到现有 `mcpServers`，保留已有服务器配置。不同 WorkBuddy 版本入口名称可能不同；也可按其项目级配置方式加载。此脚本不会修改用户全局或项目级 WorkBuddy 配置，实际加载由用户手动完成。

依据官方 [Skills 格式](https://open.workbuddy.cn/docs/skill)、[MCP stdio 配置](https://open.workbuddy.cn/docs/connector) 与 [技能导入说明](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market)准备。这里是开发项目的本机接入包，不是已发布市场连接器。移动仓库、换机器或更新 Skill 后重新运行 setup。

## Runtime 与配置

MCP 第一次调用工具会检查共享 Runtime。默认使用 `http://127.0.0.1:8791`、当前仓库 `work/data`；不存在时由 `--ensure-runtime` 隐藏启动，日志为 `work/data/runtime.log`。MCP 自身 stdout 只输出协议消息。Runtime 独立存活，关闭 WorkBuddy 对话不会主动终止生成；进程意外结束时保留已有任务并按原任务查询。

如果已经运行旧版 Runtime，先在其启动终端停止旧进程再重新连接。检测到版本／数据目录不一致时返回 `runtime_mismatch`，不会悄悄切换到别的工作台或第二个数据目录。MCP 多连接共享 HTTP Runtime；项目保存与 Web 共用一个持久化队列和文件。

已有 `npm run dev` 启动的新版 Runtime 可直接复用。若 Runtime 已由 MCP 启动，要查看页面时单独运行 `npm run dev:web`，避免 `npm run dev` 再占用 8791。若希望统一由开发终端管理，先停止 MCP 启动的该 Runtime，再运行 `npm run dev`。不要结束其他项目的 Node 进程。

`.env.local` 仍是服务端配置源，进程环境优先。可配置 `WORKBENCH_RUNTIME_URL`（仅 http://127.0.0.1:端口）、`WORKBENCH_RUNTIME_PORT`、`WORKBENCH_DATA_DIR`；使用自定义数据目录时，MCP 与 Runtime 必须一致。端口和数据目录变更后重新启动对应进程。

文字直接由 WorkBuddy 写回时无需 DeepSeek 密钥。`task_start` 的文字生成器需要已有 DeepSeek 配置。图像／视频 WorkBuddy 模式只创建当前对话的文件交接，**不调用 WorkBuddy 消息接口，不要求 WORKBUDDY_ACCESS_TOKEN**。真实图像／视频／语音能力仍来自 WorkBuddy 中实际可用的工具；Skills 与本 MCP 不自带这些模型。外部 API 继续使用现有服务端配置，不把凭证填进 Skill 或连接包。

## 核心工具

| 工具 | 能力 |
| --- | --- |
| workbench_status | 连接、配置状态、能力范围 |
| project_list / project_get | 列表、完整草稿、版本、专属 inbox |
| project_create / project_update | 新建与按字段更新，数组整体替换 |
| task_start / task_list / task_get | 生成任务及文件交接，长任务异步查询 |
| task_cancel / task_adopt | 停止本地处理／接收、检查依据后采用 |
| media_import | 从项目 inbox 导入实际图片、镜头、旁白、配乐 |
| project_deliver | 正文 TXT/MD 和已采用媒体／HTML／ZIP 实际文件 |

所有接口复用 `POST /v1/core/<工具名>`；MCP 不直接写 workspace.json 或另建 TaskManager。保留 `workbench://manifest` 资源。此处共 12 个工具，不开放删除项目、任意文件读写、Shell、安装软件、改密钥或发布网站工具。

写操作使用 projectVersion 检查项目级并发；Web 更新其他项目不妨碍当前项目修改。requestId 支持原参数幂等重试，工作区原子保存最近 1000 次核心操作回执；更早的重试仍受版本和项目 ID 检查保护。任务提交持久保存 requestId；任务结果不因查询成功自动写回项目。采用记录和项目同时提交，重复采用不会重复追加内容。

`media_import` 只读该项目 inbox 的简单文件名，拒绝路径穿越和链接到别处的文件。图片实际解码；音视频经 FFmpeg 解码与规范化，最大处理时间约 3 分钟，因此连接模板给出 210 秒超时。生成器、合成与网站构建通过异步 task 工具执行；不要为等待中的任务反复创建新 ID。

## 用户手动加载验收

以下项目只在本机保存测试资料，建议标题统一加“WB加载测试”，便于与真实作品区分。

1. **发现工具**：对 WorkBuddy 说“检查创意工作台的连接状态，列出已有项目。”应发现 12 个工具及 manifest 资源；状态中的 WorkBuddy 实际加载测试仍标记待用户验证。
2. **无额外密钥的文字闭环**：“新建 WB加载测试小说，主题是西关修伞人的一天。写创意、文化依据、一个短篇并保存，导出 TXT 和 Markdown。”核对 project_list 可找到、重新读取正文一致、文件真实存在。可在 Web 查看同一项目。
3. **无额外密钥的网站闭环**：“新建 WB加载测试网站，做岭南手艺介绍，包含首页和常见问题。用当前对话完成文案并保存，然后本地构建并给我预览与 ZIP。”应调用 website-build 而无需文字 API；采用后能打开实际 HTML 和 ZIP。
4. **图像**：“为测试项目添加一个葵扇概念对象并生成图片。”WorkBuddy 应读取本次 handoff 的输入，用其实际生图能力写回 PNG，查询成功再采用。再要求局部修改，核对读取的是原图。没有生图能力时应明确说明，不能出现占位图或自发消息循环。
5. **视频**：保存一个 2–5 秒分镜。用 WorkBuddy 可用工具生成或导入真实 MP4，必要时写回 WAV，查询并采用，然后 video-compose。应得到可播放 MP4 和 SRT；修改镜头描述后旧成品标记 stale。
6. **恢复**：重复同一 requestId 不新增任务／项目；修改项目后采用旧生成结果得到冲突；关闭重开 WorkBuddy 后项目与任务仍可读取。

发生失败时记录 WorkBuddy 版本、工具名、错误 code、任务 ID，以及 Runtime 是否由旧终端启动。无需提供密钥。协议测试通过只能证明本地接口互通，不能代替 WorkBuddy 的加载、技能触发或真实媒体生成验证。
