# 第一阶段：DeepSeek V4 Flash

当前只接入创意阶段的“帮我完善”“换个方向”“按要求完善”。内容、美术提示词、概念图和成品仍保留原有未接入状态。

## 本地配置

1. 将根目录 `.env.example` 复制为 `.env.local`。
2. 在本地填写 `DEEPSEEK_API_KEY=你的密钥`，不要提交或发送到聊天。
3. 重启 `npm run dev`，在工作台设置里刷新创意服务状态。
4. 创建自己的项目，写下想法，点击“帮我完善”。演示项目不调用 API。

`.env.local` 被 Git 忽略，Runtime 启动时读取；已有进程环境值优先。前端没有密钥字段，也不将密钥放进 IndexedDB。生产运行时同样需要单独启动 Node Runtime 并通过环境提供密钥；本轮没有新增远程部署、身份认证或服务端项目保存。

官方接口：[`POST https://api.deepseek.com/chat/completions`](https://api-docs.deepseek.com/api/create-chat-completion/)，模型固定为 `deepseek-v4-flash`。使用非思考、非流式 JSON 输出，输出上限 4096 tokens，120 秒服务端等待上限；不自动重试付费请求。模型命名依据 [DeepSeek 首次调用文档](https://api-docs.deepseek.com/)。

## 请求与结果

调用链：Web `/api/workbench/creative` → Runtime `/v1/creative/brief` → 创意编排 → DeepSeek 适配器。

输入只有 `action`（`improve`/`redirect`/`revise`）、`type`、`idea`、`brief`、`culture`、`instruction`。上限依次为原始想法 4000 字、当前方案 20000 字、文化语境 4000 字、修改要求 4000 字。请求体上限 128 KiB。不发送图片、其他阶段内容、浏览器存储或完整项目对象。

返回 `title`、`brief`、`culture`、`model`。服务端校验结构与完整结束标志；拒绝截断或无效结果。方案预览采用后写入现有浏览器草稿，名称建议默认不采用；可在短暂撤销期恢复原稿。生成期间输入改变会禁止旧结果覆盖，用户仍可复制预览文字。

等待期间可取消或离开阶段，取消信号逐层传递，迟到结果不写入其他项目。请求发出后的供应商费用无法通过停止等待保证撤回。未采用的结果仅在当前页面临时显示，刷新或离开阶段会清除；已采用方案按现有 IndexedDB 逻辑恢复。

Runtime 仅监听回环地址，拒绝带 Origin 的直接浏览器请求和非本地主机名；Web 写接口检查同源与 JSON 类型。最多同时处理 2 个创意请求。不透传供应商原始错误、密钥或调试正文。

`GET /api/workbench/creative` 返回模型与密钥是否配置，不执行计费调用。已配置不等于密钥有效、账户有余额或网络连通。

## 验证记录

自动测试覆盖：模型与参数、原始文字保真、输入校验、缺少密钥时零外部请求、401/402/429/500 脱敏且不重试、异常和截断结果、取消传播、Runtime HTTP 闭环、同源边界。连同既有前端和 Runtime 检查，共 15 项测试。

最终 `npm test`（15 项）、`npm run lint`、`npm run typecheck`、`npm run build` 均通过，`git diff --check` 无空白错误。

浏览器已验证实际缺少密钥提示，并用本地模拟供应商响应验证三种操作、预览、采用、撤销、生成期间编辑保护、采用后刷新恢复与取消。模拟服务已退出，临时测试项目已删除，工作台恢复真实适配器。

本次未配置真实 DeepSeek 密钥，因此没有执行付费模型请求；真实账户连通性、输出质量与费用仍需配置后验证。
