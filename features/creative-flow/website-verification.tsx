'use client';
import {Field} from '@/components/workbench/ui';
import type {WebsiteSource} from '@/features/projects/model';
import {websiteVerification} from '@/lib/workbench/website-verification.mjs';
export function WebsiteVerification({source,onChange}:{source:WebsiteSource;onChange?:(patch:Partial<WebsiteSource>)=>void}) {
  const report=websiteVerification(source);
  return <div className="website-verification"><p role="status"><strong>文件结构已检查。</strong>{report.note}</p>{onChange&&<details><summary>记录实际浏览器验收</summary><p>运行网站后检查真实按钮和答案可见性；FAQ 至少验证“展开 → 收起 → 再次展开”、快速连点、键盘与手机布局。</p><Field label="网站验证方式"><select value={source.verificationMethod||'not-tested'} onChange={e=>onChange({verificationMethod:e.target.value as WebsiteSource['verificationMethod'],verificationResult:'not-tested'})}><option value="not-tested">未验证</option><option value="static">静态／模拟检查</option><option value="browser">浏览器自动化</option><option value="user-browser">用户浏览器复测</option></select></Field><Field label="网站验证结果"><select value={source.verificationResult||'not-tested'} onChange={e=>onChange({verificationResult:e.target.value as WebsiteSource['verificationResult']})}><option value="not-tested">未判定</option><option value="passed">报告通过</option><option value="failed">报告失败</option></select></Field><Field label="浏览器验收证据"><textarea rows={3} value={source.verificationEvidence||''} placeholder="记录浏览器/网址、实际操作序列、可见结果，以及截图或验证记录路径。" onChange={e=>onChange({verificationEvidence:e.target.value})}/></Field></details>}</div>;
}
