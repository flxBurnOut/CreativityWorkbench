# 验收与传参规则

## 数组传参

优先调用正常工具并传原生数组。MCP 输入兼容一层 JSON 数组字符串（如 entryIds 为 `["lingnan-arcade"]` 的 JSON 编码；实际 ID 从搜索结果读取），解码后仍按原类型校验，不接收逗号拼接文本或单个对象。

若 WorkBuddy 在工具到达 Runtime 前仍报数组类型错误，使用 `workbench_call_json({tool:"knowledge_apply",argumentsJson:JSON.stringify(原完整参数对象)})`。这是 MCP 内的兼容入口，只允许已注册核心工具；JSON 内的数组必须是原生数组，保留原 requestId、expectedVersion 及所有业务参数。不要转为临时 HTTP 脚本、绕过版本检查或改写 workspace.json。写入返回不确定时，先读项目；同一业务操作保留原 ID，避免重复创建。记录标准调用还是 JSON 兼容调用成功；本地 stdio 测试不等于 WorkBuddy 实际加载测试。

## 小说

`content.novel.story` 是梗概，完整正文写入 `novel:{title,text}`。text 从正文开始，标题单独放 title。已有正文开头同名标题在导出时去重，不改动原稿或文中标题。写回后读取项目并导出真实 TXT/Markdown，检查文件内容、标题只出现一次（正文引用除外）和结尾。

## 图片返工

修改要求写清位置、变化和可见程度，保留原图。采用生成任务只放入候选，不代表视觉验收通过。对照 parentAssetId 原图与候选，先看整体，再看相同局部，核对修改是否清晰且应保留的主体、构图、风格是否正确。文件哈希不同不能证明修改有效。

需要用户判断时展示对比。确认选用后，读取完整 concepts 数组，仅更新目标 savedAssetId，并可写 imageReview：assetId、parentAssetId、changesVisible、preserved、notes、checkedAt（毫秒时间戳）。记录真实观察，不伪造用户确认或效果。页面提供同步放大和确认记录；不满意时保留候选和原定稿，不为完成验收自动追加付费生成。

## 视频

生成前读取 `prompt_prepare(kind:"video-shot")` 的 frameCheck。首帧与项目画幅不一致时，页面可选补边或居中裁切；MCP 使用 `video_frame_fit({requestId,projectId,expectedVersion,objectId,fit:"pad"或"crop"})`。操作创建真实 PNG，保留原图并更新镜头引用。补边保留全画面，裁切可能移除边缘主体；按用户要求选用，有关键主体不明确时再确认。适配后检查实际图片，重新准备并核对最终提示词，保存新 promptBasis。

交给实际视频工具的提示词与参数要如实记录。如果供应商工具要求调整提示词格式，说明实际使用稿与原稿的区别；不能声称被拒绝的原稿已原样使用。

任务 succeeded 仅表示收到可解码文件；读取 result.videoClip.validation / project_deliver.files[].specification，核对实际宽高、显示比例和时长。failed 文件保留供下载，不能作为合格镜头采用。stale:false 只表示依据未变化，不证明规格通过。历史记录缺规格时为 unverified，重新导入实际 MP4。检查真实播放、运动和构图；补边不是视频模型保证。音频、水印和供应商限制如实说明，不未经授权自动重新付费。

## 网站

新网站任务成功的是提示词／素材包，没有 sections 时调用 task_adopt 不传 sectionKeys。只有实际返回 sections 的内容任务才逐节选用。完成真实源码后，导入 ZIP 为候选，再采用源码。不要把任务包当网站成品。

报告交互通过前启动交付源码并在真实浏览器操作。FAQ 检查每个问题的展开→收起→再次展开、快速连续点击、多项独立展开、Enter/Space 和手机宽度；确认答案实际可见且未被裁切，而非只看 aria-expanded。导航需点击并核对落点。模拟 DOM、脚本语法、ZIP 检查、HTTP 200 都不是浏览器交互验证。

`website_source_import` 可附 verificationMethod（not-tested/static/browser/user-browser）、verificationResult（not-tested/passed/failed）、verificationEvidence（浏览器、运行入口、操作序列、可见结果和截图/记录路径）。原 verification 只作文字说明。缺少浏览器证据一律标未验证；有证据也是执行端报告，不代表 Runtime 独立复测。用户复测失败时如实记录 failed，修复后针对实际 ZIP 复测。没有可用浏览器时交付文件并明确未验证，不能把静态检查包装成通过。
