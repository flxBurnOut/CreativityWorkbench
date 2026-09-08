# 项目约定

- 2026-09-08 最新方向：按原顺序完成保存与任务、文字、图像；然后视频、网站，最后才实施 3D 文创资产。文创成品确定为 3D，不改做平面文创。旧 3D 提案仅作历史参考，不主动恢复。

- 当前已实现 P1 前端骨架与五阶段界面，采用 README 13.8–13.9 中确定的 B＋C 融合岭南主题。继续保留简洁流程，不擅自扩展品牌、工具市场或业务类型。
- 保留 Web → 共享 Runtime → 适配器的分层。能力清单为 workbench/manifest.json，登记已实现接口并单独标明真实服务验证状态。文字使用服务端 DeepSeek V4 Flash；图像优先 WorkBuddy 官方本地助理消息接口与受控文件交接，同时保留外部 Images API。密钥仅通过服务端环境配置。
- 项目、任务、PNG 与音视频／网站文件保存在 work/data 或指定目录，旧 IndexedDB 仅用于迁移／导入且保留原副本。演示项目不混入真实项目。文字、短篇 TXT/Markdown、图像生成／带原图编辑已接线；真实账户与出图质量尚未验证。视频分镜、WorkBuddy MP4/WAV 交接、Runway Gen-4.5、FFmpeg 合成与静态网站生成／预览／打包已实现，真实服务未验。长篇和 3D 交付仍未实现。CLI 提供发现/诊断与本机接入包生成；MCP 已封装 12 项核心工具、2 项 WorkBuddy Skills，复用同一 HTTP Runtime，项目写入和采用需版本检查与幂等回执。MCP 的 WorkBuddy 媒体任务使用当前对话文件交接，不再给自己派发消息。Skill ZIP 和连接配置位于 work/workbuddy-core，由用户手动加载测试；不将本地协议测试称为 WorkBuddy 实际装载通过。配置、模拟验证和真实结果分别记录。
- 新功能先明确需求，再实现对应模块；不把参考项目业务批量带回。
- 验证使用 npm test、npm run lint、npm run typecheck、npm run build。
