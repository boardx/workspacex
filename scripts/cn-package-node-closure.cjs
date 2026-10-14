#!/usr/bin/env node
'use strict';
// Read-only graph extraction. The caller owns copying, manifests and staging tests.
const fs=require('node:fs'),path=require('node:path'),{createRequire,isBuiltin}=require('node:module');
function need(ok,code){if(!ok)throw Error(code);}
function packageName(spec){return spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0];}
function relative(root,file){const rel=path.relative(root,file);need(rel&&!rel.startsWith('../')&&!path.isAbsolute(rel),'OUTSIDE_ROOT:'+file);return rel.split(path.sep).join('/');}
function inside(root,file){relative(root,file);const actual=fs.realpathSync(file);relative(root,actual);return actual;}
function packageRoot(root,name,req){
 let entry;try{entry=req.resolve(name+'/package.json');}catch{try{entry=req.resolve(name);}catch{throw Error('MISSING_REQUIRED_PACKAGE:'+name);}}
 let dir=path.dirname(inside(root,entry));
 while(dir!==root){const manifest=path.join(dir,'package.json');if(fs.existsSync(manifest)&&JSON.parse(fs.readFileSync(manifest,'utf8')).name===name)return dir;dir=path.dirname(dir);}
 throw Error('PACKAGE_MANIFEST_NOT_FOUND:'+name);
}
const REVIEWED_DYNAMIC={importer:'packages/cloud-deploy/src/cn-migration-plan.ts',expression:'pathToFileURL(join(root, migratorPath)).href',target:'apps/api/src/infrastructure/db/migrator.ts'};
function rejectDynamicImports(ts,file,review=null){
 const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true),bindings=[];
 function visit(node){
  const importCall=ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==='require'));
  if(importCall&&!(node.arguments.length===1&&ts.isStringLiteralLike(node.arguments[0]))){
   need(review&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments.length===1&&node.arguments[0].getText(ast)===REVIEWED_DYNAMIC.expression,'UNRESOLVED_DYNAMIC_IMPORT:'+file);
   let fn=node.parent;while(fn&&!ts.isFunctionDeclaration(fn))fn=fn.parent;
   need(fn&&fn.name?.text==='generateMigrationPlan','DYNAMIC_FUNCTION_BINDING');
   const declarations=[];function vars(n){if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&['migratorPath','root'].includes(n.name.text))declarations.push(n);ts.forEachChild(n,vars);}vars(fn);
   for(const [name,expected]of [['migratorPath',JSON.stringify(REVIEWED_DYNAMIC.target)],['root','realpathSync(resolve(checkout))']]){
    const matches=declarations.filter(d=>d.name.text===name);need(matches.length===1&&(matches[0].parent.flags&ts.NodeFlags.Const)&&matches[0].initializer,'DYNAMIC_CONSTANT_BINDING');
    const init=matches[0].initializer;need(name==='migratorPath'?ts.isStringLiteralLike(init)&&init.text===REVIEWED_DYNAMIC.target:init.getText(ast)===expected,'DYNAMIC_CONSTANT_BINDING');
   }
   bindings.push({...REVIEWED_DYNAMIC,sourceRoot:review.sourceRoot});
  }
  ts.forEachChild(node,visit);
 }visit(ast);return bindings;
}
async function collectClosure({root,entryPoints,apiDirectory='apps/api',includeRoots=['tsx'],tools=null,reviewedDynamicImports=[]}){
 root=fs.realpathSync(root);need(Array.isArray(entryPoints)&&entryPoints.length,'ENTRY_POINTS');
 const rootRequire=createRequire(path.join(root,'package.json'));
 const apiRequire=createRequire(path.join(root,apiDirectory,'package.json'));
 const toolRequire=createRequire(path.join(__dirname,'../package.json'));
 function resolveTool(name){for(const req of [toolRequire,apiRequire,rootRequire]){try{return req.resolve(name);}catch{}}throw Error('BUILD_TOOL_MISSING:'+name);}
 const ts=tools?.ts||require(resolveTool('typescript'));
 const esbuild=tools?.esbuild||require(createRequire(resolveTool('tsx')).resolve('esbuild'));
 const externals=[],workspaces=[];
 const entries=entryPoints.map(p=>inside(root,path.resolve(root,p)));
 async function graph(graphEntries){return esbuild.build({absWorkingDir:root,entryPoints:graphEntries,bundle:true,write:false,metafile:true,platform:'node',format:'esm',packages:'external',treeShaking:false,outdir:path.join(root,'.cn-closure-unused-output'),logLevel:'silent',plugins:[{
  name:'cn-workspace-and-package-graph',setup(build){build.onResolve({filter:/^[^./]|^@/},args=>{
   if(isBuiltin(args.path))return {path:args.path,external:true};
   if(args.path.startsWith('@repo/')){
    let resolved;const importerRequire=createRequire(args.importer||path.join(root,'package.json'));
    for(const req of [importerRequire,apiRequire,rootRequire]){try{resolved=req.resolve(args.path);break;}catch{}}
    need(resolved,'UNRESOLVED_WORKSPACE_IMPORT:'+args.path);workspaces.push({name:packageName(args.path),importer:args.importer||path.join(root,'package.json')});return {path:inside(root,resolved)};
   }
   externals.push({name:packageName(args.path),importer:args.importer||path.join(root,'package.json')});return {path:args.path,external:true};
  });}
 }]});}
 for(const binding of reviewedDynamicImports){need(Object.keys(binding).sort().join(',')==='expression,importer,sourceRoot,target'&&Object.entries(REVIEWED_DYNAMIC).every(([k,v])=>binding[k]===v)&&/^\/usr\/local\/lib\/workspacex-cn\/release-source\/[a-f0-9]{40}$/.test(binding.sourceRoot),'DYNAMIC_REVIEW_SCOPE');}
 let result=await graph(entries),sourceFiles,bindings=[];
 for(let pass=0;pass<2;pass++){sourceFiles=Object.keys(result.metafile.inputs).map(p=>inside(root,path.resolve(root,p)));bindings=[];for(const file of sourceFiles)if(/\.[cm]?[jt]sx?$/.test(file)){const review=reviewedDynamicImports.find(row=>row.importer===relative(root,file));bindings.push(...rejectDynamicImports(ts,file,review));}
  const additional=bindings.map(row=>inside(root,path.join(root,row.target))).filter(file=>!sourceFiles.includes(file));if(!additional.length)break;need(pass===0,'DYNAMIC_GRAPH_UNCLOSED');result=await graph([...entries,...additional]);
 }
 need(!result.warnings.some(w=>/dynamic|glob|require|import/i.test(w.text)),'UNRESOLVED_IMPORT_WARNING');
 // onResolve can cache equal external specifiers across importer sites. The
 // metafile retains each source edge, which is required to preserve every
 // package lookup alias when unbundled TS is copied to staging.
 for(const [importer,input]of Object.entries(result.metafile.inputs)){for(const edge of input.imports||[]){if(edge.external&&edge.path!=='<runtime>'&&!isBuiltin(edge.path)&&!edge.path.startsWith('.')&&!path.isAbsolute(edge.path)){const row={name:packageName(edge.path),importer:inside(root,path.resolve(root,importer))};if(edge.path.startsWith('@repo/'))workspaces.push(row);else externals.push(row);}}}
 const packages=new Set(),files=new Set(),links={};
 function recordLinks(file){
  const rel=relative(root,file).split('/');let current=root;
  for(const part of rel){current=path.join(current,part);if(!fs.existsSync(current))break;
   if(fs.lstatSync(current).isSymbolicLink()){
    const target=inside(root,current);links[relative(root,current)]=path.relative(path.dirname(current),target).split(path.sep).join('/');
   }
  }
 }
 function resolvePackage(name,req,optional=false){
  let dir;try{dir=packageRoot(root,name,req);}catch(error){if(optional&&String(error.message).startsWith('MISSING_REQUIRED_PACKAGE:'))return;throw error;}
  for(const base of req.resolve.paths(name)||[]){const alias=path.join(base,name);if(fs.existsSync(alias)&&fs.realpathSync(alias)===dir){recordLinks(alias);break;}}
  need(relative(root,dir).split('/').includes('node_modules'),'NPM_PACKAGE_OUTSIDE_NODE_MODULES:'+name);
  if(packages.has(dir))return;packages.add(dir);
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  function scan(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
   if(entry.name==='node_modules')continue;
   const file=path.join(folder,entry.name);
   if(entry.isSymbolicLink()){recordLinks(file);const target=inside(root,file);need(!fs.statSync(target).isDirectory(),'PACKAGE_INTERNAL_DIRECTORY_LINK:'+file);files.add(target);}
   else if(entry.isDirectory())scan(file);else{need(entry.isFile(),'SPECIAL_PACKAGE_FILE:'+file);need(fs.statSync(file).size<=32*1024*1024,'PACKAGE_FILE_TOO_LARGE:'+file);files.add(file);}
  }}scan(dir);
  const reqHere=createRequire(path.join(dir,'package.json')),optionalNames=new Set(Object.keys(manifest.optionalDependencies||{}));
  for(const dep of Object.keys(manifest.dependencies||{}))resolvePackage(dep,reqHere,optionalNames.has(dep));
  for(const dep of optionalNames)resolvePackage(dep,reqHere,true);
  for(const dep of Object.keys(manifest.peerDependencies||{}))resolvePackage(dep,reqHere,manifest.peerDependenciesMeta?.[dep]?.optional===true);
 }
 for(const workspace of workspaces){
  let dir;const choices=[createRequire(workspace.importer),apiRequire,rootRequire];
  for(const req of choices){try{dir=packageRoot(root,workspace.name,req);for(const base of req.resolve.paths(workspace.name)||[]){const alias=path.join(base,workspace.name);if(fs.existsSync(alias)&&fs.realpathSync(alias)===dir){recordLinks(alias);break;}}break;}catch(error){if(!String(error.message).startsWith('MISSING_REQUIRED_PACKAGE:'))throw error;}}
  need(dir,'WORKSPACE_MANIFEST_MISSING:'+workspace.name);sourceFiles.push(path.join(dir,'package.json'));
 }
 for(const file of [...sourceFiles]){let folder=path.dirname(file);while(folder===root||folder.startsWith(root+path.sep)){for(const name of ['package.json','tsconfig.json']){const candidate=path.join(folder,name);if(fs.existsSync(candidate))sourceFiles.push(inside(root,candidate));}if(folder===root)break;folder=path.dirname(folder);}}
 for(const row of externals)resolvePackage(row.name,createRequire(row.importer));
 for(const name of includeRoots){
  let selected=false;
  for(const req of [apiRequire,rootRequire]){try{packageRoot(root,name,req);resolvePackage(name,req);selected=true;break;}catch(error){if(!String(error.message).startsWith('MISSING_REQUIRED_PACKAGE:'+name))throw error;}}
  if(!selected){const store=path.join(root,'node_modules/.pnpm');const matches=fs.existsSync(store)?fs.readdirSync(store).map(label=>path.join(store,label,'node_modules',name,'package.json')).filter(file=>fs.existsSync(file)):[];need(matches.length===1,'ROOT_PACKAGE_MISSING_OR_AMBIGUOUS:'+name);resolvePackage(name,createRequire(matches[0]));}
  const selectedDirs=[...packages].filter(dir=>JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8')).name===name);need(selectedDirs.length===1,'ROOT_PACKAGE_VERSION_AMBIGUOUS:'+name);
  const alias=path.join(root,'node_modules',name),dir=selectedDirs[0];if(fs.existsSync(alias))need(fs.realpathSync(alias)===dir,'ROOT_PACKAGE_LINK_MISMATCH:'+name);
  links[relative(root,alias)]=path.relative(path.dirname(alias),dir).split(path.sep).join('/');
 }
 const sorted=set=>[...set].map(p=>relative(root,p)).sort();
 return {sourceFiles:[...new Set(sourceFiles.map(p=>relative(root,p)))].sort(),packageDirectories:sorted(packages),packageFiles:sorted(files),links:Object.fromEntries(Object.entries(links).sort(([a],[b])=>a.localeCompare(b))),dynamicBindings:bindings,scope:'selected-packages-no-nested-node_modules',writesPerformed:false};
}
module.exports={collectClosure,packageName,rejectDynamicImports};
if(require.main===module){
 const args=process.argv.slice(2),options={entryPoints:[],reviewedDynamicImports:[]};
 for(let i=0;i<args.length;i+=2){need(args[i+1],'MISSING_ARGUMENT');if(args[i]==='--root')options.root=args[i+1];else if(args[i]==='--entry')options.entryPoints.push(args[i+1]);else if(args[i]==='--reviewed-dynamic-imports')options.reviewedDynamicImports=JSON.parse(args[i+1]);else throw Error('UNKNOWN_ARGUMENT');}
 collectClosure(options).then(x=>process.stdout.write(JSON.stringify(x)+'\n')).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
}
