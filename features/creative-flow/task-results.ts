import type { Project, Concept, ImageAsset, VideoDraft, MediaFile, WebsiteDraft,WebsiteSource } from '@/features/projects/model';
export { applyTaskResult } from '../../lib/workbench/project-core.mjs';
export interface GenerationTask {
  id:string; projectId:string; kind:string; args:Record<string,unknown>; source:string;
  status:'queued'|'running'|'waiting_external'|'waiting_provider'|'uncertain'|'succeeded'|'failed'|'cancelled'|'superseded';
  supersededBy?:string;retryOf?:string;executionStatus?:string;updatedAt?:number;imageState?:{binding:string;ready:boolean;stale:boolean;canSelect:boolean;bindingLabel:string};provenance?:Record<string,string>;recoveredAfterCancel?:boolean; createdAt:number; dismissed:boolean; error?:string; note?:string; handoffMessage?:string; dispatch?:string; targetName?:string; promptVersion?:string; submittedPrompt?:string|{role:string;content:string}[];
  workType?:string;inputManifest?:{key:string;label:string;value:unknown;fingerprint:string;role:string}[];
  handoffContract?:{mode:'complete-existing-task';taskId:string;projectId:string;kind:string;objectId?:string;requestPath:string;output:string;completionTool:string};
  result?: { warnings?:string[]; title?:string;brief?:string;culture?:string;sections?:Record<string,string>;replacement?:string;notes?:string;art?:Project['art'];objects?:(Pick<Concept,'id'|'category'|'name'|'description'> & Partial<Concept>)[];asset?:ImageAsset;novel?:Project['novel'];videoPlan?:VideoDraft;videoClip?:MediaFile;videoAudio?:MediaFile;videoFinal?:VideoDraft['final'];website?:WebsiteDraft;websiteSource?:WebsiteSource;websiteRequest?:Project['websiteRequest'];designPackage?:Project['designPackage'] };
}
