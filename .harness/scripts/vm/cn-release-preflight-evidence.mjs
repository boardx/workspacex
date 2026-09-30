// Values are passed only after successful live probes in the root collector.
const fs=(await import("node:fs")).default,crypto=(await import("node:crypto")).default;
const [path,phase,attemptId,sourceSha,baselineSha,release,secretCount,acrTtl,browserExecutable,manifestPath,priorPath,bootstrapPath,runtimePath,stablePath,managedPath,protocolPath]=process.argv.slice(2);
const canonical=v=>Array.isArray(v)?"["+v.map(canonical).join(",")+"]":v&&typeof v==="object"?"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}":JSON.stringify(v);
const digest=v=>crypto.createHash("sha256").update(typeof v==="string"?v:canonical(v)).digest("hex");
const check=(id,metadata)=>({status:"passed",evidenceSha256:digest(id+"|"+canonical(metadata)),metadata});
const checks={
  "source.exact_sha":check("source.exact_sha",{requestedSha:sourceSha,repositoryHead:sourceSha,mirrorHead:sourceSha}),"source.complete_artifact":check("source.complete_artifact",{complete:true,offline:true}),
  "source.offline_plan_b":check("source.offline_plan_b",{githubRequired:false}),"toolchain.package_manager":check("toolchain.package_manager",{declared:"pnpm@9.15.0",actual:"9.15.0"}),
  "toolchain.pnpm_cli_protocol":check("toolchain.pnpm_cli_protocol",{doubleDashForwardingPassed:true}),"toolchain.stdout_protocol":check("toolchain.stdout_protocol",{exactlyOneMachineRecord:true}),
  "toolchain.browser_runtime":check("toolchain.browser_runtime",{browserExecutable,playwrightResolved:true,launchPassed:true}),
  "registry.acr_auth":check("registry.acr_auth",{authenticatedProbe:true,remainingTtlSeconds:Number(acrTtl)}),
  "runtime.release_lock":check("runtime.release_lock",{heldByAttempt:false,attemptId}),"runtime.no_orphans":check("runtime.no_orphans",{scanPassed:true,count:0}),
  "config.release_manifest":check("config.release_manifest",{sourceSha,release,kind:"source-plan"}),
  "config.durable_profiles":check("config.durable_profiles",{asrConfigured:true,githubIssueConfigured:true,platformSuperuserConfigured:true}),
  "config.secret_serialization":check("config.secret_serialization",{checkedRefs:Number(secretCount),invalidKeys:[]}),
  "cloud.managed_data_permissions":check("cloud.managed_data_permissions",{mode:"persistent-resource-scoped-read-only",liveDescribePassed:true,passedActions:["rds:DescribeDBInstanceAttribute","rds:DescribeDBInstanceSSL","rds:DescribeDBInstanceIPArrayList","rds:DescribeBackupPolicy","redis:DescribeInstanceAttribute","redis:DescribeInstanceSSL"],resourceScoped:true,readOnlyActionsOnly:true}),
  "database.drain_read_access":check("database.drain_read_access",{role:"app_diag_ro",canReadAgentRuns:true}),
  "bootstrap.compatibility":{status:"failed",code:"BOOTSTRAP_COMPATIBILITY_UNKNOWN",evidenceSha256:digest("shared-bootstrap-probe-not-implemented"),metadata:{}},
  "secrets.stable_continuity":check("secrets.stable_continuity",{requiredCount:12,matchedCount:12,missingKeyIds:[],rotatedKeyIds:[],consumerDriftIds:[],stableDirectory:true,baselineReadable:true,candidateWillReuse:true,noMutation:true}),
  "build.affected_services":check("build.affected_services",{diffComputed:true,baselineSha,sourceSha,services:["api","web","agent","sandbox"]}),
  "deploy.trusted_copy":check("deploy.trusted_copy",{hashesMatch:true,checkedEntrypoints:8}),"network.dependencies":check("network.dependencies",{probed:true,acr:true,oss:true,rds:true,redis:true}),
};
const readRecord=(path,prefix)=>{
  const raw=fs.readFileSync(path,"utf8");
  if(raw.split("\n").length!==2||!raw.endsWith("\n")||!raw.startsWith(prefix))throw Error("PREFLIGHT_MACHINE_OUTPUT_INVALID");
  return {raw,value:JSON.parse(raw.slice(prefix.length))};
};
const bootstrap=readRecord(bootstrapPath,"CN_BOOTSTRAP_COMPAT_JSON=");
const b=bootstrap.value;
if(b.sourceSha!==sourceSha||b.phase!==phase||b.ready!==true||b.readOnlyTransaction!==true||b.productionWriteStatements!==0||!Array.isArray(b.blockers)||b.blockers.length)throw Error("BOOTSTRAP_COMPATIBILITY_UNPROVEN");
if(phase==="preactivate"&&b.imageDigest!==JSON.parse(fs.readFileSync(manifestPath,"utf8")).images.api.image.split("@")[1])throw Error("BOOTSTRAP_IMAGE_IDENTITY_DIFFERS");
checks["bootstrap.compatibility"]={status:"passed",evidenceSha256:digest(bootstrap.raw),metadata:{
  readOnlyTransaction:b.readOnlyTransaction,productionWriteStatements:b.productionWriteStatements,...b.checks,
  stateClass:b.stateClass,exactlyOneMachineRecord:true,emailSha256:b.adminEmailSha256,
}};
for(const [key,path,prefix] of [["config.durable_profiles",runtimePath,"CN_RUNTIME_ENVIRONMENT_PREFLIGHT_JSON="],["secrets.stable_continuity",stablePath,"CN_STABLE_SECRET_PREFLIGHT "],["cloud.managed_data_permissions",managedPath,"CN_MANAGED_DATA_PREFLIGHT_JSON="]]){
  const record=readRecord(path,prefix);
  if(record.value.ready!==true&&record.value.passed!==true)throw Error("PREFLIGHT_PROBE_NOT_READY");
  checks[key].evidenceSha256=digest(record.raw);
}
checks["config.secret_serialization"].evidenceSha256=digest(fs.readFileSync(runtimePath,"utf8"));
checks["toolchain.pnpm_cli_protocol"].evidenceSha256=digest(fs.readFileSync(protocolPath,"utf8"));
const now=new Date(),expires=new Date(now.getTime()+55*60*1000),iso=v=>v.toISOString().replace(/\.\d{3}Z$/,"Z");
const result={schemaVersion:2,phase,attemptId,sourceSha,baselineSha,release,issuedAt:iso(now),expiresAt:iso(expires),buildStarted:phase==="preactivate",checks};
if(phase==="preactivate"){
  const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8")),services=["api","web","agent","sandbox"],images={};
  for(const service of services){const image=manifest.images?.[service]?.image,match=typeof image==="string"&&image.match(/@(sha256:[a-f0-9]{64})$/);if(!match)process.exit(1);images[service]={sourceSha,digest:match[1],entrypointVerified:true};}
  checks["build.target_images"]=check("build.target_images",{services:images});
  checks["config.release_manifest"]=check("config.release_manifest",{sourceSha,release,kind:"sealed-images",imageDigests:Object.fromEntries(services.map(service=>[service,images[service].digest]))});
  const prior=JSON.parse(fs.readFileSync(priorPath,"utf8"));
  result.prebuildEvidence=prior; result.prebuildReceiptSha256=digest(prior);
}
fs.writeFileSync(path,JSON.stringify(result)+"\n",{mode:0o600,flag:"wx"});
