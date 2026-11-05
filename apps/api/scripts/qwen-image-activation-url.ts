/** Preserve the deployed API proxy prefix; target only the explicitly supported devapp. */
export function activationBaseUrl(raw='https://devapp.boardx.us/api'){
 const base=new URL(raw);
 if(base.protocol!=='https:'||base.hostname!=='devapp.boardx.us'||base.username||base.password||base.port||!['/api','/api/'].includes(base.pathname)||base.search||base.hash)throw new Error('ACTIVATION_REQUIRES_DEVAPP_API_BASE');
 return base;
}
export function activationApiUrl(base:URL,path:string){
 if(!path.startsWith('/platform/billing/consumption/')||path.includes('\\')||path.includes('#'))throw new Error('ACTIVATION_PATH_NOT_ALLOWED');
 return new URL(`${base.pathname.replace(/\/$/,'')}${path}`,base.origin);
}
