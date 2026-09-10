// Original vector artwork, created for this workbench. Source links support the
// cultural interpretation, not ownership of a third party photograph or design.
export const themeAssetVersion='lingnan-visual-2026-09-10.1';
export const themeAssetRights='本项目原创矢量示意，允许用于工作台作品、比赛展示与衍生网站，并可修改；再分发时保留资产说明。未包含第三方图片，不代表原站媒体授权。';
const sources={
  qilou:{title:'百年骑楼筑老城肌理 廊下烟火延千载商脉',publisher:'广州市人民政府门户网站（转载广州日报）',url:'https://www.gz.gov.cn/zlgz/whgz/content/post_8564096.html'},
  window:{title:'岭南园林建筑装修的构件',publisher:'广州市林业和园林局',url:'https://lyylj.gz.gov.cn/kpyd/zhzy/content/post_9665427.html'},
  porcelain:{title:'广彩瓷烧制技艺',publisher:'中国非物质文化遗产网',url:'https://www.ihchina.cn/project_details/14453.html'},
  paper:{title:'剪纸（广东剪纸）',publisher:'中国非物质文化遗产网',url:'https://www.ihchina.cn/project_details/13931.html'},
};
export const themeAssets=[
  {id:'qilou-street',name:'廊下晴光 · 骑楼街景',region:'广府 · 广州',category:'建筑空间',knowledgeIds:['guangzhou-qilou'],sourceKeys:['qilou'],width:1600,height:900,usage:'文旅首页横幅、街区文化专题封面；左侧保留标题空间。',alt:'暖色骑楼沿街相连，底层廊道与商铺相接的原创街景插画',description:'以连续底层廊道、商住相连为依据，构图和立面为原创组合，不对应某一条实际街道。'},
  {id:'arcade-rain',name:'雨行廊间 · 步行空间',region:'广府 · 广州',category:'建筑空间',knowledgeIds:['guangzhou-qilou'],sourceKeys:['qilou'],width:1200,height:900,usage:'文化解说卡、散步主题配图、视频构图参考。',alt:'雨线落在街面，廊柱与遮蔽步道形成远近层次的原创插画',description:'表达骑楼廊道遮阳避雨的空间功能；人物、天气和街段为原创情境。'},
  {id:'manzhou-window',name:'窗映四色 · 彩玻窗格',region:'广府 · 岭南园林',category:'装饰构件',knowledgeIds:['lingnan-garden-window'],sourceKeys:['window'],width:1000,height:1000,usage:'知识卡、章节插画、局部裁切背景。',alt:'木色边框环绕彩色玻璃与中心画心的原创满洲窗意象',description:'依据画心与衬底的空间关系整理；几何排列和中心植物为当代设计，不是实物临摹。'},
  {id:'garden-courtyard',name:'庭园留白 · 框景',region:'广府 · 岭南园林',category:'建筑空间',knowledgeIds:['lingnan-garden-window'],sourceKeys:['window'],width:1600,height:900,usage:'文旅栏目横幅、阅读背景、静态故事插图。',alt:'庭园开口将水面、植物与廊下空间框入视野的原创插画',description:'从园林窗洞的框景作用转译，庭园布局为原创想象，不冒充景区照片或测绘。'},
  {id:'guangcai-floral',name:'彩瓷新意 · 花叶盘饰',region:'广府 · 广州',category:'工艺意象',knowledgeIds:['guangcai'],sourceKeys:['porcelain'],width:1000,height:1000,usage:'文创专题卡、色彩参考；不作为真实藏品或在售商品图。',alt:'金色边线与红绿花叶环绕白色圆盘的原创彩瓷意象',description:'参考广彩鲜明彩绘与装饰组织，花叶纹样由项目原创；不声称代表特定传统纹样、工艺流程或文物。'},
  {id:'foshan-paper',name:'纸上花影 · 剪纸意象',region:'广府 · 佛山',category:'工艺意象',knowledgeIds:['foshan-paper'],sourceKeys:['paper'],width:1000,height:1000,usage:'佛山工艺专题、活动页装饰、图案参考；跨城栏目须保留佛山标签。',alt:'朱红花叶纹样与金色、青绿色衬底形成对比的原创剪纸意象',description:'从佛山剪纸的连接纹线、色纸和铜箔对比获得启发；图案为原创数字设计，不是传统铜凿作品。'},
].map(a=>({...a,version:themeAssetVersion,format:'original-vector',rights:themeAssetRights,reviewedAt:'2026-09-10',sources:a.sourceKeys.map(k=>sources[k]),png:`/theme-assets/lingnan-v1/${a.id}.png`,svg:`/theme-assets/lingnan-v1/${a.id}.svg`,thumbnail:`/theme-assets/lingnan-v1/${a.id}-thumb.webp`}));
