// Development-only reproducible vendor generator. Release runtime needs no packages.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../..');
const out=path.join(root,'.harness/scripts/vendor/yaml-2.9.0');
const hash=v=>createHash('sha256').update(v).digest('hex');
const upstream=process.env.WSX_YAML_VENDOR_SOURCE??path.dirname(require.resolve('yaml/package.json'));
const pkg=JSON.parse(fs.readFileSync(path.join(upstream,'package.json')));
const manifest=JSON.parse(fs.readFileSync(path.join(out,'manifest.json')));
if(pkg.version!=='2.9.0'||pkg.license!=='ISC')throw Error('VENDOR_UPSTREAM_VERSION');
const lock=fs.readFileSync(path.join(root,'pnpm-lock.yaml'),'utf8');
if(!lock.includes('yaml@2.9.0:')||!lock.includes(manifest.upstreamIntegrity))throw Error('VENDOR_LOCK_DRIFT');
const rows=[];
function walk(rel){for(const n of fs.readdirSync(path.join(upstream,rel)).sort()){const p=path.join(rel,n),s=fs.lstatSync(path.join(upstream,p));if(s.isSymbolicLink())throw Error('VENDOR_SYMLINK');if(s.isDirectory())walk(p);else if(p.endsWith('.js'))rows.push([p,hash(fs.readFileSync(path.join(upstream,p)))]);}}
walk('dist');rows.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
if(hash(JSON.stringify(rows))!==manifest.upstreamDistSha256||hash(fs.readFileSync(path.join(upstream,'LICENSE')))!==manifest.licenseSha256)throw Error('VENDOR_UPSTREAM_BYTES');
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('tsx')]}));
if(esbuild.version!==manifest.generatorVersion)throw Error('VENDOR_GENERATOR_VERSION');
const result=await esbuild.build({absWorkingDir:upstream,stdin:{contents:"export {parse} from './dist/index.js';",resolveDir:upstream,sourcefile:'yaml-parser-entry.mjs'},bundle:true,format:'esm',platform:'node',target:'node22',write:false,minify:false,legalComments:'inline',banner:{js:`// Vendored yaml 2.9.0 (ISC). See LICENSE and manifest.json; regenerate with vendor-yaml-parser.mjs.
import nodeProcess from 'node:process';
import * as nodeBuffer from 'node:buffer';
const require=name=>{if(name==='process')return nodeProcess;if(name==='buffer')return nodeBuffer;throw Error('OFFLINE_VENDOR_EXTERNAL_MODULE');};`}});
const bytes=result.outputFiles[0].contents;
if(process.argv[2]==='--verify'){if(hash(bytes)!==manifest.bundleSha256||!Buffer.from(bytes).equals(fs.readFileSync(path.join(out,'parser.mjs'))))throw Error('VENDOR_REGEN_DRIFT');console.log('OFFLINE_YAML_VENDOR_VERIFIED');}
else if(process.argv[2]==='--generate'){fs.writeFileSync(path.join(out,'parser.mjs'),bytes);fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({...manifest,bundleSha256:hash(bytes)},null,2)+'\n');}
else throw Error('VENDOR_COMMAND');
