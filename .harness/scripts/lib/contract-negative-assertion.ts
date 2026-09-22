/**
 * 「对契约的否定性断言」机械门的判定逻辑（issue #473）。
 *
 * 分层同 `lib/body-path-param-leak.ts` 的先例：本文件是纯函数（喂字符串、可单测），
 * `lint-contract-negative-assertion.mjs` 只做「读真实文件 → 调本文件 → 定退出码」。
 *
 * ## 这道门为什么存在
 *
 * 2026-08-04，`apps/web/app/chat/live/page.tsx` 里逐字写着：
 *
 *     ⚠ 没有「发消息」输入框：契约里没有这个写端口（见 `lib/live-chat.ts` 头部）
 *
 * 那句话在写下的那天是真的。`packages/contracts/src/chat.ts` 后来加上了
 * `createMessage`（PR #429），**注释没跟着改**，于是仓库里多了一个会说谎的事实源。
 * 代价不是假想的：coord-main 据它建了一个完全不必要的 design-delta issue #461、派了
 * 一个不必要的高优先级网关 Task #112、把「签 #461」列为人类第一优先待办，并据此重排了
 * 两条工作链的优先级——全部已回滚（#461 关闭、#112 撤回、#462 降级、#470 公开更正）。
 *
 * `AGENTS.md` 第一条硬约束是「仓库即唯一事实来源」。推论是：**一个会说谎的事实源比
 * 缺失的事实源更贵——缺失只会让人去查，说谎会让人停止查。**
 *
 * 所以这类断言不能靠「有人记得回来改注释」维持，必须**会红**。
 *
 * ## 它只判一类断言，刻意不做全量注释 lint
 *
 * #473 明确写了：不要做成全量注释 lint，噪声淹没信号最后会被 skip 掉。本门只认
 * 「对契约做否定性断言」这一种形状（`契约里没有 X` / `契约没有 X` / `契约尚无 X`…），
 * 且只把其中**点名了契约标识符**的那部分当作可机械判定：
 *
 *   · 断言里用反引号点了一个 operation 名，而 `packages/contracts/src/` 里确实
 *     声明着这个 operation ⇒ **STALE，判红**。这是唯一的失败判据，它是确定的：
 *     operation 名是契约里的全局标识符，「契约里有没有 X 这个 operation」不需要
 *     任何解释就能回答。
 *   · 点名的标识符在契约里**查不到任何声明** ⇒ VERIFIED_ABSENT。这是唯一真正
 *     「被核实过」的断言，它今天成立，且哪天契约加上了这道门会当场红。
 *   · 点名的标识符只作为**字段/取值**出现（不是 operation）⇒ FIELD_ONLY，只报告
 *     不判红。理由：字段名不定位契约里的位置——`ownerTeamId` 在 A 束的某个 out 里
 *     存在，完全不妨碍「B 束的 createTemplate.in 里没有它」是真话。为了这类断言判红
 *     会制造假阳性，而一道会误报的门最后一定被 skip 掉。
 *   · 断言整句都是散文、没点名任何标识符（`契约里没有「分享线程」操作`）⇒ PROSE，
 *     机械上不可判定。这类走**只减不增的预算**（见 `.mjs` 入口），不逐条判红。
 *
 * ## 三个同族故障（#473 的两条补充评论）
 *
 * 本门挡的是第 ① 类。另两类不是被测对象的问题，是**测量仪器**的问题，只能靠纪律挡，
 * 一并记在这里，因为它们的结论长得一模一样（「我查了，没有」）：
 *
 *   ① 说谎的注释 —— 断言写下时为真，契约后来变了，注释没跟着改。**本门挡这一类。**
 *   ② 写坏的正则 —— `'"(POST|PUT|PATCH|DELETE)[^"]*messages'` 要求 method 与 path
 *      落在同一对引号内，而源码里它们是两个独立字符串字面量 ⇒ 该正则在任何树上恒返回 0。
 *   ③ 吞掉的参数 —— `grep -rn "x" apps/web --include=*.ts`（不加引号）在 zsh 下
 *      `--include=*.ts` 会被 glob 展开或报 `no matches found`，输出看起来就像「零命中」。
 *
 * 由此立的两条全队纪律（#473 第二条评论，coord-chat-e2e 提出、coord-main 采纳）：
 *
 *   1. 引用 grep / find / curl 的结果作为「某物不存在」的证据前，**先跑一个正样本**
 *      证明该命令在这条路径上量得出东西。
 *   2. 在断言、探针、文档里写下任何标识符之前，**先在仓库里定位到它的定义处**。
 *      正样本只证明「尺子有效」，不证明「你量的那个东西存在」——`capability-catalog`
 *      / `board-canvas.tsx` 这类凭印象编出来的标识符，第 1 条挡不住。
 */

/** 一份被扫的源文件。 */
export interface SourceFile {
  /** 仓库根的相对路径，出现在报告里。 */
  file: string;
  source: string;
}

/** 契约里的一处声明。 */
export interface Declaration {
  /** 声明所在文件（仓库相对路径）。 */
  file: string;
  line: number;
}

/**
 * 契约索引。**只收声明，不收注释里的提及**——这个区分是本模块的地基：
 * `createMessage` 在 `chat-file-upload.ts` 的注释里出现两次、在 `chat.ts:298` 的
 * 注释里也出现一次，如果按「文本里出现过」建索引，那么「契约里有没有它」就会被
 * 注释左右，而注释正是本门不信任的东西。
 */
export interface ContractIndex {
  /** operation 名 → 声明处。`foo: { method: "POST", path: ... }` 这种形状。 */
  operations: Map<string, Declaration>;
  /** 字段 / 取值名 → 首个声明处。只用来区分 FIELD_ONLY，不作判红依据。 */
  fields: Map<string, Declaration>;
}

/** 源码里的一条「对契约的否定性断言」。 */
export interface NegativeAssertion {
  file: string;
  /** 1-based，断言短语所在行。 */
  line: number;
  /** 断言短语起、到句末止的那一段原文（已去掉注释前缀，便于打印）。 */
  text: string;
  /** 断言里点名的契约标识符候选（反引号包住、operation 名形状的那些）。 */
  identifiers: string[];
}

export type Verdict =
  /** 断言说契约里没有 X，而 X 就是契约里的一个 operation —— 断言已经变假。判红。 */
  | "STALE"
  /** 点名的标识符在契约里查不到任何声明 —— 断言今天成立，且加上了就会红。 */
  | "VERIFIED_ABSENT"
  /** 只查到字段/取值声明，不是 operation —— 机械上不定位，只报告。 */
  | "FIELD_ONLY"
  /** 整句散文，没点名标识符 —— 机械上不可判定，走预算。 */
  | "PROSE";

export interface Judgement {
  assertion: NegativeAssertion;
  /** PROSE 时为 undefined。 */
  identifier?: string;
  verdict: Verdict;
  /** STALE / FIELD_ONLY 时给出契约里的声明处，方便一眼核对。 */
  declaredAt?: Declaration;
}

export interface Report {
  judgements: Judgement[];
  /** 判红的那些。 */
  stale: Judgement[];
  /** 机械上不可判定的断言条数（去重到「断言」而不是「标识符」粒度）。 */
  proseCount: number;
}

/* ── 契约索引 ───────────────────────────────────────────────────────── */

/** 行首是注释（`//`、`*`、`/*`）——索引一律跳过这些行，理由见 ContractIndex 注释。 */
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*)/;

/** `foo: {` / `"foo": {`。operation 与嵌套 zod 对象共用这个形状，靠后面 4 行里有没有 method 区分。 */
const KEY_OPEN_RE = /^\s*(?:["']?)([A-Za-z_]\w*)(?:["']?)\s*:\s*\{/;
const METHOD_RE = /\bmethod:\s*["'](?:GET|POST|PUT|PATCH|DELETE)["']/;

/**
 * 字段声明：`foo: z.string()`、`foo?: Message`、`foo: z.array(...)`。
 * 取 `z.` 开头或大写标识符开头的右值——contracts 里的字段值只有这两种形状。
 */
const FIELD_RE = /^\s*(?:["']?)([A-Za-z_]\w*)(?:["']?)\??\s*:\s*(z\.|[A-Z]\w*)/;

/** 这几个 key 是 operation 自己的结构，不是业务字段。 */
const STRUCTURAL_KEYS = new Set(["method", "path", "in", "out", "err"]);

/**
 * operation 声明后面 N 行内出现 `method: "POST"` 才算 operation。
 * 4 行是量出来的：`chat.ts` 里最松的一处是 `foo: {` 换行后 `method`/`path` 各占一行
 * 加一行 doc，2 行够；留到 4 行，不留到 10——放宽会把「某个嵌套 out 对象里恰好有个
 * 叫 method 的字段」误判成 operation。
 */
const METHOD_LOOKAHEAD = 4;

export function buildContractIndex(files: SourceFile[]): ContractIndex {
  const operations = new Map<string, Declaration>();
  const fields = new Map<string, Declaration>();

  for (const { file, source } of files) {
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!;
      if (COMMENT_LINE_RE.test(raw)) continue;

      const open = KEY_OPEN_RE.exec(raw);
      if (open) {
        const name = open[1]!;
        const window = lines.slice(i, i + METHOD_LOOKAHEAD + 1).join("\n");
        if (METHOD_RE.test(window) && !STRUCTURAL_KEYS.has(name)) {
          // 同名 operation 出现在多个束里（不同前缀）——留第一处就够定位。
          if (!operations.has(name)) operations.set(name, { file, line: i + 1 });
          continue;
        }
      }

      const field = FIELD_RE.exec(raw);
      if (field) {
        const name = field[1]!;
        if (STRUCTURAL_KEYS.has(name)) continue;
        if (!fields.has(name)) fields.set(name, { file, line: i + 1 });
      }
    }
  }

  return { operations, fields };
}

/* ── 断言识别 ───────────────────────────────────────────────────────── */

/**
 * 否定性断言短语。收的是本仓实际写过的措辞（`契约里没有` / `契约没有` /
 * `契约中没有` / `契约尚无` / `契约未提供` / `契约里没提供`…），不是穷举中文。
 * 新措辞出现时在这里补一条——这是本门唯一需要跟着自然语言走的地方，故意放在最显眼处。
 */
const NEGATIVE_RE =
  /契约(?:里|中|上)?(?:还|也|并|本身)?(?:没有|没提供|没声明|没定义|不提供|尚无|尚未提供|未提供|未声明|未定义)/g;

/** 断言止于句末标点：一句话讲完了，后面那句讲的是别的事，不该被并进来。 */
const SENTENCE_END_RE = /[。；!！?？]/;

/** 续行的注释前缀（` * `、`// `）与 JSX 缩进，打印与取标识符时都要去掉。 */
const CONTINUATION_PREFIX_RE = /^\s*(?:\/\/+|\*+\/?|\/\*+)?\s*/;

/**
 * 断言最多跨 3 行（起始行 + 2 行续行）。本仓的注释宽度约 90 列，点名的标识符常常
 * 被折到下一行（`template-admin.tsx:910` 的 `deleteTemplate` 就在续行上），只看
 * 一行会漏掉一半；放到 3 行以上则开始把下一段的标识符卷进来——那是假阳性方向，
 * 比漏判更贵。
 */
const ASSERTION_LINES = 3;

/**
 * 「被否定的那个东西」只取紧跟在否定短语后面的那一个（或那一串）反引号标识符。
 *
 * ⚠ 这条紧邻约束是本模块最要紧的一处设计，它是实测逼出来的。第一版是「断言这句话里
 * 出现过的每个反引号标识符都去核对」，在真实树上立刻报出 19 条 STALE，逐条读完**几乎
 * 全是假阳性**，而且全是同一种形状：句子里点名的标识符是**对照物**，不是被否定的东西。
 *
 *   · `契约没有「按 id 直接读单个项目」的已挂路由（`getProjectOverview` 在契约与应用层
 *      都有，但控制器从未挂那个 @Get）` —— 这句自己就说了它存在
 *   · `契约本身没有为"回滚"声明专门的错误码（`mergeThemes`/`splitThemes` 的 err 数组里
 *      都没有）` —— 被否定的是错误码，点名的是「err 数组里没有它」的那几个 operation
 *   · `契约里没有注销服务器的操作，也没有把授权范围/放行评审接到后端的路由
 *      （`registerMcpServer` / `reviewMcpServer`…）` —— 点名的是**已接上**的那些
 *
 * 一道会把这些判红的门，第一次上线就会被人 skip 掉——#473 正文写的「噪声淹没信号、
 * 最后被 skip」就是这个。所以：否定短语之后必须**立刻**是反引号（中间只容许少数几个
 * 量词/指示词），否则这条断言归 PROSE，本门不替它下结论。
 */
const MODIFIER = "(?:任何一个|任何|这一条|这一个|这个|这条|单独的|单条|单个|第二条|第二个|专门的|名为|一个|一条)";
const ADJACENT_ID_RE = new RegExp(`^\\s*(?:${MODIFIER}\\s*){0,2}\`([^\`]+)\``);

/**
 * 同一条断言可以一次否定好几个 operation：`契约里没有 \`deleteReview\` / \`updateReview\` 操作`。
 * 这里只接受纯分隔符（`/`、`、`、`与`、`和`、`或`、`,`）连接的后续反引号项——一旦中间
 * 夹了别的字，就不再是「同一个否定的并列宾语」了，停。
 */
const NEXT_ID_RE = /^\s*(?:[/、,，]|与|和|或)\s*`([^`]+)`/;

/**
 * 候选是否长得像契约里的 operation 名：单个 lowerCamelCase 词，或
 * `chat.createMessage` 这种带束前缀的形式（取最后一段）。
 * 这条过滤把 `lib/live-chat.ts`（路径）、`POST /x`（方法+路径）、`create | rename`
 * （枚举列举）这些非标识符的反引号内容挡在外面。
 */
function identifierCandidate(raw: string): string | null {
  const text = raw.trim();
  if (/^[a-z][A-Za-z0-9]*$/.test(text)) return text;
  const dotted = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/.exec(text);
  if (dotted) return text.slice(text.lastIndexOf(".") + 1);
  return null;
}

/** 从否定短语之后的文本里取「被否定的那一串标识符」。 */
function adjacentIdentifiers(after: string): string[] {
  const first = ADJACENT_ID_RE.exec(after);
  if (!first) return [];
  const ids: string[] = [];
  const push = (raw: string) => {
    const id = identifierCandidate(raw);
    if (id && !ids.includes(id)) ids.push(id);
  };
  push(first[1]!);
  let rest = after.slice(first[0].length);
  for (;;) {
    const next = NEXT_ID_RE.exec(rest);
    if (!next) break;
    push(next[1]!);
    rest = rest.slice(next[0].length);
  }
  return ids;
}

export function findNegativeAssertions(file: string, source: string): NegativeAssertion[] {
  const lines = source.split("\n");
  const out: NegativeAssertion[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    NEGATIVE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NEGATIVE_RE.exec(line)) !== null) {
      // 断言窗口：本行从短语起到行尾，再接最多 2 行续行，整体在第一个句末标点处截断。
      const pieces: string[] = [line.slice(m.index)];
      for (let k = 1; k < ASSERTION_LINES; k++) {
        const next = lines[i + k];
        if (next === undefined) break;
        if (SENTENCE_END_RE.test(pieces[pieces.length - 1]!)) break;
        pieces.push(next.replace(CONTINUATION_PREFIX_RE, ""));
      }
      let text = pieces.join(" ");
      const end = SENTENCE_END_RE.exec(text);
      if (end) text = text.slice(0, end.index + 1);

      // 被否定的宾语只在否定短语**之后**找，且必须紧邻——见 ADJACENT_ID_RE 的注释。
      const identifiers = adjacentIdentifiers(text.slice(m[0].length));

      out.push({ file, line: i + 1, text: text.trim(), identifiers });
    }
  }

  return out;
}

/* ── 判定 ───────────────────────────────────────────────────────────── */

export function judge(assertions: NegativeAssertion[], index: ContractIndex): Report {
  const judgements: Judgement[] = [];
  let proseCount = 0;

  for (const assertion of assertions) {
    if (assertion.identifiers.length === 0) {
      proseCount++;
      judgements.push({ assertion, verdict: "PROSE" });
      continue;
    }
    for (const identifier of assertion.identifiers) {
      const op = index.operations.get(identifier);
      if (op) {
        judgements.push({ assertion, identifier, verdict: "STALE", declaredAt: op });
        continue;
      }
      const field = index.fields.get(identifier);
      if (field) {
        judgements.push({ assertion, identifier, verdict: "FIELD_ONLY", declaredAt: field });
        continue;
      }
      judgements.push({ assertion, identifier, verdict: "VERIFIED_ABSENT" });
    }
  }

  return { judgements, stale: judgements.filter((j) => j.verdict === "STALE"), proseCount };
}

export function countByVerdict(report: Report): Record<Verdict, number> {
  const out: Record<Verdict, number> = { STALE: 0, VERIFIED_ABSENT: 0, FIELD_ONLY: 0, PROSE: 0 };
  for (const j of report.judgements) out[j.verdict]++;
  return out;
}
