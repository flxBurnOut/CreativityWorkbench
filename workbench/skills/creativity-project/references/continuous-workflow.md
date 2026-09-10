# 连续采用与下一步

继续遵守 creative-rules.md 的系统／文化约束。先 project_get，再 workflow_get({projectId,kind,args}) 核对当前输入、版本与相关变化。基于当前采用成果继续完善，按用户要求局部修改；明确另作候选时使用 action:"alternative"。旧稿和未选中成果必须保留。

对象保存 sourceKeys（当前类型小节 key）、usage（图片用途）、referenceAssetIds（真实图像 ID）；objects 更新建议保持已有 id。task_adopt 可传 objectIds 只采用指定对象，也可传 sectionKeys 只采用指定文字小节；一次采用应包含此次全部选择，重复同一采用保持原参数。

小说用 novelReferenceIds 选择确认对象文字。默认是已保存概念图对应对象；不声称文字接口分析了图片。正文采用后可 task_start({kind:"content",args:{action:"generate",fromNovel:true}}) 整理 characters/world 建议，逐项采用，不静默反向改写设定。

类型切换用 project_update.patch.type，保存各类型独立草稿。显式沿用资料用 workflow_update({action:"inherit",from,brief,content,art,conceptIds,mediaIds,...版本字段})。原内容成为 transfers 数组中的资料快照（兼容读取旧 transfer），不替换当前类型小节；对象有新的当前类型 ID，不混用旧任务。恢复用 workflow_update({action:"restore",recordId,...版本字段})；恢复保留原依赖与其他版本。不要用 project_update 写 flow 或 variants。

视频镜头可保存 conceptIds、contentKeys 和明确 referenceAssetId。frameReferenceIds 选择多张已保存概念图，frameInstruction 描述组合构图。task_start(kind:"video-frame",args:{action:"generate",objectId,provider:"workbuddy",ratio:"3:2"}) 创建实际图像交接；使用当前工具读取真实输入图片，生成 PNG，查询并 task_adopt 后产生 frameCandidate。选定后将该 ID 写入 referenceAssetId；再 prompt_prepare(video-shot)、保存 prompt/promptBasis，提交视频。原图修改 action:"edit"；总实际图片最多五张。首帧候选不是 MP4。

网站先获取网站任务包，读取 PROMPT.md、materials.json、图片与 existing-website.zip（如果有）。在当前执行端读取和修改真实源码，完整实施用户要求，并运行适当检查；不回到旧固定模板。将源码和运行说明打成 ZIP，放入 project_get 返回的 inbox，调用 website_source_import({filename,description,instructions,verification,taskId?,...版本字段})。仅导入为候选，不执行包内代码。核对后 workflow_update({action:"adopt-website-source",...版本字段})。下一次 website 任务自动附带该版本真实 ZIP，保留旧源码。project_deliver 返回源码文件；静态预览与 ZIP 结构通过不等于业务、服务端或部署已验证。

craft / undecided 用 task_start(kind:"design-package") → task_get → task_adopt → project_deliver 交付当前创意、形体、美术、来源和实际图片资料。文创最终方向仍为 3D；此包没有模型生成，不称为已完成 3D 成品。

网站交接会直接附上已沿用的完整小说正文、选定的已采用音视频、字幕与来源，不要求先执行网站内容生成。不同来源类型可以并存；同一来源再次沿用时更新该类型快照。来源后续修改只提示核对，不静默更新或丢弃旧快照。
