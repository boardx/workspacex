/**
 * WF03 —— trigger 输入按 Definition 的 inputSchema 校验（R3 第 2b 步）。纯函数、无 IO。
 *
 * inputSchema 是 JSON Schema 的对象子集：`required`（字符串数组）与 `properties.<name>.type`
 * （string / number / integer / boolean / object / array）。未声明 additionalProperties=false 时
 * 允许额外字段。只判这一子集——Definition 发布时就只写这一子集（运行面板按它渲染表单）。
 */
export interface TriggerInputIssue {
  path: string;
  message: string;
}

const TYPE_CHECKS: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  array: (v) => Array.isArray(v),
};

export function validateTriggerInput(schema: Record<string, unknown>, input: Record<string, unknown>): TriggerInputIssue[] {
  const issues: TriggerInputIssue[] = [];
  const required = Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === "string") : [];
  for (const name of required) {
    if (input[name] === undefined) issues.push({ path: name, message: "required" });
  }
  const props = TYPE_CHECKS.object!(schema.properties) ? (schema.properties as Record<string, unknown>) : {};
  for (const [name, value] of Object.entries(input)) {
    const prop = props[name];
    if (prop === undefined) {
      if (schema.additionalProperties === false) issues.push({ path: name, message: "not allowed" });
      continue;
    }
    const type = TYPE_CHECKS.object!(prop) ? (prop as Record<string, unknown>).type : undefined;
    const check = typeof type === "string" ? TYPE_CHECKS[type] : undefined;
    if (check && !check(value)) issues.push({ path: name, message: `expected ${String(type)}` });
  }
  return issues;
}
