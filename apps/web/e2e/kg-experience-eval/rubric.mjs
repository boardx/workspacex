/**
 * phase-18 F15 记忆体验评测集的**评分口径**：十个维度（06-user-experience.md R4 E1–E10）与「哪些文件定义了检查」。
 *
 * 维度得分 = 该维通过条数 / 该维总条数（0–1），总分 = 十维之和（0–10），阶段退出门槛 ≥ 9.0（R4 原文）。
 *
 * ## 冻结（R4「用例与检查在 R0 冻结，之后只能修评测自身的 bug，并写明理由；不许为了分数放宽检查」）
 * `rubricHash()` 是下面 `RUBRIC_FILES` 全部内容的 sha256：检查本身（*.eval.ts）、语料（cases.json）、共用动作
 * （eval-helpers.ts）、打分（本文件与 score.mjs）、账号与栈（fixture.ts、playwright config）、以及决定回答长什么样的
 * 回环模型与种子——回环模型如果被改成「直接照语料答」，所有检查都会假绿，所以它也在锁里。
 * R0 的哈希与检查清单写在 `evidence/kg-experience-eval/rubric-lock.json`；之后任何一个字节的改动都会让哈希变，
 * 门（`apps/web/tests/kg-experience/score-gate.test.ts`）就要求锁文件里有一条带理由的修订记录对应这个新哈希。
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
export const EVIDENCE_DIR = "evidence/kg-experience-eval";
export const LOCK_FILE = `${EVIDENCE_DIR}/rubric-lock.json`;
export const PASS_MARK = 9.0;

/** 维度定义的唯一出处（名称与「量什么」逐字取自 06-user-experience.md R4）。 */
export const DIMENSIONS = {
  E1: { name: "零负担", what: "新用户不做任何设置，聊 3 轮后开新会话，回答里出现「来自你之前的对话」；全过程记忆相关点击数 = 0" },
  E2: { name: "记得住", what: "固定 20 题回忆（人名、决定、数字、日期、原因）：每题答对且带引用；答对率 ≥ 90% 即本维 ≥ 0.9" },
  E3: { name: "答得对", what: "关系类题（谁定的 / 为什么 / 被什么取代）；hybrid 比纯向量多答对 ≥ 20%" },
  E4: { name: "有出处", what: "回答里 100% 的记忆引用可点，点开就是原话，且原话被高亮" },
  E5: { name: "改得快", what: "纠正一条记忆 ≤ 2 次点击；说「忘掉 X」后，下一轮就不再提 X" },
  E6: { name: "看得懂", what: "界面文案不含 R5 禁用词（自动扫描）；状态不只靠颜色区分（带文字）" },
  E7: { name: "会提醒", what: "前后矛盾的说法，在第二次出现时的回答里出现冲突提示卡；忽略后同一冲突不再重复打扰" },
  E8: { name: "不打扰", what: "一轮对话里主动提示最多 1 条；「已记下」提示是单行，不遮挡正文" },
  E9: { name: "放心", what: "面板常驻可见范围说明；另一个账号访问同一条记忆返回 403，界面显示「无权查看」" },
  E10: { name: "不卡顿", what: "开启记忆前后，发消息到首字的时间差 ≤ 100ms；图或向量故障时对话照常，只多一行说明" },
};

/** 定义检查的文件（相对仓库根）。本目录下除了 *.d.mts 类型声明，全部在锁里。 */
export function rubricFiles() {
  const dir = relative(REPO_ROOT, HERE);
  const own = readdirSync(HERE)
    .filter((f) => !f.endsWith(".d.mts"))
    .map((f) => `${dir}/${f}`);
  return [
    ...own,
    "apps/web/playwright.kg-experience-eval.config.ts",
    "apps/api/scripts/loopback-kg-eval-model-provider.ts",
    "apps/api/scripts/seed-kg-experience-eval.ts",
  ].sort();
}

/** 检查定义的指纹：文件名 + 内容，逐个进哈希（换行统一成 \n，免得换个检出方式就变）。 */
export function rubricHash(root = REPO_ROOT) {
  const h = createHash("sha256");
  for (const f of rubricFiles()) {
    h.update(`${f}\n`);
    h.update(readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n"));
    h.update("\n\0\n");
  }
  return h.digest("hex");
}

/** 检查标题的前缀：`[E2.c01] …`。没有这个前缀的测试不计分（也不该存在）。 */
export const CHECK_TITLE = /^\[(E\d+)\.(c\d+)\]\s*(.*)$/;

/** 按维度折分：维度得分 = 通过 / 总数；总分 = 十维之和（保留两位）。 */
export function scoreChecks(checks) {
  const dims = Object.keys(DIMENSIONS).map((d) => {
    const cs = checks.filter((c) => c.dim === d);
    const passed = cs.filter((c) => c.passed).length;
    return { dim: d, ...DIMENSIONS[d], passed, total: cs.length, score: cs.length === 0 ? 0 : passed / cs.length };
  });
  const total = Number(dims.reduce((s, d) => s + d.score, 0).toFixed(2));
  return { dims, total };
}
