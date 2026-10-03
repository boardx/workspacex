const projects=new Set(['chromium','firefox','webkit','board-api-ws-objectstore']);
const specs=new Set(['board-selection-layout.spec.ts','board-shared-outbox.spec.ts','board-visual-accessibility-acceptance.spec.ts','board-compact-chrome-acceptance.spec.ts']);
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:undefined;
const rect=value=>Object.fromEntries(['x','y','width','height'].flatMap(key=>numeric(value?.[key])===undefined?[]:[[key,value[key]]]));
function firstJsonObject(message,start){
 if(start<0)return null;
 let depth=0,inString=false,escaped=false;
 for(let index=start;index<message.length&&index-start<8192;index++){
  const char=message[index];
  if(inString){
   if(escaped)escaped=false;
   else if(char==='\\')escaped=true;
   else if(char==='"')inString=false;
   continue;
  }
  if(char==='"')inString=true;
  else if(char==='{')depth++;
  else if(char==='}'&&--depth===0)return message.slice(start,index+1);
 }
 return null;
}
/** Only fixed codes and finite geometry cross the CI log boundary. */
export function boardCiFailureDiagnostic(test,result){
 if(result.status==='passed'||result.status===test.expectedStatus)return null;
 const file=String(test.location?.file??'').replaceAll('\\','/').split('/').at(-1);
 if(!specs.has(file))return null;
 const project=test.parent?.project?.()?.name;
 const output={spec:file,status:['failed','timedOut','interrupted'].includes(result.status)?result.status:'unexpected'};
 if(projects.has(project))output.project=project;
 if(Number.isSafeInteger(test.location?.line)&&test.location.line>0)output.testLine=test.location.line;
 output.reason='UNCLASSIFIED_TEST_FAILURE';
 for(const error of result.errors??[]){
  const message=typeof error?.message==='string'?error.message:'';
  const errorFile=String(error?.location?.file??'').replaceAll('\\','/').split('/').at(-1);
  if(errorFile===file&&Number.isSafeInteger(error.location.line)&&error.location.line>0&&output.errorLine===undefined)output.errorLine=error.location.line;
  if(file==='board-shared-outbox.spec.ts'&&message.includes('Peer must replay the actual held-ACK receipt after its durable claim expires')){output.reason='PEER_HELD_ACK_REPLAY_FAILED';break;}
  if(message.includes('NO_NATIVE_BLANK_POSITION')){
   output.reason='NO_NATIVE_BLANK_POSITION';
   const start=message.indexOf('{',message.indexOf('NO_NATIVE_BLANK_POSITION'));
   const payload=firstJsonObject(message,start);
   if(payload===null)continue;
   try{
    const data=JSON.parse(payload);
    output.geometry={canvas:rect(data.canvas)};
    for(const key of ['zoom','margin','unobstructedCenters'])if(numeric(data[key])!==undefined)output.geometry[key]=data[key];
    if(Array.isArray(data.chrome))output.geometry.chrome=data.chrome.slice(0,32).map(rect);
   }catch{}
   break;
  }
  if(/Test timeout of \d+ms exceeded/.test(message))output.reason='TEST_TIMEOUT';
  else if(/expect\(/.test(message)&&output.reason==='UNCLASSIFIED_TEST_FAILURE')output.reason='ASSERTION_FAILED';
 }
 return output;
}
