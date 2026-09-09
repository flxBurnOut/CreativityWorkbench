// A supplied report is never promoted to an independently verified Runtime result.
export const verificationMethods=['not-tested','static','browser','user-browser'];
export const verificationResults=['not-tested','passed','failed'];
export function websiteVerification(source) {
  const method=source.verificationMethod||'not-tested';const result=source.verificationResult||'not-tested';
  const browser=['browser','user-browser'].includes(method);
  const evidence=typeof source.verificationEvidence==='string'&&source.verificationEvidence.trim();
  return {origin:'external-report',method,result,browserStatus:browser&&evidence&&result!=='not-tested'?(result==='passed'?'reported-pass':'reported-fail'):'unverified',
    note:browser&&evidence&&result!=='not-tested'?`执行端报告浏览器检查${result==='passed'?'通过':'失败'}；工作台未独立复测。`:(result==='failed'?'已有检查报告失败。':'')+'浏览器交互未验证；ZIP 检查、HTTP 200 或模拟 DOM 不能证明交互通过。'};
}
export function validateWebsiteVerification(source) {
  if((source.verificationMethod!==undefined&&!verificationMethods.includes(source.verificationMethod))||(source.verificationResult!==undefined&&!verificationResults.includes(source.verificationResult))||(source.verificationEvidence!==undefined&&(typeof source.verificationEvidence!=='string'||source.verificationEvidence.length>100000)))throw new Error('网站验证记录格式无效。');
}
