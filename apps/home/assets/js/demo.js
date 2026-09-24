/**
 * demo.js — the scripted demo: one real piece of work, done in front of you.
 *
 * A visitor cannot feel "every claim traces to its source" from a sentence
 * that says so. They can feel it by picking a problem, watching four agents
 * work it from five sources, clicking a claim to see where it came from, and
 * watching the reviewer withdraw the one claim nothing supports. No sign-up,
 * no network, no model: the material is written in advance and replayed, and
 * the page says so above the demo in both languages.
 *
 * Loaded on demand (main.js imports it when the section nears the viewport),
 * so it costs nothing on the first paint. Deliberately NOT part of site.js:
 * build-js.mjs does not follow dynamic imports, and this file imports
 * nothing, so it resolves on its own from assets/js/.
 *
 * `SCENARIOS` is exported for scripts/check-i18n.mjs, which fails when the two
 * languages of a scenario differ in shape — a source, step or claim present in
 * one and not the other, a citation that points at no source, or a verdict
 * that differs between them.
 */

export const SCENARIOS = [
  /* ---- design thinking --------------------------------------------------- */
  {
    id: 'design',
    en: {
      tab: 'Design thinking',
      task: 'Find the problem worth solving in twelve customer interviews about expense reporting.',
      sources: [
        { who: 'Finance manager · interview', text: 'I spend the last week of every month chasing receipts. The tool is fine. People just submit late.' },
        { who: 'Sales rep · interview', text: 'Half my receipts die in my wallet. By the time I file, they are gone.' },
        { who: 'Sales rep · interview', text: 'Filling in the form takes five minutes. Finding the receipt takes the afternoon.' },
        { who: 'Survey · 212 employees', text: '64% lose at least one receipt a month. 9% say the form is hard to use.' },
        { who: 'CFO · interview', text: 'Late claims hold the monthly close back a full day. I would pay to fix that.' },
      ],
      steps: [
        { agent: 'Interview analyst', did: 'Tagged every complaint in the twelve interviews by where it happens: capture, form or approval.', uses: [0, 1, 2] },
        { agent: 'Pattern finder', did: 'Lost receipts come up four times more often than the form. The survey agrees.', uses: [1, 2, 3] },
        { agent: 'Framer', did: 'Wrote the problem as a “how might we” and tied it to what the business loses.', uses: [2, 4] },
        { agent: 'Reviewer', did: 'Checked every claim against the sources. Withdrew one that nothing supports.', uses: [] },
      ],
      claims: [
        { text: 'The pain is capturing the receipt, not filling in the form.', cites: [1, 2, 3], ok: true,
          why: 'Two interviews say it in their own words, and the survey puts lost receipts at 64% against 9% for the form.' },
        { text: 'How might we let a receipt file itself at the moment of payment?', cites: [1, 2], ok: true,
          why: 'Both sales reps lose the receipt between paying and filing — that gap is where the idea acts.' },
        { text: 'The business case is a faster monthly close.', cites: [4, 0], ok: true,
          why: 'The CFO names the cost (a day of close) and a budget. Finance confirms the cause.' },
        { text: 'Employees would pay for a personal receipt app.', cites: [], ok: false,
          why: 'No interview and no survey question asked about paying. Withdrawn before it reached you.' },
      ],
    },
    zh: {
      tab: '设计思维',
      task: '从十二次报销流程的客户访谈里，找出真正值得解决的那个问题。',
      sources: [
        { who: '财务经理 · 访谈', text: '每个月最后一周，我都在追发票。工具本身没问题，问题是大家交得晚。' },
        { who: '销售 · 访谈', text: '我一半的发票都烂在钱包里了，等到要报销时早就找不到了。' },
        { who: '销售 · 访谈', text: '填表只要五分钟，找发票要花一个下午。' },
        { who: '问卷 · 212 名员工', text: '64% 的人每月至少丢一张发票；只有 9% 觉得表单难用。' },
        { who: '首席财务官 · 访谈', text: '报销交得晚，月结就要多拖一整天。能解决这个，我愿意付钱。' },
      ],
      steps: [
        { agent: '访谈分析员', did: '把十二次访谈里的每一条抱怨，按发生环节标注：留存、填表、审批。', uses: [0, 1, 2] },
        { agent: '模式发现员', did: '“发票丢了”出现的次数是“表单难用”的四倍，问卷结果一致。', uses: [1, 2, 3] },
        { agent: '问题框定员', did: '把问题写成一句“我们如何能……”，并对应到业务损失。', uses: [2, 4] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了一条没有任何来源支撑的。', uses: [] },
      ],
      claims: [
        { text: '痛点在于留住发票，而不在于填表。', cites: [1, 2, 3], ok: true,
          why: '两位受访者原话如此；问卷里丢发票的比例是 64%，觉得表单难用的只有 9%。' },
        { text: '我们如何能让发票在付款那一刻就自动归档？', cites: [1, 2], ok: true,
          why: '两位销售都是在“付完款”到“去报销”之间弄丢发票——这个点子正好作用在这段空档上。' },
        { text: '商业理由是更快完成月结。', cites: [4, 0], ok: true,
          why: '首席财务官点明了代价（月结多拖一天）和预算；财务经理印证了原因。' },
        { text: '员工愿意为个人发票应用付费。', cites: [], ok: false,
          why: '没有任何访谈或问卷问过付费意愿。这条在交到你手上之前就被撤回了。' },
      ],
    },
  },

  /* ---- innovation -------------------------------------------------------- */
  {
    id: 'innovation',
    en: {
      tab: 'Innovation',
      task: 'Choose one of three new product ideas for a four-week experiment.',
      sources: [
        { who: 'Idea A · market scan', text: 'AI meeting notes: at least fourteen funded competitors, most of them free.' },
        { who: 'Idea B · pilot calls', text: 'Contract obligation tracking came up as a top-three pain in five of eight pilot calls.' },
        { who: 'Idea C · feasibility note', text: 'A supplier risk radar needs three outside data feeds. Earliest delivery: six months.' },
        { who: 'Engineering · capability list', text: 'We already parse contracts in production for two customers.' },
        { who: 'Customer success · log', text: 'Two customers asked, unprompted, whether we could warn them before renewal dates.' },
      ],
      steps: [
        { agent: 'Market scanner', did: 'Compared demand and competition for all three ideas.', uses: [0, 1, 2] },
        { agent: 'Capability matcher', did: 'Checked which idea we could build from what already runs in production.', uses: [3, 2] },
        { agent: 'Experiment designer', did: 'Drafted a four-week test with one success measure decided in advance.', uses: [1, 4] },
        { agent: 'Reviewer', did: 'Checked every claim against the sources. Withdrew one that nothing supports.', uses: [] },
      ],
      claims: [
        { text: 'Idea B has the strongest demand of the three.', cites: [1, 4], ok: true,
          why: 'Five of eight pilot calls raised it, and two customers asked for it without being prompted.' },
        { text: 'Idea B reuses a capability we already run in production.', cites: [3], ok: true,
          why: 'Contract parsing is live for two customers today. Idea C would need six months of new data work.' },
        { text: 'Test it for four weeks with three pilots. Success means weekly use nobody had to prompt.', cites: [1, 4], ok: true,
          why: 'The pilots come from the calls that raised the pain; the measure copies what those two customers did unasked.' },
        { text: 'Contract tracking is a $2B market.', cites: [], ok: false,
          why: 'None of the five sources gives a market size. The number was withdrawn rather than guessed.' },
      ],
    },
    zh: {
      tab: '创新',
      task: '从三个新产品点子里选一个，做为期四周的实验。',
      sources: [
        { who: '点子 A · 市场扫描', text: 'AI 会议纪要：至少十四家拿到融资的竞品，大多免费。' },
        { who: '点子 B · 试点访谈', text: '八次试点访谈中有五次，把“合同义务跟踪”列为前三大痛点。' },
        { who: '点子 C · 可行性说明', text: '供应商风险雷达需要接入三个外部数据源，最早六个月后交付。' },
        { who: '工程 · 能力清单', text: '我们已经在生产环境中为两家客户解析合同。' },
        { who: '客户成功 · 记录', text: '两家客户主动问过：能不能在合同续约日之前提醒他们。' },
      ],
      steps: [
        { agent: '市场扫描员', did: '对比了三个点子各自的需求强度与竞争情况。', uses: [0, 1, 2] },
        { agent: '能力匹配员', did: '核对哪个点子能用生产环境里已有的能力做出来。', uses: [3, 2] },
        { agent: '实验设计员', did: '起草了一个四周实验，事先定好唯一的成功指标。', uses: [1, 4] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了一条没有任何来源支撑的。', uses: [] },
      ],
      claims: [
        { text: '三个点子里，B 的需求最强。', cites: [1, 4], ok: true,
          why: '八次试点访谈里有五次提到它，还有两家客户在没人提示的情况下主动问起。' },
        { text: 'B 复用的是我们已在生产环境运行的能力。', cites: [3], ok: true,
          why: '合同解析今天已在为两家客户运行；点子 C 则需要六个月的新数据工作。' },
        { text: '用三个试点客户测四周；成功的标准是无人提醒下的每周使用。', cites: [1, 4], ok: true,
          why: '试点客户来自提出这个痛点的访谈；指标照搬了那两家客户主动做的事。' },
        { text: '合同跟踪是一个 20 亿美元的市场。', cites: [], ok: false,
          why: '五份来源里没有任何一份给出市场规模。这个数字被撤回，而不是被猜出来。' },
      ],
    },
  },

  /* ---- AI transformation strategy ---------------------------------------- */
  {
    id: 'strategy',
    en: {
      tab: 'AI transformation strategy',
      task: 'Pick the three workflows to change with AI first.',
      sources: [
        { who: 'Process inventory', text: '38 recurring workflows across legal, finance, support and sales.' },
        { who: 'Legal · time log', text: 'First-pass contract review: six hours each, about forty contracts a month.' },
        { who: 'Finance · time log', text: 'The monthly variance report takes three analysts two days.' },
        { who: 'Policy · approvals', text: 'Any refund over $500 needs a named human approver.' },
        { who: 'Support · ticket study', text: '70% of first-line tickets are answered from the help center.' },
      ],
      steps: [
        { agent: 'Inventory agent', did: 'Scored all 38 workflows on four conditions: digital inputs, clear steps, checkable output, and a place for a human to sign off.', uses: [0] },
        { agent: 'Time analyst', did: 'Ranked the ones that pass by hours returned each month.', uses: [1, 2, 4] },
        { agent: 'Risk agent', did: 'Marked where policy requires a named person to decide.', uses: [3, 4] },
        { agent: 'Reviewer', did: 'Checked every claim against the sources. Withdrew one that breaks a policy.', uses: [] },
      ],
      claims: [
        { text: 'First: contract review — about 240 hours a month come back.', cites: [1], ok: true,
          why: 'Six hours × forty contracts = 240 hours. Inputs are digital and every finding can be checked.' },
        { text: 'Second: the monthly variance report.', cites: [2], ok: true,
          why: 'Three analysts for two days, same steps every month, numbers anyone can re-add.' },
        { text: 'Third: first-line support drafts, sent after a person glances at them.', cites: [4, 3], ok: true,
          why: 'Most answers already exist in the help center; a human stays on anything touching refunds.' },
        { text: 'Automate refunds end to end.', cites: [3], ok: false,
          why: 'Policy requires a named approver over $500. Withdrawn — kept as a step a person approves.' },
      ],
    },
    zh: {
      tab: 'AI 转型战略',
      task: '选出最先用 AI 改造的三个工作流程。',
      sources: [
        { who: '流程清单', text: '法务、财务、客服、销售共 38 个重复性工作流程。' },
        { who: '法务 · 工时记录', text: '合同初审每份六小时，每月约四十份。' },
        { who: '财务 · 工时记录', text: '月度差异分析报告要三名分析师做两天。' },
        { who: '制度 · 审批规则', text: '超过 500 美元的退款，必须有指定的审批人。' },
        { who: '客服 · 工单研究', text: '70% 的一线工单，答案在帮助中心里就有。' },
      ],
      steps: [
        { agent: '盘点智能体', did: '按四个条件给 38 个流程打分：输入是数字化的、步骤可拆解、产出可核验、有人签核的位置。', uses: [0] },
        { agent: '工时分析员', did: '把通过的流程，按每月能省回的工时排序。', uses: [1, 2, 4] },
        { agent: '风险智能体', did: '标出制度要求必须由指定的人做决定的地方。', uses: [3, 4] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了一条违反制度的。', uses: [] },
      ],
      claims: [
        { text: '第一个：合同初审——每月省回约 240 小时。', cites: [1], ok: true,
          why: '六小时 × 四十份 = 240 小时；输入是数字化的，每条审查意见都可以核验。' },
        { text: '第二个：月度差异分析报告。', cites: [2], ok: true,
          why: '三名分析师做两天，每月步骤相同，数字谁都能重新加一遍。' },
        { text: '第三个：一线客服先起草回复，人看一眼再发出。', cites: [4, 3], ok: true,
          why: '多数答案帮助中心里已经有；凡是涉及退款的，仍由人处理。' },
        { text: '把退款流程端到端全自动化。', cites: [3], ok: false,
          why: '制度要求 500 美元以上必须有指定审批人。已撤回——保留为一个由人审批的步骤。' },
      ],
    },
  },

  /* ---- AI-native enterprise path ----------------------------------------- */
  {
    id: 'native',
    en: {
      tab: 'AI-native enterprise path',
      task: 'Draft an eighteen-month path to AI-native for a 200-person company.',
      sources: [
        { who: 'Org chart', text: '200 people in nine teams across three offices.' },
        { who: 'Tool audit', text: '23 tools in use. No shared record of what was decided, or why.' },
        { who: 'Staff survey', text: '71% use AI on their own. 12% use it in work they share with others.' },
        { who: 'Legal pilot · 8 weeks', text: 'Contract review time fell 58%. Every finding traced to a clause.' },
        { who: 'Board goal', text: 'Grow revenue 40% without headcount growing at the same rate.' },
      ],
      steps: [
        { agent: 'Org analyst', did: 'Mapped where decisions are made and where the reasons get lost.', uses: [0, 1] },
        { agent: 'Adoption analyst', did: 'Found the gap: most people already use AI, almost never together.', uses: [2] },
        { agent: 'Path planner', did: 'Laid out three stages — individual, team, organization — each with a measure.', uses: [2, 3, 4] },
        { agent: 'Reviewer', did: 'Checked every claim against the sources. Withdrew one that is not ours to decide.', uses: [] },
      ],
      claims: [
        { text: 'Months 1–3: move the private AI use people already have into one shared workspace.', cites: [2, 1], ok: true,
          why: 'The habit exists (71%); what is missing is a shared record (12%, and 23 disconnected tools).' },
        { text: 'Months 4–9: repeat the legal pilot’s pattern in two more teams.', cites: [3], ok: true,
          why: 'It is the one pattern here with a measured result (−58%) and a trail anyone can audit.' },
        { text: 'Months 10–18: one organizational memory, measured against the 40% goal.', cites: [0, 4], ok: true,
          why: 'Nine teams in three offices need a shared memory; the board has already named the measure.' },
        { text: 'Remove one layer of management by month six.', cites: [], ok: false,
          why: 'No source supports it, and it is a leadership decision. Withdrawn and flagged for leadership instead.' },
      ],
    },
    zh: {
      tab: 'AI 原生企业路径',
      task: '为一家 200 人的公司起草一条十八个月走向 AI 原生的路径。',
      sources: [
        { who: '组织架构', text: '200 人，九个团队，分布在三个办公地。' },
        { who: '工具盘点', text: '在用工具 23 个；决定了什么、为什么这样决定，没有任何共享记录。' },
        { who: '员工调研', text: '71% 的人私下在用 AI；在共享工作中使用的只有 12%。' },
        { who: '法务试点 · 8 周', text: '合同审查时间下降 58%，每条审查意见都能追溯到具体条款。' },
        { who: '董事会目标', text: '收入增长 40%，人员规模不随之同比增长。' },
      ],
      steps: [
        { agent: '组织分析员', did: '梳理决策在哪里做出，理由又在哪里丢失。', uses: [0, 1] },
        { agent: '采用分析员', did: '找到了缺口：大多数人已经在用 AI，却几乎从不一起用。', uses: [2] },
        { agent: '路径规划员', did: '规划三个阶段——个人、团队、组织——每个阶段都有衡量指标。', uses: [2, 3, 4] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了一条不该由我们决定的。', uses: [] },
      ],
      claims: [
        { text: '第 1–3 个月：把大家已有的私下 AI 使用，搬进一个共享的工作空间。', cites: [2, 1], ok: true,
          why: '习惯已经有了（71%）；缺的是共享记录（12%，外加 23 个互不相连的工具）。' },
        { text: '第 4–9 个月：把法务试点的做法复制到另外两个团队。', cites: [3], ok: true,
          why: '这是这里唯一有实测结果（−58%）、且过程谁都能审计的做法。' },
        { text: '第 10–18 个月：建立统一的组织记忆，以 40% 的目标来衡量。', cites: [0, 4], ok: true,
          why: '三地九个团队需要共享的记忆；董事会已经定好了衡量标准。' },
        { text: '第六个月前砍掉一个管理层级。', cites: [], ok: false,
          why: '没有来源支撑，而且这是管理层的决定。已撤回，并转交管理层判断。' },
      ],
    },
  },
];

/* Interface words, both languages. Kept beside the scenarios so the checker
   sees one file. */
export const UI = {
  en: {
    tabs: 'Scenarios', task: 'The task', sources: 'Sources', run: 'Start the agents', rerun: 'Run it again',
    working: 'Working…', result: 'The answer', doubt: 'Doubt this', hide: 'Hide the check',
    verified: 'Verified', withdrawn: 'Withdrawn by the reviewer', noSource: 'no source',
    step: (i, n) => `Step ${i} of ${n}`, done: 'Done. Every line of the answer below names its sources — press “Doubt this” on any of them.',
    next: 'That was sample material. Yours is the real test.', cta: 'Start free', other: 'Try another scenario',
  },
  zh: {
    tabs: '场景', task: '任务', sources: '来源', run: '开始运行智能体', rerun: '再运行一次',
    working: '运行中……', result: '结论', doubt: '质疑这条', hide: '收起核验',
    verified: '已核验', withdrawn: '已被审核员撤回', noSource: '无来源',
    step: (i, n) => `第 ${i} 步，共 ${n} 步`, done: '完成。下面结论的每一条都标明了来源——点任意一条的“质疑这条”试试。',
    next: '刚才用的是样例材料；真正的检验，是你自己的材料。', cta: '免费开始', other: '换一个场景试试',
  },
};

const APP = 'https://devapp.boardx.us';
const STEP_MS = 1100;

/* A tiny element builder: the markup is small enough that a template engine
   would be the larger part of the file. Text always goes in as text. */
function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach((k) => k != null && node.append(k));
  return node;
}

const tag = (i) => `S${i + 1}`;

export function initDemo(host) {
  if (!host || host.dataset.mounted) return;
  host.dataset.mounted = '1';
  const lang = document.documentElement.lang.startsWith('zh') ? 'zh' : 'en';
  const ui = UI[lang];
  const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timers = [];
  const stop = () => { timers.forEach(clearTimeout); timers = []; };

  const tabs = el('div', { class: 'demo__tabs', role: 'tablist', 'aria-label': ui.tabs });
  const panel = el('div', { class: 'demo__panel', role: 'tabpanel', tabindex: '-1' });
  const buttons = SCENARIOS.map((s, i) => el('button', {
    class: 'demo__tab', type: 'button', role: 'tab', id: `demo-tab-${s.id}`,
    'aria-controls': 'demo-panel', 'aria-selected': 'false', tabindex: '-1',
    'data-scenario': s.id, text: s[lang].tab,
    onclick: () => select(i),
    onkeydown: (e) => {
      const n = SCENARIOS.length;
      const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      select((to + n) % n, true);
    },
  }));
  tabs.append(...buttons);
  panel.id = 'demo-panel';

  function select(index, focus = false) {
    stop();
    buttons.forEach((b, i) => {
      b.setAttribute('aria-selected', String(i === index));
      b.tabIndex = i === index ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', buttons[index].id);
    if (focus) buttons[index].focus();
    render(SCENARIOS[index][lang], index);
  }

  function render(s, index) {
    const sourceItems = s.sources.map((src, i) => el('li', { class: 'demo__src', 'data-src': tag(i) },
      el('span', { class: 'demo__srctag', text: tag(i) }),
      el('span', { class: 'demo__srcbody' },
        el('span', { class: 'demo__who', text: src.who }),
        el('span', { class: 'demo__quote', text: src.text }))));
    const mark = (list) => sourceItems.forEach((li, i) => li.classList.toggle('is-used', list.includes(i)));

    const log = el('ol', { class: 'demo__log', 'aria-live': 'polite' });
    const status = el('p', { class: 'demo__status', role: 'status' });
    const claims = el('ul', { class: 'demo__claims' });
    const result = el('div', { class: 'demo__result', hidden: true },
      el('p', { class: 'demo__kicker', text: ui.result }), claims);
    const next = el('div', { class: 'demo__next', hidden: true },
      el('p', { class: 'demo__nextline', text: ui.next }),
      el('div', { class: 'demo__nextactions' },
        el('a', { class: 'btn btn--primary', href: APP, rel: 'noopener', text: ui.cta }),
        el('button', { class: 'btn btn--ghost demo__other', type: 'button', text: ui.other,
          onclick: () => select((index + 1) % SCENARIOS.length, true) })));
    const run = el('button', { class: 'btn demo__run', type: 'button', text: ui.run, onclick: () => start() });

    const claimItem = (c) => {
      const check = el('div', { class: 'demo__check', hidden: true },
        el('p', { class: 'demo__verdict', text: `${c.ok ? '✓' : '✗'} ${c.ok ? ui.verified : ui.withdrawn} — ${c.why}` }),
        c.cites.length
          ? el('ul', { class: 'demo__cited' }, c.cites.map((i) => el('li', {},
            el('span', { class: 'demo__srctag', text: tag(i) }), el('span', { text: s.sources[i].text }))))
          : null);
      const toggle = el('button', {
        class: 'demo__doubt', type: 'button', 'aria-expanded': 'false', text: ui.doubt,
        onclick: () => {
          const open = check.hidden;
          check.hidden = !open;
          toggle.setAttribute('aria-expanded', String(open));
          toggle.textContent = open ? ui.hide : ui.doubt;
          mark(open ? c.cites : []);
        },
      });
      const cites = c.cites.length
        ? c.cites.map((i) => el('span', { class: 'demo__cite', text: tag(i) }))
        : [el('span', { class: 'demo__cite demo__cite--none', text: ui.noSource })];
      return el('li', { class: `demo__claim${c.ok ? '' : ' is-withdrawn'}`, 'data-ok': String(c.ok) },
        el('p', { class: 'demo__claimtext' }, c.ok ? c.text : el('s', { text: c.text })),
        el('div', { class: 'demo__claimmeta' }, cites, toggle),
        check);
    };

    function finish() {
      mark([]);
      claims.replaceChildren(...s.claims.map(claimItem));
      result.hidden = false;
      next.hidden = false;
      status.textContent = ui.done;
      run.textContent = ui.rerun;
      run.disabled = false;
    }

    function start() {
      stop();
      log.replaceChildren();
      claims.replaceChildren();
      result.hidden = true; next.hidden = true;
      if (still()) {
        s.steps.forEach((st, i) => log.append(stepItem(st, i)));
        finish();
        return;
      }
      run.disabled = true;
      status.textContent = ui.working;
      s.steps.forEach((st, i) => {
        timers.push(setTimeout(() => {
          log.querySelector('.is-active')?.classList.remove('is-active');
          const item = stepItem(st, i);
          item.classList.add('is-active');
          log.append(item);
          mark(st.uses);
        }, i * STEP_MS));
      });
      timers.push(setTimeout(() => {
        log.querySelector('.is-active')?.classList.remove('is-active');
        finish();
      }, s.steps.length * STEP_MS));
    }

    const stepItem = (st, i) => el('li', { class: 'demo__step' },
      el('span', { class: 'demo__stepn', text: ui.step(i + 1, s.steps.length) }),
      el('span', { class: 'demo__agent', text: st.agent }),
      el('span', { class: 'demo__did', text: st.did }),
      st.uses.length ? el('span', { class: 'demo__uses' }, st.uses.map((u) => el('span', { class: 'demo__cite', text: tag(u) }))) : null);

    panel.replaceChildren(
      el('div', { class: 'demo__brief' },
        el('p', { class: 'demo__kicker', text: ui.task }),
        el('p', { class: 'demo__task', text: s.task }),
        el('p', { class: 'demo__kicker', text: `${ui.sources} (${s.sources.length})` }),
        el('ol', { class: 'demo__sources' }, sourceItems)),
      el('div', { class: 'demo__work' }, run, status, log, result, next),
    );
  }

  host.replaceChildren(tabs, panel);
  host.classList.add('is-live');
  select(0);
}
