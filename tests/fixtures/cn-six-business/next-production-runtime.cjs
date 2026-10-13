'use strict';
const fs=require('node:fs'),path=require('node:path'),v8=require('node:v8');
function need(v){if(!v)throw Error('CN_SIX_PRODUCTION_RUNTIME');}
need(process.env.CN_SIX_WEB_MODE==='production-single'&&process.env.CN_RELEASE_FULLSTACK_FIXTURE==='1');
need(process.argv[1]===path.join(process.env.CN_SIX_WEB_ARTIFACT,'runtime/apps/web/server.js'));
const limit=v8.getHeapStatistics().heap_size_limit;need(limit>=2048*1024**2&&limit<2304*1024**2);
const directory=path.dirname(process.env.CN_SIX_REPORT_PATH),info=fs.lstatSync(directory);need(info.isDirectory()&&!info.isSymbolicLink()&&info.uid===process.getuid()&&(info.mode&0o777)===0o700);
const identity=require('./next-worker-observer.cjs').identity(process.pid);
const fd=fs.openSync(path.join(directory,'next-worker-runtime.json'),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
try{fs.writeFileSync(fd,JSON.stringify({kind:'cn-next-production-runtime-v1',observedAt:new Date().toISOString(),process:identity,heapSizeLimitBytes:limit})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
