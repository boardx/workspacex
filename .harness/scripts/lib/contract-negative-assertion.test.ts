import { describe, expect, it } from "vitest";
import {
  buildContractIndex,
  countByVerdict,
  findNegativeAssertions,
  judge,
  type SourceFile,
} from "./contract-negative-assertion";

/**
 * issue #473 的机械门反证套件。fixture 全部是最小字符串，不读真实文件——判定逻辑本身
 * 要能被单测覆盖（同 `lib/body-path-param-leak.test.ts` / `lib/rewrite-coverage.test.ts`
 * 的先例）。每条用例对应一次在真实树上跑过的结论，不是凭想象造的形状。
 *
 * ⚠ 这套测试**在本门存在之前必然全红**（`./contract-negative-assertion` 根本不存在），
 *   这正是 #473 红线 2 要求的反证：先有一条会红的，再让它变绿。
 */

/** 契约的最小形状：一个 operations 表，键是 operation 名，值里有 method/path。 */
const CHAT_CONTRACT: SourceFile = {
  file: "packages/contracts/src/chat.ts",
  source: `
export const operations = {
  listThreads: {
    method: "GET", path: "/chat/projects/:projectId/threads",
    in: z.object({ projectId: z.string() }).strict(),
  },
  /** Wave 2: persist the human message and queued run. */
  createMessage: {
    method: "POST", path: "/chat/threads/:threadId/messages",
    in: z.object({
      threadId: z.string(),
      clientMessageId: z.string().uuid(),
      text: z.string(),
    }).strict(),
  },
};
`,
};

const index = buildContractIndex([CHAT_CONTRACT]);

describe("契约索引：只收声明，不收注释里的提及", () => {
  it("operations 表里的 operation 被收进索引，并带声明处", () => {
    expect(index.operations.get("createMessage")).toEqual({
      file: "packages/contracts/src/chat.ts",
      line: 8,
    });
    expect(index.operations.has("listThreads")).toBe(true);
  });

  it("字段与 operation 分开收（字段名不作判红依据）", () => {
    expect(index.fields.has("clientMessageId")).toBe(true);
    expect(index.operations.has("clientMessageId")).toBe(false);
  });

  it("`method`/`path`/`in`/`out`/`err` 是 operation 自己的结构，不是业务字段", () => {
    for (const k of ["method", "path", "in", "out", "err"]) {
      expect(index.fields.has(k)).toBe(false);
      expect(index.operations.has(k)).toBe(false);
    }
  });

  /**
   * 本模块的地基。`createMessage` 在 `chat-file-upload.ts` 的注释里出现两次、在
   * `chat.ts:298` 的注释里也出现一次——如果按「文本里出现过」建索引，那么「契约里
   * 有没有它」就会被注释左右，而注释正是本门不信任的东西。
   */
  it("只在注释里被提到的名字**不算**契约里有这个 operation", () => {
    const commentOnly = buildContractIndex([
      {
        file: "packages/contracts/src/chat-file-upload.ts",
        source: `
/**
 * 上传（\`uploadAttachment\`）先拿 attachment id；发消息（\`chat.createMessage\`）带上它。
 *   createMessage: { method: "POST", path: "/x" }   ← 注释里画的示意，不是声明
 */
export const operations = {};
`,
      },
    ]);
    expect(commentOnly.operations.has("createMessage")).toBe(false);
    expect(commentOnly.operations.has("uploadAttachment")).toBe(false);
  });
});

describe("会说谎的断言必须判红（#473 的现场形状）", () => {
  /**
   * #473 的反证：写一句「契约里没有 `createMessage`」，门必须红。
   * 这条用例就是那次反证的固化——它红过（本门不存在时），现在绿。
   */
  it("断言「契约里没有 `createMessage`」而契约里有 ⇒ STALE", () => {
    const assertions = findNegativeAssertions(
      "apps/web/app/chat/live/page.tsx",
      "// ⚠ 本页没有「发消息」输入框：契约里没有 `createMessage` 这个写端口。\n",
    );
    const report = judge(assertions, index);
    expect(report.stale).toHaveLength(1);
    expect(report.stale[0]).toMatchObject({ identifier: "createMessage", verdict: "STALE" });
    expect(report.stale[0]!.declaredAt).toEqual({
      file: "packages/contracts/src/chat.ts",
      line: 8,
    });
  });

  it("契约后来才加上 operation 的那一刻变红——同一句断言，索引不同，结论不同", () => {
    const assertion = findNegativeAssertions(
      "apps/web/app/chat/live/page.tsx",
      "// 契约里没有 `createMessage`。\n",
    );
    // 加 createMessage 之前：这句断言成立，门是绿的。
    const before = buildContractIndex([
      { file: "packages/contracts/src/chat.ts", source: `export const operations = {\n  listThreads: {\n    method: "GET", path: "/x",\n  },\n};\n` },
    ]);
    expect(judge(assertion, before).stale).toHaveLength(0);
    expect(judge(assertion, before).judgements[0]!.verdict).toBe("VERIFIED_ABSENT");
    // 加上之后：同一句话变假，门当场红。这就是 #473 要买的东西。
    expect(judge(assertion, index).stale).toHaveLength(1);
  });

  it("断言跨行折断时，续行上的标识符照样被抓到", () => {
    const source = [
      " * ⚠ 语义是「归档」不是「删除」：契约里没有任何",
      " *   `createMessage` 操作，能做到的最接近的事是……",
      "",
    ].join("\n");
    const report = judge(findNegativeAssertions("apps/web/x.tsx", source), index);
    expect(report.stale.map((j) => j.identifier)).toEqual(["createMessage"]);
  });

  it("一句话并列否定多个 operation ⇒ 每个都判", () => {
    const source = "// 契约里没有 `deleteReview` / `createMessage` 操作。\n";
    const report = judge(findNegativeAssertions("apps/api/src/domain/mcp/review-flow.ts", source), index);
    expect(countByVerdict(report)).toMatchObject({ STALE: 1, VERIFIED_ABSENT: 1 });
    expect(report.stale[0]!.identifier).toBe("createMessage");
  });
});

describe("断言成立时给出**正面**结论（零命中必须附带「这把尺子量得出东西」）", () => {
  it("点名的标识符在契约里查不到 ⇒ VERIFIED_ABSENT", () => {
    const report = judge(
      findNegativeAssertions(
        "apps/web/components/canvas/template-admin.tsx",
        "// 契约里没有任何 `deleteTemplate` 操作（全仓 grep 零命中）。\n",
      ),
      index,
    );
    expect(report.judgements).toHaveLength(1);
    expect(report.judgements[0]).toMatchObject({ identifier: "deleteTemplate", verdict: "VERIFIED_ABSENT" });
  });

  it("只查到字段声明（不是 operation）⇒ FIELD_ONLY，只报告不判红", () => {
    // `契约没有 ownerTeamId` 说的是「某个 in 里没有这一栏」；同名字段在别的束里存在，
    // 完全不妨碍这句话是真话。为这类断言判红就是制造假阳性。
    const report = judge(
      findNegativeAssertions(
        "apps/api/src/application/canvas/create-template.ts",
        "// C_CANVAS_8 ①：契约没有 `clientMessageId`，取创建者自己的团队。\n",
      ),
      index,
    );
    expect(report.stale).toHaveLength(0);
    expect(report.judgements[0]).toMatchObject({ verdict: "FIELD_ONLY" });
    expect(report.judgements[0]!.declaredAt).toMatchObject({ file: "packages/contracts/src/chat.ts" });
  });
});

/**
 * 这一组是**实测逼出来的**。第一版把「断言这句话里出现过的每个反引号标识符」都拿去
 * 核对，在真实树上报出 19 条 STALE，逐条读完几乎全是假阳性，且全是同一种形状：句子里
 * 点名的标识符是**对照物**，不是被否定的东西。一道会误报的门，第一次上线就会被 skip
 * 掉（#473 正文：「噪声淹没信号、最后被 skip」）。所以这些必须是绿的。
 */
describe("对照物不是被否定的东西 —— 这些真实句子必须不判红", () => {
  const cases: { name: string; file: string; source: string }[] = [
    {
      name: "句子自己就说了它存在（projects/[projectId]/page.tsx:28）",
      file: "apps/web/app/projects/[projectId]/page.tsx",
      source:
        "// 真实拉取需要 orgId——契约没有「按 id 直接读单个项目」的已挂路由（`createMessage` 在契约与应用层都有，但控制器从未挂那个 @Get）。\n",
    },
    {
      name: "点名的是「err 数组里没有这个码」的那几个 operation（interview/errors.ts:505）",
      file: "apps/api/src/application/interview/errors.ts",
      source:
        "// 契约本身没有为「回滚」声明专门的错误码（`createMessage`/`listThreads` 的 err 数组里都没有），如实登记为已知缺口。\n",
    },
    {
      name: "点名的是**已接上**的那些（admin/mcp-screen.tsx:355）",
      file: "apps/web/components/admin/mcp-screen.tsx",
      source:
        "// 契约里没有注销服务器的操作，也没有把放行评审接到后端的路由（`createMessage` / `listThreads` 仍未接线）。\n",
    },
    {
      name: "否定的是「出处」，标识符在破折号之后另起一句（project/tab-results.tsx:67）",
      file: "apps/web/components/project/tab-results.tsx",
      source: "// 这三个计数契约里还没有出处——`createMessage` 的白名单四件都不覆盖它。\n",
    },
    {
      name: "句末标点之后的标识符属于下一句（archive-project.ts:86）",
      file: "apps/api/src/application/project/archive-project.ts",
      source: "// 契约没有 NOT_FOUND。同 `createMessage` 里「非成员与非 lead 同码」的先例。\n",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const report = judge(findNegativeAssertions(c.file, c.source), index);
      expect(report.stale).toEqual([]);
      expect(report.proseCount).toBe(1);
    });
  }

  it("反引号里不是标识符（路径 / 枚举列举 / 语法片段）⇒ 不当作点名", () => {
    for (const src of [
      "// 契约里没有这个写端口（见 `lib/live-chat.ts` 头部）。\n",
      "// 契约里没有 `create | rename | delete` 之外的 op。\n",
      "// `INTERJECT_OP.method` 在契约里没有 `as const`，类型是宽的 `string`。\n",
    ]) {
      const report = judge(findNegativeAssertions("apps/web/x.ts", src), index);
      expect(report.stale).toEqual([]);
      expect(report.proseCount).toBe(1);
    }
  });
});

describe("散文断言：机械上不可判定，如实归 PROSE（不假装判过）", () => {
  /**
   * #473 现场那句注释的**原始措辞**没有点名任何标识符——本门抓不到它，这一点必须
   * 写在测试里，而不是留给读者以为「这门什么都能抓」。门实际买到的东西是：
   * 新写的否定性断言必须点名标识符（散文预算只减不增，见 `.mjs` 入口），
   * 而点名了的那些会被持续复核——#473 那句若按这条纪律写成
   * 「契约里没有 `createMessage`」，PR #429 合入当天这道门就会红。
   */
  it("原始措辞「契约里没有这个写端口」⇒ PROSE，不冒充 VERIFIED_ABSENT", () => {
    const report = judge(
      findNegativeAssertions(
        "apps/web/app/chat/live/page.tsx",
        "// ⚠ 没有「发消息」输入框：契约里没有这个写端口（见 `lib/live-chat.ts` 头部），这里如实留空。\n",
      ),
      index,
    );
    expect(report.judgements).toHaveLength(1);
    expect(report.judgements[0]!.verdict).toBe("PROSE");
    expect(report.proseCount).toBe(1);
  });

  it("引用一句已经作废的旧断言时，本门仍按断言计数（分不清引用与主张，取保守方向）", () => {
    const source =
      "// ⚠ 这里原先写着「契约没有消息创建端口」。那句话现在是假的，写端口一直都在。\n";
    const report = judge(findNegativeAssertions("apps/api/src/application/chat/ports.ts", source), index);
    expect(report.proseCount).toBe(1);
    expect(report.stale).toEqual([]);
  });

  it("不是在谈契约的否定句不算断言（本门只认「契约 + 否定」这一种形状）", () => {
    const report = judge(
      findNegativeAssertions("apps/web/x.ts", "// 这里没有 `createMessage`，因为本页只读。\n"),
      index,
    );
    expect(report.judgements).toEqual([]);
    expect(report.proseCount).toBe(0);
  });
});
