'use strict';
// Public read-only acceptance; never provision, migrate, bootstrap, or run agents.
async function publicReadiness(input,request=fetch){
 const base=new URL(input.publicUrl);if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash||typeof input.deploymentMarker!=='string'||!input.deploymentMarker)throw Error('PUBLIC_READINESS_BINDING');
 const get=async path=>{const r=await request(new URL(path,base),{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('PUBLIC_READINESS_HTTP');return r;};
 const [web,api,login]=await Promise.all([get('/.well-known/workspacex-deployment'),get('/api/healthz'),get('/login')]);const w=await web.json(),a=await api.json(),html=await login.text();
 if(w.deploymentMarker!==input.deploymentMarker||a.deploymentMarker!==input.deploymentMarker||a.trustworthy!==true||!html.includes('data-testid="login-form"'))throw Error('PUBLIC_READINESS_IDENTITY');
 return {publicReadOnlyVerified:true};
}
module.exports={publicReadiness};
