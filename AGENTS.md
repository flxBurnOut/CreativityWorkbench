# 项目约定

- 2026-09-10 原任务交接修复：当前协议 7、24 工具、Skills 0.5.1。网页图片任务必须沿用原 ID 和输出路径；task_complete_handoff 仅将明确选定的同项目 PNG 写回原交接，由正常导入器校验成功，不创建任务或直接采用。同 ID 同文件可重试，不覆盖不同结果。Skills 已有任务路由优先于新建流程。历史段落的版本为当时状态。

- 2026-09-09 实际验收修复：当前核心协议 6、23 工具、Skills 0.5.0。新增 video_frame_fit 和受限 workbench_call_json。视频规格与文件可解码、依据新鲜度分开；网站外部验收报告不等于 Runtime 独立验证。MCP 原生数组与 JSON 数组字符串在传输层兼容，Runtime 保持严格类型、版本和幂等检查。历史段落中的工具数/协议是当时状态。见 docs/WORKBUDDY_ACCEPTANCE_FIXES_2026-09-09.md。

- 2026-09-09：用户要求文化库独立于游戏，不导入《织梦者》原项目作为默认知识。首批知识源在 workbench/knowledge/lingnan-2026-09-09.mjs；事实有出处，创作转译与事实分开，跨区域不得混为同一民俗。已发布知识版本保持可解析；后续修订新增版本并保留旧版注册。knowledge_search / knowledge_apply 共用 Runtime；资料引用参与生成依据、过期检测与交付。真实服务和 WorkBuddy 实际加载另行验收。

- 2026-09-08 连续创作已实现：五类型成果与历史记录、对象来源及实际参考、小说设定往返、视频可选首帧候选、网站源码候选与下一轮真实源码交接、3D 前期资料包。类型草稿分支隔离，按选择继承。新增 workflow_get、workflow_update、website_source_import，总计 21 工具／协议 5，Skills 0.4.0。保持 prompts.mjs 中的系统与文化规则。详见 docs/CONTINUOUS_WORKFLOW.md；3D 模型与长篇仍未实现。

- 2026-09-08 最新提示词方向：统一文化、阶段与作品类型约束；概念图明确原图、风格参考、选定对象及成品素材用途。视频主入口只针对一个连续镜头，可直接编辑最终提示词，无需分镜前置；旧分镜、旁白与合成保留。网站新任务由 harness 准备提示词与素材交接，模型／外部 agent 完整实现内容、设计、代码与功能，不再使用工作台固定模板生成新网站；旧网站与构建器仅作兼容。规则源为 lib/workbench/prompts.mjs，MCP 新增 prompt_prepare 共 21 工具，核心协议 5。详见 docs/PROMPT_HARNESS.md。

- 2026-09-08 最新方向：按原顺序完成保存与任务、文字、图像；然后视频、网站，最后才实施 3D 文创资产。文创成品确定为 3D，不改做平面文创。旧 3D 提案仅作历史参考，不主动恢复。

- 当前已实现 P1 前端骨架与五阶段界面，采用 README 13.8–13.9 中确定的 B＋C 融合岭南主题。继续保留简洁流程，不擅自扩展品牌、工具市场或业务类型。
- 保留 Web → 共享 Runtime → 适配器的分层。能力清单为 workbench/manifest.json，登记已实现接口并单独标明真实服务验证状态。文字使用服务端 DeepSeek V4 Flash；图像优先 WorkBuddy 官方本地助理消息接口与受控文件交接，同时保留外部 Images API。密钥仅通过服务端环境配置。
- 项目、任务、PNG 与音视频／网站文件保存在 work/data 或指定目录，旧 IndexedDB 仅用于迁移／导入且保留原副本。演示项目不混入真实项目。文字、短篇 TXT/Markdown、图像生成／带原图编辑已接线；真实账户与出图质量尚未验证。单镜头视频、WorkBuddy MP4/WAV 交接、Runway Gen-4.5、FFmpeg 合成与网站提示词／素材交接已实现；旧模板网站保留预览／打包兼容，真实服务未验。长篇和 3D 交付仍未实现。CLI 提供发现/诊断与本机接入包生成；MCP 已封装 21 项核心工具、2 项 WorkBuddy Skills，复用同一 HTTP Runtime，项目写入和采用需版本检查与幂等回执。MCP 的 WorkBuddy 媒体任务使用当前对话文件交接，不再给自己派发消息。Skill ZIP 和连接配置位于 work/workbuddy-core，由用户手动加载测试；不将本地协议测试称为 WorkBuddy 实际装载通过。配置、模拟验证和真实结果分别记录。
- 新功能先明确需求，再实现对应模块；不把参考项目业务批量带回。
- 验证使用 npm test、npm run lint、npm run typecheck、npm run build。
