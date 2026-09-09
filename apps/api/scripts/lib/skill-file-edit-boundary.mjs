import ts from "typescript";
import { createHash } from "node:crypto";
export const SKILL_FILE_EDIT_PATH = "src/infrastructure/skill/pg-skill-file-edit-repository.ts";
// #3249 administrator content reads have no ACL object. Pin the reviewed SQL+arguments;
// changing queries or adding methods requires an explicit boundary review, not a silent exemption.
const QUERIES = [["c911437101c150b88400a0081abd7d91babe9e9359fd3421c1d2a918638c592f", "[input.versionId,input.skillId,input.orgId,PLATFORM_ORG_ID]"], ["ccdd205809c3ca3c9ca5d2ce00aae3edb9928c4ec76b6222a07a241b8680d374", "[version.id,version.org_id]"], ["1a6751ba70ff65d15e989d0a11b3d8d51cabe9cfb325027136238a3b25d84f8e", "[input.skillId]"], ["8fe1dc8effdd2c7e505f9c5b75a70cda737d7ff417659d57edf24fc0e82c8d72", "[input.orgId,input.skillId]"], ["11a69e387a0d4323ff3f78ab80a33cae111db54bc5fa297b2cf56038891b57e9", "[input.orgId,input.skillId]"], ["7b5f7d2b9a8bccdfdbfea66195c3b89f2d3c14e685d228ec6c418f722f2563af", "[versionId,input.orgId,input.skillId,semanticLabel,input.contentDigest,JSON.stringify(current.manifest),input.actorId,createdAt]"], ["d0af82977229d88e1c891cc8271f7f9bbf5d6245a68864d503e6f70369bfd772", "[input.orgId,versionId,file.path,Buffer.from(file.contentBase64,\"base64\"),file.mediaType,file.digest]"], ["774779d781fac81251f84ea8f13d6c1619759d782f6c51b7ccb8f90d676d9853", "[input.orgId,versionId]"]];
const digest = value => createHash("sha256").update(value.replace(/\s+/g, " ").trim()).digest("hex");
const compact = node => node?.getText().replace(/\s+/g, "");
export function checkSkillFileEditBoundary(repository, useCase) {
  const errors = [], queries = [], methods = [], tenants = [];
  const ast = ts.createSourceFile("repo.ts", repository, ts.ScriptTarget.Latest, true);
  const classes = ast.statements.filter(ts.isClassDeclaration);
  if (classes.length !== 1 || classes[0].name?.text !== "PgSkillFileEditRepository") errors.push("only reviewed repository class allowed");
  for (const member of classes.flatMap(node => [...node.members])) {
    if (!ts.isConstructorDeclaration(member) && !ts.isMethodDeclaration(member)) errors.push("unreviewed repository member kind");
    if (member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword)) errors.push("static repository access path forbidden");
  }
  function visit(node) {
    if (ts.isMethodDeclaration(node)) methods.push(node.name.getText());
    if (ts.isPropertyDeclaration(node)) errors.push("unreviewed repository field/access path");
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "query") queries.push(node);
      if (compact(node.expression) === "this.db.withTenant") tenants.push(node);
      if (compact(node.expression)?.endsWith("withoutTenant")) errors.push("unscoped access forbidden");
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (JSON.stringify(methods) !== JSON.stringify(["read", "append"])) errors.push("only reviewed read and append methods allowed");
  if (tenants.length !== 2 || tenants.some(call => compact(call.arguments[0]) !== "toOrgId(input.orgId)")) errors.push("both methods require caller tenant session");
  const actual = queries.map(call => [call.arguments[0] && ts.isStringLiteralLike(call.arguments[0]) ? digest(call.arguments[0].text) : null, compact(call.arguments[1]) ?? ""]);
  if (JSON.stringify(actual) !== JSON.stringify(QUERIES)) errors.push("reviewed tenant SQL and bound parameters changed");
  const app = ts.createSourceFile("app.ts", useCase, ts.ScriptTarget.Latest, true);
  const functions = app.statements.filter(ts.isFunctionDeclaration);
  const exported = node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
  const exportedFunctions = functions.filter(exported).map(node => node.name?.text);
  if (JSON.stringify(exportedFunctions) !== JSON.stringify(["getSkillFileSnapshot", "saveSkillFiles"])) errors.push("only reviewed exported use cases allowed");
  for (const node of app.statements) {
    if (ts.isExportAssignment(node) || (ts.isExportDeclaration(node) && !node.isTypeOnly)) errors.push("unreviewed use-case runtime re-export");
    if (!exported(node) || ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) continue;
    if (ts.isClassDeclaration(node) && node.name?.text === "SkillFileEditError") continue;
    if (ts.isVariableStatement(node) && node.declarationList.declarations.length === 1 && compact(node.declarationList.declarations[0]) === 'SKILL_FILE_EDIT_REPOSITORY=Symbol("SkillFileEditRepository")') continue;
    errors.push("unreviewed use-case runtime export");
  }
  const auth = functions.find(node => node.name?.text === "authorize");
  if (!auth || digest(auth.getText()) !== "468af92170ef84abb9561e849aa1ace6718437f14502868627a4da474e6d84dc") errors.push("identity-backed administrator authorization changed");
  for (const name of ["getSkillFileSnapshot", "saveSkillFiles"]) {
    const fn = functions.find(node => node.name?.text === name);
    if (compact(fn?.body?.statements[0]) !== "awaitauthorize(input,deps);") errors.push(`${name} must authorize before data access`);
  }
  return errors;
}
