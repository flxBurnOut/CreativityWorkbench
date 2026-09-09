# 网页原图片任务接续修复

日期：2026-09-10。基于 `857ec60`。用户反馈：网页任务 A 等待自己的 `result.png`，WorkBuddy 另建任务／仅导入媒体库，原 A 永久等待；手动将 PNG 放回 A 的路径后恢复。本机不存在反馈中的两份任务 JSON，本轮没有修改用户的原任务；用隔离项目复现数据流并验证修复。

## 原因与结果

Runtime 原本只接收原任务指定文件，媒体库入库并不会自动完成交接。这一行为合理；缺口在于 Skills 的新建流程优先、交接消息没有清楚区分既有任务与新任务、任务列表缺少对象和交接关联信息，以及没有受控补交入口。刷新或切换步骤无法创造缺失的 `result.png`。

现在已有任务优先接续：

1. 网页交接消息、`request.json`、`task_get` 明确原 taskId、projectId、kind、objectId 和唯一 output；任务列表提供相同关联信息。读取旧任务时也返回新接续指令，无需重建旧任务。
2. 两项 Skills 的入口先判断是否收到已有 ID／request.json；此时先 task_get 原 ID，跳过 task_start／project_create 新建流程。任务已成功则使用既有结果；图片已生成则复用。
3. 新核心工具 `task_complete_handoff` 将已生成 PNG 写回原任务的 `result.png`；之后由正常导入器解码、写入来源记录和成功状态。它不生成、不创建任务、不直接采用，也不把入库当作完成。
4. 网页等待卡片新增“图片已生成，但这里仍在等待？”：可预览并选择本项目的对应图片补交。随后原卡片自动更新，完成后沿用“放入图片候选”。不自动猜测哪张图属于本任务。
5. 同对象重复提交的 `pending_task` 错误包含原任务 ID，引导回到 task_get，减少取消或另建对象绕行。

## 完成接口

```json
{"taskId":"原任务ID","filename":"generated.png"}
```

PNG 必须已完整放在原项目的 inbox（project_get 返回），filename 只接受简单 PNG 文件名。或者使用已导入本项目的明确图片：

```json
{"taskId":"原任务ID","assetId":"本项目对应图片ID"}
```

两项只能选一。只支持 image／cover／video-frame 的既有 WorkBuddy PNG 交接；视频、音频沿用原文件路径回传。完成接口不修改项目，不需新 requestId／expectedVersion，以原任务 ID 和实际内容幂等。重复同一图片可重试；已有不同结果拒绝覆盖。非 PNG、无法解码文件、超限文件、路径穿越、其他项目素材被拒绝，交接目录沿用真实路径约束。

文件先完整写入临时文件，再原子发布且不覆盖已存在结果。任务仍经正常导入器完成；接口返回时可能仍为等待，需要继续查询原 ID。采用结果时仍使用 task_adopt 原 ID、最新 expectedVersion，并执行过期检查。

完整回归还发现正常停止服务中断视频接收时被误报资源失败。已区分服务停止与真实资源失败，保留原任务供启动后继续接收；没有取消真实资源上限或失效后停止反复处理的保护。

## 验证

- HTTP 网页入口创建原任务，真实 stdio MCP 客户端接续；仅 media_import 入库后原任务仍等待，task_complete_handoff 后原任务 succeeded，来源 taskId 与原 ID 一致，任务总数为 1，没有生成服务调用。
- 项目草稿在完成交接后保持原版本；采用才写入候选。重复完成、重复采用不重复创建结果；不同已完成 PNG 不覆盖，跨项目素材和无效输入被拒绝；草稿改变后旧结果依然不能采用。
- 并发发布不同 PNG 时只有一个成功，另一个返回冲突。旧任务读取获得新接续信息。
- 实际 Chromium 网页：发起任务 `78679f12-52d4-4b59-a30e-6d26d0170299`，等待卡片选择固定测试 PNG 补交；同一任务自动变为生成完成并可放入候选。实际原目录生成 `result.png`，来源 taskId 相同，任务数 1，已入库原图保留。未选图片时按钮禁用。
- 完整测试 111 项：109 通过，2 失败。失败为既有 Windows 符号链接 EPERM 与 POSIX 0600 权限断言；未改为跳过或计为通过。lint、typecheck、build、diff 检查通过。
- 证据保存在 `work/handoff-verification-20260910/`：`tests-final.log`、`build.log`、`browser-evidence.json`、`browser-result.txt`、`before-return.png`、`completed.png`。

以上证明本地网页与 MCP 接口行为，不证明 WorkBuddy 模型已经正确执行新 Skills，亦不代表真实出图质量验证；本轮无付费图片生成。

## WorkBuddy 加载

当前 **Skills 0.5.1／核心协议 7／24 个工具**。`npm run workbench:setup` 生成 `work/workbuddy-core` 中两项 Skills ZIP、mcp.json、SETUP.md 与 TESTING.md。已校对版本、引用、工具清单及 ZIP 与源码一致；通用 Skill 校验依赖本机缺失的 Python yaml，另行检查不等于该脚本通过。

停止旧 Runtime 并重新启动，重新导入两项 Skills／连接配置；确认发现 task_complete_handoff。按[验收条目 M01–M05](创意工作台验收条目.md)实测：网页发起 A → WorkBuddy 接续 A → 已生成 PNG 交回 A → A 成功 → 采用 A。保留实际任务 ID、路径与 WorkBuddy 版本；不要用新建 B 来代替验收 A。
