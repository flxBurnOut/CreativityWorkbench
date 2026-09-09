// File decoding, source freshness and compliance are separate checks.
export function aspectMatches(width,height,ratio,displayAspectRatio) {
  const [w,h]=ratio.split(':').map(Number);const actual=displayAspectRatio||width/height;
  return Number.isFinite(actual)&&actual>0&&Math.abs(actual/(w/h)-1)<=0.01;
}
export function videoSpec(file,ratio,duration) {
  const actual={width:file.width,height:file.height,duration:file.duration,displayAspectRatio:file.displayAspectRatio||(file.width&&file.height?file.width/file.height:undefined)};
  const requested={ratio,duration};const issues=[];
  if(!file.width||!file.height||!Number.isFinite(file.duration))return {status:'unverified',requested,actual,issues:['旧记录缺少实际媒体规格，请重新导入文件检查。']};
  if(!aspectMatches(file.width,file.height,ratio,file.displayAspectRatio))issues.push(`要求 ${ratio}，实际 ${file.width}×${file.height}（显示宽高比 ${actual.displayAspectRatio.toFixed(3)}）。`);
  if(Math.abs(file.duration-duration)>0.25)issues.push(`要求 ${duration} 秒，实际 ${file.duration.toFixed(2)} 秒。`);
  return {status:issues.length?'failed':'passed',requested,actual,issues};
}
