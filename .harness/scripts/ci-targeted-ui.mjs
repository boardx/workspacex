/** Narrow opt-in UI selection. Unknown changes always keep full regression. */
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,realpathSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);let ts;
const root=resolve(import.meta.dirname,'../..');
export const policy=JSON.parse(readFileSync(new URL('../config/ci-targeted-ui.json',import.meta.url),'utf8'));
const hash=x=>createHash('sha256').update(x).digest('hex');
const forbidden=new Set(['window','document','globalThis','global','fetch','process','require','eval','Function','XMLHttpRequest','WebSocket','navigator','location']);
const allowedCalls=new Set(['cn','onUseTemplate','TASK_WORKBENCH_TEMPLATES.map']);
function comments(text){
 const scanner=ts.createScanner(ts.ScriptTarget.Latest,false,ts.LanguageVariant.Standard,text),out=[];
 for(let k=scanner.scan();k!==ts.SyntaxKind.EndOfFileToken;k=scanner.scan())if([ts.SyntaxKind.SingleLineCommentTrivia,ts.SyntaxKind.MultiLineCommentTrivia].includes(k))out.push(scanner.getTokenText());
 return out;
}
function structure(text,allowedImports){
 ts??=require('typescript');
 const source=ts.createSourceFile('ui.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 if(source.parseDiagnostics.length)return null;
 const imports=[],api=[],tags=new Set(),attrs=new Set(),names=new Set();let safe=true;
 for(const node of source.statements){
  if(ts.isImportDeclaration(node)){
   const module=node.moduleSpecifier.text,clause=node.importClause?.getText(source).replace(/\s/g,'');
   if(typeof module!=='string'||allowedImports[module]?.replace(/\s/g,'')!==clause)safe=false;
   imports.push([module,clause]);
  }
  if(ts.getModifiers(node)?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)){
   if(ts.isFunctionDeclaration(node))api.push(['function',node.name?.text,node.typeParameters?.map(x=>x.getText(source)),node.parameters.map(x=>x.getText(source)),node.type?.getText(source)]);
   else if(ts.isVariableStatement(node))api.push(['variable',node.declarationList.declarations.map(x=>[x.name.getText(source),x.type?.getText(source)])]);
   else if(ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node))api.push(node.getText(source));
   else safe=false;
  }
 }
 function visit(node){
  if(ts.isIdentifier(node)){names.add(node.text);if(forbidden.has(node.text))safe=false;}
  if(ts.isCallExpression(node)&&!allowedCalls.has(node.expression.getText(source)))safe=false;
  if(ts.isNewExpression(node)||ts.isJsxSpreadAttribute(node))safe=false;
  if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))tags.add(node.tagName.getText(source));
  if(ts.isJsxAttribute(node))attrs.add(node.name.getText(source));
  ts.forEachChild(node,visit);
 }
 visit(source);return {safe,imports,api,tags,attrs,names};
}
// Compare every syntax node. Only JSX copy and existing literal class values are variable.
// New executable syntax (including tagged templates), directives, callbacks and data wiring
// must retain the original tree and text, otherwise the full regression path is selected.
function presentationTree(text){
 const source=ts.createSourceFile('ui.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function fingerprint(node){
  if(ts.isJsxText(node))return [node.kind,'copy'];
  if(ts.isStringLiteral(node)){
   const parent=node.parent;
   const attribute=ts.isJsxAttribute(parent)&&['className','title','aria-label'].includes(parent.name.getText(source));
   const classes=ts.isCallExpression(parent)&&parent.expression.getText(source)==='cn'&&ts.isJsxExpression(parent.parent)&&ts.isJsxAttribute(parent.parent.parent)&&parent.parent.parent.name.getText(source)==='className';
   if(attribute||classes){
    if((classes||parent.name.getText(source)==='className')&&/[\\()@]|https?:|url|javascript|data:/i.test(node.text))return [node.kind,node.text];
    return [node.kind,classes||parent.name.getText(source)==='className'?'classes':'copy'];
   }
  }
  const children=node.getChildren(source);
  return children.length?[node.kind,children.map(fingerprint)]:[node.kind,node.getText(source)];
 }
 return fingerprint(source);
}
export function inspectUiBoundary(before,after,allowedImports=policy.imports){
 const a=structure(before,allowedImports),b=structure(after,allowedImports);
 return !!a?.safe&&!!b?.safe&&JSON.stringify(presentationTree(before))===JSON.stringify(presentationTree(after))&&a.imports.length===Object.keys(allowedImports).length&&JSON.stringify(a.imports)===JSON.stringify(b.imports)&&JSON.stringify(a.api)===JSON.stringify(b.api)&&[...b.tags].every(x=>a.tags.has(x))&&[...b.attrs].every(x=>a.attrs.has(x))&&[...b.names].every(x=>a.names.has(x));
}
// Existing localized components already contain hooks and runtime calls. Keeping
// the complete syntax tree identical (apart from display text/classes) preserves
// those edges without maintaining a second list of every existing call/import.
export function inspectPresentationBoundary(before,after){
 ts??=require('typescript');
 if(JSON.stringify(comments(before))!==JSON.stringify(comments(after)))return false;
 for(const text of [before,after])if(ts.createSourceFile('ui.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX).parseDiagnostics.length)return false;
 return JSON.stringify(presentationTree(before))===JSON.stringify(presentationTree(after));
}
// No module evaluation: only existing top-level dictionary string values may vary.
// Imported labels and other existing expressions retain their complete syntax tree.
export function inspectMessageBoundary(before,after,allowedKeys){
 ts??=require('typescript');
 if(JSON.stringify(comments(before))!==JSON.stringify(comments(after)))return false;
 let safe=true;const values=[];
 function topLevelDictionary(object){
  let node=object;
  while(ts.isAsExpression(node.parent)||ts.isSatisfiesExpression(node.parent)||ts.isParenthesizedExpression(node.parent)||ts.isTypeAssertionExpression(node.parent))node=node.parent;
  const declaration=node.parent;
  return ts.isVariableDeclaration(declaration)&&declaration.initializer===node&&ts.isVariableDeclarationList(declaration.parent)&&ts.isVariableStatement(declaration.parent.parent)&&ts.isSourceFile(declaration.parent.parent.parent);
 }
 const tree=text=>{
  const source=ts.createSourceFile('messages.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  if(source.parseDiagnostics.length)safe=false;
  function fingerprint(n){
   if(ts.isStringLiteral(n)&&ts.isPropertyAssignment(n.parent)&&!ts.isComputedPropertyName(n.parent.name)&&n.parent.initializer===n&&ts.isObjectLiteralExpression(n.parent.parent)&&topLevelDictionary(n.parent.parent)){
    values.push({key:n.parent.name.text,value:n.text});return [n.kind,'message',n.text.match(/\{\w+\}/g)?.sort()??[]];
   }
   const children=n.getChildren(source);return children.length?[n.kind,children.map(fingerprint)]:[n.kind,n.getText(source)];
  }
  return fingerprint(source);
 };
 const a=tree(before),old=values.splice(0),b=tree(after);
 if(!old.length||old.length!==values.length)return false;
 const permitted=key=>!allowedKeys||(Array.isArray(allowedKeys)?allowedKeys.includes(key):allowedKeys.prefixes?.some(prefix=>key.startsWith(prefix)));
 for(let i=0;i<old.length;i++)if(old[i].value!==values[i].value&&(!permitted(old[i].key)||/[<>\u0000-\u001f]|(?:https?:|javascript:|data:|^\/|\/\/)/i.test(values[i].value)))safe=false;
 return safe&&JSON.stringify(a)===JSON.stringify(b);
}
const companion=path=>/^docs\/(?:design|superpowers\/(?:plans|specs))\/[a-zA-Z0-9_./-]+\.md$/.test(path)||/^evidence\/[a-zA-Z0-9_./-]+\.(?:md|log|png|json)$/.test(path);
function checkPolicy(p){
 if(!p.imports||typeof p.imports!=='object'||Object.values(p.imports).some(x=>typeof x!=='string')||p.schemaVersion!==1||typeof p.enabled!=='boolean'||typeof p.sourceFile!=='string'||!p.sourceFile.startsWith('apps/web/components/')||!p.sourceFile.endsWith('.tsx'))throw Error('UNKNOWN_POLICY');
 const paths=[p.sourceFile,...(p.unitTests??[]),...(p.browserTests??[])];
 if(!p.unitTests?.length||!p.browserTests?.length||new Set(paths).size!==paths.length||paths.some(x=>typeof x!=='string'||x.startsWith('/')||x.split('/').includes('..'))||p.unitTests.some(x=>!/^tests\/.+\.test\.tsx?$/.test(x))||p.browserTests.some(x=>!/^e2e\/.+\.spec\.ts$/.test(x)))throw Error('UNKNOWN_POLICY');
}
export function planTargeted({baseSha,headSha,enabled=policy.enabled,policyInput=policy,preflight=false,git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024})}){
 const common={schemaVersion:1,baseSha:baseSha??null,headSha:headSha??null,policyDigest:hash(JSON.stringify(policyInput))};
 const finish=(mode,reason,suites)=>{const plan={...common,mode,reason,suites};return {...plan,planDigest:hash(JSON.stringify(plan))}};
 const full=reason=>finish('full',reason,[{id:'full-regression'}]);
 try{
  checkPolicy(policyInput);
  if(!enabled)return full('rollout-disabled');
  if(![baseSha,headSha].every(x=>/^[a-f0-9]{40}$/.test(x??'')&&!/^0+$/.test(x)))return full('explicit-history-required');
  for(const sha of [baseSha,headSha])git(['cat-file','-e',`${sha}^{commit}`]);
  git(['merge-base','--is-ancestor',baseSha,headSha]);
  const paths=git(['diff','--no-renames','--name-status','-z',baseSha,headSha]).split('\0').filter(Boolean);
  if(paths.length%2)return full('outside-reviewed-input-boundary');
  const entries=[];for(let i=0;i<paths.length;i+=2)entries.push({status:paths[i],path:paths[i+1]});
  const registered=policyInput.messageFiles??[];
  const validMessageKeys=x=>Array.isArray(x.messageKeys)&&x.messageKeys.length>0&&x.messageKeys.every(k=>typeof k==='string')&&!x.messagePrefixes||Array.isArray(x.messagePrefixes)&&x.messagePrefixes.length>0&&x.messagePrefixes.every(k=>typeof k==='string'&&/^[a-z][a-zA-Z0-9]*\.$/.test(k))&&!x.messageKeys;
  if(!Array.isArray(registered)||new Set(registered.map(x=>x.file)).size!==registered.length||registered.some(x=>!/^apps\/web\/lib\/i18n\/(?:messages\/(?:en|zh-CN)|namespaces\/[a-z0-9-]+)\.ts$/.test(x.file)||!['playwright.organization-create.config.ts','playwright.fullstack-smoke.config.ts'].includes(x.browserConfig)||!validMessageKeys(x)||!Array.isArray(x.unitTests)||!x.unitTests.length||!Array.isArray(x.browserTests)||!x.browserTests.length||x.unitTests.some(f=>!/^tests\/.+\.test\.tsx?$/.test(f)||f.split('/').includes('..'))||x.browserTests.some(f=>!/^e2e\/.+\.spec\.ts$/.test(f)||f.split('/').includes('..'))))return full('unknown-message-policy');
  const presentations=policyInput.presentationFiles??[];
  if(!Array.isArray(presentations)||new Set([...registered,...presentations].map(x=>x.file)).size!==registered.length+presentations.length||presentations.some(x=>!/^apps\/web\/components\/project\/[a-z0-9-]+\.tsx$/.test(x.file)||x.browserConfig!=='playwright.fullstack-smoke.config.ts'||!Array.isArray(x.unitTests)||!x.unitTests.length||!Array.isArray(x.browserTests)||!x.browserTests.length||x.unitTests.some(f=>!/^tests\/.+\.test\.tsx?$/.test(f)||f.split('/').includes('..'))||x.browserTests.some(f=>!/^e2e\/.+\.spec\.ts$/.test(f)||f.split('/').includes('..'))))return full('unknown-presentation-policy');
  const registrations=[...registered,...presentations];
  const sources=entries.filter(x=>x.path===policyInput.sourceFile||registrations.some(r=>r.file===x.path));
  if(!sources.length||sources.some(x=>x.status!=='M')||entries.some(x=>!sources.includes(x)&&(!['M','A'].includes(x.status)||!companion(x.path)||x.path.split('/').includes('..'))))return full('outside-reviewed-input-boundary');
  // Multiple independent locale edits can share one candidate. Runtime component
  // changes never acquire a lighter route merely by being mixed with translations.
  if(sources.length>1&&sources.some(x=>x.path===policyInput.sourceFile))return full('mixed-runtime-and-message-change');
  if(entries.length>17)return full('too-many-companion-files');
  const selections=sources.map(x=>registrations.find(r=>r.file===x.path)).filter(Boolean);
  if(new Set(selections.map(x=>x.browserConfig)).size>1)return full('mixed-browser-environments');
  const selected=selections[0];
  const sourceFile=sources[0].path;
  const read=(sha,path)=>{
   const tree=git(['ls-tree','-z',sha,'--',path]);
   if(!tree.startsWith('100644 blob ')||!tree.endsWith(`\t${path}\0`))throw Error('NON_REGULAR_INPUT');
   return git(['show',`${sha}:${path}`]);
  };
  for(const entry of entries){read(headSha,entry.path);if(entry.status==='M')read(baseSha,entry.path);}
  if(preflight){read(baseSha,sourceFile);read(headSha,sourceFile);return finish('candidate-ui','requires-runtime-boundary-inspection',[]);}
  if(!(selected?sources.every(x=>{const r=registrations.find(r=>r.file===x.path);return presentations.includes(r)?inspectPresentationBoundary(read(baseSha,x.path),read(headSha,x.path)):inspectMessageBoundary(read(baseSha,x.path),read(headSha,x.path),r.messageKeys??{prefixes:r.messagePrefixes});}):inspectUiBoundary(read(baseSha,sourceFile),read(headSha,sourceFile),policyInput.imports)))return full('runtime-or-public-boundary-changed');
  const suite=(id,files)=>({id,files:files.map(file=>({file,sha256:hash(read(headSha,`apps/web/${file}`))}))});
  const unique=items=>[...new Set(items)];
  const plan=finish('targeted-ui','reviewed-local-ui-change',[suite('web-unit',selected?unique(selections.flatMap(x=>x.unitTests)):policyInput.unitTests),suite('chat-ui',selected?unique(selections.flatMap(x=>x.browserTests)):policyInput.browserTests)]);
  if(selected){const {planDigest,...body}=plan;body.browserConfig={file:selected.browserConfig,sha256:hash(read(headSha,`apps/web/${selected.browserConfig}`))};return {...body,planDigest:hash(JSON.stringify(body))};}
  return plan;
 }catch{return full('unavailable-or-unrecognized-input');}
}
export function verifyTargetedPlan(plan,options){
 if(!options||!options.baseSha||!options.headSha||plan?.mode!=='targeted-ui')throw Error('TARGETED_PLAN_REQUIRED');
 const expected=planTargeted(options);
 if(expected.mode!=='targeted-ui'||JSON.stringify(plan)!==JSON.stringify(expected))throw Error('TARGETED_PLAN_MISMATCH');
 return true;
}
if(process.argv[1]&&existsSync(resolve(process.argv[1]))&&import.meta.url===pathToFileURL(realpathSync(resolve(process.argv[1]))).href){
 if(!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA??'')||/^0+$/.test(process.env.GITHUB_SHA??''))throw Error('SOURCE_SHA_REQUIRED');
 const preflight=process.argv[2]==='--preflight',forceFull=process.argv[2]==='--full';
 const plan=planTargeted({baseSha:process.env.CI_SCOPE_BASE_SHA,headSha:process.env.GITHUB_SHA,enabled:forceFull?false:policy.enabled,preflight});
 if(preflight){const candidate=plan.mode==='candidate-ui';if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`candidate=${candidate}\n`);console.log(JSON.stringify({candidate}));process.exit(0);}
 const output=forceFull?undefined:process.argv[2];if(output){mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(plan,null,2));}
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`mode=${plan.mode}\nplan_digest=${plan.planDigest}\n`);
 console.log(JSON.stringify(plan,null,2));
}
