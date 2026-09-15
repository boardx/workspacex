#!/usr/bin/env node
/**
 * `/agent/team4` 验收打分器 v2 —— 口径见 `docs/agents/team4-acceptance-rubric.md`。
 *
 * v2（人类指令「从需求的功能性满足，以及可用性的角度评估」）把权重改成
 * 功能性 6 / 可用性 3 / 支撑 1：评的是"这个 Agent 把投后报告这件事干成了没有、
 * 人能不能顺畅用起来"，不是工程卫生。
 *
 * 为什么要有这个脚本：本会话环境跑不了真实模型（无 docker / 无 provider 凭据），
 * 自评"感觉不错"是没有证据的自我宣称。它读**真实仓库文件**机械算分，每一分都能
 * 指到具体文件的具体内容。
 *
 * 用法：
 *   node apps/web/scripts/team4-acceptance-score.mjs           # 打分并打印明细
 *   node apps/web/scripts/team4-acceptance-score.mjs --json    # 机器可读
 *   node apps/web/scripts/team4-acceptance-score.mjs --min 9   # 低于 9 分退出码非 0
 *
 * ⚠ 它不评模型输出质量——那要在配了真实模型的环境里跑三包材料人工核对。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `apps/web/scripts/` → 仓库根要上三层。少一层会让所有 read() 静默返回 null、
 *  把"文件里明明有内容"评成 0 分——打分器自己先得对，否则它只是另一个假绿。 */
const repoFlag = process.argv.indexOf("--repo");
/** `--repo <path>`：对另一份（可能被刻意篡改的）副本打分——反证测试用它证明本脚本
 *  真的在读内容，而不是恒返回一个好看的数。默认是本仓库根。 */
const REPO = repoFlag !== -1
  ? process.argv[repoFlag + 1]
  : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel) => (existsSync(join(REPO, rel)) ? readFileSync(join(REPO, rel), "utf8") : null);
const has = (rel) => existsSync(join(REPO, rel));

const P = {
  methodology: "apps/web/lib/post-investment/methodology.ts",
  rules: "packages/contracts/src/post-investment-rules.ts",
  skillIdentity: "apps/web/lib/post-investment/skill-identity.ts",
  skillContent: "apps/api/scripts/post-investment-skill-content.ts",
  skillSeed: "apps/api/src/infrastructure/skill/ensure-platform-skill-catalog.ts",
  ensureThread: "apps/web/lib/post-investment/ensure-thread.ts",
  ensureAgent: "apps/web/lib/post-investment/ensure-agent.ts",
  entry: "apps/web/components/agent/post-investment-chat-entry.tsx",
  derive: "apps/api/src/application/post-investment/derive-financial-metrics.ts",
  deriveTest: "apps/api/tests/post-investment/derive-financial-metrics.test.ts",
  fixtures: "apps/web/lib/post-investment/fixtures.ts",
  fixtureExport: "apps/web/scripts/team4-export-fixtures.mjs",
  directory: "apps/web/lib/post-investment/agent-directory.ts",
  doc: "docs/agents/team4-post-investment-report-mvp.md",
  rubric: "docs/agents/team4-acceptance-rubric.md",
  routePage: "apps/web/app/agent/[teamId]/page.tsx",
  selfTest: "apps/web/tests/team4-acceptance-score.test.ts",
  legacyLauncher: "apps/web/components/agent/post-investment-launcher.tsx",
  legacyPrompt: "apps/web/lib/post-investment/analysis-prompt.ts",
};

/**
 * 模型最终看到的方法论 = `buildPostInvestmentSkillContent()` 的**渲染结果**。
 *
 * ⚠ 早先这里是"把 methodology.ts 与 rules.ts 两份源码文本拼起来"评的——那是静态痕迹，
 * 不是动态事实（AGENTS.md 那条纪律）：渲染函数里少写一个 `${renderRiskCriteria()}`
 * 插值，源码里判据一个不少、模型却一条也看不到，打分照样满分。所以现在真的用 tsx
 * 执行一次渲染，评拿到的那段文字。
 *
 * 渲染失败（缺依赖 / TS 编译错）不静默回退成"看源码"——那等于把假绿的口子重新开一遍。
 * 回退仍会发生（否则整个打分器不可用），但会打上 `degraded` 标记并在 S3 扣分，
 * 让"渲染不出来"这件事本身是可见的失分项。
 */
let renderedCache = null;
function renderedMethodology() {
  if (renderedCache !== null) return renderedCache;
  const entryFile = join(REPO, P.methodology);
  try {
    const out = execFileSync(
      process.execPath,
      [join(REPO, "node_modules/tsx/dist/cli.mjs"), "-e",
        `import { buildPostInvestmentSkillContent } from ${JSON.stringify(entryFile)};` +
        `process.stdout.write(buildPostInvestmentSkillContent());`],
      { encoding: "utf8", cwd: REPO, stdio: ["ignore", "pipe", "pipe"] },
    );
    renderedCache = { text: out, degraded: false };
  } catch (error) {
    renderedCache = {
      text: `${read(P.methodology) ?? read(P.legacyPrompt) ?? ""}\n${read(P.rules) ?? ""}`,
      degraded: true,
      reason: String(error).split("\n")[0],
    };
  }
  return renderedCache;
}
const methodology = () => renderedMethodology().text;

/* ── 15 个测试点：needs=方法论必须具备的判据；evidence=示例材料必须含的触发证据。
 *    标准答案不在这里，也不进任何模型可读上下文。
 * ⚠ 跨文件类判据用 `/哪两份材料/` 而不是泛词 `/跨文件/`：反证测试实测发现，只要正文
 *   任何地方出现过「跨文件」三个字就算命中——删掉整节跨文件关联指引，分数竟然不降。
 *   判据必须钉在「方法论是否真给出了可执行的跨文件指令」上，不是关键词出现过没有。 */
const TEST_POINTS = [
  { id: "A-R01", needs: [/增收不增利/, /增速差/], evidence: [/4,?680/, /18\.2%/, /385/, /32\.1%/] },
  { id: "A-R02", needs: [/利润与现金背离|由正转负/], evidence: [/-860/, /\+?420/] },
  { id: "A-R03", needs: [/资本化率/, /行业/], evidence: [/1,?200/, /960/] },
  { id: "B-R01", needs: [/集中度/, /单方终止权|终止本合同/], evidence: [/72%/, /38%/, /第8\.3条|8\.3/] },
  { id: "B-R02", needs: [/存货/, /需求收缩|退坡/, /跌价/, /哪两份材料/], evidence: [/3,?465/, /2,?100/, /退坡30%|退坡 30%/] },
  { id: "B-R03", needs: [/关联方?.*价差|价差.*关联/], evidence: [/14\.2/, /瀚宇化工/] },
  { id: "B-R04", needs: [/新规|VOC|排放/, /改造|未达标/, /财报未|未在财报|未体现/], evidence: [/48mg|48 ?mg/, /RTO/] },
  { id: "B-R05", needs: [/补助/, /扣非/, /退坡|缩减/], evidence: [/1,?150/, /48%/, /缩减50%|缩减 50%/] },
  { id: "C-R01", needs: [/完成率|入组|里程碑/, /未解释原因|未说明原因|未披露原因/], evidence: [/218/, /360/, /60\.6%/] },
  { id: "C-R02", needs: [/现金跑道/, /里程碑所需月数|所需月数/, /缺口/, /哪两份材料/], evidence: [/4,?200/, /4,?080/] },
  { id: "C-R03", needs: [/竞品/, /获批|医保/], evidence: [/XY-302/, /医保/] },
  { id: "C-R04", needs: [/回购|对赌/, /截止日|触发日/, /无法支撑|难以满足|能否满足/], evidence: [/2026年6月30日/, /8%/] },
  { id: "C-R05", needs: [/保护期|专利/, /获批日|上市时点|预计获批/, /独占期/], evidence: [/2038年3月21日/, /2027/] },
  { id: "C-R06", needs: [/CRO/, /适应性设计变更/, /中期数据|不及预期|暗示/], evidence: [/380/, /药明康德|科瑞斯/] },
  { id: "C-R07", needs: [/自相矛盾|冲突/, /双方.*出处|冲突双方/, /不许沿用|不得沿用|不要沿用/, /分叉|两种情形|不同版本/], evidence: [/2028年3月22日/, /2038年3月21日/] },
];

/** F2：投后报告必需的字段集。 */
const REQUIRED_FIELDS = [
  /营业收入/, /净利润/, /毛利率/, /经营性现金流|经营现金流/, /应收账款/, /周转天数/, /存货/,
  /研发支出/, /资本化/, /补助/, /集中度/, /关联方/, /货币资金/, /月均经营净流出|月均净流出/,
  /回购|清算优先|反稀释/, /到期日/, /里程碑/,
];

/** F5：七件产出。 */
const DELIVERABLES = [
  /分析底稿/, /外部对标/, /风险清单/, /需核实清单/, /追问清单/, /退出前置条件/, /时间轴/,
];

const results = [];
const add = (dim, label, earned, max, detail = "ok") => results.push({ dim, label, earned, max, detail });
/** 逐条命中的通用打分：hits/total × max。 */
const ratio = (hits, total, max) => (total === 0 ? 0 : (hits / total) * max);

/* ══════════ F1 材料摄入（0.8）══════════ */
{
  const m = methodology();
  const entry = read(P.entry) ?? "";
  const intake = read("apps/web/lib/post-investment/intake.ts") ?? "";
  const launcher = read(P.legacyLauncher) ?? "";
  const surface = entry + intake + launcher;
  const formats = /pdf|PDF/.test(surface + m) && /xlsx|XLSX/.test(surface + m) && /pptx|PPTX/.test(surface + m);
  const realAttachment = /uploadAttachment|附件/.test(surface + m);
  const parseTool = /wx_document_parse/.test(m + (read(P.directory) ?? ""));
  const evidenceTable = /依据表/.test(m) && /来源文件/.test(m);
  const unparsed = /未能解析清单/.test(m + surface);
  add("F1", "材料摄入（多格式·真实附件·解析要求·未能解析清单）",
    (formats && realAttachment ? 0.3 : 0) + (parseTool && evidenceTable ? 0.3 : 0) + (unparsed ? 0.2 : 0), 0.8,
    `formats=${formats} attachment=${realAttachment} parseTool=${parseTool} evidenceTable=${evidenceTable} unparsed=${unparsed}`);
}

/* ══════════ F2 财务分析与确定性派生计算（1.0）══════════ */
{
  const m = methodology();
  const fieldHits = REQUIRED_FIELDS.filter((re) => re.test(m)).length;
  const fieldScore = ratio(fieldHits, REQUIRED_FIELDS.length, 0.3);

  const derive = read(P.derive) ?? "";
  const formulas = ["computeYoyPct", "capitalizationRate", "concentrationRatio", "relatedPartyPriceGapPct", "cashRunwayMonths", "runwayGapMonths"];
  const implemented = formulas.filter((f) => derive.includes(f)).length;
  const t = read(P.deriveTest) ?? "";
  const realNums = [/4680|4,680/, /960/, /4200|4,200/, /6\.2/].filter((re) => re.test(t)).length;
  const formulaScore = ratio(implemented, formulas.length, 0.15) + ratio(realNums, 4, 0.15);

  const sandbox = /沙箱/.test(m) && /不.{0,6}心算/.test(m);
  const selfCheck = /自检/.test(m) && /18\.2%/.test(m) && /80%/.test(m);
  const rawOutput = /原样贴出|原样输出|不要转述/.test(m);
  const disciplineScore = (sandbox ? 0.2 : 0) + (selfCheck ? 0.1 : 0) + (rawOutput ? 0.1 : 0);

  add("F2", `财务分析与确定性计算（字段 ${fieldHits}/${REQUIRED_FIELDS.length}·公式 ${implemented}/6·真实数字 ${realNums}/4）`,
    fieldScore + formulaScore + disciplineScore, 1.0,
    `sandbox=${sandbox} selfCheck=${selfCheck} rawOutput=${rawOutput}`);
}

/* ══════════ F3 风险识别覆盖（1.5）══════════ */
{
  const m = methodology();
  const missed = [];
  let hit = 0;
  for (const tp of TEST_POINTS) {
    if (tp.needs.every((re) => re.test(m))) hit += 1;
    else missed.push(`${tp.id}(${tp.needs.filter((re) => !re.test(m)).map(String).join(",")})`);
  }
  add("F3", `风险识别判据覆盖 ${hit}/${TEST_POINTS.length}`, ratio(hit, TEST_POINTS.length, 1.5), 1.5,
    missed.length ? `缺: ${missed.join(" ")}` : "全覆盖");
}

/* ══════════ F4 外部公开信息与同业对标（0.8）══════════ */
{
  const m = methodology();
  const channels = [/企查查|qcc/, /天眼查|tianyancha/, /裁判文书|wenshu/, /交易所|巨潮|cninfo/, /证监会|csrc/, /统计局|stats/];
  const channelHit = channels.filter((re) => re.test(m)).length;
  const provenance = /来源标题/.test(m) && /URL/.test(m) && /获取时间/.test(m) && /分栏/.test(m);
  const peers = /可比(上市)?公司/.test(m) && /(选取理由|口径年度|指标定义|偏离)/.test(m);
  const degrade = /未取证/.test(m) && /(不得|不要|不许).{0,10}(冒充|顶替)/.test(m);
  add("F4", `外部信息与同业对标（渠道 ${channelHit}/${channels.length}）`,
    ratio(channelHit, channels.length, 0.3) + (provenance ? 0.2 : 0) + (peers ? 0.2 : 0) + (degrade ? 0.1 : 0), 0.8,
    `provenance=${provenance} peers=${peers} degrade=${degrade}`);
}

/* ══════════ F5 报告产出与逐数可追溯（1.0）══════════ */
{
  const m = methodology();
  const delivered = DELIVERABLES.filter((re) => re.test(m)).length;
  const sourceList = /数据来源清单/.test(m);
  const artifacts = /pdf-create/.test(m) && /xlsx-create/.test(m);
  const timeline = /风险窗口时间轴/.test(m) && /(政策生效|到期日|截止日)/.test(m);
  add("F5", `报告产出与可追溯（产出件 ${delivered}/${DELIVERABLES.length}）`,
    ratio(delivered, DELIVERABLES.length, 0.4) + (sourceList ? 0.2 : 0) + (artifacts ? 0.2 : 0) + (timeline ? 0.2 : 0), 1.0,
    `sourceList=${sourceList} artifacts=${artifacts} timeline=${timeline}`);
}

/* ══════════ F6 人在环路（0.9）══════════ */
{
  const m = methodology();
  const round1 = /确认/.test(m) && /驳回/.test(m) && /补充/.test(m) && /存疑/.test(m) && /尊重.{0,6}驳回/.test(m);
  const round2 = /(高\/中\/低|风险分级|打.{0,4}高)/.test(m) && /深挖/.test(m) && /只做.{0,10}勾选/.test(m) && /算式/.test(m);
  const feedback = /主观偏差/.test(m) && /信息缺失/.test(m) && /不改任何(数字|分数)/.test(m);
  const schedule = /wx_schedule_create/.test(m);
  add("F6", "人在环路（两轮确认·分级深挖·反馈五分类·定期报告）",
    (round1 ? 0.3 : 0) + (round2 ? 0.3 : 0) + (feedback ? 0.2 : 0) + (schedule ? 0.1 : 0), 0.9,
    `round1=${round1} round2=${round2} feedback=${feedback} schedule=${schedule}`);
}

/* ══════════ U1 入口一步可达（0.8）══════════ */
{
  const entry = read(P.entry) ?? "";
  const route = read(P.routePage) ?? "";
  const thread = read(P.ensureThread) ?? "";
  const wired = /PostInvestmentChatScreen/.test(route);
  const intoChat = /CopilotKitV2Shell/.test(entry);
  /**
   * ⚠ 2026-09-15 真机截图暴露的缺口：光"挂进 roster + 打开 chat"不够——那只决定
   * "这条线程编制里有谁"，不决定"这次请求用哪个 agent"。后者看 chat 的
   * `selectedAgentId`（→ header → 服务端 `resolveEffectiveAgentId`）；不选中就落到
   * org 动态默认（通用助手）回答，本 Agent 的 instructions 一行都没进 system prompt。
   * 截图里用户问"你可以做什么"，答的是通用助手的能力清单——**这条判据以前不存在，
   * 所以打分器给了满分而实际是坏的**。现在钉住：入口必须把自己的 agentId 交给选择
   * provider，且 `ensure-thread` 必须把 agentId 一并交出来（只给 threadId 就漏了）。
   */
  const agentSelected = /initialAgentId/.test(entry) && /agentId/.test(entry)
    && /PostInvestmentSession/.test(thread) && /agentId/.test(thread);
  const autoReady = Boolean(read(P.ensureAgent)) && /mountSkills/.test(thread);
  const noSelfUi = !has(P.legacyLauncher);
  add("U1", "入口一步可达（进真 chat·本 Agent 真被选中·Skill 自动就位·不自建窄版 UI）",
    (wired && intoChat ? 0.25 : 0) + (agentSelected ? 0.25 : 0) + (autoReady ? 0.15 : 0) + (noSelfUi ? 0.15 : 0), 0.8,
    `wired=${wired} intoChat=${intoChat} agentSelected=${agentSelected} autoReady=${autoReady} noSelfUi=${noSelfUi}`);
}

/* ══════════ U2 首次引导与示例材料（0.7）══════════ */
{
  const entry = read(P.entry) ?? "";
  const dir = read(P.directory) ?? "";
  const m = methodology();
  // 引导文案存在，且**每条能力承诺都在方法论里兑现**（v3 加严）：落地页承诺一条、
  // 方法论里没教它怎么做 ⇒ 用户照着承诺用会发现做不到。承诺与实现必须机械绑定。
  const promises = [...dir.matchAll(/evidence:\s*"([^"]+)"/g)].map((x) => x[1]);
  const unmet = promises.filter((e) => !m.includes(e));
  const guidance = /正在准备/.test(entry) && promises.length >= 5 && unmet.length === 0;
  const fx = read(P.fixtures) ?? "";
  let evHit = 0;
  const evMissed = [];
  for (const tp of TEST_POINTS) {
    if (tp.evidence.every((re) => re.test(fx))) evHit += 1;
    else evMissed.push(`${tp.id}(${tp.evidence.filter((re) => !re.test(fx)).map(String).join(",")})`);
  }
  const reachable = has(P.fixtureExport) || /示例/.test(entry);
  add("U2", `首次引导与示例材料（证据 ${evHit}/${TEST_POINTS.length}）`,
    (guidance ? 0.3 : 0) + ratio(evHit, TEST_POINTS.length, 0.3) + (reachable ? 0.1 : 0), 0.7,
    `guidance=${guidance}(承诺 ${promises.length} 条${unmet.length ? `，方法论未兑现: ${unmet.join(", ")}` : "，全部兑现"}) reachable=${reachable}${evMissed.length ? ` 缺证据: ${evMissed.join(" ")}` : ""}`);
}

/* ══════════ U3 失败可读与降级（0.8）══════════ */
{
  const entry = read(P.entry) ?? "";
  const fallback = /ROLE_INSUFFICIENT/.test(entry) && /(复制|clipboard)/.test(entry);
  const retry = /重试/.test(entry);
  const readable = /无法/.test(entry) && /(请稍后重试|可以|需要一位组织管理员)/.test(entry);
  add("U3", "失败可读与降级不卡死", (fallback ? 0.3 : 0) + (retry ? 0.25 : 0) + (readable ? 0.25 : 0), 0.8,
    `fallback=${fallback} retry=${retry} readable=${readable}`);
}

/* ══════════ U4 续用与重来（0.7）══════════ */
{
  const thread = read(P.ensureThread) ?? "";
  const entry = read(P.entry) ?? "";
  const reuse = /listPersonalThreads/.test(thread);
  const forceNew = /forceNew/.test(thread) && /new=1|"new"/.test(entry);
  add("U4", "续用与重来（线程复用·?new=1 开新一轮）", (reuse ? 0.4 : 0) + (forceNew ? 0.3 : 0), 0.7,
    `reuse=${reuse} forceNew=${forceNew}`);
}

/* ══════════ S1 防漂移（0.5）══════════ */
{
  const m = read(P.methodology) ?? "";
  const derive = read(P.derive) ?? "";
  const rulesExists = has(P.rules);
  const methodologyDerives = /post-investment-rules/.test(m);
  const deriveDerives = /post-investment-rules/.test(derive);
  const skillReuses = /methodology/.test(read(P.skillContent) ?? "");
  const idShared = /skill-identity/.test(read(P.skillSeed) ?? "");
  const hits = [rulesExists, methodologyDerives, deriveDerives, skillReuses, idShared].filter(Boolean).length;
  add("S1", `防漂移：单一事实源 ${hits}/5`, ratio(hits, 5, 0.5), 0.5,
    `rules=${rulesExists} methodology←rules=${methodologyDerives} derive←rules=${deriveDerives} skill←methodology=${skillReuses} id共享=${idShared}`);
}

/* ══════════ S2 门控与反证（0.5）══════════ */
{
  const t = read(P.selfTest) ?? "";
  const gate = /toBeGreaterThanOrEqual/.test(t);
  const counterProof = /反证|篡改|mutate/.test(t) && /toBeLessThan/.test(t);
  add("S2", "门控与反证（打分器自己能红）", (gate ? 0.25 : 0) + (counterProof ? 0.25 : 0), 0.5,
    `gate=${gate} counterProof=${counterProof}`);
}

/* ══════════ S3 动态事实与内容钉版（0.5，从 S1/S2 之外新增，v3 加严）══════════
 * v2 满分之后自我挑刺发现的两个真实缺口：①判据是按源码文本评的（渲染函数漏插值
 * 照样满分）②改了方法论/阈值却忘了升 Skill 版本号，只会在 API 启动日志里冒一行
 * 错误，仓库里没有任何东西会红。 */
{
  const r = renderedMethodology();
  const dynamic = !r.degraded;
  const pinTest = read("apps/web/tests/team4-skill-content-pin.test.ts") ?? "";
  const pinned = /content_digest|contentDigest|摘要|digest/.test(pinTest) && /POST_INVESTMENT_SKILL_VERSION_ID/.test(pinTest);
  // 方法论里的自检算例必须与参照实现同源，不能各写各的数字。三点连通才算：
  // 契约声明算例 → 方法论渲染它 → 参照实现的测试遍历它验证 expected。
  // 少任何一环，"我们告诉模型的正确答案"就可能是错的而无人发现。
  const selfCheckShared = /renderSelfChecks/.test(read(P.methodology) ?? "")
    && /SELF_CHECK_CASES/.test(read(P.rules) ?? "")
    && /SELF_CHECK_CASES/.test(read(P.deriveTest) ?? "");
  add("S3", "动态事实（评渲染结果）· Skill 内容钉版 · 自检算例同源",
    (dynamic ? 0.2 : 0) + (pinned ? 0.2 : 0) + (selfCheckShared ? 0.1 : 0), 0.5,
    `dynamic=${dynamic}${r.degraded ? `(渲染失败:${r.reason})` : ""} pinned=${pinned} selfCheckShared=${selfCheckShared}`);
}

/* ── 输出 ── */
const total = results.reduce((s, r) => s + r.earned, 0);
const max = results.reduce((s, r) => s + r.max, 0);
const rounded = Math.round(total * 100) / 100;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ score: rounded, max, results }, null, 2));
} else {
  console.log("\n/agent/team4 验收打分 v3（功能性 6 / 可用性 3 / 支撑 1.5，满分 10.5 按比例归一到 10）");
  console.log("口径：docs/agents/team4-acceptance-rubric.md\n");
  for (const r of results) {
    const flag = r.earned >= r.max - 1e-9 ? "✓" : r.earned > 0 ? "~" : "✗";
    console.log(`  ${flag} ${r.dim.padEnd(3)} ${r.earned.toFixed(2).padStart(5)} / ${r.max.toFixed(2)}  ${r.label}`);
    if (r.earned < r.max - 1e-9) console.log(`        └─ ${r.detail}`);
  }
  const fn = results.filter((r) => r.dim.startsWith("F")).reduce((s, r) => s + r.earned, 0);
  const us = results.filter((r) => r.dim.startsWith("U")).reduce((s, r) => s + r.earned, 0);
  const sp = results.filter((r) => r.dim.startsWith("S")).reduce((s, r) => s + r.earned, 0);
  console.log(`\n  功能性 ${fn.toFixed(2)}/6.00 · 可用性 ${us.toFixed(2)}/3.00 · 支撑 ${sp.toFixed(2)}/1.00`);
  console.log(`  总分：${rounded.toFixed(2)} / ${max.toFixed(2)}\n`);
}

const minIdx = process.argv.indexOf("--min");
if (minIdx !== -1 && rounded < Number(process.argv[minIdx + 1])) {
  console.error(`✗ 低于要求的 ${process.argv[minIdx + 1]} 分`);
  process.exit(1);
}
