# 提示词与任务交接实施验收

日期：2026-09-08。实现说明见 [PROMPT_HARNESS.md](PROMPT_HARNESS.md)。

## 自动检查

| 检查 | 结果 |
| --- | --- |
| `npm test` | 63 项：61 通过，2 失败；均为改动前已复现的 Windows 环境问题，详见下方 |
| `npm run lint` | 通过 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过；vinext 仍提示首页静态路由分类为 Unknown，不影响本轮构建完成 |
| 新增提示词测试与输出、MCP 测试 | 针对性执行 21 项通过 |
| 最后补充的 stdio 网站闭环 | `node --experimental-strip-types --test --test-name-pattern='real stdio client' tests/mcp.test.mjs` 通过 |
| `npm run workbench:setup` | 两项 Skill ZIP、MCP 连接配置、接入说明与验收条目重新生成 |

全量测试的两个既有失败：

- `tests/issue-regressions.test.mjs:41`：创建目录符号链接时报 EPERM，当前 Windows 进程没有相应权限。
- `tests/service-settings.test.mjs:19`：Windows 返回文件权限位 0666，测试要求 POSIX 0600。没有修改或放宽这两个断言。

新增覆盖包括：不同类型文字规则、原文保留、独立美术字段与原图传递；单镜头最终稿原样提交、相关变化和实际图片哈希检查、无关标题与其他镜头变化不误拦截；提示词过期／超限不调用供应商；网站素材用途、任务包、备份、旧网站兼容；MCP 只读准备与当前对话交接；图片上传期间新编辑不被哈希回填覆盖。

stdio 补充用例通过真实 MCP 客户端完成：读取提示词、保存编辑稿、准备网站任务、采用、交付并读取 ZIP。确认 PROMPT.md 与编辑稿一致，包内有旧网站备份，未生成固定模板 index.html，调用次数检查确认没有向 WorkBuddy 自发消息。

## 隔离浏览器操作

使用独立数据目录 `work/harness-qa-20260908-r1/data`、Runtime 8792 和前端 3002；模拟供应商禁止真实外网调用。两个测试项目未写入真实项目目录。

- 空视频项目直接填写单镜头要求，无需分镜。编辑最终提示词后生成、采用；刷新后镜头、编辑稿和 MP4 恢复。浏览器媒体元数据显示已就绪、时长 5 秒。
- 模拟请求日志仅有一次视频提交，发送的 promptText 与保存的最终编辑稿逐字一致。测试夹具首次查询缺少任务 ID；修正夹具后原任务继续查询成功，没有重复提交。
- 网站默认仅选中已保存概念图，风格参考另行说明。编辑最终提示词，准备任务包并采用，刷新后记录与下载入口仍在。
- 读取实际 ZIP：包含 PROMPT.md、materials.json、README.md、asset-output.png、reference-style.png。提示词与编辑稿完全一致；用途分别为 output 与 style-reference；没有 index.html。
- 修改网站需求后，编辑稿和旧包保留，出现过期提示并禁用直接交接；核对保留后恢复操作，旧任务包继续显示为旧版本。

这些操作验证了浏览器流程、持久化与实际文件内容。截图接口未能返回图像，因此不将本轮记录作为完整视觉或移动端排版验收。

## 本机运行与未验证范围

原 Runtime 无进行中任务，数据目录指纹核对一致后重启为核心协议 3；前端 3001 恢复并返回 HTTP 200。独立 QA 进程在检查结束后关闭。

未验证真实 DeepSeek、WorkBuddy、Runway 账户调用及生成质量；未实际加载 WorkBuddy Skills；未让外部 agent 执行网站代码生成。生成 ZIP 与本地协议通过不等于上述实测通过。真实文化表达、背景稳定性、参考遵循和交付质量按 [创意工作台验收条目](创意工作台验收条目.md) 继续验收。
