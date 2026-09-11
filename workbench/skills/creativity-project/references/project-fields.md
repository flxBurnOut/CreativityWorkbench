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
| craftGoal | 一句话三维需求草稿；运行中可继续编辑下一轮，最多 4000 字 |
| craftRequest / craftAsset | Runtime 管理的原任务指针及真实 Blender/GLB 成品；使用 craft_generate 和 craft_complete_plan，不手写文件记录 |
| art | fullPrompt 为唯一生效提示词；其余四个旧分项仅兼容读取 |
| requests | 五项字符串数组，分别对应 0–4 阶段修改要求 |
| novel | title、text；taskId 可省略，由工具标注为对话创作 |
| concepts | 对象数组，每项 id、category（character/map/object）、name、description、prompt、revisionRequest；可选 candidateAssetId、savedAssetId |
| references | 参考图数组，每项 id、assetId、purpose；生图时最多使用 4 张 |
| delivery | notes、textFormat（md/txt）、ratio、duration，均为字符串 |
| video.shots[] | 单镜头：id、title、visual、camera、duration、narration、subtitle、revision；可选首帧 referenceAssetId、最终 prompt 与 promptBasis |
| websiteRequest | prompt、basis、assetIds；basis 由 prompt_prepare 返回，assetIds 是明确允许用于网站的素材 |

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

美术模块只编写提示词，不生成图片。使用 project_update.patch.art={fullPrompt:"完整提示词"} 替换当前稿，Runtime 同时清空旧分项；旧项目的四分项与综合描述会完整合并显示，旧客户端分项写入也会合并为同一段文字，不暗设优先级。异步 art 任务可在 args.instruction 中固定本轮要求，候选采用后才替换。参考图片在准备图片阶段添加并随后续出图发送；本次文字服务未附图。视频最终编辑稿保存到对应镜头 prompt，并附本次 prompt_prepare 的 basis 作为 promptBasis；项目背景改变后需重新核对。网站交接前保存 websiteRequest；task_start(kind:"website") 只准备提示词和素材包。website.spec 与 website-build 保留用于旧模板项目，不作为新网站的生成契约。


连续创作新增接口与字段见 [continuous-workflow.md](continuous-workflow.md)：实际首帧、已确认对象引用、类型分支和恢复，以及 website_source_import → workflow_update adopt-website-source → 下一轮源码任务包。
