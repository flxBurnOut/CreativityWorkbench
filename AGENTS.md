# 项目约定

- 当前已实现 P1 前端骨架与五阶段界面，采用 README 13.8–13.9 中确定的 B＋C 融合岭南主题。继续保留简洁流程，不擅自扩展品牌、工具市场或业务类型。
- 保留 Web → 共享 Runtime → 适配器的分层。能力清单为 workbench/manifest.json，当前为空。
- 浏览器草稿使用独立 IndexedDB 存储，演示项目不混入真实项目。服务端持久化、AI、任务执行与成品交付尚未接入；CLI、HTTP、MCP 仍只有基础接入，不伪造可用能力或生成结果。
- 新功能先明确需求，再实现对应模块；不把参考项目业务批量带回。
- 验证使用 npm test、npm run lint、npm run typecheck、npm run build。
