import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeSharedGrants,
  allowlistKey,
  blankNonCode,
  staleAllowlistEntries,
} from "./lib/test-shared-grant.ts";

/**
 * 「测试代码对共享角色做无限定 GRANT/REVOKE」门控的反证套件（issue #522 范围 C）。
 *
 * ⚠ 本文件最要紧的一组不是「违规能被抓到」，而是**红必须红在对的判据上**（红线 10）：
 * 同一条 `REVOKE INSERT ON <表> FROM app_rw`，表是本文件建的就必须绿、是共享表才红。
 * 如果门其实是在匹配「出现了 REVOKE 这个词」，下面那一对用例里的第二条会跟着红，
 * 套件就会指着它说话——这正是 #522 明写的那条要求。
 */
const at = (source: string, file = "apps/api/tests/x.test.ts") =>
  analyzeSharedGrants([{ file, source }]);

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "lint-test-shared-grant.mjs");

describe("判据：共享对象 vs 本文件自己的对象", () => {
  it("对共享表的无限定 REVOKE 判违规——这就是 #522 实测把别人插 chat_messages 插挂的那条", () => {
    const report = at(`await asOwner((c) => c.query("REVOKE INSERT ON chat_messages FROM app_rw"));`);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toMatchObject({
      verb: "REVOKE",
      object: "chat_messages",
      grantee: "app_rw",
      verdict: "shared",
      line: 1,
    });
  });

  it("**同一条语句、同一个角色**，表由本文件 CREATE 出来就放行——红必须红在「无限定」上", () => {
    const report = at(`
      await asOwner((c) => c.query("CREATE TABLE f02_probe (id int)"));
      await asOwner((c) => c.query("REVOKE INSERT ON f02_probe FROM app_rw"));
    `);
    expect(report.violations).toHaveLength(0);
    expect(report.sites.map((s) => s.verdict)).toEqual(["file-owned"]);
  });

  it("限定到本文件自己建的 schema 的授权放行（chat_wave2_fixture 的现存正当用法）", () => {
    const report = at(`
      await client.query(\`
        CREATE SCHEMA IF NOT EXISTS chat_wave2_fixture;
        GRANT SELECT, INSERT, UPDATE, DELETE ON chat_wave2_fixture.agents TO app_rw;
        GRANT USAGE ON SCHEMA chat_wave2_fixture TO app_rw;
      \`);
    `);
    expect(report.violations).toHaveLength(0);
    expect(report.sites).toHaveLength(2);
  });

  it("`public.` 前缀不是限定——它就是所有人共用的那个 schema", () => {
    expect(at(`c.query("GRANT DELETE ON public.organizations TO app_rw")`).violations).toHaveLength(1);
  });

  it("对象名是运行期拼接的，判不出来就按共享处理（宁可假红去看一眼，不要假绿）", () => {
    expect(at("c.query(`GRANT SELECT ON ${table} TO app_rw`)").violations).toHaveLength(1);
  });

  it("接受方是本文件自己 CREATE ROLE 出来的角色 ⇒ 放行（app_rw 的权限一个字节没动）", () => {
    const report = at(`
      await o.query("CREATE ROLE f02_attacker LOGIN");
      await o.query("GRANT DELETE ON organizations TO f02_attacker");
    `);
    expect(report.violations).toHaveLength(0);
    expect(report.sites[0]!.verdict).toBe("grantee-owned");
  });
});

describe("刻意不判的三档（放行，但计数看得见）", () => {
  it("注释里写着的语句不算数——#516 的修法注释逐字引用了那条 REVOKE", () => {
    const report = at(`
      // 首版用 REVOKE INSERT ON chat_messages FROM app_rw 注入失败，那是库级的。
      /* REVOKE DELETE ON organizations FROM app_rw */
      const ok = 1;
    `);
    expect(report.sites).toHaveLength(0);
  });

  it("只断言迁移文本、并不执行的放行（tests/capability/model/* 的现存用法）", () => {
    const byRegexLiteral = at(`const g = MIGRATION.match(/GRANT ([A-Z,]+) ON research_gate_audit TO app_rw/);`);
    expect(byRegexLiteral.sites).toHaveLength(0);

    const byExpect = at(`expect(sql).toContain("REVOKE INSERT ON provenance_events FROM app_rw");`);
    expect(byExpect.violations).toHaveLength(0);
    expect(byExpect.sites[0]!.verdict).toBe("asserted");
  });

  it("库级权限不在本门控范围内——本仓的并行隔离单位就是库（#468 / #487 的地盘）", () => {
    const report = at("await admin.query(`REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`)");
    expect(report.violations).toHaveLength(0);
    expect(report.sites[0]!.verdict).toBe("database");
  });

  it("显式声明独占一次性实例的文件整份放行（tests/deploy/*.live.ts）", () => {
    const report = at(`
      if (process.env.WORKSPACEX_DATA_TEST !== "1") throw new Error("isolated test opt-in required");
      await owner.query("GRANT DELETE ON organizations TO app_rw");
    `);
    expect(report.violations).toHaveLength(0);
    expect(report.sites[0]!.verdict).toBe("instance-owned");
  });
});

describe("不误伤普通 TS 代码里的 grant / revoke", () => {
  it("业务代码里的 standing tool grant 之类不是 SQL 权限语句", () => {
    const report = at(`
      const grant = await fetchStandingGrant(orgId);
      await revokeStandingGrant(grant.id, { from: actor, to: subject });
      expect(grant.revokedFrom).toBe("app_rw");
    `);
    expect(report.sites).toHaveLength(0);
  });

  it("带单引号的正则字面量不会让后面的字符串状态错位", () => {
    const report = at(`
      const human = /it's fine/;
      await c.query("REVOKE INSERT ON chat_messages FROM app_rw");
    `);
    expect(report.violations).toHaveLength(1);
  });

  it("字符串里的 // 不是注释（否则同一行后面的语句会被静默抹掉）", () => {
    const source = `const u = "http://x"; /* gone */ c.query("REVOKE INSERT ON chat_messages FROM app_rw");`;
    const blanked = blankNonCode(source);
    // 等长替换是行号/偏移量不变的前提，注释没了、字符串内容还在。
    expect(blanked).toHaveLength(source.length);
    expect(blanked).toContain(`"http://x"`);
    expect(blanked).not.toContain("gone");
    expect(at(source).violations).toHaveLength(1);
  });
});

describe("棘轮名单", () => {
  const source = `await c.query("REVOKE INSERT ON chat_messages FROM app_rw");`;
  const files = [{ file: "apps/api/tests/x.test.ts", source }];
  const key = allowlistKey("apps/api/tests/x.test.ts", "REVOKE INSERT ON chat_messages FROM app_rw");

  it("命中名单的违规不判红，但进 allowed 桶被打印出来（存量债看得见）", () => {
    const report = analyzeSharedGrants(files, new Set([key]));
    expect(report.violations).toHaveLength(0);
    expect(report.allowed.map((a) => a.statement)).toEqual(["REVOKE INSERT ON chat_messages FROM app_rw"]);
  });

  it("语句已经改掉了，名单条目就是陈旧的 ⇒ 必须删（棘轮只许变短）", () => {
    expect(staleAllowlistEntries(files, new Set([key]))).toEqual([]);
    expect(staleAllowlistEntries([{ file: "apps/api/tests/x.test.ts", source: "const ok = 1;" }], new Set([key]))).toEqual([key]);
  });
});

/**
 * 端到端反证（#522 范围 C 的原话：「写一个对 app_rw 无限定 REVOKE 的测试 → 门必须变红；
 * 换成限定版 → 变绿」）。
 *
 * 这里跑的是**真的那个门**（`lint-test-shared-grant.mjs`，`--root` 指到临时树），
 * 看的是**真的退出码**——纯函数返回了什么数组，证明不了 CI 上那一步会不会红。
 */
describe("端到端：门真的会红", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  const runGate = (source: string): { status: number; output: string } => {
    dir = mkdtempSync(join(tmpdir(), "test-shared-grant-"));
    mkdirSync(join(dir, "apps/api/tests/kernel"), { recursive: true });
    writeFileSync(join(dir, "apps/api/tests/kernel/fixture.test.ts"), source);
    try {
      const output = execFileSync(process.execPath, ["--import", "tsx", SCRIPT, "--root", dir], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, output };
    } catch (error) {
      const e = error as { status: number; stdout: string; stderr: string };
      return { status: e.status, output: `${e.stdout}${e.stderr}` };
    }
  };

  it("无限定 REVOKE 的 fixture ⇒ exit 1，且指名道姓说出是哪条、为什么", () => {
    const result = runGate(`
      import { it } from "vitest";
      it("injects a write failure the cheap way", async () => {
        await asOwner((c) => c.query("REVOKE INSERT ON chat_messages FROM app_rw"));
      });
    `);
    expect(result.status).toBe(1);
    expect(result.output).toContain("REVOKE INSERT ON chat_messages FROM app_rw");
    expect(result.output).toContain("apps/api/tests/kernel/fixture.test.ts:4");
    expect(result.output).toContain("不是本文件建的");
  });

  it("换成限定到本文件自己数据的写法 ⇒ exit 0（同一个词，不同的判据）", () => {
    const result = runGate(`
      import { it } from "vitest";
      it("injects a write failure scoped to this file's own rows", async () => {
        await asOwner((c) => c.query(\`
          CREATE OR REPLACE FUNCTION f522_break_write() RETURNS trigger AS $fn$
          BEGIN
            IF NEW.org_id = '\${ORG}' AND NEW.body LIKE '\${INJECT}%' THEN
              RAISE EXCEPTION 'injected';
            END IF;
            RETURN NEW;
          END;
          $fn$ LANGUAGE plpgsql;
        \`));
      });
    `);
    expect(result.status).toBe(0);
    expect(result.output).toContain("✓ [test-shared-grant]");
  });
});
