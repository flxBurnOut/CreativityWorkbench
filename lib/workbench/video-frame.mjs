import sharp from 'sharp';
import { digest } from './repository.mjs';
import { ServiceError } from './errors.mjs';
import { aspectMatches } from './media-validation.mjs';

export async function inspectVideoFrame(project,shot,repository) {
  if(!shot.referenceAssetId)return {status:'not-applicable'};
  const asset=project.assets.find(a=>a.id===shot.referenceAssetId);
  if(!asset?.fileId)throw new ServiceError(400,'missing_frame','首帧还未保存，请先保存或重新选择。');
  const info=await sharp(await repository.media(asset.fileId)).metadata();
  return {status:aspectMatches(info.width,info.height,project.video.ratio)?'passed':'failed',width:info.width,height:info.height,requestedRatio:project.video.ratio,assetId:asset.id};
}
export async function fitVideoFrame(project,shot,fit,repository,requestId) {
  const asset=project.assets.find(a=>a.id===shot.referenceAssetId);
  if(!asset?.fileId)throw new ServiceError(400,'missing_frame','先为镜头选择一张已保存的首帧。');
  const [width,height]=project.video.ratio==='9:16'?[720,1280]:[1280,720];
  const bytes=await sharp(await repository.media(asset.fileId)).resize(width,height,{fit:fit==='crop'?'cover':'contain',position:'centre',background:'#171d1b'}).png().toBuffer();
  const stored=await repository.putImage(bytes);
  const result={id:'a-'+digest(requestId).slice(0,32),name:asset.name+' · '+project.video.ratio+(fit==='crop'?' 居中裁切':' 补边'),fileId:stored.fileId,source:{provider:'local-frame-fit',parentAssetId:asset.id,fit,ratio:project.video.ratio,instruction:fit==='crop'?'用户选择居中裁切，边缘内容可能移除':'用户选择补边，完整保留原图内容'}};
  return {...project,assets:[...project.assets.filter(a=>a.id!==result.id),result],video:{...project.video,shots:project.video.shots.map(s=>s.id===shot.id?{...s,referenceAssetId:result.id,referenceConceptId:undefined}:s)}};
}
