# 一句话三维资产生成

协议 13，Skills 0.10.0。独立流程为完整需求 → 受控建模方案 → 本机 Blender → 网页查看与下载真实 `.blend`。只查看模型，不操作顶点、拓扑或材质编辑器。旧 `design-package` 仍只交付设计资料，不能当作模型。

## 平面图案生成与本机贴合（网页默认）

已有器皿需要丰富表面时，调用 craft_generate，textureOf 指向本项目原版本，textureMode=image，goal 沿用该资产 prompt，dispatch=conversation 在当前 WorkBuddy 对话完成生图。可选 texturePrompt 为 200 字以内补充要求；不要求用户重新描述作品。此路径复用现有图片服务，不调用 HY，不需 COS。

接到 args.textureMode=image 的原任务，读取 handoffInstructions，使用实际生图能力生成一张平面 PNG；不要画器物照片、透视图、UV 网格或烘焙光影。保持给定底色，纹样远离边缘。使用 task_complete_handoff({taskId,filename}) 或同项目 assetId 回传原任务，filename 是 inbox 中的文件名；也可原子写入 handoff.output。不能调用 craft_complete_plan、另建任务或把单独入库当作完成。查询到 succeeded 且 result.craftAsset 有真实 Blender/GLB 后，才报告完成，网页自动显示新版。

当前只支持内置碗、盘、盆、瓶、罐、锅、瓢、茶壶的外壁贴图，内壁与附件材质保留。不能承诺建筑分区或照片自动建模。失败保留原模型与收到的图案；取消后不采用晚到结果。单张 1024 图案、单个受限 Blender 进程，中间文件处理后清理，正式成果与历史保留。

## 优先接续原任务

收到网页三维任务 ID 或交接说明时，先 `task_get`。`kind=craft-model` 且没有 `args.textureSource` 时读取 `handoffInstructions`，在当前 WorkBuddy 对话中将需求解释为受限 JSON 方案，并调用 `craft_complete_plan({taskId,planJson})`。`planJson` 是方案对象的 JSON 字符串，不能包含外层 `plan`、代码、Python、文件路径或下载链接。保持原任务 ID，不用 `task_start`、`media_import` 或另一个项目代替。

原任务已经 queued/running 时只查询；相同方案重放安全，不同方案会拒绝。取消任务不会因交接而重新启动。`succeeded` 后模型自动同步到原项目页面，再用 `project_deliver` 返回真实 `.blend` 和 `.glb` 文件；不需要额外 `task_adopt`。新目标与旧结果分别保存，旧历史保留。

## 对话中直接开始

先 `workbench_status` 核对 `providers.craft.available`，再找到或新建 `type=craft` 项目。当前对话直接理解用户完整需求，按下列结构生成方案，再调用 `craft_generate({requestId,projectId,expectedVersion,goal,planJson})`。`expectedVersion` 来自最近 `project_get`；同一次请求重放原 requestId。不要让用户填写技术标识。

没有 planJson 时，有已配置 DeepSeek 的网页可直接解析；没有文字解析服务则进入一次 WorkBuddy 交接。没有本机 Blender 时明确说明引擎缺失，不展示假模型或把脚本下载叫作 Blender 资产。

## 受限方案

- `kind` 必填：`bowl` 碗、`plate` 盘、`basin` 盆、`vase` 花瓶、`jar` 罐、`pot` 锅、`ladle` 瓢勺、`teapot` 茶壶、`arcade` 简化骑楼、`window` 花窗、`colonnade` 柱廊、`roof` 坡屋顶构件。
- `version:1`、`title`（1–80 字）可省略。每次一件资产，盖、把手、壶嘴属于同一件。
- `dimensions` 为厘米，字段 `width/height/depth/wallThickness`。省略时使用所选器形默认尺寸，不把默认值写成历史测绘事实。
- `material`：`color` 为 `#RRGGBB`，`roughness/metallic` 为 0–1。
- `decoration`：`style=plain/floral/lattice`；后两者是原创花叶或几何装饰，`color` 为 `#RRGGBB`。
- `details`：`handles` 0–2，`lid/spout` 布尔，`stories` 1–3，`bays` 1–5，`roof=flat/pitched`，`profile=round/tapered/flared`。

Runtime 还会检查尺寸与适用范围，拒绝未知字段和不成立的壁厚。只能表达支持的结构，不把“运行任意 Blender 脚本”作为扩展方法。不要编造支持精细人物雕塑、动物浮雕、整条街道、考据复原、制造或 3D 打印验证。核心需求不能表示时说明缺口，不拿相似形体冒充完成。

## 文化与资源

文化事实使用知识库的具体地域与版本；普通锅碗无需强贴非遗标签。广彩属于装饰工艺，不能凭任意金纹认定为传统广彩复原。产物标明原创数字设计、程序构造，不复制来源网页照片或具名作品。主题库独立于《织梦者》游戏项目。

Runtime 同时只运行一个建模进程，限制文件大小、内存与执行时间；验证真实文件后自动入库，清理自己本次临时目录。不要自行建立重复任务包或扫描删除用户历史；失败后明确重试用新 requestId 与 retryOf，保留原项目和成品。

## 旧混元文化纹理接口（仅明确选择 HY 时）

只有用户明确要求上传已有模型并进行付费纹理增强时，才调用此功能。先读取 project_get 和 workbench_status.providers.craft.texture；若没有 COS 配置，指引用户在网页设置完成一次性配置，不索取聊天中的密钥。

沿用原资产的 prompt 作为 goal，以其 taskId 作为 textureOf，textureMode=hy，使用新 requestId 调用 craft_generate；可选 texturePrompt（200 字以内），不能同时传 planJson。省略 textureMode 仅为兼容旧调用，仍走 HY。任务 args.textureSource 存在时，它是纹理任务，不要调用 craft_complete_plan。使用 task_get 查询原任务；未知提交须先在腾讯云核对，不能另造任务绕过。

Runtime 只生成 1024 颜色贴图，贴回原 Blender 网格并核对器形，新版与原版都保留。取消不等于云端停止计费；晚到结果不自动采用。成功后可 project_deliver，不能把配置通过或模拟测试称为真实云端生成通过。
