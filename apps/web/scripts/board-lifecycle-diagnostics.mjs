const specs=new Set(['board-shared-outbox.spec.ts']);
const projects=new Set(['chromium','board-collaboration-regressions','board-api-ws-objectstore']);
const stages=new Set(['before-freeze','before-pause','native-visibilitychange','after-active','after-resume']);
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=1_000_000;
/** Rebuild the complete output; never forward stdout, arbitrary keys or paths. */
export function boardLifecycleDiagnostic(chunk,test){
 const file=String(test?.location?.file??'').replaceAll('\\','/').split('/').at(-1);
 if(!specs.has(file)||!projects.has(test?.parent?.project?.()?.name))return [];
 const text=String(chunk);if(text.length>4096)return [];
 const output=[];
 for(const line of text.split('\n')){
  if(!line.startsWith('OWNED_LIFECYCLE_VISIBILITY '))continue;
  try{
   const data=JSON.parse(line.slice('OWNED_LIFECYCLE_VISIBILITY '.length));
   if(!stages.has(data.stage)||!['visible','hidden'].includes(data.state)||!count(data.trustedChanges)||!count(data.untrustedChanges)||![0,1].includes(data.sameDocument))continue;
   output.push({stage:data.stage,state:data.state==='visible'?0:1,trustedChanges:data.trustedChanges,untrustedChanges:data.untrustedChanges,sameDocument:data.sameDocument});
  }catch{}
 }
 return output;
}
