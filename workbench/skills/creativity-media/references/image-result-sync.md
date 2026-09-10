# 图片结果、候选与选用状态

适用版本：核心协议 9、27 个工具、Skills 0.6.1。

网页创建的图片任务，继续使用原 taskId 和 handoff.output。生成完成后写回原路径，或用 task_complete_handoff 将明确对应的 PNG 交回原任务；不能另建任务或仅 media_import 来结束原交接。

## 成功后怎么做

task_get / task_list 返回 imageState。以当前项目中的绑定状态判断，不将 dismissed 或 succeeded 当成“已选用”：

- unbound：成功文件尚未绑定对象。网页会自动显示“新结果待选用”，用户可直接对比并选用，无需先让 WorkBuddy 调用 task_adopt。
- candidate：已放入对象候选。原定稿仍保留，网页可继续选用或基于候选改图。
- selected：当前对象已选用该结果。不要重复 task_adopt，也不要重新生成。
- stale:true：实际生成依据已变化。保留结果供查看，不覆盖新稿。仅对象字段顺序变化或该图片自身的候选、提示词、选用写入不会使它过期。

图像 task_adopt 仅放入候选。最终选用使用网页“选用此图”，或在已有用户意图支持选用时调用 image_select：

1. project_get 取得项目最新 projectVersion。
2. image_select 传 projectId、expectedVersion、新 requestId、objectId，以及 taskId。也可用本项目已保存图片的 assetId；taskId 与 assetId 只能传一个。
3. 对修改图必须先查看实际原图和结果，传 review：assetId、parentAssetId、changesVisible、preserved、非空 notes、checkedAt（毫秒时间戳）。记录真实观察，不能自动勾选或虚构通过。
4. 再查 task_get 和 project_get：imageState.binding 应为 selected，concepts 中的 savedAssetId 应指向该文件。原图与历史记录仍保留。

写入超时先重查项目与原任务；重试同一次选用应保留 requestId 和参数。选用动作不调用媒体供应商，不产生新的生图请求。网页“刷新任务与图片”只同步状态，不重新生成。

## 重试与旧等待

同一明确失败、取消或已核实的任务需要重新生成时，新请求携带 retryOf 指向原任务。Runtime 将旧请求标记 supersededBy，默认页面收进历史；executionStatus 保留实际执行状态，不假称远端已取消。

旧版本有明确 retryOf 的历史记录会在启动时修复关联。没有关系的旧等待不能仅凭对象或图片相似度推断。先核对两个任务确属同一次重试，再由页面“这个等待已有后续结果？”确认，或 task_dismiss({taskId:旧ID,replacementTaskId:成功后续ID})；接口拒绝跨项目、类型或对象关联。不要批量收起所有等待任务。

旧任务晚到的文件仍可按原 ID 查询找回；不会替换新任务或当前选用图。未关联的历史等待不会被自动删除。

## 真实加载验收

在 WorkBuddy 中继续原网页改图任务，仅完成交接，不额外 task_adopt。页面应自动展示新图，能够对比、记录、选用，切换步骤后保持一致。再测一次 WorkBuddy 先放入候选的路径，以及失败重试后的历史显示。此说明和本地测试不等于 WorkBuddy 实际加载已通过。
