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
  /* ---- workforce & skills ------------------------------------------------ */
  {
    id: 'workforce',
    en: {
      tab: 'Workforce & skills',
      role: 'You lead people for a bank’s operations division — 3,000 people.',
      stakes: 'AI is coming to a third of the hours your people work. They are asking you, to your face, whether their jobs are safe.',
      task: 'Work out which work changes, where people can go, and what training they need — before the rumors answer for you.',
      sources: [
        { who: 'Task inventory · 42 roles', text: '34% of working hours go to reading, checking and re-keying documents.' },
        { who: 'Pilot · loan processing, 12 weeks', text: 'Processing time fell 45%. Nobody was let go; the team cleared a six-week backlog.' },
        { who: 'Staff survey · 2,400 replies', text: '63% worry about their job. 74% would train if it happened in work hours.' },
        { who: 'Hiring plan', text: 'Risk and data-quality teams have 90 open roles they cannot fill.' },
        { who: 'Skills assessment', text: '40% of processors already do the kind of checking those roles are hired for.' },
      ],
      steps: [
        { agent: 'Task analyst', did: 'Broke 42 roles into tasks and marked the ones AI changes first.', uses: [0] },
        { agent: 'Pilot analyst', did: 'Read what actually happened to the people in the loan pilot.', uses: [1] },
        { agent: 'Skills matcher', did: 'Matched the skills people have to the roles that stay open.', uses: [3, 4, 2] },
        { agent: 'Reviewer', did: 'Checked every claim against the sources. Withdrew the number everyone was afraid of.', uses: [] },
      ],
      headline: 'Tasks change before roles do. Open a path to the work you cannot hire for — and tell people before the rumors do.',
      claims: [
        { text: 'About a third of working hours change first: reading, checking, re-keying.', cites: [0], ok: true,
          why: '34% of hours across 42 roles — tasks inside roles, not whole roles.' },
        { text: 'Offer a first path into risk and data quality, where 90 roles stand open.', cites: [3, 4], ok: true,
          why: 'The demand is real, and 40% of processors already do that kind of checking. A first path — not room for everyone, and the plan should say so.' },
        { text: 'Train in work hours, and announce the plan before the rollout.', cites: [2], ok: true,
          why: '74% would train in work hours, and 63% are already worried — silence is what the rumors fill.' },
        { text: 'A third of roles can go by year end.', cites: [0], ok: false,
          why: '34% of hours is not 34% of people. In the one pilot, nobody was let go — the freed time cleared the backlog. That is evidence, not a guarantee; say both.' },
      ],
      so: 'You can answer your people honestly — what changes, where they can go, what nobody knows yet — and build the plan with them.',
      yours: 'Run this on your own task inventory and survey.',
    },
    zh: {
      tab: '人才与组织转型',
      role: '你负责一家银行运营条线 3,000 人的人力资源。',
      stakes: 'AI 将改变员工三分之一的工时。他们当面问你：我的饭碗还保得住吗？',
      task: '弄清哪些工作会变、人可以往哪里走、需要什么培训——别让小道消息替你回答。',
      sources: [
        { who: '任务盘点 · 42 个岗位', text: '34% 的工时花在阅读、核对和重复录入文件上。' },
        { who: '试点 · 贷款处理，12 周', text: '处理时间下降 45%。没有一个人被裁；团队清掉了积压六周的工作。' },
        { who: '员工调研 · 2,400 份回复', text: '63% 的人担心自己的工作；74% 愿意参加培训，前提是在工作时间内。' },
        { who: '招聘计划', text: '风控和数据质量团队有 90 个岗位空缺，一直招不到人。' },
        { who: '技能评估', text: '40% 的处理人员，今天做的就是这些岗位要招的那种核对工作。' },
      ],
      steps: [
        { agent: '任务分析员', did: '把 42 个岗位拆成任务，标出 AI 最先改变的那些。', uses: [0] },
        { agent: '试点分析员', did: '看贷款试点里的人，实际经历了什么。', uses: [1] },
        { agent: '技能匹配员', did: '把员工已有的技能，对上一直招不满的岗位。', uses: [3, 4, 2] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了那个人人都害怕的数字。', uses: [] },
      ],
      headline: '先变的是任务，不是岗位。为员工打开一条路，通往你招不到人的工作——并且赶在小道消息之前把话说清楚。',
      claims: [
        { text: '大约三分之一的工时最先改变：阅读、核对、重复录入。', cites: [0], ok: true,
          why: '42 个岗位合计 34% 的工时——变的是岗位里的任务，而不是整个岗位。' },
        { text: '先为员工打开通往风控和数据质量的路，那里有 90 个岗位空着。', cites: [3, 4], ok: true,
          why: '需求是真的；40% 的处理人员今天就在做这类核对。这是第一条路，不是每个人的去处——计划里要说明白。' },
        { text: '在工作时间内培训，并在上线之前公布计划。', cites: [2], ok: true,
          why: '74% 的人愿意在工作时间内培训；63% 的人已经在担心——你不说，传言就会替你说。' },
        { text: '到年底可以裁掉三分之一的岗位。', cites: [0], ok: false,
          why: '34% 的工时不等于 34% 的人。唯一的试点里，一个人都没有被裁——省出的时间清掉了积压。这是证据，不是保证；两句都要说。' },
      ],
      so: '员工问你的那个问题，你可以诚实地回答了：什么会变、可以往哪里走、哪些还没人知道——再和他们一起把计划定下来。',
      yours: '用你自己的岗位盘点和员工调研，跑一遍。',
    },
  },

  /* ---- sales win rate ---------------------------------------------------- */
  {
    id: 'growth',
    en: {
      tab: 'Sales win rate',
      role: 'You lead sales for a B2B software company.',
      stakes: 'The win rate slid from 31% to 22% in a year. Everyone has a theory. Nobody has evidence.',
      task: 'Find out why the deals we should win are being lost.',
      sources: [
        { who: 'CRM · 146 lost deals', text: 'Loss reason most often recorded: “price” (58%).' },
        { who: 'Call transcripts · 40 lost deals', text: 'In 29 of 40, the buyer asked for a security review we answered after nine days or more.' },
        { who: 'Win–loss interviews · 12 buyers', text: '“Your price was fine. We went with whoever answered the security questionnaire first.”' },
        { who: 'Security team · queue log', text: 'Questionnaires wait for one reviewer. Median time to answer: 11 days.' },
        { who: 'Won deals · last quarter', text: 'In the deals we won, the questionnaire went back within 3 days.' },
      ],
      steps: [
        { agent: 'Pipeline analyst', did: 'Read why the CRM says we lost.', uses: [0] },
        { agent: 'Conversation analyst', did: 'Listened to what buyers actually asked for in the lost deals.', uses: [1, 2] },
        { agent: 'Pattern finder', did: 'Compared the lost deals with the ones we won.', uses: [3, 4] },
        { agent: 'Reviewer', did: 'Checked every claim against the sources. Withdrew the fix everyone was about to reach for.', uses: [] },
      ],
      headline: 'We are not losing on price. We are losing on how long the security review takes.',
      claims: [
        { text: 'The recorded loss reason, price, does not hold up.', cites: [0, 2], ok: true,
          why: 'Price is logged in 58% of losses — but the buyers we interviewed point somewhere else.' },
        { text: 'A slow security review is the pattern in the lost deals.', cites: [1, 3], ok: true,
          why: '29 of 40 lost deals waited nine days or more; the queue’s median is 11.' },
        { text: 'Answer every questionnaire within three days, as in the deals we win.', cites: [4, 3], ok: true,
          why: 'Won deals got an answer within 3 days. The delay sits in a queue with one reviewer, not in the questions.' },
        { text: 'Cut prices 15% to win back share.', cites: [0], ok: false,
          why: 'It rests only on the CRM field the buyers contradict. It would have cost margin and fixed nothing.' },
      ],
      so: 'Your team stops arguing about discounts and fixes the one thing the buyers named.',
      yours: 'Run this on your own lost deals and call notes.',
    },
    zh: {
      tab: '销售赢单率',
      role: '你是一家 B2B 软件公司的销售负责人。',
      stakes: '一年之内，赢单率从 31% 跌到 22%。人人都有一套说法，没有一个人拿得出证据。',
      task: '查清楚：本该赢的单，为什么输了。',
      sources: [
        { who: 'CRM · 146 个丢单', text: '记录最多的丢单原因：“价格”（58%）。' },
        { who: '通话记录 · 40 个丢单', text: '40 个里有 29 个，客户要过安全评审，而我们九天以上才答复。' },
        { who: '赢丢单访谈 · 12 位客户', text: '“你们的价格没问题。我们选了最先答完安全问卷的那家。”' },
        { who: '安全团队 · 排队记录', text: '问卷排队等一位评审人；答复时间中位数：11 天。' },
        { who: '赢单 · 上季度', text: '赢下的单里，安全问卷都在 3 天之内答复。' },
      ],
      steps: [
        { agent: '商机分析员', did: '读 CRM 里写的丢单原因。', uses: [0] },
        { agent: '通话分析员', did: '听丢单里客户真正要的是什么。', uses: [1, 2] },
        { agent: '模式发现员', did: '把丢的单和赢的单放在一起比。', uses: [3, 4] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了大家正准备动手的那个办法。', uses: [] },
      ],
      headline: '我们不是输在价格上，而是输在安全评审太慢。',
      claims: [
        { text: '记录里的丢单原因“价格”，站不住。', cites: [0, 2], ok: true,
          why: '58% 的丢单记的是价格——可是去访谈客户，他们指向的是另一件事。' },
        { text: '安全评审太慢，是丢单里反复出现的模式。', cites: [1, 3], ok: true,
          why: '40 个丢单里有 29 个等了九天以上；排队的中位数是 11 天。' },
        { text: '每份问卷三天内答复，和赢下的单一样。', cites: [4, 3], ok: true,
          why: '赢下的单都在 3 天内拿到答复。卡点在只有一位评审人的队列，而不在问题本身。' },
        { text: '降价 15% 把份额抢回来。', cites: [0], ok: false,
          why: '它只依据 CRM 里那个被客户否认的字段。它会牺牲利润，却什么也解决不了。' },
      ],
      so: '团队不再为折扣争论不休，而是去修客户亲口指出的那一件事。',
      yours: '用你自己的丢单记录和通话纪要，跑一遍。',
    },
  },

  /* ---- AI transformation strategy ---------------------------------------- */
  {
    id: 'strategy',
    en: {
      tab: 'AI transformation strategy',
      role: 'You are the COO of a 600-person services firm.',
      stakes: 'Every function wants an AI budget. You can fund three — and you have to explain the other no’s.',
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
        { agent: 'Workload analyst', did: 'Ranked the ones that pass by how much work they carry each month.', uses: [1, 2, 4] },
        { agent: 'Risk agent', did: 'Marked where policy requires a named person to decide.', uses: [3, 4] },
        { agent: 'Reviewer', did: 'Checked every claim against the sources. Withdrew the answer that would have pleased every function.', uses: [] },
      ],
      headline: 'Fund contract review, the variance report and support drafts — large, checkable work where a person still signs off.',
      claims: [
        { text: 'First: contract review — 240 hours a month of first-pass reading today.', cites: [1], ok: true,
          why: 'Six hours × forty contracts = 240 hours, all digital, and every finding can be checked.' },
        { text: 'Second: the monthly variance report.', cites: [2], ok: true,
          why: 'Three analysts for two days, the same steps every month, numbers anyone can re-add.' },
        { text: 'Third: first-line support drafts, sent after a person reads them.', cites: [4, 3], ok: true,
          why: '70% of answers already exist in the help center; a person stays on anything touching a refund.' },
        { text: 'Give every function a small AI budget.', cites: [0], ok: false,
          why: 'It is what all 38 workflows asked for. Spread that thin, nothing changes — and the sources support three.' },
      ],
      so: 'You fund three workflows with numbers behind them — and every “not yet” comes with a reason.',
      yours: 'Run this on your own process list and time logs.',
    },
    zh: {
      tab: 'AI 转型战略',
      role: '你是一家 600 人服务公司的运营副总。',
      stakes: '每个部门都在要 AI 预算。你只能批三个——还得给其余的“不”一个说法。',
      task: '选出最先用 AI 改造的三个工作流程。',
      sources: [
        { who: '流程清单', text: '法务、财务、客服、销售共 38 个重复性工作流程。' },
        { who: '法务 · 工时记录', text: '合同初审每份六小时，每月约四十份。' },
        { who: '财务 · 工时记录', text: '月度差异分析报告要三名分析师做两天。' },
        { who: '制度 · 审批规则', text: '超过 5,000 元的退款，必须由指定审批人签字。' },
        { who: '客服 · 工单研究', text: '70% 的一线工单，答案在帮助中心里就有。' },
      ],
      steps: [
        { agent: '盘点智能体', did: '按四个条件给 38 个流程打分：输入是数字化的、步骤可拆解、产出可核验、有人签核的位置。', uses: [0] },
        { agent: '工作量分析员', did: '把通过的流程，按每月承载的工作量排序。', uses: [1, 2, 4] },
        { agent: '风险智能体', did: '标出制度要求必须由指定的人做决定的地方。', uses: [3, 4] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了那个能让每个部门都满意的答案。', uses: [] },
      ],
      headline: '先投合同初审、月度差异报告和客服起草——工作量大、结果可核验、并且仍有人签核。',
      claims: [
        { text: '第一个：合同初审——今天每月要花 240 小时做初读。', cites: [1], ok: true,
          why: '六小时 × 四十份 = 240 小时；输入全是数字化的，每条审查意见都可以核验。' },
        { text: '第二个：月度差异分析报告。', cites: [2], ok: true,
          why: '三名分析师做两天，每月步骤相同，数字谁都能重新加一遍。' },
        { text: '第三个：一线客服先起草回复，人读过再发出。', cites: [4, 3], ok: true,
          why: '70% 的答案帮助中心里已经有；凡是涉及退款的，仍由人处理。' },
        { text: '每个部门都给一点 AI 预算。', cites: [0], ok: false,
          why: '这正是 38 个流程都在要的。撒得这么薄，什么都不会改变——而来源只支撑三个。' },
      ],
      so: '你批出的三个流程都有数字撑腰；每一个“先不做”，也都说得出理由。',
      yours: '用你自己的流程清单和工时记录，跑一遍。',
    },
  },

  /* ---- customer operations ----------------------------------------------- */
  {
    id: 'service',
    en: {
      tab: 'Customer operations',
      role: 'You run customer service for a mid-sized insurer.',
      stakes: 'Contacts are up a third this year, headcount is frozen, and you owe the CEO an AI plan by Friday.',
      task: 'Decide where AI should handle customer contacts — and where it must not.',
      sources: [
        { who: 'Contact log · 12 months', text: '410,000 contacts. 46% ask about a claim’s status or a document we already hold.' },
        { who: 'Quality review · 300 calls', text: 'Agents spend 38% of every call searching four systems for the answer.' },
        { who: 'Complaints team', text: 'Our worst complaints come from customers passed between three or more people.' },
        { who: 'Regulator guidance', text: 'A decision to deny a claim must be explained to the customer by a person.' },
        { who: 'Customer survey · 1,800 replies', text: '71% would use self-service for a status update. 18% would for a claim dispute.' },
      ],
      steps: [
        { agent: 'Contact analyst', did: 'Sorted a year of contacts by what the customer actually wanted.', uses: [0, 4] },
        { agent: 'Journey mapper', did: 'Followed the calls that went wrong back to where they went wrong.', uses: [1, 2] },
        { agent: 'Compliance agent', did: 'Marked every step the regulator reserves for a person.', uses: [3] },
        { agent: 'Reviewer', did: 'Checked every claim against the sources. Withdrew a promise no source could carry.', uses: [] },
      ],
      headline: 'Let customers who want to serve themselves do it, give every agent an assistant, and keep a person on every denial.',
      claims: [
        { text: 'About a third of all contacts can move to self-service customers already want.', cites: [0, 4], ok: true,
          why: '46% are status or known-document questions, and 71% would serve themselves for those: 46% × 71% ≈ 33%.' },
        { text: 'Give every agent an assistant that searches the four systems for them.', cites: [1, 2], ok: true,
          why: '38% of each call is spent searching — and the worst complaints come from being passed from person to person.' },
        { text: 'Claim denials stay with a person; AI prepares the file.', cites: [3, 4], ok: true,
          why: 'The regulator requires it, and only 18% want self-service when they dispute a claim.' },
        { text: 'Halve the contact center within a year.', cites: [], ok: false,
          why: 'The sources show which contacts can move, not how many people you need. Freed time goes first to disputes and denials, where customers want a person.' },
      ],
      so: 'You walk into Friday with a plan you can defend line by line — and no headcount promise that nothing supports.',
      yours: 'Run this on your own contact logs and call reviews.',
    },
    zh: {
      tab: '客户运营重塑',
      role: '你负责一家中型保险公司的客户服务。',
      stakes: '今年进线量涨了三分之一，编制冻结，老板要你周五前拿出 AI 方案。',
      task: '决定哪些客户来电与咨询交给 AI——以及哪些绝不能交。',
      sources: [
        { who: '进线记录 · 12 个月', text: '共 410,000 次进线；46% 问的是理赔进度，或我们手里早有的文件。' },
        { who: '质检抽查 · 300 通电话', text: '每通电话有 38% 的时间，坐席在四个系统里找答案。' },
        { who: '投诉团队', text: '最严重的投诉，都来自在三个以上的人之间被转来转去的客户。' },
        { who: '监管要求', text: '拒赔决定必须由人向客户作出解释。' },
        { who: '客户调研 · 1,800 份回复', text: '71% 愿意用自助服务查进度；理赔争议时愿意的只有 18%。' },
      ],
      steps: [
        { agent: '进线分析员', did: '把一年的进线，按客户真正想办的事归类。', uses: [0, 4] },
        { agent: '旅程梳理员', did: '顺着出了问题的通话，追到问题出在哪一步。', uses: [1, 2] },
        { agent: '合规智能体', did: '标出监管要求必须由人完成的每一步。', uses: [3] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了一个没有任何来源撑得住的承诺。', uses: [] },
      ],
      headline: '愿意自助的客户让他们自助，给每位坐席配一个助手，拒赔始终由人来谈。',
      claims: [
        { text: '大约三分之一的进线，可以转给客户本来就愿意用的自助服务。', cites: [0, 4], ok: true,
          why: '46% 是查进度或查已有文件，其中 71% 的客户愿意自助：46% × 71% ≈ 33%。' },
        { text: '给每位坐席配一个助手，替他们在四个系统里找答案。', cites: [1, 2], ok: true,
          why: '每通电话 38% 的时间花在找答案上——而最严重的投诉，来自被转来转去。' },
        { text: '拒赔始终由人来谈，AI 负责备好材料。', cites: [3, 4], ok: true,
          why: '监管这样要求；而理赔争议时，只有 18% 的客户愿意自助。' },
        { text: '一年内把客服中心砍掉一半。', cites: [], ok: false,
          why: '来源说明了哪些进线可以转走，却没说明需要多少人。省出的时间，先给客户最需要人的理赔争议和拒赔。' },
      ],
      so: '周五你带进会议室的，是一份每一行都经得起追问的方案——也没有许下任何来源撑不住的裁员承诺。',
      yours: '用你自己的进线记录和质检抽查，跑一遍。',
    },
  },

  /* ---- AI-native enterprise path ----------------------------------------- */
  {
    id: 'native',
    en: {
      tab: 'AI-native enterprise path',
      role: 'You are the CEO of a 200-person company.',
      stakes: 'Your people already use AI on their own. The board asks what it has done for the company — and you have no answer.',
      task: 'Draft an eighteen-month path to AI-native.',
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
        { agent: 'Reviewer', did: 'Checked every claim against the sources. Withdrew the purchase that looks like progress.', uses: [] },
      ],
      headline: 'Bring the AI people already use into shared work, prove it team by team, and measure it against the board’s 40%.',
      claims: [
        { text: 'Months 1–3: move the private AI use people already have into one shared workspace.', cites: [2, 1], ok: true,
          why: 'The habit exists (71%); what is missing is shared work (12%) and a shared record, which none of the 23 tools keeps.' },
        { text: 'Months 4–9: repeat the legal pilot’s pattern in two more teams.', cites: [3], ok: true,
          why: 'It is the one pattern here with a measured result (−58%) and a trail anyone can audit.' },
        { text: 'Months 10–18: one shared memory across all nine teams, measured against the 40% goal.', cites: [0, 4], ok: true,
          why: 'Nine teams in three offices lose reasons between them; the board has already named the measure.' },
        { text: 'Buy an AI license for all 200 people in month one.', cites: [2], ok: false,
          why: '71% already use AI; only 12% share the work. More licenses widen the very gap the plan exists to close.' },
      ],
      so: 'You give the board a path with a measure at every stage — starting from the habit your people already have.',
      yours: 'Run this on your own org chart, tool list and survey.',
    },
    zh: {
      tab: 'AI 原生企业路径',
      role: '你是一家 200 人公司的老板。',
      stakes: '员工早就在私下用 AI 了。董事会问：这给公司带来了什么？你答不上来。',
      task: '起草一条十八个月走向 AI 原生的路径。',
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
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了那笔看起来像进展的采购。', uses: [] },
      ],
      headline: '先把各自私下用的 AI 摆上台面，一个团队一个团队地验证，再对着董事会 40% 的目标算账。',
      claims: [
        { text: '第 1–3 个月：把大家已有的私下 AI 使用，搬进一个共享的工作空间。', cites: [2, 1], ok: true,
          why: '习惯已经有了（71%）；缺的是一起用（12%），以及 23 个工具里没有一个留下的共享记录。' },
        { text: '第 4–9 个月：把法务试点的做法复制到另外两个团队。', cites: [3], ok: true,
          why: '这是这里唯一有实测结果（−58%）、且过程谁都能审计的做法。' },
        { text: '第 10–18 个月：九个团队共用一份组织记忆，以 40% 的目标来衡量。', cites: [0, 4], ok: true,
          why: '三地九个团队之间，理由一直在丢；董事会已经定好了衡量标准。' },
        { text: '第一个月给全部 200 人买 AI 账号。', cites: [2], ok: false,
          why: '71% 的人已经在用 AI，一起用的只有 12%。多买账号，只会拉大这条路径要弥合的那道缺口。' },
      ],
      so: '你交给董事会的，是一条每个阶段都有衡量指标的路径——起点是员工已经养成的习惯。',
      yours: '用你自己的组织架构、工具清单和员工调研，跑一遍。',
    },
  },

  /* ---- design thinking --------------------------------------------------- */
  {
    id: 'design',
    en: {
      tab: 'Design thinking',
      role: 'You lead product for an expense-management tool.',
      stakes: 'Churn is creeping up, the roadmap has forty requests on it, and you get one bet this quarter.',
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
        { agent: 'Pattern finder', did: 'Lost receipts come up far more often than the form. The survey agrees.', uses: [1, 2, 3] },
        { agent: 'Framer', did: 'Wrote the problem as a “how might we” and tied it to what the business loses.', uses: [2, 4] },
        { agent: 'Reviewer', did: 'Checked every claim against the sources. Withdrew the fix the team had already planned.', uses: [] },
      ],
      headline: 'The problem is not the form. It is the receipt that disappears between paying and filing.',
      claims: [
        { text: 'The pain is capturing the receipt, not filling in the form.', cites: [1, 2, 3], ok: true,
          why: 'Two interviews say it in their own words, and the survey puts lost receipts at 64% against 9% for the form.' },
        { text: 'How might we let a receipt file itself at the moment of payment?', cites: [1, 2], ok: true,
          why: 'Both sales reps lose the receipt between paying and filing — that gap is where the idea acts.' },
        { text: 'The business case is a faster monthly close.', cites: [4, 0], ok: true,
          why: 'The CFO names the cost (a day of close) and says they would pay to fix it. Finance confirms the cause.' },
        { text: 'Redesign the expense form this quarter.', cites: [3], ok: false,
          why: 'Only 9% find the form hard. It would spend your one bet on the problem fewest people have.' },
      ],
      so: 'Your one bet this quarter goes on the problem customers actually have — and you can show why.',
      yours: 'Run this on your own interview notes.',
    },
    zh: {
      tab: '设计思维',
      role: '你是一款报销管理工具的产品负责人。',
      stakes: '客户流失在慢慢上升，路线图上压着四十个需求，这个季度你只能押一个。',
      task: '从十二次报销流程的客户访谈里，找出真正值得解决的那个问题。',
      sources: [
        { who: '财务经理 · 访谈', text: '每个月最后一周，我都在追发票。工具本身没问题，问题是大家交得晚。' },
        { who: '销售 · 访谈', text: '我一半的发票都烂在钱包里了，等到要报销时早就找不到了。' },
        { who: '销售 · 访谈', text: '填表只要五分钟，找发票要花一个下午。' },
        { who: '问卷 · 212 名员工', text: '64% 的人每月至少丢一张发票；只有 9% 觉得表单难用。' },
        { who: '财务总监 · 访谈', text: '报销交得晚，月结就要多拖一整天。能解决这个，我愿意付钱。' },
      ],
      steps: [
        { agent: '访谈分析员', did: '把十二次访谈里的每一条抱怨，按发生环节标注：留存、填表、审批。', uses: [0, 1, 2] },
        { agent: '模式发现员', did: '“发票丢了”出现的次数远多于“表单难用”，问卷结果一致。', uses: [1, 2, 3] },
        { agent: '问题框定员', did: '把问题写成一句“我们如何能……”，并对应到业务损失。', uses: [2, 4] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了团队早已排进计划的那个方案。', uses: [] },
      ],
      headline: '问题不在表单，而在付完款到报销之间，那张不见了的发票。',
      claims: [
        { text: '痛点在于留住发票，而不在于填表。', cites: [1, 2, 3], ok: true,
          why: '两位受访者原话如此；问卷里丢发票的比例是 64%，觉得表单难用的只有 9%。' },
        { text: '我们如何能让发票在付款那一刻就自动归档？', cites: [1, 2], ok: true,
          why: '两位销售都是在“付完款”到“去报销”之间弄丢发票——这个点子正好作用在这段空档上。' },
        { text: '商业理由是更快完成月结。', cites: [4, 0], ok: true,
          why: '财务总监点明了代价（月结多拖一天），并且愿意付钱解决；财务经理印证了原因。' },
        { text: '本季度重新设计报销表单。', cites: [3], ok: false,
          why: '只有 9% 的人觉得表单难用。它会把你唯一的赌注，押在最少人遇到的问题上。' },
      ],
      so: '这个季度唯一的赌注，押在客户真正遇到的问题上——而且你说得出为什么。',
      yours: '用你自己的访谈记录，跑一遍。',
    },
  },

  /* ---- innovation -------------------------------------------------------- */
  {
    id: 'innovation',
    en: {
      tab: 'Innovation',
      role: 'You run the innovation team at a legal-software company.',
      stakes: 'Three ideas, budget for one, and the executive committee wants a decision in two weeks.',
      task: 'Choose one of three new product ideas for a four-week experiment.',
      sources: [
        { who: 'Idea A · market scan', text: 'AI meeting notes: at least fourteen funded competitors, most of them free.' },
        { who: 'Idea B · pilot calls', text: 'Contract obligation tracking came up as a top-three pain in five of eight pilot calls.' },
        { who: 'Idea C · feasibility note', text: 'A supplier risk radar needs three outside data feeds. Earliest delivery: six months.' },
        { who: 'Engineering · capability list', text: 'We already parse contracts in production for two customers.' },
        { who: 'Customer success · log', text: 'Two customers asked, unprompted, whether we could warn them before renewal dates.' },
      ],
      steps: [
        { agent: 'Market scanner', did: 'Compared what customers asked for and what competitors offer, for all three ideas.', uses: [0, 1, 2] },
        { agent: 'Capability matcher', did: 'Checked which idea we could build from what already runs in production.', uses: [3, 2] },
        { agent: 'Experiment designer', did: 'Drafted a four-week test with one success measure decided in advance.', uses: [1, 4] },
        { agent: 'Reviewer', did: 'Checked every claim against the sources. Withdrew the number that would have gone on slide one.', uses: [] },
      ],
      headline: 'Test idea B: customers asked for it, and we already run the hard part.',
      claims: [
        { text: 'Idea B is the only one customers asked for.', cites: [1, 4], ok: true,
          why: 'Five of eight pilot calls raised it, and two customers asked for it without being prompted. Nobody asked for A or C.' },
        { text: 'Idea B reuses a capability we already run in production.', cites: [3, 2], ok: true,
          why: 'Contract parsing is live for two customers today. Idea C would need six months of new data work.' },
        { text: 'Test it for four weeks with customers from the pilot calls. Success means weekly use nobody had to prompt.', cites: [1, 4], ok: true,
          why: 'The pilots come from the calls that raised the pain; the measure copies what those two customers did unasked.' },
        { text: 'Contract tracking is a $2B market.', cites: [], ok: false,
          why: 'None of the five sources sizes any market — and a guess on slide one is the first thing a committee stops trusting.' },
      ],
      so: 'You bring the committee a four-week bet with the pass line drawn in advance — not a pitch.',
      yours: 'Run this on your own pilot notes and customer requests.',
    },
    zh: {
      tab: '创新',
      role: '你负责一家法律软件公司的创新团队。',
      stakes: '三个点子，只有一份预算；管理委员会两周后要结论。',
      task: '从三个新产品点子里选一个，做为期四周的实验。',
      sources: [
        { who: '点子 A · 市场扫描', text: 'AI 会议纪要：至少十四家拿到融资的竞品，大多免费。' },
        { who: '点子 B · 试点访谈', text: '八次试点访谈中有五次，把“合同义务跟踪”列为前三大痛点。' },
        { who: '点子 C · 可行性说明', text: '供应商风险雷达需要接入三个外部数据源，最早六个月后交付。' },
        { who: '工程 · 能力清单', text: '我们已经在生产环境中为两家客户解析合同。' },
        { who: '客户成功 · 记录', text: '两家客户主动问过：能不能在合同续约日之前提醒他们。' },
      ],
      steps: [
        { agent: '市场扫描员', did: '对比了三个点子各自的客户呼声与竞争情况。', uses: [0, 1, 2] },
        { agent: '能力匹配员', did: '核对哪个点子能用生产环境里已有的能力做出来。', uses: [3, 2] },
        { agent: '实验设计员', did: '起草了一个四周实验，事先定好唯一的成功指标。', uses: [1, 4] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了本来要放上第一页幻灯片的那个数字。', uses: [] },
      ],
      headline: '测点子 B：客户主动要过，最难的那部分我们已经在运行。',
      claims: [
        { text: '三个点子里，只有 B 是客户主动要的。', cites: [1, 4], ok: true,
          why: '八次试点访谈里有五次提到它，还有两家客户在没人提示的情况下主动问起；A 和 C 没人要过。' },
        { text: 'B 复用的是我们已在生产环境运行的能力。', cites: [3, 2], ok: true,
          why: '合同解析今天已在为两家客户运行；点子 C 则需要六个月的新数据工作。' },
        { text: '找试点访谈里的客户测四周；成功的标准是无人提醒下的每周使用。', cites: [1, 4], ok: true,
          why: '试点客户来自提出这个痛点的访谈；指标照搬了那两家客户主动做的事。' },
        { text: '合同跟踪是一个百亿级的市场。', cites: [], ok: false,
          why: '五份来源里没有任何一份估算过市场规模；而第一页上一个猜出来的数字，正是委员会最先不再信任的东西。' },
      ],
      so: '你带给委员会的是一个四周的赌注，及格线事先画好——而不是一份路演稿。',
      yours: '用你自己的试点访谈和客户需求，跑一遍。',
    },
  },
];

/* Interface words, both languages. Kept beside the scenarios so the checker
   sees one file. */
export const UI = {
  en: {
    tabs: 'Scenarios', situation: 'Your situation', task: 'The task', sources: 'Sources', run: 'Start the agents', rerun: 'Run it again',
    working: 'Working…', result: 'The answer', because: 'Why — every line traceable', doubt: 'Doubt this', hide: 'Hide the check',
    verified: 'Verified', withdrawn: 'Withdrawn by the reviewer', noSource: 'no source',
    step: (i, n) => `Step ${i} of ${n}`, done: 'Done. Every line of the answer below names its sources — press “Doubt this” on any of them.',
    next: 'That was sample material, replayed. Your own documents live where you choose — in the cloud, on your own servers, or fully local.', cta: 'Start free', other: 'Try another scenario',
  },
  zh: {
    tabs: '场景', situation: '你的处境', task: '任务', sources: '来源', run: '开始运行智能体', rerun: '再运行一次',
    working: '运行中……', result: '结论', because: '依据——每一条都能追到来源', doubt: '质疑这条', hide: '收起核验',
    verified: '已核验', withdrawn: '已被审核员撤回', noSource: '无来源',
    step: (i, n) => `第 ${i} 步，共 ${n} 步`, done: '完成。下面结论的每一条都标明了来源——点任意一条的“质疑这条”试试。',
    next: '刚才是样例材料的回放。你的文件放在哪里由你决定：云端、自己的机房，或完全在本机。', cta: '免费开始', other: '换一个场景试试',
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
    onclick: () => select(i, false, true),
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

  /* Addressable, like the discipline tabs: /#demo-workforce opens on that
     scenario, so the one that is somebody's actual problem can be sent to
     them. Choosing a scenario rewrites the fragment without a history entry,
     and the language switch carries it across (motion.js). */
  function select(index, focus = false, write = focus) {
    stop();
    if (write) {
      history.replaceState(null, '', `#demo-${SCENARIOS[index].id}`);
      window.dispatchEvent(new Event('wsx:fragment'));
    }
    buttons.forEach((b, i) => {
      b.setAttribute('aria-selected', String(i === index));
      b.tabIndex = i === index ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', buttons[index].id);
    /* On a phone the tabs are one sideways-scrolling row. Bring the chosen
       one into it by scrolling the ROW — scrollIntoView would also move the
       page, and on mount the tabs can be above the screen. */
    const b = buttons[index];
    if (b.offsetLeft < tabs.scrollLeft || b.offsetLeft + b.offsetWidth > tabs.scrollLeft + tabs.clientWidth) {
      tabs.scrollLeft = b.offsetLeft - 12;
    }
    if (focus) b.focus({ preventScroll: true });
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
      el('p', { class: 'demo__kicker', text: ui.result }),
      el('p', { class: 'demo__headline', text: s.headline }),
      el('p', { class: 'demo__kicker', text: ui.because }), claims);
    const next = el('div', { class: 'demo__next', hidden: true },
      el('p', { class: 'demo__so', text: s.so }),
      el('p', { class: 'demo__yours', text: s.yours }),
      el('p', { class: 'demo__nextline', text: ui.next }),
      el('div', { class: 'demo__nextactions' },
        el('a', { class: 'btn btn--primary', href: APP, rel: 'noopener', text: ui.cta }),
        el('button', { class: 'btn btn--ghost demo__other', type: 'button', text: ui.other,
          onclick: () => select((index + 1) % SCENARIOS.length, true) })));
    const run = el('button', { class: 'btn demo__run', type: 'button', text: ui.run, onclick: () => start() });

    const claimItem = (c) => {
      const check = el('div', { class: 'demo__check', hidden: true },
        el('p', { class: 'demo__verdict' },
          el('strong', { text: `${c.ok ? '✓' : '✗'} ${c.ok ? ui.verified : ui.withdrawn}` }),
          el('span', { text: c.why })),
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
        el('p', { class: 'demo__kicker', text: ui.situation }),
        el('p', { class: 'demo__situation' }, el('strong', { text: s.role }), ' ', s.stakes),
        el('p', { class: 'demo__kicker', text: ui.task }),
        el('p', { class: 'demo__task', text: s.task }),
        el('p', { class: 'demo__kicker', text: `${ui.sources} (${s.sources.length})` }),
        el('ol', { class: 'demo__sources' }, sourceItems)),
      el('div', { class: 'demo__work' }, run, status, log, result, next),
    );
  }

  host.replaceChildren(tabs, panel);
  host.classList.add('is-live');
  const linked = SCENARIOS.findIndex((x) => location.hash === `#demo-${x.id}`);
  select(Math.max(0, linked));
}
