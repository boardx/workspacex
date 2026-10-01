"use client";
/**
 * WF08 —— 「运行 Workflow」trigger 表单：按 runnable 项的 `inputSchema`（契约 listRunnableWorkflows.out）
 * 渲染必填字段，提交前逐字段校验。只认服务端 `validateTriggerInput` 判的 JSON Schema 子集
 * （`required` + `properties.<name>.type` + 字符串长度）；标量类型（string / number / integer / boolean）渲染
 * 输入框，其余类型按 JSON 文本输入。
 */
import { useState, type FormEvent } from "react";

export interface TriggerField {
  readonly name: string;
  readonly type: string;
  readonly title?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
}

/** inputSchema 中必填字段（按 `required` 顺序）；无必填 → 空数组，入口一键发起。 */
export function requiredTriggerFields(schema: Record<string, unknown>): TriggerField[] {
  const required = Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === "string") : [];
  const props = schema.properties !== null && typeof schema.properties === "object" ? (schema.properties as Record<string, unknown>) : {};
  return required.map((name) => {
    const prop = props[name];
    const type = prop !== null && typeof prop === "object" ? (prop as Record<string, unknown>).type : undefined;
    const metadata = prop !== null && typeof prop === "object" ? prop as Record<string, unknown> : {};
    const length = (key: string) => typeof metadata[key] === "number" && Number.isSafeInteger(metadata[key]) && (metadata[key] as number) >= 0 ? metadata[key] as number : undefined;
    return { name, type: typeof type === "string" ? type : "string",
      ...(typeof metadata.title === "string" && metadata.title.trim() ? { title: metadata.title } : {}),
      ...(length("minLength") !== undefined ? { minLength: length("minLength") } : {}),
      ...(length("maxLength") !== undefined ? { maxLength: length("maxLength") } : {}),
    };
  });
}

type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

function parseField(field: TriggerField, raw: string): Parsed {
  const { type } = field;
  const text = raw.trim();
  if (text === "") return { ok: false, error: "必填" };
  if (type === "string") {
    const length = Array.from(raw).length;
    if (field.minLength !== undefined && length < field.minLength) return { ok: false, error: `至少 ${field.minLength} 个字符` };
    if (field.maxLength !== undefined && length > field.maxLength) return { ok: false, error: `最多 ${field.maxLength} 个字符` };
    return { ok: true, value: raw };
  }
  if (type === "number" || type === "integer") {
    const n = Number(text);
    if (!Number.isFinite(n)) return { ok: false, error: "请输入数字" };
    if (type === "integer" && !Number.isInteger(n)) return { ok: false, error: "请输入整数" };
    return { ok: true, value: n };
  }
  if (type === "boolean") return { ok: true, value: text === "true" };
  try {
    const v: unknown = JSON.parse(text);
    const good = type === "array" ? Array.isArray(v) : type === "object" ? v !== null && typeof v === "object" && !Array.isArray(v) : true;
    return good ? { ok: true, value: v } : { ok: false, error: type === "array" ? "请输入 JSON 数组" : "请输入 JSON 对象" };
  } catch {
    return { ok: false, error: "请输入合法 JSON" };
  }
}

export function WorkflowStartForm(props: {
  readonly workflowKey: string;
  readonly fields: readonly TriggerField[];
  readonly busy: boolean;
  readonly onSubmit: (input: Record<string, unknown>) => void;
  readonly onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.fields.map((f) => [f.name, f.type === "boolean" ? "false" : ""])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  function submit(e: FormEvent) {
    e.preventDefault();
    const input: Record<string, unknown> = {};
    const next: Record<string, string> = {};
    for (const f of props.fields) {
      const r = parseField(f, values[f.name] ?? "");
      if (r.ok) input[f.name] = r.value;
      else next[f.name] = r.error;
    }
    setErrors(next);
    if (Object.keys(next).length === 0) props.onSubmit(input);
  }
  return (
    <form data-testid={`workflow-run-form-${props.workflowKey}`} onSubmit={submit} noValidate>
      {props.fields.map((f) => {
        const id = `wf-input-${props.workflowKey}-${f.name}`;
        const err = errors[f.name];
        return (
          <div key={f.name}>
            <label htmlFor={id}>{f.title ?? f.name}（必填）</label>
            {f.type === "boolean" ? (
              <select
                id={id}
                data-testid={`workflow-run-input-${f.name}`}
                value={values[f.name]}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              >
                <option value="true">是</option>
                <option value="false">否</option>
              </select>
            ) : (
              <input
                id={id}
                data-testid={`workflow-run-input-${f.name}`}
                inputMode={f.type === "number" || f.type === "integer" ? "decimal" : undefined}
                aria-invalid={err ? true : undefined}
                aria-describedby={err ? `${id}-error` : undefined}
                value={values[f.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            )}
            {err ? (
              <p id={`${id}-error`} role="alert" data-testid={`workflow-run-input-error-${f.name}`}>
                {err}
              </p>
            ) : null}
          </div>
        );
      })}
      <button type="submit" disabled={props.busy} data-testid="workflow-run-form-submit">
        开始运行
      </button>
      <button type="button" disabled={props.busy} data-testid="workflow-run-form-cancel" onClick={props.onCancel}>
        取消
      </button>
    </form>
  );
}
