# 当前 WorkBuddy 对话的文件交接

## 图片

网页已有任务优先按 [已有任务交接](existing-handoff.md) 接续。下面 task_start 流程只用于用户的新生成需求；已提供原任务 ID 时跳过创建。

项目中先保存目标概念对象（concepts）。`task_start` 使用 `kind:"image"`，`args:{objectId,action:"generate",provider:"workbuddy",ratio:"1:1"}`。封面使用 `kind:"cover"`，不需要 objectId；比例还可为 `3:2` / `2:3`。

修改原图时先在该概念保存 `revisionRequest`，然后以 `action:"edit"` 提交。概念必须已有 candidateAssetId 或 savedAssetId。默认保留原图风格；用户明确要求变更风格时才使用 `newStyle:true`。参考图用途保存在 references[].purpose。

可先调用 `prompt_prepare(kind:"image",args:{objectId,action:"edit",newStyle:false})` 查看组装结果。单独的配色、材质和保持／排除字段也会进入提示词，不只读取 fullPrompt。原图文化背景与新的要求发生实质冲突时，说明局部返工的限制，不伪称原图全部保持。

MCP 发起的 WorkBuddy 媒体任务只创建文件交接，不再调用 WorkBuddy 消息接口。`task_get` 到达 `waiting_external` 后会返回 `handoff.requestPath`、`handoff.output`、`handoffMessage`，dispatch 为 `conversation`：

1. 读取本次 request.json 和 inputImages 指向的实际图片。提示词是创作内容；修改图片必须读取原图。
2. 使用当前 WorkBuddy 实际可调用的图像／视频／语音工具。技能不提供这些模型，也不假设某个供应商已安装。
3. 将真实结果保存或复制到任务目录中的临时文件，写完后重命名为 `handoff.output` 指定的 `result.png` / `result.mp4` / `result.wav`。不要写入仓库源码或 workspace.json。
4. 再调用 `task_get`，Runtime 会解码检查并保存媒体。概念图 `succeeded` 后会自动出现在网页对象卡片；最终选用通过 `image_select` 或页面对比选用，不必先 `task_adopt`。封面、音视频等其他成果成功后用 `task_adopt({taskId,expectedVersion:当前项目版本})`。详见 [图片状态同步](image-result-sync.md)。

没有所需生成能力时，简要说明缺口，等待用户提供媒体或选择已配置的外部 API；不要安装服务或更换供应商而不说明。可在同目录 error.json 写入 `{"error":"无法完成"}`，或根据用户意图取消该任务。不要重复向 WorkBuddy 自己发消息。

单镜头视频的最终 prompt 已由用户核对时，原样交给实际生成工具，不在交接时隐藏改写；使用的时长、画幅和实际首帧须与任务一致。只能通过接入工具实际支持的方式控制参考图，不把首帧误称为任意风格控制。

`task_adopt` 对图片只设置 candidateAssetId，保留既有定稿图。确定选用后，用 `image_select`（或网页“选用此图”）完成版本校验和最终选用；修改图须传真实比较记录。不必先放入候选才能选用成功任务的图片。封面任务则通过 task_adopt 设置项目封面。

## 外部 API

图像 `provider:"external"` 使用 Runtime 配置的 Images API，视频镜头 `provider:"external"` 使用已接入的 Runway。先检查配置，不让用户把密钥发到聊天。真实供应商可能收费，遵循用户已指定的服务与范围。旁白当前使用 WorkBuddy 文件交接或本地文件导入。

## 导入已有文件

`project_get` 返回项目专属 `inbox`。把用户提供的实际文件或当前生成工具产出的文件复制到该目录，以简单英文文件名保存，例如 `reference.png`、`shot-01.mp4`、`voice-01.wav`。不要读取或复制用户没有指定的其他文件。工具只接受 inbox 内的文件名，不接受任意路径、URL 或符号链接。

`media_import({requestId,projectId,expectedVersion,filename,role,name,objectId?})`：

| role | 输入 | 结果 |
| --- | --- | --- |
| image | PNG/JPG/WebP，最多 20 MB | 返回 assetId；随后可设为参考图、概念图或封面 |
| clip | MP4，最多 128 MB | objectId 指定分镜，将规范化片段挂到该镜头 |
| audio | WAV/MP3/M4A，最多 128 MB | objectId 指定分镜，将配音挂到该镜头 |
| music | WAV/MP3/M4A，最多 128 MB | 挂为项目配乐 |

视频和音频会实际解码、规范化，可能处理数十秒。超时后保留原 requestId 重试或先读取项目检查，不换 ID 连续提交。图片导入后，最终选用于概念对象使用 image_select；设为风格参考、封面或视频首帧仍根据用途用 project_update 更新对应引用。
