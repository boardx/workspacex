import {validateRuntimeBinding} from './board-observation-policy.mjs';
export const securityStatuses={'owner-image':[200],'viewer-image':[200],'viewer-read':[200],'commenter-read':[200],'viewer-write':[403],'commenter-write':[403],'tenant-read':[403,404],'tenant-image':[403,404],'cross-board-image':[403,404],'revoked-image':[403,404],'revoked-read':[403,404],'expiry-positive':[200],'expired-read':[401],'expired-image':[401]};
export function validateSecurityArtifact(r,sha,context){
 const failures=[];
 try{
  if(r?.version!==1||r.kind!=='board-security'||r.sha!==sha||r.approved!==false||r.score!==null||!r.boardId||r.boardId===r.otherBoardId)throw new Error('SECURITY_SCHEMA');
  failures.push(...validateRuntimeBinding(r.runtimeBefore,sha,context),...validateRuntimeBinding(r.runtimeAfter,sha,context));
  if(r.runtimeBefore.buildId!==r.runtimeAfter.buildId)failures.push('SECURITY_BUILD_CHANGED');
  const ids=r.identities;if([ids.owner,ids.viewer,ids.commenter,ids.outsider,ids.orgId,ids.foreignOrgId].some(id=>typeof id!=='string'||!id)||new Set([ids.owner,ids.viewer,ids.commenter,ids.outsider]).size!==4||ids.orgId===ids.foreignOrgId)failures.push('SECURITY_IDENTITY');
  const byName=new Map(r.observations.map(o=>[o.name,o]));if(byName.size!==r.observations.length)failures.push('DUPLICATE_SECURITY_OBSERVATION');
  for(const o of r.observations)if(!Number.isFinite(Date.parse(o.at))||Date.parse(o.at)<Date.parse(context.startedAt)||Date.parse(o.at)>Date.parse(context.endedAt))failures.push('SECURITY_TIME');
  for(const [name,allowed]of Object.entries(securityStatuses)){const o=byName.get(name);if(!o||!allowed.includes(o.status)||!Number.isInteger(o.bytes)||!/^[a-f0-9]{64}$/.test(o.bodyHash))failures.push(`SECURITY_HTTP:${name}`);}
  const original=byName.get('owner-image'),copy=byName.get('viewer-image');
  if(!original?.contentType?.startsWith('image/png')||copy?.bodyHash!==original.bodyHash||copy?.bytes!==original.bytes)failures.push('SECURITY_IMAGE_POSITIVE');
  for(const name of ['tenant-image','cross-board-image','revoked-image','expired-image']){const o=byName.get(name);if(o?.contentType?.startsWith('image/')||o?.bodyHash===original?.bodyHash)failures.push('SECURITY_IMAGE_LEAK');}
  for(const role of ['viewer','commenter']){const o=byName.get(`${role}-ws-write`);if(!o?.sync||o.ack!==false||o.error!=='FORBIDDEN')failures.push(`SECURITY_WS_WRITE:${role}`);}
  if(byName.get('owner-ws')?.sync!==true)failures.push('SECURITY_WS_POSITIVE');
  for(const name of ['tenant-ws','revoked-ws','expired-ws']){const o=byName.get(name);if(!o||o.sync!==false||o.ack!==false||!(o.closed||o.error))failures.push(`SECURITY_WS_DENIAL:${name}`);}
  if(byName.get('revoked-live-view')?.cleared!==true)failures.push('SECURITY_LIVE_REVOKE');
  const expiry=byName.get('expiry-window');if(!expiry||!(expiry.observedAt>expiry.expiresAt&&expiry.expiresAt>expiry.issuedAt)||!(Date.parse(byName.get('expiry-positive')?.at)<expiry.expiresAt))failures.push('SECURITY_REAL_EXPIRY');
  for(const name of ['expired-read','expired-image','expired-ws'])if(!(Date.parse(byName.get(name)?.at)>expiry?.expiresAt))failures.push('SECURITY_EXPIRY_ORDER');
  const unchanged=byName.get('no-unauthorized-mutation');if(!unchanged?.before?.objects?.length||JSON.stringify(unchanged.before)!==JSON.stringify(unchanged.after))failures.push('SECURITY_MUTATION');
 }catch(e){failures.push(e.message??'SECURITY_INVALID');}
 return{valid:!failures.length,failures,pending:[],score:null,budgetStatus:'engineering-targets'};
}
