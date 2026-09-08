export const taskKinds = ['creative','content','art','objects','novel','image','cover','video-plan','video-shot','video-audio','video-compose','website','website-build'];
export const contentKeys = {
  undecided: ['overview','keep'], novel: ['story','characters','world','chapters','voice'],
  video: ['script','shots','voiceover','spec'], craft: ['theme','motifs','copy','display'], website: ['goal','pages','copy','behavior'],
};
export function taskSource(p, kind, args) {
  // Deliberately independent of current stage, timestamps and Blob/file storage representation.
  const common = [p.id, p.type, p.title, p.idea, p.brief, p.culture];
  if (['website','website-build'].includes(kind)) return JSON.stringify([...common,p.content.website,p.art,p.references,p.concepts.map(c=>c.savedAssetId),p.assets.map(a=>[a.id,a.fileId]),p.website?.spec??null,p.delivery,p.requests[4],args]);
  if (kind === 'video-plan') return JSON.stringify([...common,p.content.video,p.art,p.video??null,p.delivery,p.requests[4],args]);
  if (kind === 'video-compose') return JSON.stringify([...common,p.video??null,args]);
  if (kind === 'video-shot' || kind === 'video-audio') {
    const shot=p.video?.shots.find(s=>s.id===args.objectId);
    const {clip:_clip,audio:_audio,...inputs}=shot || {};
    return JSON.stringify([...common,p.content.video,p.art,p.video?.ratio,inputs,p.assets.find(a=>a.id===shot?.referenceAssetId)?.fileId??null,args]);
  }
  if (kind === 'creative') return JSON.stringify([...common, p.requests[0]]);
  if (kind === 'content') return JSON.stringify([...common, p.content[p.type], p.requests[1], args]);
  if (kind === 'novel') return JSON.stringify([...common, p.content.novel, p.novel ?? null, p.delivery, p.requests[4]]);
  if (kind === 'art' || kind === 'objects') return JSON.stringify([...common, p.content[p.type], p.art, p.references, p.requests[kind === 'art' ? 2 : 3]]);
  const c = p.concepts.find(c => c.id === args.objectId);
  return JSON.stringify([...common, p.content[p.type], p.art, p.references, c ?? null, kind === 'cover' ? p.coverAssetId ?? null : null, args]);
}
