import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {join,dirname,relative,resolve} from 'node:path';
import {createRequire} from 'node:module';
const fileCandidate=path=>[path,...['.ts','.tsx','.mjs','.js','.json'].map(extension=>path+extension),...['index.ts','index.tsx','index.mjs','index.js'].map(name=>join(path,name))].find(candidate=>existsSync(candidate)&&statSync(candidate).isFile());
export function assertRequiredRuntimeSourceHashes(manifest,requiredSourceFiles){
 assert(requiredSourceFiles.length>0);
 for(const path of requiredSourceFiles)assert(/^[0-9a-f]{64}$/.test(manifest.sourceHashes?.[path]??''),`runtime manifest lacks required closure hash ${path}`);
}
export function collectStickyRuntimeClosure(root,seeds){
 const ts=createRequire(join(root,'package.json'))('typescript'),packages=new Map(),found=new Set(),pending=[...seeds];
 for(const directory of readdirSync(join(root,'packages'))){
  const path=join(root,'packages',directory,'package.json');if(!existsSync(path))continue;
  const metadata=JSON.parse(readFileSync(path,'utf8'));packages.set(metadata.name,{directory:join(root,'packages',directory),metadata});
 }
 const localImport=(specifier,importer)=>{
  if(specifier.startsWith('.'))return fileCandidate(resolve(dirname(importer),specifier));
  if(specifier.startsWith('@/'))return fileCandidate(join(root,'apps/web',specifier.slice(2)));
  if(specifier.startsWith('@repo/')){
   const [scope,name,...rest]=specifier.split('/'),pkg=packages.get(`${scope}/${name}`);assert(pkg,`workspace package ${specifier} missing`);
   pending.push(relative(root,join(pkg.directory,'package.json')));
   const subpath=rest.length?`./${rest.join('/')}`:'.',exports=pkg.metadata.exports;
   const target=value=>typeof value==='string'?value:value&&typeof value==='object'?target(value.import??value.default??value.browser):undefined;
   let exported=target(exports?.[subpath]??(subpath==='.'?exports:undefined));
   if(!exported&&rest.length)for(const[key,value]of Object.entries(exports??{}))if(key.includes('*')){
    const[prefix,suffix]=key.split('*');if(subpath.startsWith(prefix)&&subpath.endsWith(suffix)){const pattern=target(value);if(pattern)exported=pattern.replace('*',subpath.slice(prefix.length,suffix.length?-suffix.length:undefined));}
   }
   const source=(exported?fileCandidate(join(pkg.directory,exported)):undefined)??fileCandidate(join(pkg.directory,'src',rest.length?rest.join('/'):'index'));assert(source,`workspace source ${specifier} missing`);return source;
  }return undefined;
 };
 while(pending.length){
  const path=pending.pop();if(found.has(path))continue;const absolute=join(root,path);assert(existsSync(absolute),`required source ${path} missing`);found.add(path);
  if(!/\.(?:[cm]?[jt]sx?)$/.test(path))continue;
  // The shared API main entry is an artifact identity signal; bounded route seeds
  // represent this board lane rather than importing every unrelated API domain.
  if(path==='apps/api/src/main.ts')continue;
  const ast=ts.createSourceFile(absolute,readFileSync(absolute,'utf8'),ts.ScriptTarget.Latest,true),specifiers=[];
  const visit=node=>{
   if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteralLike(node.moduleSpecifier))specifiers.push(node.moduleSpecifier.text);
   if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments.length===1&&ts.isStringLiteralLike(node.arguments[0]))specifiers.push(node.arguments[0].text);
   ts.forEachChild(node,visit);
  };visit(ast);
  for(const specifier of specifiers){
   const dependency=localImport(specifier,absolute);
   if(specifier.startsWith('.')||specifier.startsWith('@/')||specifier.startsWith('@repo/'))assert(dependency,`unresolved local import ${specifier} in ${path}`);
   if(dependency){const dependencyPath=relative(root,dependency);assert(!dependencyPath.startsWith('..'));pending.push(dependencyPath);}
  }
 }
 return Array.from(found).sort();
}
