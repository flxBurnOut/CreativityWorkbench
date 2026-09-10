# 文字服务接入与腾讯云 Token Hub

用户确认所填密钥来自腾讯云 Token Hub。此前工作台固定请求 DeepSeek 官方地址，导致腾讯云凭据收到 401；该结果只能说明凭据不适用于那个接入点，不能据此判断腾讯云密钥无效或要求用户购买 DeepSeek 官方服务。

## 配置

网页「设置 → API 配置 → 文字生成」可填写 API 地址、准确模型 ID 与对应平台密钥。提供 DeepSeek 官方与腾讯云广州按量预设，点击预设只填地址/模型，保留已有密钥，保存后新请求立即使用。新加坡及其他接入域名按开通地域和控制台填写，不自动跨地域回退。

| 项目 | DeepSeek 官方默认 | 腾讯云广州按量预设 |
| --- | --- | --- |
| API Base URL | `https://api.deepseek.com` | `https://tokenhub.tencentmaas.com/v1` |
| 模型 ID | `deepseek-v4-flash` | `deepseek-v4-flash-0731` |
| 密钥 | DeepSeek 官方密钥 | Token Hub 平台密钥 |

按量接口与 Token Plan 套餐接口不同；这里的 Token Hub 预设为按量服务。模型是否在线、是否获准调用及计费状态以用户账户与平台响应为准。

环境配置新增 `TEXT_API_BASE_URL` 与 `TEXT_API_MODEL`。密钥沿用 `DEEPSEEK_API_KEY` 历史字段，不复制或丢弃原有凭据。网页保存覆盖同名环境配置。接口只返回公开配置、凭据存在布尔值及保存时间；不回显密钥。未填写新字段的旧安装保持原 DeepSeek 默认行为。

## 行为与边界

- 第一阶段创意与共享文字生成（含内容、正文、美术提示词及 3D 造型方案）使用同一配置；状态页显示真实配置的服务和模型。
- 使用 OpenAI Chat Completions JSON 输出，所选模型必须支持该协议及 `response_format: json_object`。DeepSeek 模型显式关闭思考；其他模型不强塞 DeepSeek 专属参数，不承诺任意模型兼容。
- 只允许 HTTPS 地址，不允许 URL 内嵌凭据、查询参数或片段，禁止请求重定向。粘贴完整 `/chat/completions` 地址时会规范化为 Base URL，避免重复拼接。
- 鉴权失败（401）、访问权限问题（403）、接口/模型不存在（404）、参数不兼容（400）、额度不足（402）分别提示；不回显供应商原始错误正文，不自动重试或切换供应商。
- 400 响应额外保留腾讯云已公布的业务错误码、已知参数名与 UUID 请求编号；读取最多 16 KiB、最多等待 2 秒，失败仍保留原 HTTP 错误。不会保存或回显原始错误正文、密钥及回显的项目内容。
- 修改文字配置不会自动接入腾讯云的图像、视频、语音或云端 3D 生成。当前 3D 仍由文字模型解析受限方案，再由本机 Blender 构造、预览及导出。

## 依据与验证

[腾讯云 API 使用说明](https://cloud.tencent.com/document/product/1823/130078)定义按地域的入口、Bearer 鉴权、模型列表及模型 ID。[Chat Completions 文档](https://cloud.tencent.com/document/product/1823/135872)定义请求协议与模型参数差异。

新增回归覆盖两条文字调用链路的 Token Hub 地址与模型传递、旧配置兼容、其他模型参数、URL 校验、错误脱敏与不自动回退、HTTP 保存后即时切换且保留原密钥。真实鉴权与生成结果另行记录，不把模拟响应视为真实账户通过。

本轮全量 216 项：210 通过、2 项既有 Windows 权限差异失败（目录链接 EPERM 与 POSIX 文件模式断言）、4 项真实 Blender 专项默认跳过。新增 5 项定向回归通过；lint、typecheck、build 通过。实际浏览器验证重启加载、设置中的地址/模型输入、Token Hub 预设填值与未保存提示；点击预设尚未保存时 Runtime 仍保持旧配置。测试日志位于 `work/dev-service/tokenhub-tests.log` 和 `tokenhub-build.log`。仅新增接入配置，不宣称完成真实 Token Hub 生成或 WorkBuddy 客户端验收。

## 18:35 参数错误反馈

用户截图中的腾讯云控制台选中了 `deepseek-v4-flash-0731`，而本机设置在 18:34:59 保存的仍是 `deepseek-v4-flash`。18:35:02 的 3D 请求返回 HTTP 400。旧适配器未保留业务错误码，因此不能断言本次 400 的具体原因，更不能仅凭 400 判定 JSON 模式不受支持。

Token Hub 预设现改为控制台选中的明确模型 ID，DeepSeek 官方预设与用户已保存的配置不自动改变。400 错误按[腾讯云已公布的业务错误码](https://intl.cloud.tencent.com/zh/document/product/1300/82348)提供具体说明，如 400004 为模型或服务 ID 不存在，400006 为输出格式不受支持。保留已知参数名和 UUID 请求编号，不保存或输出可能含凭据与项目内容的原始响应。未知或不完整错误体维持 HTTP 400，不擅自推断原因，也不修改 JSON 合同重试生成。

用户此前选择自行配置并进行真实验证，本轮沿用这一边界：只检查本机状态、修改兼容代码并执行模拟回归，未发送真实 Token Hub 请求。新增 5 项回归覆盖明确模型 ID、模型/格式错误区分、参数脱敏、超大或损坏响应、阻塞错误流取消；17 项文字相关定向测试通过。实际生成仍需用户更新准确模型 ID 后复测。

本轮全量 221 项：215 通过、2 项相同的既有 Windows 权限失败、4 项默认跳过；lint、typecheck、build 通过。实际浏览器验证冷启动和 Token Hub 预设填入 `deepseek-v4-flash-0731`，正式配置仍保持用户原值，未点击保存或生成。日志位于 `work/dev-service/tokenhub-400-tests.log` 与 `tokenhub-400-build.log`。
