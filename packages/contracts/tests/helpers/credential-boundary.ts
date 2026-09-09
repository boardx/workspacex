/** Shared test-only declaration and local JSX boundary checks for web and API F52.
 * Keep the implementation here: API's F52 command also scans the web component tree.
 * This is not a runtime sanitizer or a complete cross-file security proof.
 */
import { z } from "zod";
import ts from "typescript";

/** Traverse known Zod 3 schemas; cycles terminate by identity, unknown types fail closed. */
export function collectKeys(schema: z.ZodTypeAny, visited = new Set<z.ZodTypeAny>()): string[] {
  if (visited.has(schema)) return [];
  visited.add(schema);
  const def = schema._def;
  const scan = (child: z.ZodTypeAny) => collectKeys(child, visited);
  switch (def.typeName as string) {
    case "ZodObject": return [...Object.entries((schema as z.AnyZodObject).shape)
      .flatMap(([key, child]) => [key, ...scan(child as z.ZodTypeAny)]), ...scan(def.catchall)];
    case "ZodArray": case "ZodBranded": return scan(def.type);
    case "ZodOptional": case "ZodNullable": case "ZodDefault": case "ZodCatch": case "ZodReadonly": return scan(def.innerType);
    case "ZodEffects": return scan(def.schema);
    case "ZodLazy": return scan(def.getter());
    case "ZodUnion": case "ZodDiscriminatedUnion": return (def.options as z.ZodTypeAny[]).flatMap(scan);
    case "ZodIntersection": return [...scan(def.left), ...scan(def.right)];
    case "ZodPipeline": return [...scan(def.in), ...scan(def.out)];
    case "ZodTuple": return [...(def.items as z.ZodTypeAny[]).flatMap(scan), ...(def.rest ? scan(def.rest) : [])];
    case "ZodRecord": case "ZodMap": return [...scan(def.keyType), ...scan(def.valueType)];
    case "ZodSet": return scan(def.valueType);
    case "ZodPromise": return scan(def.type);
    case "ZodFunction": return [...scan(def.args), ...scan(def.returns)];
    case "ZodString": case "ZodNumber": case "ZodNaN": case "ZodBigInt": case "ZodBoolean":
    case "ZodDate": case "ZodSymbol": case "ZodUndefined": case "ZodNull": case "ZodVoid":
    case "ZodNever": case "ZodLiteral": case "ZodEnum": case "ZodNativeEnum": return [];
    // Known opaque leaves have no declared keys. This declaration scan does NOT establish
    // runtime content safety for MCP JSON schemas/records or arbitrary unknown payloads.
    case "ZodAny": case "ZodUnknown": return [];
    default: throw new Error(`Cannot establish response key safety for ${String(def.typeName)}`);
  }
}

export const SECRET_KEY_RE = /credential|secret|password|apikey|api_key|^(access_?token|refresh_?token|private_?key)$/i;
/** Local initializer/destructuring/assignment aliases and direct JSX sinks only: not cross-file/call-graph taint analysis.
 * Only native input or the named shared Input import gets a literal-password exemption.
 * Assignment propagation is conservative and order-insensitive; Boolean(credential) calls
 * and dynamic/custom password components are conservatively rejected; runtime canaries cover
 * actual text, attributes, Web Storage, fetch and logs on the demonstrated UI paths. */
export function secretRenderSinks(body: string): string[] {
  const source = ts.createSourceFile("component.tsx", body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sinks: string[] = [];
  const bindings = new Map<ts.Node, Map<string, ts.Node>>();
  const scopeOf = (node: ts.Node): ts.Node => {
    let current = node.parent;
    while (current && !ts.isBlock(current) && !ts.isSourceFile(current) && !ts.isFunctionLike(current)) current = current.parent;
    return current ?? source;
  };
  const collect = (node: ts.Node) => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isImportSpecifier(node) || ts.isFunctionDeclaration(node) || ts.isBindingElement(node) || ts.isClassDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
      const scope = ts.isImportSpecifier(node) ? source : scopeOf(node);
      if (!bindings.has(scope)) bindings.set(scope, new Map());
      bindings.get(scope)!.set(node.name.text, node);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  const resolve = (name: string, node: ts.Node): ts.Node | undefined => {
    for (let current: ts.Node | undefined = node; current; current = current.parent) {
      const declaration = bindings.get(current)?.get(name);
      if (declaration) return declaration;
    }
  };
  const assignments = new Map<ts.Node, ts.Expression[]>();
  const collectAssignments = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const declaration = resolve(node.left.text, node.left);
      if (declaration) assignments.set(declaration, [...(assignments.get(declaration) ?? []), node.right]);
    }
    ts.forEachChild(node, collectAssignments);
  };
  collectAssignments(source);
  const containsSecret = (node: ts.Node, seen = new Set<ts.Node>()): boolean => {
    if (seen.has(node) || ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return false;
    seen.add(node);
    // Function bodies are not their rendered value; no call-graph analysis is claimed.
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return false;
    // Boolean projections reveal presence/comparison, not credential bytes.
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) return false;
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
      ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(node.operatorToken.kind)) return false;
    if (ts.isIdentifier(node)) {
      if (/^credential$/i.test(node.text)) return true;
      const declaration = resolve(node.text, node);
      if (declaration) {
        if ((ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)) && declaration.initializer && containsSecret(declaration.initializer, seen)) return true;
        if (ts.isBindingElement(declaration)) {
          // Check nested object selectors (including renamed/computed string keys) and
          // source/default expressions. A destructured parameter has no initializer.
          let binding: ts.Node = declaration;
          while (ts.isBindingElement(binding) || ts.isObjectBindingPattern(binding) || ts.isArrayBindingPattern(binding)) {
            if (ts.isBindingElement(binding)) {
              const key = binding.propertyName;
              if (key && (/^credential$/i.test(key.getText(source).replace(/^["']|["']$/g, "")) ||
                ts.isComputedPropertyName(key) && ts.isStringLiteral(key.expression) && /^credential$/i.test(key.expression.text))) return true;
              if (binding.initializer && containsSecret(binding.initializer, seen)) return true;
            }
            binding = binding.parent;
          }
          if ((ts.isVariableDeclaration(binding) || ts.isParameter(binding)) && binding.initializer && containsSecret(binding.initializer, seen)) return true;
        }
        if ((assignments.get(declaration) ?? []).some(value => containsSecret(value, seen))) return true;
      }
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && /^credential$/i.test(node.argumentExpression.text)) return true;
    return ts.forEachChild(node, child => containsSecret(child, seen) || undefined) === true;
  };
  const trustedInput = (tag: ts.JsxTagNameExpression): boolean => {
    if (tag.getText(source) === "input") return true;
    if (!ts.isIdentifier(tag)) return false;
    const declaration = resolve(tag.text, tag);
    if (!declaration || !ts.isImportSpecifier(declaration) || (declaration.propertyName ?? declaration.name).text !== "Input") return false;
    const imported = declaration.parent.parent.parent;
    return ts.isImportDeclaration(imported) && ts.isStringLiteral(imported.moduleSpecifier) && imported.moduleSpecifier.text === "@/components/ui/input";
  };
  const literalPassword = (initializer: ts.JsxAttributeValue | undefined): boolean => {
    const value = initializer && ts.isJsxExpression(initializer) ? initializer.expression : initializer;
    return !!value && ts.isStringLiteral(value) && value.text === "password";
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxExpression(node) && node.expression && containsSecret(node.expression)) {
      const attr = ts.isJsxAttribute(node.parent) ? node.parent : null;
      const name = attr?.name.getText(source);
      const element = attr?.parent.parent;
      const passwordValue = name === "value" && element &&
        (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) && trustedInput(element.tagName) &&
        element.attributes.properties.some(property => ts.isJsxAttribute(property) &&
          property.name.getText(source) === "type" && literalPassword(property.initializer));
      const eventHandler = name?.startsWith("on") &&
        (ts.isArrowFunction(node.expression) || ts.isFunctionExpression(node.expression));
      if (!passwordValue && !eventHandler) sinks.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sinks;
}

