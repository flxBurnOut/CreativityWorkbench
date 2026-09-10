import {readFile} from 'node:fs/promises';
import {themeAssetRecord,applyThemeAssets} from './theme-assets.mjs';
import {applyKnowledge} from './knowledge.mjs';
import {buildWebsitePrompt,websitePromptBasis,websiteAssetIds} from './prompts.mjs';
import {suggestWebsiteMaterials} from './website-studio.mjs';
import {fingerprint} from './workflow.mjs';
export async function prepareWebsiteStudio(p,input,repository) {
  let next={...p,stage:4,websiteEdit:undefined,websiteBrief:{goal:input.goal.trim(),change:input.change,scope:input.scope,autoAssets:input.autoAssets}};
  if(p.websiteRequest?.prompt&&!p.websiteRequest.bundleFileId&&!p.flow?.records.some(r=>r.target==='websiteRequest'&&r.fingerprint===fingerprint(p.websiteRequest)))next.flow={version:1,records:[...(p.flow?.records||[]),{id:crypto.randomUUID(),type:'website',target:'websiteRequest',createdAt:Date.now(),origin:'legacy',fingerprint:fingerprint(p.websiteRequest),value:p.websiteRequest,dependencies:[]}]};
  // Existing selected material and detailed drafts remain user-owned. Defaults
  // only fill a new project's empty library; repeat runs do not re-add removals.
  if(input.autoAssets&&!p.websiteRequest&&!p.knowledge?.length&&!p.assets.length) {
    const suggestions=suggestWebsiteMaterials(input.goal);
    next=applyKnowledge(next,suggestions.knowledgeIds);
    const assets=[];
    for(const entry of suggestions.assets)assets.push(themeAssetRecord(entry,await repository.putImage(await readFile(new URL('../../public'+entry.png,import.meta.url)))));
    if(assets.length)next=applyThemeAssets(next,assets);
  }
  const assetIds=websiteAssetIds(next);
  const baseFileId=input.base==='draft'?p.websiteSourceCandidate?.fileId:p.websiteSource?.fileId;
  if(input.base==='draft'&&!baseFileId)throw new Error('当前初稿尚未同步，请刷新后再修改。');
  // A complete manual prompt is preserved as a version before guided editing.
  // The guided brief is the one editable instruction for this run.
  next={...next,websiteRequest:{prompt:'',basis:'',assetIds,taskId:input.requestId,...(baseFileId?{baseFileId}:{})}};
  next.websiteRequest={...next.websiteRequest,prompt:buildWebsitePrompt(next),basis:websitePromptBasis(next)};
  return next;
}
