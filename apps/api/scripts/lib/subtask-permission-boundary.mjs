import ts from "typescript";

/** Exact WX-T042 exception checks, executed by permission lint, not a generic bypass. */
export function checkSubtaskPermissionBoundary(path, source, controller, authorization) {
  const errors = [];
  const executor = path.endsWith("subtask-run-executor.ts");
  const allowed = new Set(executor ? ["agent_runs", "agent_versions"] : ["subtask_runs"]);
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const refs = /\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi;
  let statements = 0;
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.name.text === "withoutTenant") errors.push("withoutTenant is forbidden");
      if (node.expression.name.text === "query") {
        statements++;
        const sql = node.arguments[0];
        if (!sql || !ts.isStringLiteralLike(sql)) errors.push("SQL must be a static literal");
        else {
          for (const match of sql.text.replace(/\bFOR\s+UPDATE\s+SKIP\s+LOCKED\b/gi, "").matchAll(refs)) {
            if (!allowed.has(match[1])) errors.push(`unexpected table ${match[1]}`);
          }
          if (!/\bINSERT\s+INTO\b/i.test(sql.text) && !/\b(?:r\.)?org_id\s*=\s*\$1\b/i.test(sql.text)) {
            errors.push("SQL lacks explicit tenant predicate");
          }
          if (/\bINSERT\s+INTO\b/i.test(sql.text) && !/\borg_id\b/.test(sql.text)) errors.push("INSERT lacks tenant column");
          if (executor && !/v\.id\s*=\s*r\.agent_version_id\s+AND\s+v\.org_id\s*=\s*r\.org_id/i.test(sql.text)) {
            errors.push("parent version join must be pinned and tenant-matched");
          }
        }
        let ancestor = node.parent;
        let tenantBound = false;
        while (ancestor) {
          if (ts.isCallExpression(ancestor) && ts.isPropertyAccessExpression(ancestor.expression)
            && ancestor.expression.getText(ast) === "this.db.withTenant"
            && ancestor.arguments[0]?.getText(ast) === "orgId") tenantBound = true;
          ancestor = ancestor.parent;
        }
        if (!tenantBound) errors.push("query is outside withTenant(orgId)");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!statements) errors.push("expected SQL statements were not inspected");
  if (executor) {
    if (!/executionMode:\s*["']text-only["']/.test(source)) errors.push("text-only execution required");
    if (/\bthreadId\s*:/.test(source)) errors.push("parent remote thread must not be inherited");
  }
  const controllerAst = ts.createSourceFile("controller.ts", controller, ts.ScriptTarget.Latest, true);
  const methods = new Map();
  const collect = node => {
    if (ts.isMethodDeclaration(node) && node.body) methods.set(node.name.getText(controllerAst),node.body.getText(controllerAst));
    ts.forEachChild(node,collect);
  };
  collect(controllerAst);
  for (const [name, read, write] of [["listByParentRun","this.store.listByParentRun",false],["retry","this.store.get",true]]) {
    const body = methods.get(name) ?? "";
    const compact = body.replace(/\s/g, "");
    const auth = compact.indexOf(`awaitthis.authorizeParent(principal,runId,${write});`);
    const disclosure = compact.indexOf(read);
    if (auth < 0 || disclosure < auth) errors.push(`${name} must authorize parent before reading rows`);
  }
  const authBody = methods.get("authorizeParent") ?? "";
  if (!/await\s+authorizeSubtaskParent\(/.test(authBody) || !/throw new ServiceUnavailableException/.test(authBody)) {
    errors.push("controller authorization must fail closed and call the shared parent boundary");
  }
  if (!/await\s+resolveVisibility\(/.test(authorization)
    || !/outcome\.kind\s*!==\s*["']allow["']\)\s*throw new AgentRunNotVisibleError/.test(authorization)
    || !/findLocator\(input\.orgId\s*,\s*input\.runId\)/.test(authorization)) {
    errors.push("parent authorization must use the existing tenant locator and visibility decision");
  }
  return errors;
}
