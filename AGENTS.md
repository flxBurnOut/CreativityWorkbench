# 项目约定

- 当前已实现 P1 前端骨架与五阶段界面，采用 README 13.8–13.9 中确定的 B＋C 融合岭南主题。继续保留简洁流程，不擅自扩展品牌、工具市场或业务类型。
- 保留 Web → 共享 Runtime → 适配器的分层。能力清单为 workbench/manifest.json，当前仅登记 creative-brief。第一阶段使用服务端 DeepSeek V4 Flash 适配器，密钥仅通过服务端环境配置。
- 浏览器草稿使用独立 IndexedDB 存储，演示项目不混入真实项目。服务端持久化、后续阶段 AI、任务队列与成品交付尚未接入；HTTP 支持创意请求，CLI 仍仅发现/诊断，MCP 仍仅只读清单。配置状态不等于真实请求验证，不伪造生成结果。
- 新功能先明确需求，再实现对应模块；不把参考项目业务批量带回。
- 验证使用 npm test、npm run lint、npm run typecheck、npm run build。
