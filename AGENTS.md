# 项目约定

- 当前仅搭建空框架。具体工具、业务、产品名称、图标、品牌和页面内容均待用户后续指定，不自行补充。
- 保留 Web → 共享 Runtime → 适配器的分层。能力清单为 workbench/manifest.json，当前为空。
- CLI、HTTP、MCP 只保留基础接入。尚未实现任务执行与产物管理，不假装这些功能已经可用。
- 新功能先明确需求，再实现对应模块；不把参考项目业务批量带回。
- 验证使用 npm test、npm run lint、npm run typecheck、npm run build。
