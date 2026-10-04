'use strict';
const assert=require('node:assert/strict');
const {decodeSql}=require('./restore_sql_stream.cjs');
async function* chunks(text,width){const raw=Buffer.from(text);for(let i=0;i<raw.length;i+=width)yield raw.subarray(i,i+width);}
async function collect(text,width=7){const out=[];for await(const op of decodeSql(chunks(text,width))){if(op.kind==='copy'){const data=[];for await(const c of op.chunks)data.push(c);out.push({...op,chunks:Buffer.concat(data).toString()});}else out.push(op);}return out;}
(async()=>{let tests=0;
 const dump='-- fixed dump\n\\restrict abc123\nCREATE TABLE public.t (v text);\nCREATE FUNCTION public.f() RETURNS text LANGUAGE sql AS $tag$ SELECT \'a;b\'; $tag$;\nCOPY public.t (v) FROM stdin;\na;semi\n\\\\.\n你好\n\\.\nSELECT pg_catalog.setval(\'public.s\', 9, true);\n\\unrestrict abc123\n';
 for(const width of [1,2,7,64,65536]){const out=await collect(dump,width);assert.equal(out.length,4);assert.equal(out[1].kind,'sql');assert(out[1].sql.includes("'a;b'"));assert.equal(out[2].chunks,'a;semi\n\\\\.\n你好\n');assert(out[3].sql.startsWith('SELECT'));tests++;}
 const out=await collect("/* outer /* nested ; */ done */ CREATE TABLE \"semi;name\" (v text); SELECT 'it''s;ok';\n");assert.equal(out.length,2);assert(out[0].sql.startsWith('CREATE TABLE'));tests++;
 for(const bad of ["COPY public.t FROM stdin;\nx\n", "SELECT 'truncated;\n",'\\connect other\n','\\restrict abc\nSELECT 1;\n','\\restrict abc\n\\unrestrict xyz\n','COPY public.t FROM PROGRAM \'cat\';\n']){await assert.rejects(collect(bad),/RESTORE_/);tests++;}
 let yielded=false;await assert.rejects((async()=>{for await(const op of decodeSql(chunks('COPY public.t FROM stdin;\nx\n\\.\n',7))){assert.equal(op.kind,'copy');yielded=true;}})(),/COPY_NOT_CONSUMED/);assert(yielded);tests++;
 console.log(`${tests} offline SQL/COPY stream assertions PASS; real pg_restore/PG NOT RUN`);
})().catch(e=>{console.error(e);process.exitCode=1;});
