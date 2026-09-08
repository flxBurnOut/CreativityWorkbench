# 当前架构

沿用参考项目的分层：Web 页面 → HTTP 接入 → 共享运行时 → 适配器。CLI 和 MCP 共用该运行时的清单读取逻辑。

前端已实现项目首页、新建与管理、五阶段创作界面、设置、帮助和四类独立演示。后端已接入第一阶段创意服务与 DeepSeek V4 Flash 适配器；HTTP 支持创意请求与配置状态，CLI 发现/诊断和 MCP 只读清单继续保留。没有通用任务队列和成品生成。

前端采用用户确定的 B＋C 融合岭南主题：瓷白工作面、青绿主色、柔和圆角、骑楼院落与葵扇彩瓷插画。暂定产品名为“创意工作台”，最终品牌未定义。设计基准见 [README](../README.md#138-bc-融合主题当前基准)。

| 模块 | 职责 |
| --- | --- |
| `app/(workbench)/page.tsx` | 挂载前端工作台 |
| `features/creative-flow/workbench.tsx` | 项目导航、首页、弹窗、演示与状态反馈 |
| `features/creative-flow/stages.tsx` | 各类型内容编辑、提示词、概念图片、成品预览布局 |
| `features/creative-flow/creative-api.tsx` | 创意请求、取消、预览采用、旧结果保护与配置状态 |
| `app/api/workbench/creative/route.ts` | 同源 Web 接口、请求体限制与 Runtime 转发 |
| `lib/workbench/creative-brief.mjs` | 输入校验、岭南文化规则、结构化创意编排 |
| `lib/workbench/adapters/deepseek.mjs` | DeepSeek 请求、返回校验与错误脱敏 |
| `features/projects/model.ts` | 项目结构、持久化格式校验、图片引用整理与示例工厂 |
| `features/projects/local-store.ts` | IndexedDB 读写、版本冲突检测、图片输入校验 |
| `features/projects/use-project-store.ts` | 自动暂存队列、恢复、失败与临时模式 |
| `components/workbench/ui.tsx` | 按钮、字段、原生对话框、图片预览与空状态 |
| `app/globals.css` / `public/art/` | 主题、响应式布局、原创 SVG 场景 |

当前项目信息与图片 Blob 作为一个版本化工作区快照写入浏览器 IndexedDB。写入串行化，并检查数据库版本，避免另一页面的旧快照覆盖较新数据。只有事务提交成功才显示“已暂存到此浏览器”；格式错误不会重置原有记录。临时模式需要用户主动选择，不写入数据库。

演示项目由独立前端状态持有，离开后不写入真实项目；演示结果均标明非生成成品。页面使用 hash 保存导航位置，项目内部阶段保存在项目草稿中。浏览器后退与重新打开支持恢复。

图片不转成 Base64 放进文本记录，直接使用 IndexedDB 结构化克隆保存 Blob，并通过受控 object URL 展示。引用清理保留仍被封面、美术参考或候选/选定参考使用的图片。删除的短暂撤销在当前页面内保留必要对象。

正式目标仍为页面 → HTTP → 共享 Runtime → 适配器；本地草稿是获准的前端阶段过渡存储。后续替换存储入口、补充服务端项目与任务接口；现有前端暂存不等于服务端 P1 验收通过。能力清单仅包含 `creative-brief`，需要 `DEEPSEEK_API_KEY`；配置状态不代表账户余额和真实连通性已通过验证。

技术基础：React、TypeScript、Vinext/Vite、Node.js；保留本地构建所需配置。未配置云端站点、数据库或部署资源。
