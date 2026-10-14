'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createRequire}=require('node:module');
const {collectClosure}=require('../scripts/cn-package-node-closure.cjs');
const dependencies=createRequire(path.join(process.env.CN_PACKAGE_TEST_DEPENDENCY_ROOT||path.resolve(__dirname,'..'),'package.json'));
const tools={ts:dependencies('typescript'),esbuild:require(createRequire(dependencies.resolve('tsx')).resolve('esbuild'))};
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'cn-package-fixture-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 function put(name,raw){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof raw==='string'?raw:JSON.stringify(raw));return file;}
 function link(name,target){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.symlinkSync(target,file);}
 function pkg(name,dependencies={},optionalDependencies={}){const dir='node_modules/.pnpm/'+name+'/node_modules/'+name;put(dir+'/package.json',{name,main:'index.js',dependencies,optionalDependencies});put(dir+'/index.js','module.exports=1');return dir;}
 put('package.json',{name:'fixture',private:true});put('apps/api/package.json',{name:'api'});return{root,put,link,pkg};}
const collect=f=>collectClosure({root:f.root,entryPoints:['apps/api/core.ts'],includeRoots:[],tools});
test('workspace graph and selected pnpm package dependency closure, unused package excluded',async t=>{
 const f=fixture(t);f.put('apps/api/core.ts',"import {answer} from '@repo/shared'; import foo from 'foo'; console.log(answer,foo)");
 f.put('packages/shared/package.json',{name:'@repo/shared',exports:'./src/index.ts'});f.put('packages/shared/src/index.ts',"export const answer=42");
 f.link('apps/api/node_modules/@repo/shared','../../../../packages/shared');
 const foo=f.pkg('foo',{bar:'1.0.0'},{absent:'1.0.0'}),bar=f.pkg('bar');f.pkg('unused');
 f.link('apps/api/node_modules/foo','../../../'+foo);f.link('node_modules/.pnpm/foo/node_modules/bar','../../bar/node_modules/bar');
 const x=await collect(f);assert.ok(x.sourceFiles.includes('packages/shared/src/index.ts'));assert.ok(x.sourceFiles.includes('packages/shared/package.json'));
 assert.deepEqual(x.packageDirectories.sort(),[bar,foo].sort());assert.ok(x.packageFiles.includes(foo+'/index.js'));
 assert.ok(x.links['apps/api/node_modules/@repo/shared']);assert.ok(x.links['node_modules/.pnpm/foo/node_modules/bar']);assert.equal(x.writesPerformed,false);
});
test('missing required transitive package is rejected',async t=>{
 const f=fixture(t);f.put('apps/api/core.ts',"import 'foo'");const foo=f.pkg('foo',{missing:'1.0.0'});f.link('apps/api/node_modules/foo','../../../'+foo);
 await assert.rejects(collect(f),/MISSING_REQUIRED_PACKAGE:missing/);
});
test('package symlink outside the repository is rejected',async t=>{
 const f=fixture(t),outside=fs.mkdtempSync(path.join(os.tmpdir(),'cn-outside-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
 fs.writeFileSync(path.join(outside,'package.json'),JSON.stringify({name:'foo',main:'index.js'}));fs.writeFileSync(path.join(outside,'index.js'),'module.exports=1');
 f.put('apps/api/core.ts',"import 'foo'");f.link('apps/api/node_modules/foo',outside);await assert.rejects(collect(f),/OUTSIDE_ROOT/);
});
test('unresolved dynamic repository import is rejected',async t=>{
 const f=fixture(t);f.put('apps/api/core.ts',"const target='./dynamic.ts'; import(target)");await assert.rejects(collect(f),/UNRESOLVED_DYNAMIC_IMPORT/);
});
test('root tsx is explicitly included even when source does not import it',async t=>{
 const f=fixture(t);f.put('apps/api/core.ts','export const n=1');const tsx=f.pkg('tsx');f.link('node_modules/tsx','./.pnpm/tsx/node_modules/tsx');
 const x=await collectClosure({root:f.root,entryPoints:['apps/api/core.ts'],tools});assert.deepEqual(x.packageDirectories,[tsx]);assert.ok(x.links['node_modules/tsx']);
});
test('missing nonoptional peer dependency is rejected',async t=>{
 const f=fixture(t);f.put('apps/api/core.ts',"import 'foo'");const foo=f.pkg('foo');f.put(foo+'/package.json',{name:'foo',main:'index.js',peerDependencies:{peer:'1.0.0'}});f.link('apps/api/node_modules/foo','../../../'+foo);
 await assert.rejects(collect(f),/MISSING_REQUIRED_PACKAGE:peer/);
});
test('tsx can be closed from the unique pnpm store with an explicit root link',async t=>{
 const f=fixture(t);f.put('apps/api/core.ts','export const n=1');const tsx=f.pkg('tsx');
 const x=await collectClosure({root:f.root,entryPoints:['apps/api/core.ts'],tools});assert.deepEqual(x.packageDirectories,[tsx]);assert.equal(x.links['node_modules/tsx'],'./.pnpm/tsx/node_modules/tsx'.slice(2));
});
test('ambiguous root fallback versions are rejected',async t=>{
 const f=fixture(t);f.put('apps/api/core.ts','export const n=1');f.pkg('tsx');f.put('node_modules/.pnpm/tsx-two/node_modules/tsx/package.json',{name:'tsx',main:'index.js'});f.put('node_modules/.pnpm/tsx-two/node_modules/tsx/index.js','module.exports=1');
 await assert.rejects(collectClosure({root:f.root,entryPoints:['apps/api/core.ts'],tools}),/ROOT_PACKAGE_MISSING_OR_AMBIGUOUS/);
});
function dynamicFixture(t){const f=fixture(t);f.put('apps/api/core.ts',"import '../../packages/cloud-deploy/src/cn-migration-plan'");f.put('apps/api/src/infrastructure/db/migrator.ts','export const migrationFiles=()=>[]');
 const text="export async function generateMigrationPlan(checkout:string){const root=realpathSync(resolve(checkout));const migratorPath=\"apps/api/src/infrastructure/db/migrator.ts\";return import(pathToFileURL(join(root, migratorPath)).href)}";
 f.put('packages/cloud-deploy/src/cn-migration-plan.ts',text);return {...f,text};}
const mapping={importer:'packages/cloud-deploy/src/cn-migration-plan.ts',expression:'pathToFileURL(join(root, migratorPath)).href',target:'apps/api/src/infrastructure/db/migrator.ts',sourceRoot:'/usr/local/lib/workspacex-cn/release-source/'+'a'.repeat(40)};
const dynamicCollect=(f,reviewedDynamicImports=[mapping])=>collectClosure({root:f.root,entryPoints:['apps/api/core.ts'],includeRoots:[],tools,reviewedDynamicImports});
test('the sole reviewed frozen-source expression closes the migrator graph',async t=>{const f=dynamicFixture(t),x=await dynamicCollect(f);assert.ok(x.sourceFiles.includes(mapping.target));assert.deepEqual(x.dynamicBindings,[mapping]);});
test('tampered migrator constant is rejected even with approved mapping',async t=>{const f=dynamicFixture(t);f.put(mapping.importer,f.text.replace('db/migrator.ts','db/other.ts'));await assert.rejects(dynamicCollect(f),/DYNAMIC_CONSTANT_BINDING/);});
test('tampered expression and unrelated dynamic import are rejected',async t=>{const f=dynamicFixture(t);f.put(mapping.importer,f.text.replace('join(root, migratorPath)','join(other, migratorPath)'));await assert.rejects(dynamicCollect(f),/UNRESOLVED_DYNAMIC_IMPORT/);
 f.put(mapping.importer,f.text+";const data='./unknown.ts';import(data)");await assert.rejects(dynamicCollect(f),/UNRESOLVED_DYNAMIC_IMPORT/);});
test('approved expression cannot use arbitrary runtime roots',async t=>{const f=dynamicFixture(t);await assert.rejects(dynamicCollect(f,[{...mapping,sourceRoot:'/tmp/arbitrary'}]),/DYNAMIC_REVIEW_SCOPE/);});
test('all importer aliases survive esbuild external resolution caching',async t=>{
 const f=fixture(t),foo=f.pkg('foo');f.put('apps/api/core.ts',"import {n} from '@repo/shared';import foo from 'foo';console.log(n,foo)");
 f.put('packages/shared/package.json',{name:'@repo/shared',exports:'./src/index.ts'});f.put('packages/shared/src/index.ts',"import foo from 'foo';export const n=foo");
 f.link('apps/api/node_modules/@repo/shared','../../../../packages/shared');f.link('apps/api/node_modules/foo','../../../'+foo);f.link('packages/shared/node_modules/foo','../../../'+foo);
 const x=await collect(f);assert.ok(x.links['apps/api/node_modules/foo']);assert.ok(x.links['packages/shared/node_modules/foo']);
 // Copy only the declared package files and aliases, then prove actual Node
 // resolution from both importer locations without any ambient node_modules.
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'cn-closure-stage-'));t.after(()=>fs.rmSync(stage,{recursive:true,force:true}));
 for(const name of x.packageFiles){const target=path.join(stage,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(f.root,name),target);}
 for(const [name,target]of Object.entries(x.links)){const link=path.join(stage,name);fs.mkdirSync(path.dirname(link),{recursive:true});fs.symlinkSync(target,link);}
 for(const importer of ['apps/api/core.ts','packages/shared/src/index.ts'])assert.equal(createRequire(path.join(stage,importer))('foo'),1);
});
test('pnpm public-hoisted dependency link survives a pruned staging copy',async t=>{
 const f=fixture(t),foo=f.pkg('foo',{bar:'1.0.0'}),bar=f.pkg('bar');f.put('apps/api/core.ts',"import foo from 'foo';console.log(foo)");f.put(foo+'/index.js',"module.exports=require('bar')");f.link('apps/api/node_modules/foo','../../../'+foo);f.link('node_modules/.pnpm/node_modules/bar','../bar/node_modules/bar');
 const x=await collect(f);assert.ok(x.links['node_modules/.pnpm/node_modules/bar']);const stage=fs.mkdtempSync(path.join(os.tmpdir(),'cn-hoisted-stage-'));t.after(()=>fs.rmSync(stage,{recursive:true,force:true}));
 for(const name of x.packageFiles){const file=path.join(stage,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(f.root,name),file);}
 for(const [name,target]of Object.entries(x.links)){const link=path.join(stage,name);fs.mkdirSync(path.dirname(link),{recursive:true});fs.symlinkSync(target,link);}
 assert.equal(createRequire(path.join(stage,'apps/api/core.ts'))('foo'),1);
});
test('esbuild synthetic CommonJS runtime edge is not an npm dependency',async t=>{
 const f=fixture(t);f.put('apps/api/core.ts',"if(require.main===module){throw Error('CLI MAIN MUST NOT EXECUTE')}module.exports={value:42}");
 const x=await collect(f);assert.deepEqual(x.packageDirectories,[]);assert.ok(x.sourceFiles.includes('apps/api/core.ts'));
});
