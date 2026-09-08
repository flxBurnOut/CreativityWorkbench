import type { Project, Concept, ImageAsset, VideoDraft, MediaFile, WebsiteDraft } from '@/features/projects/model';
export { applyTaskResult } from '../../lib/workbench/project-core.mjs';
export interface GenerationTask {
  id:string; projectId:string; kind:string; args:Record<string,unknown>; source:string;
  status:'queued'|'running'|'waiting_external'|'waiting_provider'|'uncertain'|'succeeded'|'failed'|'cancelled';
  recoveredAfterCancel?:boolean; createdAt:number; dismissed:boolean; error?:string; note?:string; handoffMessage?:string; dispatch?:string; targetName?:string;
  result?: { warnings?:string[]; title?:string;brief?:string;culture?:string;sections?:Record<string,string>;replacement?:string;notes?:string;art?:Project['art'];objects?:Pick<Concept,'id'|'category'|'name'|'description'>[];asset?:ImageAsset;novel?:Project['novel'];videoPlan?:VideoDraft;videoClip?:MediaFile;videoAudio?:MediaFile;videoFinal?:VideoDraft['final'];website?:WebsiteDraft };
}
