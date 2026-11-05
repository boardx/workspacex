/** Static reachability for the one owned, transparent production chat runner. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const BUILDER = 'apps/web/e2e/support/chat-refresh-production-build.ts';
const OWNED = 'apps/web/e2e/support/chat-refresh-owned-process.cjs';
const printer = ts.createPrinter({ removeComments: true });
function parse(text) { return ts.createSourceFile('gate.ts', text, ts.ScriptTarget.Latest, true); }
function canonical(node, source) { return printer.printNode(ts.EmitHint.Unspecified, node, source); }
function expression(text) {
  const source = parse(`const expected = ${text};`);
  return canonical(source.statements[0].declarationList.declarations[0].initializer, source);
}
function descendants(source) {
  const nodes = [];
  function visit(node) { nodes.push(node); ts.forEachChild(node, visit); }
  visit(source);
  return nodes;
}

export function chatProductionTransparent(root) {
  if (![BUILDER, OWNED].every(file => existsSync(path.join(root, file)))) return false;
  const source = parse(readFileSync(path.join(root, BUILDER), 'utf8'));
  const nodes = descendants(source);
  const declaration = (name, value) => {
    const found = nodes.filter(node => ts.isVariableDeclaration(node) && node.name.getText(source) === name);
    return found.length === 1 && found[0].initializer
      && canonical(found[0].initializer, source) === expression(value);
  };
  // These are execution edges, not filename mentions. Reject changes to cwd,
  // argv construction, the imported helper, or the final Playwright spawn.
  if (!declaration('require', 'createRequire(import.meta.url)')
      || !declaration('ownedProcesses', "require('./chat-refresh-owned-process.cjs')")
      || !declaration('web', "fileURLToPath(new URL('../../',import.meta.url))")
      || !declaration('local', "createRequire(resolve(web,'package.json'))")
      || !declaration('playwrightArgs', 'ownedProcesses.scenarioArguments(process.argv.slice(2))')) return false;
  if (nodes.filter(node => ts.isIdentifier(node) && node.text === 'playwrightArgs').length !== 2) return false;
  const spawn = expression("ownedProcesses.runOwned(process.execPath,[local.resolve('@playwright/test/cli'),'test',...playwrightArgs],{cwd:web,env:{...process.env},directory,scope,purpose:'scenarios',note,graceMs:10000})");
  if (nodes.filter(node => ts.isCallExpression(node) && canonical(node, source) === spawn).length !== 1) return false;

  const helper = parse(readFileSync(path.join(root, OWNED), 'utf8'));
  const helperNodes = descendants(helper);
  const args = helperNodes.filter(node => ts.isVariableDeclaration(node) && node.name.getText(helper) === 'scenarioArguments');
  const clone = expression("argv=>{if(!Array.isArray(argv)||!argv.length||argv.some(a=>typeof a!=='string'))throw Error('explicit original Playwright arguments required');return [...argv];}");
  const exported = expression('module.exports');
  const runs = helperNodes.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'runOwned');
  if (runs.length !== 1 || runs[0].parameters.map(parameter => parameter.name.getText(helper)).join(',') !== 'command,args,options') return false;
  const runNodes = descendants(runs[0]);
  if (runNodes.filter(node => ts.isIdentifier(node) && node.text === 'args').length !== 2) return false;
  const childSpawn = expression("spawn(command,args,{cwd,env,detached:true,stdio:build?['ignore','pipe','pipe']:'inherit'})");
  if (runNodes.filter(node => ts.isCallExpression(node) && canonical(node, helper) === childSpawn).length !== 1) return false;
  if (!helperNodes.some(node => ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)
      && node.name.elements.length === 1 && node.name.elements[0].name.getText(helper) === 'spawn'
      && node.initializer && canonical(node.initializer, helper) === expression("require('node:child_process')"))) return false;
  return args.length === 1 && args[0].initializer && canonical(args[0].initializer, helper) === clone
    && helperNodes.some(node => ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && canonical(node.left, helper) === exported && ts.isObjectLiteralExpression(node.right)
      && ['scenarioArguments', 'runOwned'].every(name => node.right.properties.some(property => ts.isShorthandPropertyAssignment(property) && property.name.text === name)));
}

// A deliberately narrow shell subset: the standard producer has no filename or
// grep selectors. Unknown/quoted selectors fail closed instead of claiming the
// whole config is covered. Matrix shard expressions select the complete union;
// they are not passed to Playwright --list as a single symbolic shard.
export function chatProductionInvocations(text, root) {
  if (!text.includes(BUILDER)) return [];
  if (!chatProductionTransparent(root)) return [];
  const result = [];
  const entry = /(?:^|\s)pnpm\s+exec\s+tsx\s+apps\/web\/e2e\/support\/chat-refresh-production-build\.ts(?=\s|$)([^\n|;&]*)/g;
  for (const match of text.matchAll(entry)) {
    const forwarded = match[1].trimEnd().replace(/\s+2>\s+"[^"\n]+"$/, '');
    const args = forwarded.replace(/\$\{\{[^}]+\}\}/g, 'matrix');
    const tokens = args.trim().split(/\s+/).filter(Boolean);
    const allowed = new Set(['--config', '--project', '--max-failures', '--shard', '--reporter', '--workers', '--timeout']);
    let valid = tokens.length > 0;
    for (let i = 0; i < tokens.length && valid; i++) {
      const [flag, ...value] = tokens[i].split('=');
      if (!allowed.has(flag)) { valid = false; break; }
      const argument = value.length ? value.join('=') : tokens[++i];
      if (!argument || !/^[A-Za-z0-9_./:-]+$/.test(argument)) valid = false;
    }
    if (valid) result.push(`pnpm --filter web exec playwright test${forwarded}`);
  }
  return result;
}
