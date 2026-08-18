/**
 * 判定逻辑：某个前端 API 封装文件里，写请求（PUT/POST/PATCH）的 `body` 字面量
 * 里不该出现「这次调用已经通过 URL 路径传递」的那个参数名——同 `lib/rewrite-coverage.ts`
 * 的分层（纯函数 + fixture 单测，脚本入口只做「读真文件 → 调它 → 定退出码」）。
 *
 * ## 这条门为什么存在（F961，2026-08-18，issue #1580）
 *
 * F950 的 `saveProjectTopic`/`saveProjectGrouping`（及同批的 `saveInterviewSubjects`）
 * 三处都把 `projectId`（有的还带 `groupId`）塞进了 PUT 请求的 body——而对应 controller
 * 的 body schema 是 `C.operations.xxx.in.omit({ projectId: true })`：`.omit()` **保留**
 * 契约 object 本身的 `.strict()`，所以 body 里多出的 `projectId` 会被 zod 判成未知字段，
 * 整个请求 400。这三处从 F950 合入 main 起，在真实浏览器里一次都没成功过——而全部
 * 组件测试绿，因为它们 mock 的 `fetch` 只记录 body、不像真的 zod 那样拒绝（F961 复核
 * 详述，见 PR #1549）。本文件把「路径参数不进 body」这条隐含约束变成机械可查。
 *
 * ## 判据必须按「调用点」而不是「文件」聚合路径参数（v1 的一次真实反证）
 *
 * 最初版本按文件聚合「这个文件里出现过哪些 `:paramName`」，结果在 `live-canvas.ts`
 * 上当场假阳性：`createCanvasTemplate` 的 POST 请求本身没有任何路径参数（`key` 是
 * 新建时选的业务字段，理应在 body 里），却因为**同一文件里别的函数**（更新/发布某个
 * 已存在模板）用了 `.replace(":key", ...)`，被牵连报成「泄漏」。同一份「事实」（这个
 * 调用有没有路径参数）不能靠文件级聚合去猜——必须回到「这一次 `apiRequest(...)` 调用
 * 的第一个参数实际替换了哪些 `:paramName`」。故本版按调用点解析：
 *
 *   1. 找每一处 `apiRequest(...)` 调用，按括号配平切出完整调用文本，再按顶层逗号
 *      （跳过嵌套括号/字符串）切出参数列表：`[pathExpr, optionsObj?]`。
 *   2. 从 `pathExpr` 里直接抓 `.replace(":x", ...)` 用到的参数名。
 *   3. 若 `pathExpr` 是「调用一个本文件内定义的小函数」（如 `subjectsPath(a, b)`——
 *      本仓把路径拼接抽成小函数是常见写法，见 `live-project-prep.ts`），额外解析
 *      **那个函数自己的函数体**里用到的 `:paramName`，一并纳入——只展开一层，不递归
 *      追更深的调用链，跟这个仓库实际写法的复杂度匹配就够。
 *   4. 只在 `optionsObj` 里找 `body: { ... }`，抓其中 key 名（任意深度，见下方保守方向
 *      的说明），与第 2/3 步收集到的「这次调用的路径参数」比对，命中才报 gap。
 *
 * 保守方向：`body` 里嵌套对象/数组的深层 key 恰好与路径参数同名也算命中——这类真正的
 * 假阳性理论上存在但目前没遇到过，遇到了走 allowlist（同 `rewrite-coverage-allowlist.json`
 * 的棘轮先例），不为了这个理论风险牺牲判据的简单可读。
 */

export interface WebLibFileInput {
  readonly file: string;
  readonly source: string;
}

export interface BodyPathParamLeakGap {
  readonly file: string;
  readonly param: string;
  readonly line: number;
  readonly snippet: string;
}

export interface BodyPathParamLeakReport {
  readonly incomplete: boolean;
  readonly incompleteReason?: string;
  readonly filesScanned: number;
  readonly gaps: readonly BodyPathParamLeakGap[];
}

const PATH_PARAM_IN_TEXT_RE = /\.replace\(\s*["'`]:([A-Za-z0-9_]+)["'`]/g;
const API_REQUEST_CALL_RE = /\bapiRequest\s*\(/g;
const FUNCTION_DEF_RE =
  /(?:function\s+(\w+)\s*\([^)]*\)|const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>)\s*\{/g;

function pathParamsIn(text: string): Set<string> {
  const set = new Set<string>();
  const re = new RegExp(PATH_PARAM_IN_TEXT_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) set.add(m[1]!);
  return set;
}

/** 从某个开括号起做配平计数，返回配对括号内的完整子串（含首尾）。不平衡则 null。 */
function extractBalanced(source: string, openIndex: number, open: string, close: string): string | null {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return null;
}

/** 按顶层逗号切参数列表（跳过嵌套的 ()/[]/{} 与字符串/模板字面量）。 */
function splitTopLevelArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (quote) {
      cur += ch;
      if (ch === quote && inner[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      args.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim().length > 0) args.push(cur);
  return args;
}

/** 抓出一段对象字面量里出现的全部 `key:` 名（任意深度——见文件头注，刻意选保守方向）。 */
function extractObjectKeys(objectLiteral: string): string[] {
  const keys: string[] = [];
  const re = /[{,]\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(objectLiteral)) !== null) keys.push(m[1]!);
  return keys;
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source[i] === "\n") line++;
  return line;
}

/** 本文件内定义的具名函数/箭头函数：名字 → 函数体文本（用于展开一层 helper 调用）。 */
function indexLocalFunctions(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = new RegExp(FUNCTION_DEF_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1] ?? m[2];
    if (!name) continue;
    const openBrace = m.index + m[0].length - 1;
    const body = extractBalanced(source, openBrace, "{", "}");
    if (body) map.set(name, body);
  }
  return map;
}

/** `pathExpr` 是否是「单纯调用某个本地函数」，若是则返回那个函数名。 */
function asLocalHelperCall(pathExpr: string, localFns: Map<string, string>): string | null {
  const trimmed = pathExpr.trim();
  const m = /^(\w+)\(/.exec(trimmed);
  if (!m) return null;
  const name = m[1]!;
  return localFns.has(name) ? name : null;
}

export function analyzeBodyPathParamLeaks(files: readonly WebLibFileInput[]): BodyPathParamLeakReport {
  if (files.length === 0) {
    return {
      incomplete: true,
      incompleteReason: "没有传入任何文件——扫不全，不判定「没有泄漏」",
      filesScanned: 0,
      gaps: [],
    };
  }

  const gaps: BodyPathParamLeakGap[] = [];

  for (const { file, source } of files) {
    const localFns = indexLocalFunctions(source);
    const callRe = new RegExp(API_REQUEST_CALL_RE);
    let cm: RegExpExecArray | null;
    while ((cm = callRe.exec(source)) !== null) {
      const openParenIndex = cm.index + cm[0].length - 1; // "apiRequest(" 的最后一个字符就是 "("
      const callText = extractBalanced(source, openParenIndex, "(", ")");
      if (callText === null) continue;
      const inner = callText.slice(1, -1); // 去掉外层 ( )
      const args = splitTopLevelArgs(inner);
      if (args.length < 2) continue; // 没有 options 对象，不可能有 body

      const pathExpr = args[0]!;
      const optionsObj = args.slice(1).find((a) => a.trim().startsWith("{"));
      if (!optionsObj) continue;

      // 第 2 步：调用点自己直接写的路径参数。
      const params = pathParamsIn(pathExpr);
      // 第 3 步：展开一层 helper 函数调用。
      const helperName = asLocalHelperCall(pathExpr, localFns);
      if (helperName) {
        for (const p of pathParamsIn(localFns.get(helperName)!)) params.add(p);
      }
      if (params.size === 0) continue; // 这次调用没有任何路径参数，本判据不适用

      const bodyMatch = /\bbody\s*:\s*\{/.exec(optionsObj);
      if (!bodyMatch) continue;
      const bodyOpenBrace = bodyMatch.index + bodyMatch[0].length - 1;
      const bodyBlock = extractBalanced(optionsObj, bodyOpenBrace, "{", "}");
      if (bodyBlock === null) continue;

      const bodyKeys = extractObjectKeys(bodyBlock);
      for (const key of bodyKeys) {
        if (params.has(key)) {
          gaps.push({
            file,
            param: key,
            line: lineOf(source, openParenIndex),
            snippet: bodyBlock.slice(0, 120).replace(/\s+/g, " "),
          });
        }
      }
    }
  }

  return { incomplete: false, filesScanned: files.length, gaps };
}
