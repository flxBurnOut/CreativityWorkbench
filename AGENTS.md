# 项目约定

- 2026-09-10 平面图案：协议 13、31 工具、Skills 0.10.0。网页默认 craft_generate textureMode=image + textureOf，复用 WorkBuddy/外部图片服务生成平面 PNG，本机脚本仅贴到内置器皿外壁；无 HY/COS 依赖，内壁、附件、网格及历史保留。原任务通过 task_complete_handoff 回传 PNG，再本机贴图到 result.craftAsset 才成功，不调用 craft_complete_plan。生图先保存图片再建模，未知请求不重发，取消不采用晚到结果，单进程与内存/文件预算保持。图片引用参与备份，清理只删除验证过的本任务副本。旧无 textureMode 的纹理调用仍走 HY 兼容路径，不自动切换供应商。详见 docs/CRAFT_PATTERN_2026-09-10.md。

- 2026-09-10 文化纹理：协议 12、31 工具、Skills 0.9.0。craft_generate 可用 textureOf 指定本项目已有模型；沿用原 goal，可选 texturePrompt。先本机整理 UV，再私有 COS 中转，hy-3d-texture 只生成 1024 颜色图，贴回原 Blender 网格并校验几何哈希。保持器形、原版本与文件引用；不把返回的模型或缩略图直接替换为成果。未知提交不自动重发，取消后不采用晚到结果。只有同 Token Hub 地址才可复用文字密钥，COS 凭据单独配置；本机回归不等于真实 COS/Token Hub 成功。详见 docs/CRAFT_TEXTURE_2026-09-10.md。

- 2026-09-10 文字服务：TEXT_API_BASE_URL、TEXT_API_MODEL 决定实际接口与模型；保留 DEEPSEEK_API_KEY 作为兼容的服务端密钥字段，支持 Token Hub 按量入口。旧配置继续使用 DeepSeek 官方默认值，不自动猜测密钥发行方或失败后切换供应商。创意与共享文字/3D 解析必须走同一配置；设置仅显示凭据存在，不声称鉴权成功。Token Hub 的模型目录不等于已实现其图片、视频或云端 3D 接口，详见 docs/TEXT_SERVICES_2026-09-10.md。

- 2026-09-10 独立三维资产：当前协议 11、31 工具、Skills 0.8.0。craft_generate 统一创建 craftRequest 与 craft-model 原任务；WorkBuddy 用 craft_complete_plan 回传受限 JSON，不执行任意脚本。成功自动存入 craftAsset 历史，仅匹配当前指针与固定依据才显示为当前；craftGoal 为可独立编辑的下一轮草稿。网页仅查看/下载真实 .blend/.glb，不提供直接编辑、参考图建模、圈足/杯等未实现构造或任意雕塑，不宣称自动嵌入文旅网站。Blender 单进程、1 GiB、180 秒、4 万三角形/240对象、每文件32 MiB；临时目录位于项目数据目录，等待进程停止后 finally 清理，保留成品与小型元数据。真实结构/重开验证与 DeepSeek/网页/WorkBuddy 证据分别记录，详见 docs/CRAFT_ASSETS_2026-09-10.md；以下版本段落均为当时记录。

- 2026-09-10 资源生命周期：项目进程启动前预加载 lib/workbench/temp-env.mjs，将 TEMP/TMP/TMPDIR 限定到当前检出的 work/tmp/process，不改用户环境。测试使用 tests/helpers/test-directory.mjs；等待任务、HTTP 请求和自建子进程停止后才删自己的夹具，停止失败保留并报错。内存验证默认清理大型夹具。storage_cleanup 只删有正式副本与哈希证明的单个源文件，保留请求、输入、作品和历史。资源采样不等于 WorkBuddy 长时验收；实测及剩余风险见 docs/RESOURCE_AUDIT_2026-09-10.md。

- 2026-09-10 前端缓存隔离：Vite cacheDir 必须落在当前检出目录的 .cache/node_modules/.vite/<command>/<mode>。测试副本可共享安装依赖，但不能共用 node_modules/.vite 预打包缓存；serve/build 分离，保留 node_modules 路径段以兼容 Vinext 的 CommonJS 过滤。缓存路径也必须参与 workbench-dependency-cache 插件名：Vite 不哈希 cacheDir，迁移后不换版本会让浏览器混用新旧 React。修复或测试后须确认用户实际页面及冷启动仍能加载，不能只验证测试副本。不要用关闭错误遮罩掩盖加载失败。

- 2026-09-10 使用流程重整：当前协议 10、29 工具、Skills 0.7.0。网站默认目标→连续制作→初稿预览，websiteBrief 为统一目标，website_run 自动准备资料，website_complete 或原 result.zip 回传实际源码；等待源码时保持 waiting_external，禁止把资料包成功等同网站完成。初稿自动保存，用户一次“使用这个版本”才替换当前稿，限定范围修改带真实旧源码。小说/视频默认直接看结果，详细五阶段按需打开；3D 从主入口移至更多能力。保留版本、来源、幂等与范围检查，不自动重复生成或发布。详见 docs/RESULT_STUDIO_2026-09-10.md。

- 2026-09-10 图片选用同步修复：当前协议 9、27 工具、Skills 0.6.1。成功概念图从任务直接显示到对应对象，image_select 在共享 Runtime 中按版本和幂等写入最终选用；改图须保留真实对比记录，不自动替换原图。task_adopt 对图片仍仅放入候选。来源比较消除字段顺序及结果自身写入的假过期，保留实际输入变化检查。明确 retryOf 修复 supersededBy；未知关系只由页面或 task_dismiss 显式确认，不猜测、不取消远端作业。轮询可取消且单请求去重。详见 docs/IMAGE_RESULT_SYNC_2026-09-10.md。以下日期版本均为当时状态。

- 2026-09-10 文创文旅完善：当前协议 8、26 工具、Skills 0.6.0。新增 theme_asset_list/apply，6 组原创 SVG/PNG 资产与 11 条知识；新知识版本保留旧快照。transfers 可并存完整小说和明确选择的已采用媒体，网站任务直接附真实原文、素材和来源。网站任务仍由当前 agent 实现，examples/lingnan-visit 是独立具体 Demo。任务缓存有容量限制，媒体下载与 ZIP 打包采用流式处理，静态预览只解码选定文件；不得把本地内存采样当作真实 WorkBuddy 长时验收。详见 docs/TOURISM_WORKFLOW_2026-09-10.md。

- 2026-09-10 原任务交接修复：当前协议 7、24 工具、Skills 0.5.1。网页图片任务必须沿用原 ID 和输出路径；task_complete_handoff 仅将明确选定的同项目 PNG 写回原交接，由正常导入器校验成功，不创建任务或直接采用。同 ID 同文件可重试，不覆盖不同结果。Skills 已有任务路由优先于新建流程。历史段落的版本为当时状态。

- 2026-09-09 实际验收修复：当前核心协议 6、23 工具、Skills 0.5.0。新增 video_frame_fit 和受限 workbench_call_json。视频规格与文件可解码、依据新鲜度分开；网站外部验收报告不等于 Runtime 独立验证。MCP 原生数组与 JSON 数组字符串在传输层兼容，Runtime 保持严格类型、版本和幂等检查。历史段落中的工具数/协议是当时状态。见 docs/WORKBUDDY_ACCEPTANCE_FIXES_2026-09-09.md。

- 2026-09-09：用户要求文化库独立于游戏，不导入《织梦者》原项目作为默认知识。首批知识源在 workbench/knowledge/lingnan-2026-09-09.mjs；事实有出处，创作转译与事实分开，跨区域不得混为同一民俗。已发布知识版本保持可解析；后续修订新增版本并保留旧版注册。knowledge_search / knowledge_apply 共用 Runtime；资料引用参与生成依据、过期检测与交付。真实服务和 WorkBuddy 实际加载另行验收。

- 2026-09-08 连续创作已实现：五类型成果与历史记录、对象来源及实际参考、小说设定往返、视频可选首帧候选、网站源码候选与下一轮真实源码交接、3D 前期资料包。类型草稿分支隔离，按选择继承。新增 workflow_get、workflow_update、website_source_import，总计 21 工具／协议 5，Skills 0.4.0。保持 prompts.mjs 中的系统与文化规则。详见 docs/CONTINUOUS_WORKFLOW.md；3D 模型与长篇仍未实现。

- 2026-09-08 最新提示词方向：统一文化、阶段与作品类型约束；概念图明确原图、风格参考、选定对象及成品素材用途。视频主入口只针对一个连续镜头，可直接编辑最终提示词，无需分镜前置；旧分镜、旁白与合成保留。网站新任务由 harness 准备提示词与素材交接，模型／外部 agent 完整实现内容、设计、代码与功能，不再使用工作台固定模板生成新网站；旧网站与构建器仅作兼容。规则源为 lib/workbench/prompts.mjs，MCP 新增 prompt_prepare 共 21 工具，核心协议 5。详见 docs/PROMPT_HARNESS.md。

- 2026-09-08 最新方向：按原顺序完成保存与任务、文字、图像；然后视频、网站，最后才实施 3D 文创资产。文创成品确定为 3D，不改做平面文创。旧 3D 提案仅作历史参考，不主动恢复。

- 当前已实现 P1 前端骨架与五阶段界面，采用 README 13.8–13.9 中确定的 B＋C 融合岭南主题。继续保留简洁流程，不擅自扩展品牌、工具市场或业务类型。
- 保留 Web → 共享 Runtime → 适配器的分层。能力清单为 workbench/manifest.json，登记已实现接口并单独标明真实服务验证状态。文字使用服务端 DeepSeek V4 Flash；图像优先 WorkBuddy 官方本地助理消息接口与受控文件交接，同时保留外部 Images API。密钥仅通过服务端环境配置。
- 项目、任务、PNG 与音视频／网站文件保存在 work/data 或指定目录，旧 IndexedDB 仅用于迁移／导入且保留原副本。演示项目不混入真实项目。文字、短篇 TXT/Markdown、图像生成／带原图编辑已接线；真实账户与出图质量尚未验证。单镜头视频、WorkBuddy MP4/WAV 交接、Runway Gen-4.5、FFmpeg 合成与网站提示词／素材交接已实现；旧模板网站保留预览／打包兼容，真实服务未验。长篇和 3D 交付仍未实现。CLI 提供发现/诊断与本机接入包生成；MCP 已封装 21 项核心工具、2 项 WorkBuddy Skills，复用同一 HTTP Runtime，项目写入和采用需版本检查与幂等回执。MCP 的 WorkBuddy 媒体任务使用当前对话文件交接，不再给自己派发消息。Skill ZIP 和连接配置位于 work/workbuddy-core，由用户手动加载测试；不将本地协议测试称为 WorkBuddy 实际装载通过。配置、模拟验证和真实结果分别记录。
- 新功能先明确需求，再实现对应模块；不把参考项目业务批量带回。
- 验证使用 npm test、npm run lint、npm run typecheck、npm run build。
