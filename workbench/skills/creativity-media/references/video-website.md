# 视频与网站

## 视频

用户脚本可直接在当前对话拆成分镜，通过 project_update 保存 `video`：

```json
{
  "ratio": "16:9",
  "burnSubtitles": true,
  "keepAudio": false,
  "shots": [{
    "id": "shot-01", "title": "骑楼下",
    "visual": "雨后骑楼下行人经过，保留真实运动",
    "camera": "缓慢推进", "duration": 5,
    "narration": "雨停了，街巷重新热闹起来。",
    "subtitle": "雨停了，街巷重新热闹起来。", "revision": ""
  }]
}
```

最多 12 个镜头，每镜头 2–10 秒整数；画幅还支持 `9:16`。参考首帧用项目真实 assetId 填入 referenceAssetId。只修改一个镜头时保留其他镜头、已生成 clip/audio；数组为整体替换。删除配乐用 `music:null`。

每个镜头依次 `task_start(kind:"video-shot",args:{objectId,provider:"workbuddy"})`，处理 MP4 交接后查询并采用。旁白使用 `kind:"video-audio"` 与相同 objectId；若当前 WorkBuddy 没有实际视频／语音生成能力，可导入已有文件。空旁白不必创建配音任务。

所有镜头与所需配音齐备后，提交 `kind:"video-compose",args:{}`，Runtime 用 FFmpeg 生成 MP4 与 SRT。片段过短、配音太长或镜头／旁白已改变会拒绝合成，应修正对应输入。不要删掉用户要求的旁白或用静帧占位来让合成通过。

最后查询、采用、`project_deliver(format:"all")`，交付 role 为 video 和 subtitles 的实际文件。旧片段是否可用取决于当前镜头描述与来源版本，不能手工伪造 source。

## 静态网站

网站结构由 WorkBuddy 直接编写，保存到 `website.spec`，再 `task_start(kind:"website-build",args:{})` 本地构建，不需要 DeepSeek API。格式：

```json
{
  "title": "岭南手艺", "description": "街巷手艺展示",
  "accent": "#35765d", "theme": "paper",
  "pages": [{
    "id": "home", "title": "首页", "intro": "记录生活里的手艺",
    "sections": [{
      "kind": "gallery", "title": "作品", "body": "按分类浏览",
      "items": [{"title": "葵扇", "text": "创作说明与文化依据", "tag": "日常器物"}]
    }]
  }],
  "limitations": []
}
```

主题 paper/night；1–5 页，每页 1–12 个区，每区最多 20 项。kind 支持 text（正文与卡片）、gallery（搜索／分类）、faq（展开问答）。已有图片可给 item 添加 assetId，必须属于当前项目。没有图片就保持文字内容，不编造文件标识。

不支持登录、支付、提交表单、数据库或服务端业务；需求中出现这些时，把具体缺口写入 limitations 并说明，不创建假按钮。此工具不接受任意 HTML/JS 代码；构建器按结构生成静态页面。

修改时读取完整 spec，保留未改页面和条目；保存后重新构建、查询并采用。`project_deliver` 返回 website-preview（HTML）和 website-zip（源码 ZIP）。展示本地预览与 ZIP，不能把打包说成发布。
