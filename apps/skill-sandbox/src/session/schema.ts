import { readFileSync } from "node:fs";
import { Ajv } from "ajv";

const artifact = JSON.parse(readFileSync(new URL("../generated/sandbox-session-schema.json", import.meta.url), "utf8"));

/**
 * 并发 session 容量的**部署可配项**（`SKILL_SANDBOX_MAX_SESSIONS`）。
 *
 * 契约里的 `maxSessions` 仍是**唯一的默认值声明处**（`packages/contracts/src/sandbox-session.ts`）——
 * 这里不复制那个数字，只在部署显式给了值时覆盖它。不设 / 设成空串 ⇒ 用契约默认值，
 * 于是"默认是多少"永远只有一处答案，本仓栽过五次的那条不会在这里第六次发生。
 *
 * ⚠ 为什么无效值要**抛异常而不是退回默认**：退回默认是静默的。运维把它设成 `"32 "`
 *   之外的任何笔误（`thirty-two`、`0`、`-1`），得到的会是一台"看起来配了、实际没配"的机器——
 *   而这正是本项目 `deploy.sh` 4b-i 步那条注释在防的同一类事故（"配了一半比什么都没配更难查"）。
 *   这里抛出会让容器起不来，deploy.sh 的沙箱就绪检查当场红退，症状指向配置本身。
 *
 * ⚠ 调大它**必须同时**调大沙箱容器的 `mem_limit` / `cpus`（见 docker-compose.deploy.yml 的
 *   SKILL_SANDBOX_MEM_LIMIT / SKILL_SANDBOX_CPUS）。只调这一个，超出的并发不会再拿到
 *   干净的 SESSION_LIMIT 错误，而是变成容器 OOM——把一个说得清的拒绝换成一场说不清的崩溃。
 */
function resolveMaxSessions(contractDefault: number): number {
  const raw = process.env.SKILL_SANDBOX_MAX_SESSIONS?.trim();
  if (!raw) return contractDefault;
  // 只认十进制正整数：`Number()` 会把 `"1e3"` 收成整数 1000、把 `"0x10"` 收成 16，
  // 部署里写下这两种东西的人想要的几乎不是那个数。配置项宁可挑剔，也不要"看起来接受了"。
  if (!/^[0-9]+$/.test(raw) || Number(raw) < 1) {
    throw new Error(`SKILL_SANDBOX_MAX_SESSIONS must be a positive decimal integer, got ${JSON.stringify(raw)}`);
  }
  return Number(raw);
}

export const sessionLimits: Record<string, number> = {
  ...artifact.limits,
  maxSessions: resolveMaxSessions(artifact.limits.maxSessions),
};
const ajv = new Ajv({ strict: false });
ajv.addFormat("uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const validators = new Map(Object.entries(artifact.schemas).map(([name, schema]) => [name, ajv.compile(schema as object)]));
export function validateSessionBody(name: string, value: unknown): boolean {
  return validators.get(name)?.(value) === true;
}
