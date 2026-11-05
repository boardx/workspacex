/** Conservative structure contract for one reviewed execution spine, not general JS analysis. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const BUILDER = 'apps/web/e2e/support/chat-refresh-production-build.ts';
const OWNED = 'apps/web/e2e/support/chat-refresh-owned-process.cjs';
const printer = ts.createPrinter({ removeComments: true });
const parse = text => ts.createSourceFile('gate.ts', text, ts.ScriptTarget.Latest, true);
const printed = (node, source) => printer.printNode(ts.EmitHint.Unspecified, node, source);
function nodes(source) {
  const out = [];
  function visit(node) { out.push(node); ts.forEachChild(node, visit); }
  visit(source); return out;
}
function expected(text) {
  const source = parse(`const contract = ${text};`);
  return printed(source.statements[0].declarationList.declarations[0].initializer, source);
}
const same = (node, text, source) => !!node && printed(node, source) === expected(text);
function declarations(source, name) {
  return nodes(source).filter(node => ts.isVariableDeclaration(node) && node.name.getText(source) === name);
}
function bound(source, name, initializer) {
  const found = declarations(source, name);
  return found.length === 1 && same(found[0].initializer, initializer, source);
}
function ordinaryParameters(node, names) {
  return node.parameters.length === names.length && node.parameters.every((parameter, index) =>
    ts.isIdentifier(parameter.name) && parameter.name.text === names[index]
    && !parameter.dotDotDotToken && !parameter.questionToken && !parameter.initializer && !parameter.modifiers?.length);
}
function isAsync(node) { return !!node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword); }
// No writes, aliases or mutation calls may bypass the fixed argv/spawn edges.
function immutableEdges(source) {
  const sensitive = /^(?:command|args|cwd|env|web|local|next|playwrightArgs|ownedProcesses|spawn)(?:\b|\.)|^process\.(?:argv|env)(?:\b|\.)/;
  for (const node of nodes(source)) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && sensitive.test(node.left.getText(source))) return false;
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node) || ts.isDeleteExpression(node))
        && sensitive.test(node.operand?.getText(source) ?? node.expression?.getText(source) ?? '')) return false;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && sensitive.test(node.expression.expression.getText(source))
        && !['resolve', 'slice', 'scenarioArguments', 'runOwned', 'claimDist', 'scopeHash', 'killRecorded', 'cleanupOwned', 'comparisonExitCode'].includes(node.expression.name.text)) return false;
  }
  return true;
}
function onlyTopLevelBindings(source, allowed) {
  return source.statements.filter(ts.isVariableStatement).every(statement =>
    statement.declarationList.declarations.every(declaration => {
      const names = ts.isIdentifier(declaration.name) ? [declaration.name.text]
        : ts.isObjectBindingPattern(declaration.name) ? declaration.name.elements.map(binding => binding.name.getText(source)) : [];
      return names.length > 0 && names.every(name => allowed.includes(name));
    }));
}
function builderSpine(source) {
  if (!immutableEdges(source) || !onlyTopLevelBindings(source, ['require','core','ownedProcesses','web','servers','server','env','dist','playwrightArgs','output','owned','directory','write','note','scope','exit','interrupted','onStop'])) return false;
  const imports = [
    "import {createRequire} from 'node:module';", "import {existsSync,mkdirSync,lstatSync,rmSync} from 'node:fs';",
    "import {resolve} from 'node:path';", "import {fileURLToPath} from 'node:url';",
    "import config from '../../playwright.chat-read.config';",
  ].map(text => { const parsed = parse(text); return printed(parsed.statements[0], parsed); });
  const actualImports = source.statements.filter(ts.isImportDeclaration).map(node => printed(node, source));
  if (JSON.stringify(actualImports) !== JSON.stringify(imports)) return false;
  const bindings = {
    require: 'createRequire(import.meta.url)', ownedProcesses: "require('./chat-refresh-owned-process.cjs')",
    web: "fileURLToPath(new URL('../../',import.meta.url))", env: 'server?.env',
    local: "createRequire(resolve(web,'package.json'))", next: "local.resolve('next/dist/bin/next')",
    playwrightArgs: 'ownedProcesses.scenarioArguments(process.argv.slice(2))',
    core: "require('./chat-refresh-diagnostic-core.cjs')",
    servers: 'Array.isArray(config.webServer)?config.webServer:[]',
    server: "servers.find(s=>s.command.includes('chat-refresh-diagnostic-server.mjs next next start'))",
    dist: 'env?.NEXT_DIST_DIR', output: 'resolve(web,dist)', owned: 'ownedProcesses.claimDist(output)',
    directory: "resolve(web,'e2e/__evidence__/chat-refresh-diagnostics')",
    write: "core.boundedWriter(resolve(directory,'production-build.jsonl'))",
    note: '(event:string,fields:object={})=>write({event,...fields})',
    scope: 'ownedProcesses.scopeHash(process.env.WORKSPACEX_ISOLATION_ID)',
    exit: "()=>ownedProcesses.killRecorded(directory,scope,'SIGKILL')",
    interrupted: 'false', onStop: '()=>{interrupted=true;}', start: 'Date.now()',
  };
  if (!Object.entries(bindings).every(([name, value]) => bound(source, name, value))) return false;

  const mains = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'main');
  if (mains.length !== 1 || !isAsync(mains[0]) || mains[0].asteriskToken || !ordinaryParameters(mains[0], [])) return false;
  const body = mains[0].body?.statements;
  if (body?.length !== 1 || !ts.isTryStatement(body[0]) || body[0].catchClause || !body[0].finallyBlock) return false;
  const statements = body[0].tryBlock.statements;
  const names = statement => ts.isVariableStatement(statement) ? statement.declarationList.declarations.map(declaration => declaration.name.getText(source)).join(',') : '';
  // Direct ordered statements: moving spawn into an uncalled function/dead branch
  // is unsupported, even if the same expression remains somewhere in the file.
  if (statements.length !== 8 || names(statements[0]) !== 'local,next' || names(statements[1]) !== 'start'
      || !ts.isExpressionStatement(statements[2]) || names(statements[3]) !== 'built'
      || !ts.isExpressionStatement(statements[4]) || !ts.isIfStatement(statements[5])
      || names(statements[6]) !== 'result' || !ts.isExpressionStatement(statements[7])) return false;
  const expressions = [
    [2, "note('build-start',{budgetMs:600000})"],
    [4, "note('build-end',{durationMs:Date.now()-start,code:built.code})"],
    [7, 'process.exitCode=ownedProcesses.comparisonExitCode(result)'],
  ];
  if (!expressions.every(([index, expression]) => same(statements[index].expression, expression, source))) return false;
  const scenario = "ownedProcesses.runOwned(process.execPath,[local.resolve('@playwright/test/cli'),'test',...playwrightArgs],{cwd:web,env:{...process.env},directory,scope,purpose:'scenarios',note,graceMs:10000})";
  if (!bound(source, 'result', `await ${scenario}`)
      || !bound(source, 'built', "await ownedProcesses.runOwned(process.execPath,[next,'build'],{cwd:web,env:{...process.env,...env},directory,scope,purpose:'build',note,budgetMs:600000})")) return false;
  const guard = parse("if(built.code!==0||built.interrupted||interrupted||!existsSync(resolve(output,'BUILD_ID'))){process.exitCode=built.code||1;return;}");
  if (printed(statements[5], source) !== printed(guard.statements[0], guard)) return false;
  const last = source.statements.at(-1);
  if (!ts.isExpressionStatement(last) || !same(last.expression, "void main().catch(()=>{note('comparison-failed');process.exitCode=1;})", source)) return false;
  // Only the existing preflight throwing guards and signal registration loop
  // may surround main; no alternate/dead top-level execution path is supported.
  return source.statements.every(statement => ts.isImportDeclaration(statement) || ts.isVariableStatement(statement)
    || statement === mains[0] || statement === last
    || (ts.isIfStatement(statement) && [
      "if(process.env.WSX_CHAT_REFRESH_PRODUCTION_WEB!=='1'||!process.env.WORKSPACEX_ISOLATION_ID)throw new Error('explicit isolated production comparison required');",
      "if(!env||!dist||!/^\\.next-chat-refresh-[a-f0-9]{16}$/.test(dist)||env.NODE_ENV!=='production')throw new Error('production build/start environment missing');",
    ].some(text => { const parsed = parse(text); return printed(statement, source) === printed(parsed.statements[0], parsed); }))
    || (ts.isForOfStatement(statement) && printed(statement, source) === printed(parse("for(const s of ['SIGTERM','SIGINT','SIGHUP','SIGQUIT'])process.on(s,onStop);").statements[0], parse("for(const s of ['SIGTERM','SIGINT','SIGHUP','SIGQUIT'])process.on(s,onStop);")))
    || (ts.isExpressionStatement(statement) && [
      'mkdirSync(directory,{recursive:true})',
      "note('comparison-start',{scopeHash:scope,ownerPid:process.pid})",
      "process.once('exit',exit)",
    ].some(expression => same(statement.expression, expression, source))));
}
// Completion is supported only through the existing no-pid error callback or
// the real child.once('close') callback. No early success or synthetic close.
function completionSpine(executor, childDeclaration, source) {
  const statements = executor.body.statements;
  // Every direct executor statement is part of this finite structure contract.
  // Extra/replaced branches, returns or alias calls are unsupported, including
  // statements that never mention resolve/child.once or a dangerous API name.
  if (statements.length !== 13) return false;
  const intermediate = [
    [3, "note('owned-start',{scopeHash:scope,ownerPid:process.pid,pid:child.pid,pgid:child.pid,purpose});"],
    [4, "if(build)for(const stream of [child.stdout,child.stderr]){let pending='';stream.on('data',chunk=>{pending+=chunk.toString();const lines=pending.split('\\n');pending=lines.pop().slice(-4096);for(const line of lines){const safe=core.safeChildLine(line);if(safe)note(safe.event,safe);}});}"],
    [5, "let interrupted=false,expired=false,escalation;"],
    [6, "const stop=()=>{if(interrupted)return;interrupted=true;note('owned-stop',{pgid:child.pid,signal:build?'SIGTERM':'SIGINT'});signal(-child.pid,build?'SIGTERM':'SIGINT');escalation=setTimeout(()=>{note('owned-kill',{pgid:child.pid});signal(-child.pid,'SIGKILL');},graceMs);};"],
    [7, "const exit=()=>signal(-child.pid,'SIGKILL');"],
    [8, "for(const s of ['SIGTERM','SIGINT','SIGHUP','SIGQUIT'])process.once(s,stop);"],
    [9, "process.once('exit',exit);"],
    [10, "const deadline=budgetMs?setTimeout(()=>{expired=true;stop();},budgetMs):undefined;"],
    [11, "child.once('error',()=>{interrupted=true;});"],
  ];
  if (!intermediate.every(([index, text]) => {
    const contract = parse(text);
    return contract.statements.length === 1 && printed(statements[index], source) === printed(contract.statements[0], contract);
  })) return false;
  const absent = statements[2];
  if (!ts.isIfStatement(absent) || !same(absent.expression, '!child.pid', source) || absent.elseStatement
      || !ts.isBlock(absent.thenStatement) || absent.thenStatement.statements.length !== 2) return false;
  const [subscribe, returned] = absent.thenStatement.statements;
  if (!ts.isExpressionStatement(subscribe) || !same(subscribe.expression, "child.once('error',()=>resolve({code:1,interrupted:false}))", source)
      || !ts.isReturnStatement(returned) || returned.expression) return false;
  const close = statements.at(-1);
  if (!ts.isExpressionStatement(close) || !ts.isCallExpression(close.expression)
      || close.expression.expression.getText(source) !== 'child.once' || close.expression.arguments.length !== 2
      || !same(close.expression.arguments[0], "'close'", source)) return false;
  const handler = close.expression.arguments[1];
  if (!ts.isArrowFunction(handler) || isAsync(handler) || !ordinaryParameters(handler, ['code']) || !ts.isBlock(handler.body)) return false;
  const expectedClose = [
    'clearTimeout(deadline)', 'clearTimeout(escalation)',
    "for(const s of ['SIGTERM','SIGINT','SIGHUP','SIGQUIT'])process.off(s,stop);",
    "process.off('exit',exit)", "signal(-child.pid,'SIGKILL')",
    "note('owned-exit',{pgid:child.pid,code,expired,interrupted})",
    'resolve({code:expired?124:code??1,interrupted})',
  ];
  if (handler.body.statements.length !== expectedClose.length || !expectedClose.every((text, index) => {
    const actual = handler.body.statements[index];
    if (index === 2) { const parsed = parse(text); return printed(actual, source) === printed(parsed.statements[0], parsed); }
    return ts.isExpressionStatement(actual) && same(actual.expression, text, source);
  })) return false;
  const errorCallback = subscribe.expression.arguments[1];
  const allowedResolve = new Set([executor.parameters[0].name, errorCallback.body.expression, handler.body.statements.at(-1).expression.expression]);
  if (nodes(executor).some(node => ts.isIdentifier(node) && node.text === 'resolve' && !allowedResolve.has(node))) return false;
  // Every child reference is either its declaration or one of the real pid,
  // streams and event subscriptions. In particular child.emit is unsupported.
  if (nodes(executor).some(node => ts.isIdentifier(node) && node.text === 'child'
      && node !== childDeclaration.declarationList.declarations[0].name
      && (!ts.isPropertyAccessExpression(node.parent) || node.parent.expression !== node
        || !['pid','stdout','stderr','once'].includes(node.parent.name.text)))) return false;
  if (nodes(executor).some(node => ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && /^child(?:\.|\[)/.test(node.left.getText(source)))) return false;
  const subscriptions = nodes(executor).filter(node => ts.isCallExpression(node) && node.expression.getText(source) === 'child.once');
  return subscriptions.length === 3 && subscriptions.includes(subscribe.expression) && subscriptions.includes(close.expression)
    && subscriptions.some(node => same(node, "child.once('error',()=>{interrupted=true;})", source));
}
function ownedSpine(source) {
  if (!immutableEdges(source) || !onlyTopLevelBindings(source, ['spawn','fs','path','crypto','core','scopeHash','valid','alive','sleep','comparisonExitCode','scenarioArguments'])) return false;
  const knownFunctions = ['signal','starts','remaining','waitGone','killRecorded','cleanupOwned','runOwned','claimDist'];
  if (!source.statements.every(statement => ts.isVariableStatement(statement)
      ? !!(statement.declarationList.flags & ts.NodeFlags.Const) && statement.declarationList.declarations.every(declaration =>
        !!declaration.initializer && (ts.isArrowFunction(declaration.initializer) || (ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(source) === 'require')))
      : ts.isFunctionDeclaration(statement) ? knownFunctions.includes(statement.name?.text)
      : ts.isIfStatement(statement) ? same(statement.expression, 'require.main===module', source) && !statement.elseStatement
      : ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)
        && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && same(statement.expression.left, 'module.exports', source))) return false;
  if (nodes(source).some(node => ts.isCallExpression(node) && node.expression.getText(source) === 'process.exit')) return false;
  for (const [name, module] of Object.entries({fs:'node:fs',path:'node:path',crypto:'node:crypto',core:'./chat-refresh-diagnostic-core.cjs'})) {
    if (!bound(source, name, `require('${module}')`)) return false;
  }
  if (!bound(source, 'scopeHash', "id=>crypto.createHash('sha256').update(id).digest('hex')")) return false;
  const runs = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'runOwned');
  if (runs.length !== 1 || !isAsync(runs[0]) || runs[0].asteriskToken || !ordinaryParameters(runs[0], ['command','args','options'])) return false;
  const body = runs[0].body?.statements;
  if (body?.length !== 2 || !ts.isVariableStatement(body[0]) || !ts.isReturnStatement(body[1])) return false;
  const binding = parse('const {cwd,env,directory,scope,purpose,note,budgetMs,graceMs=3000}=options;');
  if (printed(body[0], source) !== printed(binding.statements[0], binding)) return false;
  const promise = body[1].expression;
  if (!ts.isNewExpression(promise) || promise.expression.getText(source) !== 'Promise' || promise.arguments?.length !== 1) return false;
  const callback = promise.arguments[0];
  if (!ts.isArrowFunction(callback) || isAsync(callback) || !ts.isBlock(callback.body)
      || !ordinaryParameters(callback, ['resolve'])) return false;
  const first = callback.body.statements[0];
  if (!ts.isVariableStatement(first) || first.declarationList.declarations.length !== 1
      || first.declarationList.declarations[0].name.getText(source) !== 'build'
      || !same(first.declarationList.declarations[0].initializer, "purpose==='build'", source)) return false;
  const child = callback.body.statements[1];
  if (!ts.isVariableStatement(child) || child.declarationList.declarations.length !== 1 || child.declarationList.declarations[0].name.getText(source) !== 'child') return false;
  if (!same(child.declarationList.declarations[0].initializer, "spawn(command,args,{cwd,env,detached:true,stdio:build?['ignore','pipe','pipe']:'inherit'})", source)) return false;
  if (!completionSpine(callback, child, source)) return false;
  if (!nodes(source).some(node => ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)
      && node.name.elements.length === 1 && node.name.elements[0].name.getText(source) === 'spawn'
      && same(node.initializer, "require('node:child_process')", source))) return false;
  const spawnBindings = nodes(source).filter(node => ts.isBindingElement(node) && node.name.getText(source) === 'spawn');
  if (spawnBindings.length !== 1 || spawnBindings[0].parent.parent.parent.parent.parent !== source) return false;
  const importContract = parse("const {spawn}=require('node:child_process');");
  if (printed(spawnBindings[0].parent.parent.parent.parent, source)
      !== printed(importContract.statements[0], importContract)) return false;
  // No local spawn or Promise binding may shadow the real child-process import
  // or the Promise constructor. The sole spawn binding is the top-level import.
  if (nodes(source).some(node => {
    const name = (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isBindingElement(node)) ? node.name : undefined;
    return name && ts.isIdentifier(name) && ['spawn','Promise'].includes(name.text) && node !== spawnBindings[0];
  })) return false;
  if (!bound(source, 'scenarioArguments', "argv=>{if(!Array.isArray(argv)||!argv.length||argv.some(a=>typeof a!=='string'))throw Error('explicit original Playwright arguments required');return [...argv];}")) return false;
  const exports = source.statements.filter(node => ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)
    && same(node.expression.left, 'module.exports', source));
  if (exports.length !== 1 || !ts.isObjectLiteralExpression(exports[0].expression.right)) return false;
  // The require result is this one object, without later writes, spreads,
  // accessors or duplicate keys that can replace the reviewed runOwned edge.
  if (nodes(source).filter(node => ts.isPropertyAccessExpression(node)
      && same(node, 'module.exports', source)).length !== 1) return false;
  const properties = exports[0].expression.right.properties;
  if (!properties.every(ts.isShorthandPropertyAssignment)) return false;
  const names = properties.map(property => property.name.text);
  return new Set(names).size === names.length && ['scenarioArguments','runOwned'].every(name => names.includes(name));
}
export function chatProductionTransparent(root) {
  if (![BUILDER, OWNED].every(file => existsSync(path.join(root, file)))) return false;
  const source = parse(readFileSync(path.join(root, BUILDER), 'utf8'));
  const helper = parse(readFileSync(path.join(root, OWNED), 'utf8'));
  return !source.parseDiagnostics.length && !helper.parseDiagnostics.length && builderSpine(source) && ownedSpine(helper);
}
export function chatProductionInvocations(text, root) {
  if (!text.includes(BUILDER)) return [];
  // A finite whole-run-block grammar, not a search for a command inside Bash.
  // Only a standalone invocation or the actual five unconditional producer
  // statements are supported. Unknown lines/control flow/heredocs fail closed.
  const lines = text.trim().split('\n').map(line => line.trim());
  const prefix = [
    'mkdir -p "$RUNNER_TEMP/shard"', 'set -o pipefail',
    'mkdir -p phases/phase-01-run-a-project/evidence/ci',
  ];
  let invocation;
  if (lines.length === 1) invocation = lines[0];
  else if (lines.length === 5 && prefix.every((line, index) => lines[index] === line)
      && lines[4] === 'node .harness/scripts/ci-chat-shards.mjs --record ${{ matrix.shard }}') invocation = lines[3];
  else return [];
  const suffix = ' 2> "$RUNNER_TEMP/shard/server.log" | tee phases/phase-01-run-a-project/evidence/ci/chat-read.log "$RUNNER_TEMP/shard/chat-read.log"';
  if (lines.length === 5 && !invocation.endsWith(suffix)) return [];
  if (invocation.endsWith(suffix)) invocation = invocation.slice(0, -suffix.length);
  const entry = /^(?:pnpm[ \t]+exec[ \t]+tsx[ \t]+\.harness\/scripts\/with-test-isolation\.ts[ \t]+--[ \t]+)?pnpm[ \t]+exec[ \t]+tsx[ \t]+apps\/web\/e2e\/support\/chat-refresh-production-build\.ts(?=[ \t]|$)([^\n]*)$/;
  const match = entry.exec(invocation);
  if (!match || !chatProductionTransparent(root)) return [];
  const forwarded = match[1].trimEnd();
  const tokens = forwarded.replace(/\$\{\{[^}]+\}\}/g, 'matrix').trim().split(/\s+/).filter(Boolean);
  const allowed = new Set(['--config','--project','--max-failures','--shard','--reporter','--workers','--timeout']);
  if (!tokens.length) return [];
  for (let i = 0; i < tokens.length; i++) {
    const [flag, ...value] = tokens[i].split('=');
    if (!allowed.has(flag)) return [];
    const argument = value.length ? value.join('=') : tokens[++i];
    if (!argument || !/^[A-Za-z0-9_./:-]+$/.test(argument)) return [];
  }
  return [`pnpm --filter web exec playwright test${forwarded}`];
}
