# 项目字段与写回

`project_get` 返回 `project`、`projectVersion`、`revision` 与该项目 `inbox` 绝对路径。`project_update` 返回确认保存的 `projectVersion`，可用于下一次修改；发生并发冲突时重新读取。

| 字段 | 内容 |
| --- | --- |
| type | undecided / novel / video / website / craft |
| stage | 0 创意、1 内容、2 美术提示词、3 概念图、4 成品 |
| idea / brief / culture | 用户想法、创意方案、文化依据与待核实事项 |
| content.novel | story、characters、world、chapters、voice |
| content.video | script、shots、voiceover、spec |
| content.website | goal、pages、copy、behavior |
| content.undecided | overview、keep |
| content.craft | theme、motifs、copy、display；仅 3D 规划 |
| art | direction、material、palette、constraints、fullPrompt |
| requests | 五项字符串数组，分别对应 0–4 阶段修改要求 |
| novel | title、text；taskId 可省略，由工具标注为对话创作 |
| concepts | 对象数组，每项 id、category（character/map/object）、name、description、prompt、revisionRequest；可选 candidateAssetId、savedAssetId |
| references | 参考图数组，每项 id、assetId、purpose；生图时最多使用 4 张 |
| delivery | notes、textFormat（md/txt）、ratio、duration，均为字符串 |

创建小说项目：`project_create({requestId:新的UUID, idea:用户想法, type:"novel", title:作品名})`。后续先读取项目，再更新：

```json
{
  "requestId": "每个新操作使用新的UUID",
  "projectId": "读取到的项目ID",
  "expectedVersion": "读取到的projectVersion",
  "patch": {
    "brief": "已经完成的创意方案",
    "culture": "用户资料与待核实依据",
    "content": {"novel": {"story": "故事梗概", "voice": "叙事要求"}},
    "novel": {"title": "作品标题", "text": "完整短篇正文"}
  }
}
```

示例中的占位值必须替换为真实调用结果。不要将示例请求 ID 重复用于多次创作。此更新只合并指定内容小节，保留其他小节。

概念图候选需要确定为定稿时，读取现有 concepts 数组，仅把目标对象的 `savedAssetId` 设为该对象 `candidateAssetId`，保留其他对象再写回。封面可设置 `coverAssetId` 与 `manualCover:true`；取消封面指定 `coverAssetId:null`。

导出：`project_deliver({projectId,format:"txt"})` 或 `format:"md"`。工具返回实际文件 `path` 和 `url`。网页、视频和图片用 `format:"all"`。本轮没有执行生成／保存的内容不要声称已经完成。
