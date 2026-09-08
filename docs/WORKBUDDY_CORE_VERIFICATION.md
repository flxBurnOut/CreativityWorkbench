# 核心接入本地验证记录

日期：2026-09-08。此记录针对本地核心 MCP 与 Skill 接入，不代表 WorkBuddy 已实际加载。

- `npm test`：41 / 41 通过。其中 4 项新增 MCP 集成测试使用真正的 SDK stdio Client 与独立 HTTP Runtime，数据隔离在临时目录。
- `npm run typecheck`、`npm run lint`、`npm run build`：通过。构建保留 Vinext 现有的首页静态分类 Unknown 提示，退出码为 0。
- stdio：12 个工具与 manifest 可发现；从仓库外工作目录使用生成的绝对路径配置，能够连接正常 Runtime 并读取状态与项目列表。
- 项目／文字：新建、保存、跨连接读取、TXT/MD 实际导出；重复请求不新增数据，两个并发写入只接受一个，Web 保存后核心回执仍可重试。
- 网站：通过对话结构直接保存后调用本机构建器，实际生成 HTML/ZIP；检查 ZIP 含 index.html；旧结果采用被拒绝，旧成品标为 stale。
- 图像：测试 PNG 实际解码与交接；基于原图修改时交接包含实际原图；取消后迟到图片不会采用。
- 视频：测试图案 MP4 和合成音 WAV 作为隔离测试素材，真实 FFmpeg 导入／解码／合成，检查成品音轨、约 2 秒时长与 SRT。测试素材不属于真实作品或生成模型质量验证。
- WorkBuddy 消息：即使测试环境含模拟 token，MCP 当前对话交接也不触发外部请求；任务 dispatch 为 conversation。
- 启动：自动启动共享 Runtime；第二客户端复用同一服务，断开 MCP 连接不停止 Runtime；旧服务、错误数据目录和非本机地址被拒绝。
- 包装：两个 ZIP 可解包，SKILL.md 与源文件一致；配置中的 Node 与入口文件实际存在。没有修改 WorkBuddy 的全局或项目级配置。
- Skills：使用 YAML 解析器检查 WorkBuddy 必填元数据和引用文件；由于 Codex 校验器不支持 WorkBuddy 双语等扩展字段，对临时规范化副本执行共享命名与正文检查，源文件保留 WorkBuddy 格式。
- 正常工作台：旧 Runtime 已刷新为核心协议版本 1，正常数据目录的项目数仍为 0，测试项目没有混入。

尚待用户执行：WorkBuddy 导入和启用两项 Skills、MCP 加载、自动选择技能、真实图像／视频／语音能力调用，以及至少一项真实项目的完整交付。测试步骤见 [WORKBUDDY_CORE.md](WORKBUDDY_CORE.md)。
