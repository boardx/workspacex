/**
 * test-shared-grant.ts —— 「测试代码对共享角色做无限定 GRANT / REVOKE」的机械门控（issue #522）。
 *
 * ## 它堵的洞：第六种共享可变状态
 *
 * 本仓的「共享可变状态」清单此前是五条（git 索引 / 工作树 / stash 栈 / 开发库 /
 * scratchpad），前三条由 ADR-005 的 worktree 隔离挡住，第四条由 `test-isolation` 挡住。
 * #522 记录了第六条：**数据库授权（GRANT / REVOKE）**，而它一条都挡不住——
 * 权限挂在**角色**上，不在文件系统里，也不在 git 里；worktree 隔离与「每个 worker 一个
 * 库名」都影响不到它，同一个库里所有并行 worker 共用同一个 `app_rw`。
 *
 * 实测（#413 / PR #516 的实现者，同语句、同角色、同库，不是推理）：
 *
 *     revoke 前：org-f109badge 插入 chat_messages → INSERT 0 1
 *     revoke 中：同一条                          → ERROR: permission denied for table chat_messages
 *
 * `apps/api/vitest.config.ts` 是 forks 池 + `maxWorkers: 4` ⇒ 四个测试文件并行跑在**同一个**
 * Postgres 上。某个文件用 `REVOKE INSERT ON chat_messages FROM app_rw` 注入写回失败，
 * 别的文件的夹具只要在那个窗口里插 `chat_messages` 就挂——受害者是谁由 vitest 的调度
 * 决定，所以它在 CI 上长成 flake，而单跑永远是绿的。
 *
 * ## 判据：区分「作用于共享对象」与「作用于本用例自己的对象」
 *
 * ⚠ **不是禁止一切 GRANT/REVOKE**（#522 范围 A 明写）。本仓现存的正当用法实测有三类，
 * 门必须放行，否则它挡住的是正确的代码：
 *
 *   ① 授权对象由**本文件自己创建** —— `chat-wave2-fixture-schema.ts` 限定到
 *      `chat_wave2_fixture` schema、`rls-force-nonowner.test.ts` 限定到自己 `CREATE TABLE`
 *      出来的探针表。别的文件看不见这些对象，也就不可能被影响。
 *   ② 语句只是**被断言的迁移文本**，从不执行 —— `tests/capability/model/*.test.ts`
 *      读迁移文件断言里面有某条 GRANT。
 *   ③ 本文件**独占一个一次性实例** —— `tests/deploy/*.live.ts` 开头就是
 *      `WORKSPACEX_DATA_TEST!=="1"` 抛错，它根本不在并行池里。
 *
 * 于是判据是三段而不是一句「不许出现 GRANT」：**语句是否真的执行** ×
 * **授权对象是否被本文件独占** × **文件是否独占实例**。反证测试里有一条专门钉这件事：
 * 合法的限定写法必须是绿的，红必须红在「无限定」上，而不是红在「出现了 REVOKE 这个词」上。
 *
 * ## 刻意不判的一档：库级权限
 *
 * `REVOKE CONNECT ON DATABASE <db> FROM PUBLIC`（`tests/support/drop-database.ts`）不在
 * 本门控范围内。本仓的并行隔离单位**就是库**（`vitest.config.ts` 把 `WORKSPACEX_DB`
 * 翻成 `PGDATABASE`），库级权限的影响面不会越过隔离边界；库这一层的洞是 #468（端口碰撞）
 * 与 #487（拆库掐连接）的地盘，不是本条的。这一档在报告里单独计数，不是静悄悄地放过。
 *
 * ## 修法（#516 的范例，不是本文件发明的）
 *
 * 要注入权限失败，就**限定到本用例自己的数据**：装一个双重限定的触发器（本文件的 org
 * AND 本文件的 sentinel 前缀），别动角色权限。见
 * `apps/api/tests/agent-runtime/no-tool-run-writeback.test.ts` 的
 * `installWritebackFailureInjector`：DDL 从每用例两次降到每文件两次，且安装期间别的文件
 * 观察不到任何差别。
 */

/** 扫描输入：一个测试文件的路径（相对仓库根）与源码。 */
export interface TestSourceFile {
  readonly file: string;
  readonly source: string;
}

export type GrantVerdict =
  /** 违规：作用在共享角色 × 共享对象上，别的并行 worker 会被波及。 */
  | "shared"
  /** 放行：授权对象由本文件创建（schema 前缀或对象名在本文件的 CREATE 里）。 */
  | "file-owned"
  /** 放行：授权对象的接受者是本文件自己 CREATE ROLE 出来的角色。 */
  | "grantee-owned"
  /** 放行：只是断言迁移文本里有这条语句，并不执行它。 */
  | "asserted"
  /** 放行（刻意不判）：库级权限，隔离单位就是库，见文件头。 */
  | "database"
  /** 放行：本文件独占一次性实例（`WORKSPACEX_DATA_TEST=1` 显式准入），不在并行池里。 */
  | "instance-owned";

export interface GrantSite {
  readonly file: string;
  readonly line: number;
  /** 归一化后的语句（空白折叠），也是棘轮名单的 key 的一半。 */
  readonly statement: string;
  readonly verb: "GRANT" | "REVOKE";
  /** 授权对象（`ON` 之后那一截，已去掉引号）；库级/角色成员语句里是库名/角色名。 */
  readonly object: string;
  /** 接受方角色。 */
  readonly grantee: string;
  readonly verdict: GrantVerdict;
}

export interface GrantReport {
  readonly filesScanned: number;
  /** 扫到的全部授权语句，含放行的——「放行了什么」必须看得见。 */
  readonly sites: readonly GrantSite[];
  /** 未被棘轮名单豁免的违规。 */
  readonly violations: readonly GrantSite[];
  /** 命中棘轮名单的违规（存量债，照常放行但会被打印）。 */
  readonly allowed: readonly GrantSite[];
}

/**
 * SQL 权限关键字。`GRANT <这些> ON ...` 这个形状在散文与普通 TS 代码里不会出现，
 * 所以门控只认带 `ON` 子句的权限语句——`grant` / `revoke` 这两个词在本仓的业务代码里
 * 满地都是（standing tool grant、临时授权……），靠词频匹配必然误判。
 */
const PRIVILEGE_WORDS =
  "ALL|PRIVILEGES|SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|USAGE|CREATE|CONNECT|TEMPORARY|TEMP|EXECUTE|MAINTAIN|SET|ALTER|SYSTEM|GRANT|OPTION|FOR|MAINTAIN";

/**
 * `GRANT <privs> ON <object> TO <role>` / `REVOKE <privs> ON <object> FROM <role>`。
 *
 * 中段不许跨 `;`（否则一条语句的 GRANT 会跟下一条语句的 TO 配成对），
 * 且必须整段由权限关键字、逗号、空白组成——这是「这确实是一条 SQL 权限语句」的判据。
 */
const STATEMENT = new RegExp(
  String.raw`\b(GRANT|REVOKE)\s+((?:(?:${PRIVILEGE_WORDS})|[\s,])+?)\bON\s+([^;]{1,160}?)\b(TO|FROM)\s+("?)([A-Za-z_][\w$]*)\5`,
  "gi",
);

/** `ON` 之后可能出现的对象类型前缀，以及 `ALL <X> IN SCHEMA` 这种整批形态。 */
const OBJECT_KIND = new RegExp(
  String.raw`^(?:(ALL)\s+(?:TABLES|SEQUENCES|FUNCTIONS|ROUTINES|PROCEDURES)\s+IN\s+SCHEMA\s+|(TABLE|SCHEMA|DATABASE|FUNCTION|ROUTINE|PROCEDURE|SEQUENCE|TYPE|DOMAIN|TABLESPACE|LANGUAGE|LARGE\s+OBJECT|FOREIGN\s+(?:SERVER|DATA\s+WRAPPER))\s+)?(.+)$`,
  "i",
);

/** 本文件创建了哪些对象（表 / schema / 角色 / 函数……）。 */
const CREATE = new RegExp(
  String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:GLOBAL\s+|LOCAL\s+|TEMP(?:ORARY)?\s+|UNLOGGED\s+|MATERIALIZED\s+)*(TABLE|SCHEMA|SEQUENCE|VIEW|FUNCTION|ROLE|USER|TYPE|DOMAIN|DATABASE)\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w$.]+"?)`,
  "gi",
);

/**
 * 「这条语句只是被断言，不会被执行」的标记。
 *
 * 正则字面量里的 SQL 已经在 `blankNonCode` 里被抹掉了（模式不是语句），这里补的是
 * 模板串/普通串被喂给断言的那几种：`expect(sql).toContain('REVOKE …')`、
 * `new RegExp(\`GRANT … TO app_rw\`)`。
 */
const ASSERTION_MARKER = /\bexpect\s*\(|\btoMatch\s*\(|\btoContain\s*\(|\btoEqual\s*\(|new\s+RegExp\s*\(|\.match\s*\(|\bassert\b/;

/** 文件级准入：显式声明「我独占一个一次性实例」。 */
const INSTANCE_OPT_IN = /WORKSPACEX_DATA_TEST/;

/**
 * 把注释与正则字面量抹成等长空白（保留换行，行号与偏移量都不变）。
 *
 * 为什么要认字符串：`'http://x'` 里的 `//` 不是注释；为什么要认正则字面量：
 * `/GRANT ([A-Z,]+) ON research_gate_audit TO app_rw/` 是**模式**不是语句，
 * 而 `/it's/` 这种带单引号的正则如果被当成代码，后面整段字符串状态都会错位。
 */
export function blankNonCode(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== "\n") out[i] = " ";
  };
  /** 上一个有意义的字符——用来判断 `/` 是除号还是正则的开头。 */
  let prev = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const d = source[i + 1] ?? "";
    if (c === "/" && d === "/") {
      const end = source.indexOf("\n", i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (c === "/" && d === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && (prev === "" || "(,=:[!&|?{};+\n".includes(prev))) {
      // 正则字面量：抹到同一行里第一个未转义的 `/`。找不到就当除号，什么也不做。
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== "\n") {
        if (source[j] === "\\") { j += 2; continue; }
        if (source[j] === "[") inClass = true;
        else if (source[j] === "]") inClass = false;
        else if (source[j] === "/" && !inClass) break;
        j++;
      }
      if (j < source.length && source[j] === "/") {
        blank(i, j + 1);
        prev = "/";
        i = j + 1;
        continue;
      }
    }
    if (c === "'" || c === '"' || c === "`") {
      // 字符串内容保留（SQL 就写在里面），只是跳过，免得里面的 `//` 被当注释。
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") { j += 2; continue; }
        if (source[j] === c) break;
        j++;
      }
      prev = c;
      i = j + 1;
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join("");
}

const unquote = (raw: string): string => raw.trim().replace(/^"(.*)"$/, "$1");

/** 归一化语句文本：空白折叠成单空格，便于做棘轮名单的 key。 */
const normalize = (raw: string): string => raw.replace(/\s+/g, " ").trim();

/** 棘轮名单的条目形状，同 `body-path-param-leak.ts` 的 `allowlistKey` 先例。 */
export function allowlistKey(file: string, statement: string): string {
  return `${file} :: ${normalize(statement)}`;
}

function createdNames(source: string): { objects: Set<string>; schemas: Set<string>; roles: Set<string> } {
  const objects = new Set<string>();
  const schemas = new Set<string>();
  const roles = new Set<string>();
  for (const match of source.matchAll(CREATE)) {
    const kind = match[1]!.toUpperCase();
    const name = unquote(match[2]!).toLowerCase();
    if (kind === "SCHEMA") schemas.add(name);
    else if (kind === "ROLE" || kind === "USER") roles.add(name);
    else objects.add(name);
    // `CREATE TABLE fixture_schema.t` 同时也证明 `fixture_schema` 归本文件管。
    const dot = name.indexOf(".");
    if (dot > 0) schemas.add(name.slice(0, dot));
  }
  return { objects, schemas, roles };
}

/**
 * 授权对象是否被本文件独占。
 *
 * - 带 schema 前缀 ⇒ 看这个 schema 是不是本文件建的（`public` 永远不算）。
 * - 裸对象名 ⇒ 看本文件有没有 `CREATE … <同名>`。
 * - 名字里含 `${…}` / `%I` 这类运行期拼接 ⇒ **判不出来就是判不出来**，按共享处理
 *   （宁可要一条假红去看一眼，也不要一条假绿）。
 */
function ownedByFile(object: string, created: ReturnType<typeof createdNames>): boolean {
  const name = unquote(object).toLowerCase();
  const dot = name.indexOf(".");
  if (dot > 0) {
    const schema = name.slice(0, dot);
    return schema !== "public" && created.schemas.has(schema);
  }
  if (/[${}%]/.test(name)) return false;
  return created.objects.has(name) || created.schemas.has(name);
}

/**
 * 扫描测试源码里的授权语句。
 *
 * @param allowlist 棘轮豁免名单（`allowlistKey` 的 key 集合）。不传就是「一条都不豁免」，
 *                  `staleAllowlistEntries` 靠这个重跑来发现陈旧条目。
 */
export function analyzeSharedGrants(
  files: readonly TestSourceFile[],
  allowlist: ReadonlySet<string> = new Set(),
): GrantReport {
  const sites: GrantSite[] = [];
  const violations: GrantSite[] = [];
  const allowed: GrantSite[] = [];

  for (const { file, source } of files) {
    const code = blankNonCode(source);
    const instanceOwned = INSTANCE_OPT_IN.test(code);
    const created = createdNames(code);
    const lineStarts: number[] = [0];
    for (let i = 0; i < code.length; i++) if (code[i] === "\n") lineStarts.push(i + 1);
    const lineOf = (offset: number): number => {
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid]! <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    };

    for (const match of code.matchAll(STATEMENT)) {
      const verb = match[1]!.toUpperCase() as "GRANT" | "REVOKE";
      const grantee = unquote(match[6]!);
      const line = lineOf(match.index!);
      const lineText = code.split("\n")[line - 1] ?? "";
      const kindMatch = OBJECT_KIND.exec(unquote(match[3]!.trim()));
      const batch = kindMatch?.[1];
      const kind = (kindMatch?.[2] ?? (batch ? "SCHEMA" : "TABLE")).toUpperCase();
      const object = unquote(kindMatch?.[3] ?? match[3]!);

      const verdict: GrantVerdict = instanceOwned
        ? "instance-owned"
        : ASSERTION_MARKER.test(lineText)
          ? "asserted"
          : kind === "DATABASE"
            ? "database"
            : created.roles.has(grantee.toLowerCase())
              ? "grantee-owned"
              : ownedByFile(object, created)
                ? "file-owned"
                : "shared";

      const site: GrantSite = {
        file,
        line,
        statement: normalize(match[0]!),
        verb,
        object,
        grantee,
        verdict,
      };
      sites.push(site);
      if (verdict !== "shared") continue;
      if (allowlist.has(allowlistKey(file, site.statement))) allowed.push(site);
      else violations.push(site);
    }
  }

  return { filesScanned: files.length, sites, violations, allowed };
}

/**
 * 棘轮陈旧条目检测——同 `body-path-param-leak.ts` / `rewrite-coverage.ts` 的先例：
 * 不带 allowlist 重新跑一遍，名单里「已经不再出现在原始结果里」的条目就是陈旧的，
 * 必须删掉。豁免名单只能变短；留着已经不缺的条目，等于给未来的回归留一扇没人看守的门。
 */
export function staleAllowlistEntries(
  files: readonly TestSourceFile[],
  allowlist: ReadonlySet<string>,
): string[] {
  const raw = analyzeSharedGrants(files);
  const live = new Set(raw.violations.map((v) => allowlistKey(v.file, v.statement)));
  return [...allowlist].filter((key) => !live.has(key));
}
