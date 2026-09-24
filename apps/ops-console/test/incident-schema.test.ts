/**
 * 事故 schema 的「无客户身份字段」门：遍历 IncidentRecord 的全部字段名，
 * 任何指向客户 / 租户 / 组织 / 账号 / 用户的字段即红——唯一允许的客户引用是
 * `affectedInstanceHashes`（64 位 hex 不透明哈希）。
 * 个人信息字段名、自由文本、strict、数组上限由 `pnpm run lint:ops-incident-schema`（C5/C6 同一道门）负责。
 */
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import { IncidentRecord } from "../src/incident-schema";

const CUSTOMER_WORDS = ["customer", "client", "tenant", "org", "organization", "account", "user", "company", "workspace", "domain"];
const ALLOWED_CUSTOMER_REF = "affectedInstanceHashes";

function keys(schema: ZodTypeAny, out: string[] = []): string[] {
  const def = schema._def as { typeName: string; innerType?: ZodTypeAny; schema?: ZodTypeAny; type?: ZodTypeAny; shape?: () => Record<string, ZodTypeAny> };
  if (def.innerType) return keys(def.innerType, out);
  if (def.typeName === "ZodEffects" && def.schema) return keys(def.schema, out);
  if (def.typeName === "ZodArray" && def.type) return keys(def.type, out);
  if (def.typeName === "ZodObject" && def.shape) {
    for (const [k, child] of Object.entries(def.shape())) { out.push(k); keys(child, out); }
  }
  return out;
}

describe("IncidentRecord 不含客户身份字段", () => {
  const all = keys(IncidentRecord);
  it("遍历到了字段（空集不是全绿）", () => {
    expect(all.length).toBeGreaterThan(5);
    expect(all).toContain(ALLOWED_CUSTOMER_REF);
  });
  it("除不透明实例哈希外，没有任何字段名指向客户", () => {
    const split = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_-]+/);
    const offenders = all.filter((k) => k !== ALLOWED_CUSTOMER_REF && split(k).some((w) => CUSTOMER_WORDS.includes(w)));
    expect(offenders).toEqual([]);
  });
  it("实例引用只接受 64 位 hex", () => {
    const shape = IncidentRecord.shape.affectedInstanceHashes.element;
    expect(shape.safeParse("f".repeat(64)).success).toBe(true);
    expect(shape.safeParse("acme-corp").success).toBe(false);
  });
});
