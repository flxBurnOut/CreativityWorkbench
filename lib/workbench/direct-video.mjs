export function videoGoalSpecs(goal) {
  const total=goal.match(/(?:总时长|总长|时长|共)\s*[：:]?\s*(\d+(?:\.\d+)?)\s*秒/);
  const times=[...goal.matchAll(/(\d+(?:\.\d+)?)\s*秒/g)];
  const value=total?.[1]||(times.length===1?times[0][1]:undefined),duration=value===undefined?undefined:Number(value);
  const vertical=/竖屏|竖版|9\s*[:：]\s*16/.test(goal),horizontal=/横屏|横版|16\s*[:：]\s*9/.test(goal);
  return {duration:duration!==undefined&&Number.isInteger(duration)&&duration>=2&&duration<=10?duration:undefined,ratio:vertical&&!horizontal?'9:16':horizontal&&!vertical?'16:9':undefined,
    issue:duration!==undefined&&(!Number.isInteger(duration)||duration<2||duration>10)?'当前一个镜头支持 2–10 秒整数时长，请调整时长或在详细编辑中拆成多个镜头。':vertical&&horizontal?'描述同时包含横屏和竖屏，请选择本镜头的画面方向。':''};
}
export function setVideoGoalSpec(goal,patch) {
  let next=goal;
  if(patch.duration!==undefined){const total=/(总时长|总长|时长|共)(\s*[：:]?\s*)\d+(?:\.\d+)?\s*秒/;if(total.test(next))next=next.replace(total,`$1$2${patch.duration} 秒`);else if([...next.matchAll(/\d+(?:\.\d+)?\s*秒/g)].length===1)next=next.replace(/\d+(?:\.\d+)?\s*秒/,patch.duration+' 秒');else next+='\n镜头总时长：'+patch.duration+' 秒。';}
  if(patch.ratio){const words=patch.ratio==='9:16'?'竖屏':'横屏';const pattern=/横屏|横版|竖屏|竖版|16\s*[:：]\s*9|9\s*[:：]\s*16/g;if(pattern.test(next))next=next.replace(pattern,m=>/[：:]/.test(m)?patch.ratio:words);else next+='\n画幅：'+patch.ratio+'。';}
  return next;
}
