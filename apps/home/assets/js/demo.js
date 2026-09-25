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
      research: { src: 'anthropic-economic-index-2026-06', firm: 'Anthropic', title: 'Anthropic Economic Index report: Cadences', date: '2026-06-26', url: 'https://www.anthropic.com/research/economic-index-june-2026-report', page: null, quote: 'More than a third of respondents said it was likely or very likely that responsibilities would significantly change (for themselves, a peer, a junior colleague, and a senior colleague). 10% rated losing their own jobs as likely or very likely.', about: 'A survey of Claude users; the report notes its respondents skew toward knowledge workers in stable jobs.' },
      who: 'Head of people',
      ask: '“Is my job safe?” — what do I tell them?',
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
        { text: 'A third of roles can go by year end.', cites: [0, 1], ok: false,
          why: '34% of hours is not 34% of people. In the one pilot, nobody was let go — the freed time cleared the backlog. That is evidence, not a promise, and your people deserve to hear both.' },
      ],
      so: 'You can answer your people honestly — what changes, where they can go, what nobody knows yet — and build the plan with them.',
      yours: 'Run this on your own task inventory and survey.',
    },
    zh: {
      tab: '人才与组织转型',
      research: { src: 'anthropic-economic-index-2026-06', firm: 'Anthropic', title: 'Anthropic Economic Index report: Cadences', date: '2026-06-26', url: 'https://www.anthropic.com/research/economic-index-june-2026-report', page: null, quote: 'More than a third of respondents said it was likely or very likely that responsibilities would significantly change (for themselves, a peer, a junior colleague, and a senior colleague). 10% rated losing their own jobs as likely or very likely.', gloss: '超过三分之一的受访者认为，自己、同事、下属或上级的职责很可能会大幅改变；认为自己很可能丢掉工作的占 10%。', about: '对 Claude 用户的调查；报告说明，受访者偏向工作稳定的知识工作者。' },
      who: '人力负责人',
      ask: '员工问“饭碗保得住吗”，我怎么答？',
      role: '你负责一家银行运营条线 3,000 人的人力资源。',
      stakes: 'AI 将改变员工三分之一的工时。他们当面问你：我的饭碗还保得住吗？',
      task: '弄清哪些工作会变、人可以往哪里走、需要什么培训——别等小道消息先传开。',
      sources: [
        { who: '任务盘点 · 42 个岗位', text: '34% 的工时花在阅读、核对和重复录入文件上。' },
        { who: '试点 · 贷款处理，12 周', text: '处理时间下降 45%。没有一个人被裁；团队清掉了积压六周的工作。' },
        { who: '员工调研 · 2,400 份回复', text: '63% 的人担心自己的工作；74% 愿意参加培训，前提是在工作时间内。' },
        { who: '招聘计划', text: '风控和数据质量团队有 90 个岗位空缺，一直招不到人。' },
        { who: '技能评估', text: '40% 的处理人员，今天做的就是这些岗位要招的那种核对工作。' },
      ],
      steps: [
        { agent: '任务分析员', did: '把 42 个岗位拆成任务，标出最先会被 AI 改变的那部分。', uses: [0] },
        { agent: '试点分析员', did: '看贷款试点里的人，后来怎么样了。', uses: [1] },
        { agent: '技能匹配员', did: '把员工已有的技能，对上一直招不满的岗位。', uses: [3, 4, 2] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了那个人人都害怕的数字。', uses: [] },
      ],
      headline: '先变的是任务，不是岗位。为员工开一条路，通向你一直招不到人的岗位——并且赶在小道消息之前把话说清楚。',
      claims: [
        { text: '大约三分之一的工时最先改变：阅读、核对、重复录入。', cites: [0], ok: true,
          why: '42 个岗位合计 34% 的工时——变的是岗位里的任务，而不是整个岗位。' },
        { text: '为员工开出第一条转岗路：风控和数据质量，那里有 90 个岗位空着。', cites: [3, 4], ok: true,
          why: '缺口是实打实的；40% 的处理人员今天就在做这类核对。这是第一批能走的路，不是人人都有位置——方案里要讲清楚。' },
        { text: '在工作时间内培训，并在上线之前公布计划。', cites: [2], ok: true,
          why: '74% 的人愿意在工作时间内培训；63% 的人已经在担心——你不说，传言就会替你说。' },
        { text: '到年底可以裁掉三分之一的岗位。', cites: [0, 1], ok: false,
          why: '34% 的工时不等于 34% 的人。唯一的试点里，一个人都没有被裁——省出的时间清掉了积压。但一个 12 周的试点也不是保证——这一点同样要如实告诉员工。' },
      ],
      so: '员工问你的那个问题，你可以如实回答了：什么会变、可以往哪里走、哪些还没人知道——再和他们一起把计划定下来。',
      yours: '用你自己的岗位盘点和员工调研跑一遍。',
    },
  },

  /* ---- sales win rate ---------------------------------------------------- */
  {
    id: 'growth',
    en: {
      tab: 'Sales win rate',
      who: 'Head of sales',
      ask: 'CRM says we lose on price. True?',
      role: 'You lead sales for a B2B software company.',
      stakes: 'The win rate slid from 31% to 22% in a year. Everyone has a theory. Nobody has evidence.',
      task: 'Find out why the deals we should win are being lost.',
      sources: [
        { who: 'CRM · 146 lost deals', text: 'Win rate: 31% last year, 22% this year. Loss reason most often recorded: “price” (58%).' },
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
      headline: 'The CRM says we lose on price. The call transcripts and interviews point to how long the security review takes.',
      claims: [
        { text: 'The recorded loss reason, price, is contradicted in the win–loss interviews.', cites: [0, 2], ok: true,
          why: 'Price is logged in 58% of losses — but the win–loss quote we have names the security questionnaire, not price.' },
        { text: 'A slow security review is the pattern in the lost deals.', cites: [1, 3], ok: true,
          why: '29 of 40 lost deals waited nine days or more; the queue’s median is 11.' },
        { text: 'Test a three-day answer on every questionnaire, and track the win rate.', cites: [4, 3], ok: true,
          why: 'The deals we won got an answer within 3 days. The delay sits in a queue with one reviewer — which is fixable, and measurable.' },
        { text: 'Cut prices to win the deals back.', cites: [0], ok: false,
          why: 'It rests only on the CRM field the buyers contradict. It would cost margin on every deal and leave the nine-day wait in place.' },
      ],
      so: 'Your team stops arguing about discounts and fixes the one thing the buyers named.',
      yours: 'Run this on your own lost deals and call notes.',
    },
    zh: {
      tab: '销售赢单率',
      who: '销售负责人',
      ask: 'CRM 说输在价格，真的吗？',
      role: '你是一家 B2B 软件公司的销售负责人。',
      stakes: '一年之内，赢单率从 31% 跌到 22%。人人都有一套说法，没有一个人拿得出证据。',
      task: '查清楚：本该赢的单，为什么输了。',
      sources: [
        { who: 'CRM · 146 个丢单', text: '赢单率：去年 31%，今年 22%。记录最多的丢单原因：“价格”（58%）。' },
        { who: '通话记录 · 40 个丢单', text: '40 个里有 29 个，客户要做安全评审，而我们九天以上才答复。' },
        { who: '丢单复盘访谈 · 12 位客户', text: '“你们的价格没问题。我们选了最先答完安全问卷的那家。”' },
        { who: '安全团队 · 排队记录', text: '所有问卷都排队等同一位评审；答复时间中位数：11 天。' },
        { who: '赢单 · 上季度', text: '赢下的单里，安全问卷都在 3 天之内答复。' },
      ],
      steps: [
        { agent: '商机分析员', did: '读 CRM 里写的丢单原因。', uses: [0] },
        { agent: '通话分析员', did: '听丢单里客户真正要的是什么。', uses: [1, 2] },
        { agent: '对比分析员', did: '把丢的单和赢的单放在一起比。', uses: [3, 4] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了大家正准备动手的那个办法。', uses: [] },
      ],
      headline: 'CRM 说我们输在价格；通话记录和复盘访谈说，输在安全评审太慢。',
      claims: [
        { text: '在丢单复盘访谈里，“价格”这个原因被客户否认了。', cites: [0, 2], ok: true,
          why: '58% 的丢单记的是价格——可复盘访谈里客户的原话是：“你们的价格没问题。”' },
        { text: '安全评审太慢，在丢单里反复出现。', cites: [1, 3], ok: true,
          why: '40 个丢单里有 29 个等了九天以上；排队的中位数是 11 天。' },
        { text: '试行每份问卷三天内答复，并跟踪赢单率。', cites: [4, 3], ok: true,
          why: '赢下的单都在 3 天内拿到答复。卡点在只有一位评审的队列——这能改，也能量。' },
        { text: '降价把单子抢回来。', cites: [0], ok: false,
          why: '它只依据 CRM 里那个被客户否认的字段。每一单都让了利润，九天的等待却还在。' },
      ],
      so: '团队不再为折扣争论不休，而是去解决客户亲口说的那个问题。',
      yours: '用你自己的丢单记录和通话纪要跑一遍。',
    },
  },

  /* ---- AI-native enterprise path ----------------------------------------- */
  {
    id: 'native',
    en: {
      tab: 'AI-native enterprise path',
      research: { src: 'anthropic-economic-index-2026-06', firm: 'Anthropic', title: 'Anthropic Economic Index report: Cadences', date: '2026-06-26', url: 'https://www.anthropic.com/research/economic-index-june-2026-report', page: null, quote: 'large majorities of people report productivity gains in speed, scope, and quality of their work (86%, 82%, and 69%, respectively)', about: 'A survey of Claude users; the report notes its respondents skew toward knowledge workers in stable jobs.' },
      who: 'CEO',
      ask: 'We spent on AI. What did it change?',
      role: 'You are the CEO of a 200-person company.',
      stakes: 'You paid for AI, and your people already use it on their own. The board asks what it has changed — and you have no answer.',
      task: 'Lay out eighteen months: what comes first, what comes next, and how each step is measured.',
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
        { text: 'Months 1–3: bring the AI work people already do into the open, where the team can see it and build on it.', cites: [2, 1], ok: true,
          why: 'The habit exists (71%); what is missing is shared work (12%) and a shared record, which none of the 23 tools keeps.' },
        { text: 'Months 4–9: repeat the legal pilot’s pattern, one team at a time.', cites: [3], ok: true,
          why: 'Of the five sources, it is the only pattern with a measured result (−58%) and a trail anyone can audit.' },
        { text: 'Months 10–18: one shared record of decisions across all nine teams, measured against the 40% goal.', cites: [0, 4, 1], ok: true,
          why: 'Nine teams in three offices lose reasons between them; the board has already named the measure.' },
        { text: 'Buy an AI license for all 200 people in month one.', cites: [2], ok: false,
          why: 'The gap is between the 71% who use AI alone and the 12% who use it in shared work — and a license does not close it.' },
      ],
      so: 'You give the board a path with a measure at every stage — starting from the habit your people already have.',
      yours: 'Run this on your own org chart, tool list and survey.',
    },
    zh: {
      tab: 'AI 原生企业路径',
      research: { src: 'anthropic-economic-index-2026-06', firm: 'Anthropic', title: 'Anthropic Economic Index report: Cadences', date: '2026-06-26', url: 'https://www.anthropic.com/research/economic-index-june-2026-report', page: null, quote: 'large majorities of people report productivity gains in speed, scope, and quality of their work (86%, 82%, and 69%, respectively)', gloss: '……大多数人报告，工作在速度、范围和质量上都有提升（分别为 86%、82% 和 69%）……', about: '对 Claude 用户的调查；报告说明，受访者偏向工作稳定的知识工作者。' },
      who: '老板',
      ask: '钱花在 AI 上，到底改变了什么？',
      role: '你是一家 200 人公司的老板。',
      stakes: '钱花了，员工也早就在私下用 AI。董事会问：到底改变了什么？你答不上来。',
      task: '排出十八个月里先做什么、后做什么，每一步怎么量效果。',
      sources: [
        { who: '组织架构', text: '200 人，九个团队，分布在三个办公地。' },
        { who: '工具盘点', text: '在用工具 23 个；决定了什么、为什么这样决定，没有任何共享记录。' },
        { who: '员工调研', text: '71% 的人私下在用 AI；在共享工作中使用的只有 12%。' },
        { who: '法务试点 · 8 周', text: '合同审查时间下降 58%，每条审查意见都能追溯到具体条款。' },
        { who: '董事会目标', text: '收入增长 40%，人不能跟着同比例加。' },
      ],
      steps: [
        { agent: '组织分析员', did: '梳理决定在哪儿拍板、依据又在哪儿断了档。', uses: [0, 1] },
        { agent: '使用情况分析员', did: '找到了缺口：大多数人已经在用 AI，却几乎从不一起用。', uses: [2] },
        { agent: '路径规划员', did: '规划三个阶段——个人、团队、组织——每个阶段都有衡量指标。', uses: [2, 3, 4] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了那笔看着像有动作、却补不上缺口的采购。', uses: [] },
      ],
      headline: '先把各自私下用的 AI 摆上台面，一个团队一个团队地验证，再对着董事会 40% 的目标算账。',
      claims: [
        { text: '第 1–3 个月：把大家私下用 AI 做的事摆到明面上，让团队看得见、接得上。', cites: [2, 1], ok: true,
          why: '习惯已经有了（71%）；缺的是一起用（12%），以及 23 个工具里没有一个留下的共享记录。' },
        { text: '第 4–9 个月：把法务试点的做法，一个团队一个团队地复制过去。', cites: [3], ok: true,
          why: '五份材料里，只有它有实测结果（−58%），而且每条审查意见都能追溯到具体条款。' },
        { text: '第 10–18 个月：九个团队共用一套决策记录，以 40% 的目标来衡量。', cites: [0, 4, 1], ok: true,
          why: '三地九个团队之间，决策依据一直没留下来；董事会已经定好了衡量标准。' },
        { text: '第一个月给全部 200 人买 AI 账号。', cites: [2], ok: false,
          why: '71% 的人已经在用，缺的不是账号，而是一起用——只有 12%。光买账号补不上。' },
      ],
      so: '你交给董事会的，是一条每个阶段都有衡量指标的路径——起点是员工已经养成的习惯。',
      yours: '用你自己的组织架构、工具清单和员工调研跑一遍。',
    },
  },

  /* ---- AI return on investment ------------------------------------------- */
  {
    id: 'roi',
    en: {
      tab: 'AI return on investment',
      who: 'CFO',
      ask: 'Vendors say it works. Does my P&L?',
      role: 'You are the CFO of an 800-person logistics company.',
      stakes: 'The company spent $1.2M on AI tools last year. The board asks what it got back — and every vendor dashboard says “great.”',
      task: 'Find out what the AI spending actually returned, and what to renew.',
      sources: [
        { who: 'Vendor dashboards', text: 'Together, the three tools report “14,000 hours saved,” counted as prompts sent × an assumed 6 minutes each.' },
        { who: 'Licenses · 12 months', text: '$1.2M across three tools: a writing assistant ($700K), a routing optimizer ($300K), an invoice reader ($200K).' },
        { who: 'Operations data', text: 'Since the routing optimizer went live, fuel cost per delivery fell 7% on the routes that use it. Other routes are flat.' },
        { who: 'Accounts payable', text: 'Invoice processing time fell from 4 days to 1. Late-payment fees dropped by $150K.' },
        { who: 'Usage log · writing assistant', text: '38% of licensed seats were used in the last month.' },
      ],
      steps: [
        { agent: 'Spend analyst', did: 'Matched every license to the budget line it came from.', uses: [1] },
        { agent: 'Outcome analyst', did: 'Looked for results in the company’s own numbers, not the vendors’.', uses: [2, 3] },
        { agent: 'Usage analyst', did: 'Checked who actually uses what the company pays for.', uses: [4, 0] },
        { agent: 'Reviewer', did: 'Checked every claim against the sources. Withdrew the number most likely to go straight into the board deck.', uses: [] },
      ],
      headline: 'Renew the invoice reader. Routing shows a measured result, not yet a dollar figure. Measure the $700K writing assistant before renewing it.',
      claims: [
        { text: 'The routing optimizer shows a result: fuel cost per delivery down 7% on its routes — not yet set against its cost.', cites: [2, 1], ok: true,
          why: 'The comparison is built in — the routes without it stayed flat.' },
        { text: 'The invoice reader has earned back most of its cost in late fees alone.', cites: [3, 1], ok: true,
          why: '$150K in avoided late fees against a $200K license — and processing went from 4 days to 1.' },
        { text: 'Before renewing the writing assistant, measure it — and cut the seats nobody uses.', cites: [4, 1], ok: true,
          why: 'It is $700K of the $1.2M, and 38% of its seats were used last month. There is no outcome number for it yet.' },
        { text: 'AI saved us 14,000 hours last year.', cites: [0], ok: false,
          why: 'That is prompts × an assumed six minutes, from the vendors’ own dashboards. It measures activity, not time returned — and a board will ask about the second.' },
      ],
      so: 'You tell the board what paid off, what nobody has measured yet, and what to renew — with a source under every number.',
      yours: 'Run this on your own licenses and operating numbers.',
    },
    zh: {
      tab: 'AI 投入回报',
      who: '财务总监',
      ask: '供应商说有效，账上在哪？',
      role: '你是一家 800 人物流公司的财务总监。',
      stakes: '公司去年在 AI 工具上花了 900 万元。董事会问：换回来了什么？而每家供应商的后台都说“效果很好”。',
      task: '弄清楚 AI 上花的钱到底换回了什么，以及哪些该续费。',
      sources: [
        { who: '供应商后台', text: '三款工具的后台加起来报告“节省 14,000 小时”，算法是：提问次数 × 假定每次 6 分钟。' },
        { who: '许可费 · 12 个月', text: '三款工具共 900 万元：写作助手 500 万元、路线优化 250 万元、发票识别 150 万元。' },
        { who: '运营数据', text: '路线优化上线后，用它的线路每单油耗成本下降 7%；其他线路持平。' },
        { who: '应付账款', text: '发票处理时间从 4 天降到 1 天；逾期付款罚金少了 110 万元。' },
        { who: '使用日志 · 写作助手', text: '上个月，已购账号里只有 38% 被用过。' },
      ],
      steps: [
        { agent: '支出分析员', did: '把每一笔许可费对到它所属的预算科目。', uses: [1] },
        { agent: '成效分析员', did: '到公司自己的数字里找结果，而不是看供应商的数字。', uses: [2, 3] },
        { agent: '使用情况分析员', did: '查公司付了钱的东西，到底谁在用。', uses: [4, 0] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了最容易被直接拿去汇报的那个数字。', uses: [] },
      ],
      headline: '发票识别续费。路线优化有了实测结果，但还没折成钱。500 万元的写作助手，续费前先把效果量出来。',
      claims: [
        { text: '路线优化见到了结果：用它的线路，每单油耗成本下降 7%——还没和它的许可费对过账。', cites: [2, 1], ok: true,
          why: '对照组是现成的——没用它的线路一直持平。' },
        { text: '发票识别单靠少交的罚金，就收回了大部分成本。', cites: [3, 1], ok: true,
          why: '少交罚金 110 万元，对应 150 万元的许可费；处理时间还从 4 天降到了 1 天。' },
        { text: '续费写作助手之前，先衡量效果，并砍掉没人用的账号。', cites: [4, 1], ok: true,
          why: '它占了 900 万元里的 500 万元，上个月只有 38% 的账号被用过；到现在还没有任何成效数字。' },
        { text: 'AI 去年替我们节省了 14,000 小时。', cites: [0], ok: false,
          why: '这个数字是提问次数 × 假定的 6 分钟，出自供应商自己的后台。它衡量的是活跃度，不是省回的时间——董事会要问的是后者。' },
      ],
      so: '你告诉董事会：哪些见效了、哪些还没人量过、哪些该续费——每个数字下面都有来源。',
      yours: '用你自己的许可费清单和经营数据跑一遍。',
    },
  },

  /* ---- AI transformation strategy: pilots that never leave the lab ------- */
  {
    id: 'strategy',
    en: {
      tab: 'AI transformation strategy',
      who: 'COO',
      ask: 'Dozens of pilots, few live. What now?',
      role: 'You are the COO of a 600-person services firm.',
      stakes: 'Eighteen months of AI pilots: 23 started, 2 in production. The board has stopped asking what you are testing and started asking what it changed.',
      task: 'Decide which pilots to scale, which to stop — and why the rest never left the lab.',
      sources: [
        { who: 'Pilot register', text: '23 AI pilots started in 18 months. 2 are in production.' },
        { who: 'Pilot reviews', text: '19 of the 23 were judged on how good the demo looked. 4 had a business measure agreed before they began.' },
        { who: 'Legal · contract review pilot', text: 'Measured from day one: first-pass review of 40 contracts fell from six hours each to two, replacing the old first read. Every finding was checked against its clause.' },
        { who: 'Finance · variance report pilot', text: 'It worked in the pilot and never reached the monthly close: nobody owned changing the process.' },
        { who: 'Survey · 14 pilot teams', text: '11 of 14 say the pilot tool sat beside the old process instead of replacing a step in it.' },
      ],
      steps: [
        { agent: 'Portfolio analyst', did: 'Sorted all 23 pilots by what they were judged on.', uses: [0, 1] },
        { agent: 'Workflow analyst', did: 'Checked which pilots replaced a step of real work, and which ran beside it.', uses: [4, 3] },
        { agent: 'Value analyst', did: 'Kept only results measured in the business’s own terms.', uses: [2, 1] },
        { agent: 'Reviewer', did: 'Checked every claim against the sources. Withdrew the next pilot everyone assumed was ready.', uses: [] },
      ],
      headline: 'Only 4 of 23 pilots had a business measure, and 11 of 14 teams ran beside the old process. Scale contract review; start or scale nothing else until it has a measure and an owner.',
      claims: [
        { text: 'Most pilots were never set up to scale: 19 of 23 were judged on the demo.', cites: [1, 0], ok: true,
          why: 'Only 4 had a business measure agreed before they began, and 2 of 23 reached production.' },
        { text: 'Scale contract review: it has a business measure and replaced a real step.', cites: [2], ok: true,
          why: 'It was measured from day one, it replaced the old first read, and review went from six hours to two.' },
        { text: 'Make the manager who runs each process the owner of its change. No pilot starts or scales without that owner and a measure agreed up front.', cites: [3, 4, 1], ok: true,
          why: 'The variance report worked and stalled with no owner; 11 of 14 teams ran the tool beside the old process; 4 of 23 had a measure.' },
        { text: 'Scale the variance report next — it worked in the pilot.', cites: [3], ok: false,
          why: 'It worked, and it stalled because nobody owned changing the process. Scaled the same way, it stalls the same way — only bigger.' },
      ],
      so: 'You tell the board what changed, what stops, and what has to be true before the next pilot starts.',
      yours: 'Run this on your own pilot list and reviews.',
    },
    zh: {
      tab: 'AI 转型战略',
      who: '运营副总',
      ask: '试点一大堆，哪几个该放大？',
      role: '你是一家 600 人服务公司的运营副总。',
      stakes: '十八个月里做了 23 个 AI 试点，真正上线的只有 2 个。董事会已经不问你在试什么，而是问：到底改变了什么？',
      task: '决定哪些试点放大、哪些叫停——以及其余的为什么始终没走出实验室。',
      sources: [
        { who: '试点台账', text: '十八个月启动了 23 个 AI 试点；上线的有 2 个。' },
        { who: '试点评审', text: '23 个里有 19 个按演示效果评审；只有 4 个在启动前定好了业务指标。' },
        { who: '法务 · 合同初审试点', text: '从第一天就定了指标：40 份合同的初审时间，从每份六小时降到两小时，取代了原来的人工初读；每条审查意见都对着条款核对过。' },
        { who: '财务 · 差异报告试点', text: '试点里跑通了，却一直没进入月结：没人负责改流程。' },
        { who: '调研 · 14 个试点团队', text: '14 个团队里有 11 个说：试点工具摆在老流程旁边，没有替换掉其中任何一步。' },
      ],
      steps: [
        { agent: '组合分析员', did: '把 23 个试点按“拿什么来评”分了类。', uses: [0, 1] },
        { agent: '流程分析员', did: '核对哪些试点真的替换了实际工作里的一步，哪些只是摆在旁边。', uses: [4, 3] },
        { agent: '价值分析员', did: '只保留用业务自己的指标量出来的结果。', uses: [2, 1] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了大家都以为可以放大的那一个。', uses: [] },
      ],
      headline: '23 个试点里只有 4 个定了业务指标，14 个团队里有 11 个把工具摆在老流程旁边。放大合同初审；其余还在试的，没有指标和负责人之前，一个都不启动、不放大。',
      claims: [
        { text: '大多数试点从一开始就不是为放大而设：23 个里有 19 个按演示效果评。', cites: [1, 0], ok: true,
          why: '只有 4 个在启动前定好了业务指标；23 个里只有 2 个上线。' },
        { text: '放大合同初审：它有业务指标，也真的替换了一步工作。', cites: [2], ok: true,
          why: '它从第一天就有指标，取代了原来的人工初读，初审从六小时降到两小时。' },
        { text: '每个试点都要有一位管这个流程的经理负责改流程；没有负责人、没有事先定好的指标，任何试点都不启动、不放大。', cites: [3, 4, 1], ok: true,
          why: '差异报告跑通了，却因为没人负责而卡住；14 个团队里有 11 个把工具摆在老流程旁边；23 个里只有 4 个定了指标。' },
        { text: '下一个放大差异报告——它在试点里跑通了。', cites: [3], ok: false,
          why: '它跑通了，也因为没人负责改流程而卡住了。照同样的方式放大，只会在更大的规模上卡住。' },
      ],
      so: '你告诉董事会：改变了什么、停掉什么、下一个试点开始之前必须先满足什么。',
      yours: '用你自己的试点台账和评审记录跑一遍。',
    },
  },

  /* ---- AI governance ----------------------------------------------------- */
  {
    id: 'governance',
    en: {
      tab: 'AI governance',
      who: 'General counsel',
      ask: 'Banning chatbots fails. What do I show clients?',
      role: 'You are the general counsel of a 1,500-person professional-services firm.',
      stakes: 'Last month a consultant pasted a client’s draft contract into a public chatbot. The client found out. The managing partner wants it never to happen again.',
      task: 'Decide how the firm governs AI use — without pretending people will stop using it.',
      sources: [
        { who: 'Network log · 30 days', text: 'Traffic to public AI tools from 1,140 of 1,500 staff accounts.' },
        { who: 'Staff survey · 900 replies', text: '64% use public AI tools weekly. 81% would switch to an approved tool that is as good.' },
        { who: 'Incident review', text: 'The pasted contract contained client names and pricing. There was no approved tool for drafting.' },
        { who: 'Client contracts · sample of 40', text: '31 of 40 forbid sending client data to third parties without consent.' },
        { who: 'Peer firm · public statement', text: 'A peer banned public AI tools last year. Its own audit found people kept using them on personal phones.' },
      ],
      steps: [
        { agent: 'Usage analyst', did: 'Measured how widely public AI tools are already used.', uses: [0, 1] },
        { agent: 'Contract analyst', did: 'Read what the firm has promised its clients about their data.', uses: [3, 2] },
        { agent: 'Policy designer', did: 'Drafted rules around how people actually use the tools.', uses: [1, 2, 4] },
        { agent: 'Reviewer', did: 'Checked every claim against the sources. Withdrew the rule that would have felt safest.', uses: [] },
      ],
      headline: '1,140 of 1,500 accounts already use public AI, and the one peer that banned it pushed use onto personal phones. Give people an approved tool that keeps client data inside — and make every use traceable.',
      claims: [
        { text: 'Use is already widespread; the policy has to start from that.', cites: [0, 1], ok: true,
          why: 'Traffic from 1,140 of 1,500 accounts, and 64% use public tools every week.' },
        { text: 'Offer an approved tool where client data stays inside the firm.', cites: [1, 2, 3], ok: true,
          why: '81% would switch to one that is as good; the incident happened because there was none; 31 of 40 contracts forbid sending client data to third parties without consent.' },
        { text: 'Record what client data each AI use touched, and where it went — so a client’s question is answered from the record.', cites: [3], ok: true,
          why: 'With 31 of 40 contracts restricting where client data goes, the firm has to be able to show where it went — not only promise.' },
        { text: 'Ban public AI tools across the firm.', cites: [4, 0], ok: false,
          why: 'The peer that banned them found use moved to personal phones — out of the firm’s reach and out of any record. With 1,140 accounts already using them, a ban hides the risk instead of removing it.' },
      ],
      so: 'You give the managing partner a policy people will actually follow — and a record you can show a client.',
      yours: 'Run this on your own usage logs and client terms.',
    },
    zh: {
      tab: 'AI 治理与合规',
      who: '法务总监',
      ask: '员工把客户数据贴进 AI，怎么办？',
      role: '你是一家 1,500 人专业服务公司的法务总监。',
      stakes: '上个月，一位顾问把客户的合同草稿粘进了公共 AI 聊天工具。客户知道了。管理合伙人的要求只有一句：绝不能再发生。',
      task: '决定公司该怎样管 AI 的使用——而不是假装大家会停下来不用。',
      sources: [
        { who: '网络日志 · 30 天', text: '1,500 个员工账号里，有 1,140 个访问过公共 AI 工具。' },
        { who: '员工调研 · 900 份回复', text: '64% 的人每周都用公共 AI 工具；81% 表示，公司若提供一样好用的合规工具，愿意换过去。' },
        { who: '事件复盘', text: '被粘贴的合同里有客户名称和报价。当时公司没有可以用来起草的合规工具。' },
        { who: '客户合同 · 抽样 40 份', text: '40 份里有 31 份规定：未经同意，不得把客户数据交给第三方。' },
        { who: '同行公司 · 公开声明', text: '一家同行去年禁用了公共 AI 工具；它自己的审计发现，员工转到个人手机上继续用。' },
      ],
      steps: [
        { agent: '使用情况分析员', did: '量清楚公共 AI 工具已经用得有多普遍。', uses: [0, 1] },
        { agent: '合同分析员', did: '读公司在客户数据上做过哪些承诺。', uses: [3, 2] },
        { agent: '制度设计员', did: '按员工实际怎么用，起草规则。', uses: [1, 2, 4] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了那条听起来最稳妥的规定。', uses: [] },
      ],
      headline: '1,500 个账号里已有 1,140 个在用公共 AI，而禁用过的那家同行，把使用逼到了个人手机上。给大家一个客户数据不出公司的合规工具——并让每一次使用都有据可查。',
      claims: [
        { text: '使用已经很普遍，制度得从这个事实出发。', cites: [0, 1], ok: true,
          why: '1,500 个账号里有 1,140 个在访问；64% 的人每周都用。' },
        { text: '提供一个客户数据不出公司的合规工具。', cites: [1, 2, 3], ok: true,
          why: '81% 的人愿意换成一样好用的合规工具；这次事件，正是因为当时没有；40 份合同里有 31 份禁止未经同意把客户数据交给第三方。' },
        { text: '记下每次使用 AI 碰了哪些客户数据、数据去了哪里——客户问起时，拿记录来回答。', cites: [3], ok: true,
          why: '40 份合同里有 31 份限制客户数据的去向——公司要拿得出数据去了哪里的证明，而不只是一句承诺。' },
        { text: '全公司禁用公共 AI 工具。', cites: [4, 0], ok: false,
          why: '禁用过的同行发现，使用转到了个人手机上——那里公司管不到，也留不下记录。1,140 个账号已经在用，一纸禁令藏住了风险，却没有消除它。' },
      ],
      so: '你交给管理合伙人的，是一份大家真会照着做的制度——外加一份能拿给客户看的记录。',
      yours: '用你自己的使用日志和客户合同条款跑一遍。',
    },
  },

  /* ---- customer operations ----------------------------------------------- */
  {
    id: 'service',
    en: {
      tab: 'Customer operations',
      who: 'Head of service',
      ask: 'Headcount frozen. What can AI answer?',
      role: 'You run customer service for a large insurer.',
      stakes: 'Contacts keep rising, headcount is frozen, and you owe the CEO an AI plan by Friday.',
      task: 'Decide where AI should handle customer contacts — and where it must not.',
      sources: [
        { who: 'Contact log · 12 months', text: '410,000 contacts, up a third on the year before. 46% ask about a claim’s status or a document we already hold.' },
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
        { text: 'Up to about a third of all contacts could move to self-service customers already want.', cites: [0, 4], ok: true,
          why: '46% are status or known-document questions, and 71% of surveyed customers would use self-service for a status update: 46% × 71% ≈ 33% — assuming document questions behave like status ones. A ceiling, not a forecast.' },
        { text: 'Give every agent an assistant that searches the four systems for them.', cites: [1, 2], ok: true,
          why: '38% of each call is spent searching — and the worst complaints come from being passed from person to person.' },
        { text: 'Every claim denial stays with a person.', cites: [3, 4], ok: true,
          why: 'The regulator requires it, and only 18% want self-service when they dispute a claim.' },
        { text: 'Halve the contact center within a year.', cites: [], ok: false,
          why: 'The sources show which contacts can move, not how many people you need. Freed time goes first to disputes and denials, where customers want a person.' },
      ],
      so: 'You walk into Friday with a plan you can defend line by line — and no headcount promise that nothing supports.',
      yours: 'Run this on your own contact logs and call reviews.',
    },
    zh: {
      tab: '客户运营重塑',
      who: '客服负责人',
      ask: '编制冻结，哪些进线能交给 AI？',
      role: '你负责一家大型保险公司的客户服务。',
      stakes: '进线量一直在涨，编制冻结，老板要你周五前拿出 AI 方案。',
      task: '决定哪些客户来电与咨询交给 AI——以及哪些绝不能交。',
      sources: [
        { who: '进线记录 · 12 个月', text: '共 410,000 次进线，比上一年多三分之一；46% 问的是理赔进度，或我们手里早有的文件。' },
        { who: '质检抽查 · 300 通电话', text: '每通电话有 38% 的时间，坐席在四个系统里找答案。' },
        { who: '投诉团队', text: '最严重的投诉，都来自在三个以上的人之间被转来转去的客户。' },
        { who: '监管要求', text: '拒赔决定必须由人向客户作出解释。' },
        { who: '客户调研 · 1,800 份回复', text: '71% 愿意用自助服务查进度；理赔争议时愿意的只有 18%。' },
      ],
      steps: [
        { agent: '进线分析员', did: '把一年的进线，按客户真正想办的事归类。', uses: [0, 4] },
        { agent: '问题回溯员', did: '顺着出了问题的通话，追到问题出在哪一步。', uses: [1, 2] },
        { agent: '合规核查员', did: '标出监管要求必须由人完成的每一步。', uses: [3] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了一个没有任何来源撑得住的承诺。', uses: [] },
      ],
      headline: '愿意自助的客户让他们自助，给每位坐席配一个 AI 助手，拒赔始终由人来谈。',
      claims: [
        { text: '最多大约三分之一的进线，可以转给客户本来就愿意用的自助服务。', cites: [0, 4], ok: true,
          why: '46% 是查进度或查已有文件；受访客户里 71% 愿意自助查进度：46% × 71% ≈ 33%（假定查文件与查进度的意愿相近）。这是上限，不是预测。' },
        { text: '给每位坐席配一个 AI 助手，替他们在四个系统里找答案。', cites: [1, 2], ok: true,
          why: '每通电话 38% 的时间花在找答案上——而最严重的投诉，来自被转来转去。' },
        { text: '每一次拒赔，都由人来谈。', cites: [3, 4], ok: true,
          why: '监管这样要求；而理赔争议时，只有 18% 的客户愿意自助。' },
        { text: '一年内把客服中心砍掉一半。', cites: [], ok: false,
          why: '来源说明了哪些进线可以转走，却没说明需要多少人。省下的人手，先放到客户最需要人工的理赔争议和拒赔上。' },
      ],
      so: '周五你带进会议室的，是一份每一行都经得起追问的方案——里面没有一个没依据的裁员数字。',
      yours: '用你自己的进线记录和质检抽查跑一遍。',
    },
  },

  /* ---- frontline expertise ----------------------------------------------- */
  {
    id: 'expertise',
    en: {
      tab: 'Frontline expertise',
      research: { src: 'anthropic-economic-index-2026-06', firm: 'Anthropic', title: 'Anthropic Economic Index report: Cadences', date: '2026-06-26', url: 'https://www.anthropic.com/research/economic-index-june-2026-report', page: null, quote: 'People with at least 15 years of experience put that share of tasks AI can do roughly 10 percentage points lower than those in their first year of work.', about: 'A survey of Claude users; the report notes its respondents skew toward knowledge workers in stable jobs.' },
      who: 'Plant manager',
      ask: 'My best technicians retire soon. What leaves with them?',
      role: 'You run a plant that makes precision parts — 450 people.',
      stakes: 'Eleven of your most senior technicians retire within three years. They fix six stoppages in every ten — and when a line stops at night, they get the call.',
      task: 'Ask the senior technicians to teach what they know, while they are still here to teach it.',
      sources: [
        { who: 'Maintenance log · 2 years', text: '1,260 line stoppages. 62% were fixed by one of 11 senior technicians.' },
        { who: 'Equipment manuals', text: 'The manuals describe 35% of the fixes recorded in the log. The rest are not written down anywhere.' },
        { who: 'Interview · senior technician, 28 years', text: '“Half of it is the sound the spindle makes before it fails. You can’t put that in a manual — but I can show someone.”' },
        { who: 'Pilot · paired shifts, 10 weeks', text: 'Juniors paired with a senior fixed stoppages 40% faster by the end, and wrote down each fix in their own words.' },
        { who: 'HR · retirement plan', text: '11 senior technicians retire within three years; 4 of them within twelve months.' },
      ],
      steps: [
        { agent: 'Log analyst', did: 'Found which stoppages only the senior technicians can fix.', uses: [0, 4] },
        { agent: 'Gap analyst', did: 'Compared the fixes in the log with what the manuals cover.', uses: [1, 0] },
        { agent: 'Knowledge designer', did: 'Looked at how know-how actually passed from one person to another in the pilot.', uses: [2, 3] },
        { agent: 'Reviewer', did: 'Checked every claim against the sources. Withdrew the shortcut that would replace the people who hold the knowledge.', uses: [] },
      ],
      headline: 'Most of the know-how is in no manual. Keep it by pairing people and writing down every fix in the fixer’s words — starting with the four who leave first.',
      claims: [
        { text: 'Most of what keeps the lines running is unwritten.', cites: [1, 0], ok: true,
          why: 'The manuals cover 35% of recorded fixes, and 62% of the 1,260 stoppages were fixed by the same 11 people.' },
        { text: 'Pair a junior with each senior, and write down every fix in the fixer’s own words.', cites: [3, 2], ok: true,
          why: 'In the pilot, paired juniors got 40% faster and left a written record; the technician says it has to be shown, not recalled.' },
        { text: 'Start with the four who retire within twelve months.', cites: [4], ok: true,
          why: '4 of the 11 leave in the next year; the other seven leave more time.' },
        { text: 'Replace the senior technicians with an AI assistant trained on the manuals.', cites: [1, 2], ok: false,
          why: 'The manuals hold 35% of the fixes. An assistant trained on them would know only that 35%. The rest lives in the people who fix the line, and it passes on only when they show someone.' },
      ],
      so: 'The knowledge stays in the plant, and the veterans are asked to teach rather than being replaced — in the pilot, paired juniors were fixing stoppages 40% faster within ten weeks.',
      yours: 'Run this on your own maintenance logs and manuals.',
    },
    zh: {
      tab: '老师傅经验传承',
      research: { src: 'anthropic-economic-index-2026-06', firm: 'Anthropic', title: 'Anthropic Economic Index report: Cadences', date: '2026-06-26', url: 'https://www.anthropic.com/research/economic-index-june-2026-report', page: null, quote: 'People with at least 15 years of experience put that share of tasks AI can do roughly 10 percentage points lower than those in their first year of work.', gloss: '工作 15 年以上的人估计 AI 能替他们完成的任务比例，比入职第一年的人低约 10 个百分点。', about: '对 Claude 用户的调查；报告说明，受访者偏向工作稳定的知识工作者。' },
      who: '厂长',
      ask: '老师傅要退休了，本事怎么留下？',
      role: '你负责一家精密零部件工厂，450 人。',
      stakes: '最资深的 11 位老师傅，三年内陆续退休。十次停线里有六次是他们修好的；夜里产线一停，被叫起来的总是他们。',
      task: '趁老师傅还在，请他们把本事传下去。',
      sources: [
        { who: '维修记录 · 2 年', text: '共 1,260 次停线；62% 是 11 位老师傅中的一位修好的。' },
        { who: '设备手册', text: '手册只写到了记录里 35% 的修法；其余的，哪里都没写。' },
        { who: '访谈 · 老师傅，工龄 28 年', text: '“一半的活儿，是听主轴坏之前的那个声音。这个写不进手册——但我能带着人听。”' },
        { who: '试点 · 师徒同班，10 周', text: '跟着老师傅上班的年轻技工，到最后排故快了 40%，而且每次修法都用自己的话记了下来。' },
        { who: '人力 · 退休计划', text: '11 位老师傅三年内退休；其中 4 位在十二个月内。' },
      ],
      steps: [
        { agent: '记录分析员', did: '找出哪些停线只有老师傅修得好。', uses: [0, 4] },
        { agent: '差距分析员', did: '把记录里的修法，和手册写到的内容对了一遍。', uses: [1, 0] },
        { agent: '传承设计员', did: '看试点里，本事到底是怎么从一个人传到另一个人手上的。', uses: [2, 3] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了那条要拿 AI 替代老师傅的捷径。', uses: [] },
      ],
      headline: '大部分本事不在任何手册里。靠师徒同班，把每次修法用修的人自己的话记下来——从最先退休的四位开始。',
      claims: [
        { text: '让产线转起来的本事，大部分没写下来。', cites: [1, 0], ok: true,
          why: '手册只写到 35% 的修法；1,260 次停线里，62% 是同样这 11 个人修好的。' },
        { text: '每位老师傅带一个徒弟，每次修法都用修的人自己的话记下来。', cites: [3, 2], ok: true,
          why: '试点里，跟班的徒弟快了 40%，还留下了文字记录；一位老师傅说，听声音这门本事写不进手册，但能带着人听。' },
        { text: '先从十二个月内退休的四位开始。', cites: [4], ok: true,
          why: '11 位里有 4 位十二个月内退休；其余七位，还有时间。' },
        { text: '用一个读过设备手册的 AI 助手，替代老师傅。', cites: [1, 2], ok: false,
          why: '手册只装着 35% 的修法。用它训练出来的助手，只懂这 35%；其余的本事在修产线的人身上，只能由他们带着人学。' },
      ],
      so: '本事留在了厂里，老师傅被请来当师傅而不是被替换——试点里跟班的徒弟，十周后排故快了 40%。',
      yours: '用你自己的维修记录和设备手册跑一遍。',
    },
  },

  /* ---- design thinking --------------------------------------------------- */
  {
    id: 'design',
    en: {
      tab: 'Design thinking',
      who: 'Head of product',
      ask: 'Which problem deserves our one bet?',
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
        { agent: 'Pattern finder', did: 'Counted how often lost receipts and the form come up, then checked the count against the survey.', uses: [1, 2, 3] },
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
          why: 'The CFO names the cost (a day of close) and says they would pay to fix it. The finance manager sees the same delay from the other side.' },
        { text: 'Redesign the expense form this quarter.', cites: [3], ok: false,
          why: 'Only 9% find the form hard. It would spend your one bet on a problem few of your customers report.' },
      ],
      so: 'Your one bet this quarter goes on the problem customers actually have — and you can show why.',
      yours: 'Run this on your own interview notes.',
    },
    zh: {
      tab: '设计思维',
      who: '产品负责人',
      ask: '这个季度唯一的赌注，押哪个问题？',
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
        { agent: '访谈分析员', did: '把十二次访谈里的每一条抱怨，按发生环节标注：保管发票、填表、审批。', uses: [0, 1, 2] },
        { agent: '对比分析员', did: '数了“发票丢了”和“表单难用”各出现几次，再用问卷在更大范围里核对。', uses: [1, 2, 3] },
        { agent: '问题定义员', did: '把问题写成一句“怎样才能……”，并对应到业务损失。', uses: [2, 4] },
        { agent: '审核员', did: '逐条对照来源核验结论，撤回了团队早已排进计划的那个方案。', uses: [] },
      ],
      headline: '问题不在表单，而在付完款到报销之间，那张不见了的发票。',
      claims: [
        { text: '痛点在于留住发票，而不在于填表。', cites: [1, 2, 3], ok: true,
          why: '两位受访者原话如此；问卷里丢发票的比例是 64%，觉得表单难用的只有 9%。' },
        { text: '怎样才能让发票在付款那一刻就自动归档？', cites: [1, 2], ok: true,
          why: '两位销售都是在“付完款”到“去报销”之间弄丢发票——问题就框在这段空档上。' },
        { text: '能让客户掏钱的理由：月结能少拖一天。', cites: [4, 0], ok: true,
          why: '财务总监点明了代价（月结多拖一天），并且愿意付钱解决；财务经理从另一头看到的是同一个拖延。' },
        { text: '本季度重新设计报销表单。', cites: [3], ok: false,
          why: '只有 9% 的人觉得表单难用——把唯一的赌注押在这上面，押错了地方。' },
      ],
      so: '这个季度唯一的赌注，押在客户真正遇到的问题上——而且你说得出为什么。',
      yours: '用你自己的访谈记录跑一遍。',
    },
  },

  /* ---- innovation -------------------------------------------------------- */
  {
    id: 'innovation',
    en: {
      tab: 'Innovation',
      who: 'Innovation lead',
      ask: 'Three ideas, budget for one.',
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
      headline: 'Test idea B: customers asked for it, and we already parse contracts in production.',
      claims: [
        { text: 'Idea B is the one customers asked for.', cites: [1, 4], ok: true,
          why: 'Five of eight pilot calls raised it, and two customers asked for it without being prompted. None of these sources shows anyone asking for A or C.' },
        { text: 'Idea B reuses a capability we already run in production.', cites: [3, 2], ok: true,
          why: 'Contract parsing is live for two customers today. Idea C would need six months of new data work.' },
        { text: 'Test it for four weeks with customers from the pilot calls. Success means weekly use nobody had to prompt.', cites: [1, 4], ok: true,
          why: 'The pilots come from the calls that raised the pain; the measure tests whether that unprompted interest holds up week after week.' },
        { text: 'Contract tracking is a $2B market.', cites: [], ok: false,
          why: 'None of the five sources sizes any market — and a guess on slide one is the first thing a committee stops trusting.' },
      ],
      so: 'You bring the committee a four-week bet with the pass line drawn in advance — not a pitch.',
      yours: 'Run this on your own pilot notes and customer requests.',
    },
    zh: {
      tab: '创新',
      who: '创新负责人',
      ask: '三个点子，只够做一个。',
      role: '你负责一家法律软件公司的创新团队。',
      stakes: '三个点子，只有一份预算；管委会两周后要结论。',
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
      headline: '测点子 B：客户主动要过，合同解析我们线上已经在跑。',
      claims: [
        { text: '三个点子里，B 是客户主动要的那个。', cites: [1, 4], ok: true,
          why: '八次试点访谈里有五次提到它，还有两家客户在没人提示的情况下主动问起；这些来源里，没有人要过 A 或 C。' },
        { text: 'B 用的是我们线上已经在跑的能力。', cites: [3, 2], ok: true,
          why: '合同解析今天已在为两家客户运行；点子 C 则需要六个月去接新的数据源。' },
        { text: '找试点访谈里的客户测四周；成功的标准是客户不用催，每周自己在用。', cites: [1, 4], ok: true,
          why: '试点客户来自提出这个痛点的访谈；指标检验的是，那份主动的兴趣能不能一周一周地撑下去。' },
        { text: '合同跟踪是一个百亿级的市场。', cites: [], ok: false,
          why: '五份来源里没有任何一份估算过市场规模；开篇放个拍脑袋的数字，管委会第一个就不信。' },
      ],
      so: '你带给管委会的是一个四周的赌注，及格线事先画好——而不是一份路演稿。',
      yours: '用你自己的试点访谈和客户需求跑一遍。',
    },
  },
];

/* Interface words, both languages. Kept beside the scenarios so the checker
   sees one file. */
export const UI = {
  en: {
    tabs: 'Scenarios', situation: 'Your situation', research: 'What the research says', gloss: '', page: (n) => `p. ${n}`, task: 'The task', sources: 'Sources', run: 'Start the agents', rerun: 'Run it again',
    idle: 'The agents’ work appears here, step by step — which source each one read, and what it concluded.',
    working: 'Working…', result: 'The answer', because: 'Why — every line traceable', doubt: 'Doubt this', hide: 'Hide the check',
    verified: 'Matches its sources', withdrawn: 'Withdrawn — it looks right, and the sources don’t hold it up', noSource: 'no source',
    step: (i, n) => `Step ${i} of ${n}`, done: 'Done. One line below looked right and wasn’t — the reviewer struck it before anyone relied on it. The reviewer is an agent too, so the call is yours. Press “Doubt this” on any other line to check it yourself.',
    decideQ: 'Your call:', overruledLabel: 'Reviewer’s objection — the sources don’t hold it up. You put it back.',
    doneBack: 'Done. The reviewer struck one line; you put it back, and its objection stays with it.', keepOut: 'Keep it out', putBack: 'Put it back',
    keptOut: 'Kept out. Your decision stands beside the reviewer’s reason.',
    putBackDone: 'Put back — by you. The reviewer’s objection stays beside it, so anyone who relies on this line sees both.',
    copy: 'Copy as a note', copied: 'Copied — paste it into your meeting notes.', copyHere: 'Your browser would not copy it. Select the text below:',
    noteFoot: 'Sample material from the WorkspaceX scripted demo.', noteOut: 'Withdrawn', noteBack: 'Put back by me, over the reviewer’s objection',
    next: 'That was sample material, replayed. Your own documents live where you choose — in the cloud, on your own servers, or fully local.', cta: 'Start free', other: 'Try another scenario',
  },
  zh: {
    tabs: '场景', situation: '你的处境', research: '研究怎么说', gloss: '译文：', page: (n) => `第 ${n} 页`, task: '任务', sources: '来源', run: '开始运行智能体', rerun: '再运行一次',
    idle: '智能体的工作会在这里一步步出现——每一步读了哪份来源、得出了什么。',
    working: '运行中……', result: '结论', because: '依据——每一条都能追到来源', doubt: '质疑这条', hide: '收起核验',
    verified: '与来源相符', withdrawn: '已撤回：看着对，来源撑不住', noSource: '无来源',
    step: (i, n) => `第 ${i} 步，共 ${n} 步`, done: '完成。下面有一条看着没问题，其实站不住——审核员在任何人照着做之前把它划掉了。审核员同样是智能体，所以最后由你拍板。其余每一条，点“质疑这条”自己核一遍。',
    decideQ: '撤回这条，你同意吗？', keepOut: '同意撤回', putBack: '不同意，恢复这条', overruledLabel: '审核员的异议：来源撑不住。已由你恢复。',
    doneBack: '完成。审核员划掉了一条，你把它恢复了；它的异议一直附在旁边。',
    keptOut: '已撤回。你的确认和审核员的理由一起记下了。',
    putBackDone: '已由你恢复。审核员的反对意见会一直附在这条旁边，之后照着做的人都看得到。',
    copy: '复制为一段纪要', copied: '已复制——直接粘贴到会议纪要里。', copyHere: '浏览器没能直接复制，请手动选中下面的文字：',
    noteFoot: '以上为 WorkspaceX 脚本演示中的样例材料。', noteOut: '已撤回', noteBack: '由我恢复，审核员有异议',
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

/* One real finding beside the sample material, when a report has been read
   for it: the sentence exactly as printed (it stays in the report's
   language), who published it, when, and the page — linked. Only
   scripts/add-source.py admits a sentence, after finding it in the report's
   own file; check-citations.mjs holds these fields to that register. */
function researchBlock(r, ui, lang) {
  if (!r) return null;
  /* Cut from inside a sentence, a quote says so: an ellipsis where the
     printed sentence goes on. */
  const q = `${/^[a-z]/.test(r.quote) ? '…' : ''}${r.quote}${/[.!?]$/.test(r.quote) ? '' : '…'}`;
  return el('figure', { class: 'demo__research' },
    el('p', { class: 'demo__kicker', text: ui.research }),
    el('blockquote', { class: 'demo__rquote', lang: /[\u4e00-\u9fff]/.test(r.quote) ? 'zh-CN' : 'en', text: `“${q}”` }),
    r.gloss ? el('p', { class: 'demo__rgloss', text: `${ui.gloss}${r.gloss}` }) : null,
    el('figcaption', { class: 'demo__rsource' },
      el('a', { href: r.url, rel: 'noopener', text: `${r.firm} · ${r.title}` }),
      ` · ${r.date}${r.page ? ` · ${ui.page(r.page)}` : ''}`,
      el('span', { class: 'demo__rabout', text: r.about })));
}

export function initDemo(host) {
  if (!host || host.dataset.mounted) return;
  host.dataset.mounted = '1';
  const lang = document.documentElement.lang.startsWith('zh') ? 'zh' : 'en';
  const ui = UI[lang];
  const research = (r) => researchBlock(r, ui, lang);
  const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timers = [];
  const stop = () => { timers.forEach(clearTimeout); timers = []; };

  const tabs = el('div', { class: 'demo__tabs', role: 'tablist', 'aria-label': ui.tabs });
  const panel = el('div', { class: 'demo__panel', role: 'tabpanel', tabindex: '-1' });
  const buttons = SCENARIOS.map((s, i) => el('button', {
    class: 'demo__tab', type: 'button', role: 'tab', id: `demo-tab-${s.id}`,
    'aria-controls': 'demo-panel', 'aria-selected': 'false', tabindex: '-1',
    'data-scenario': s.id,
    onclick: () => select(i, false, true),
    onkeydown: (e) => {
      const n = SCENARIOS.length;
      const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      select((to + n) % n, true);
    },
  },
  /* A card per reader, not a list of topics: the role and the question that
     keeps that person up, so a visitor finds themselves before they read a
     word of the scenario. The topic name moves to the situation heading. */
  el('span', { class: 'demo__tabwho', text: s[lang].who }),
  el('span', { class: 'demo__tabask', text: s[lang].ask })));
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

    const idle = el('p', { class: 'demo__idle', text: ui.idle });
    const log = el('ol', { class: 'demo__log', 'aria-live': 'polite' });
    const status = el('p', { class: 'demo__status', role: 'status' });
    const claims = el('ul', { class: 'demo__claims' });
    const result = el('div', { class: 'demo__result', hidden: true },
      el('p', { class: 'demo__kicker', text: ui.result }),
      el('p', { class: 'demo__headline', text: s.headline }),
      el('p', { class: 'demo__kicker', text: ui.because }), claims);
    /* "The call is yours" has to be a call the reader can make. Two buttons
       under the withdrawn claim: agree, or put it back over the reviewer's
       objection — which lifts the strike and keeps the objection in view.
       Round-71 readers, briefed as a COO and a CFO, found the page promised
       a person decides and gave them nothing to decide with. */
    const decisions = new Map();
    const decide = (c) => {
      const said = el('p', { class: 'demo__decided', role: 'status' });
      /* Everything on screen follows the decision: the verdict label, the
         status line above, and a result line that stays visible when the
         check is folded away. A reader who put a claim back saw "Withdrawn"
         twice more and read it as the page overruling them. */
      const choose = (back) => {
        decisions.set(c, back);
        const li = said.closest('.demo__claim');
        li?.classList.toggle('is-overruled', back);
        li?.querySelector('.demo__claimtext s')?.classList.toggle('is-lifted', back);
        const label = li?.querySelector('.demo__verdict strong');
        if (label) label.textContent = `✗ ${back ? ui.overruledLabel : ui.withdrawn}`;
        status.textContent = back ? ui.doneBack : ui.done;
        buttons.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 1) === back)));
        said.textContent = back ? ui.putBackDone : ui.keptOut;
      };
      const buttons = [
        el('button', { class: 'demo__decidebtn', type: 'button', 'aria-pressed': 'false', text: ui.keepOut, onclick: () => choose(false) }),
        el('button', { class: 'demo__decidebtn', type: 'button', 'aria-pressed': 'false', text: ui.putBack, onclick: () => choose(true) }),
      ];
      return [el('div', { class: 'demo__decide' },
        el('p', { class: 'demo__decideq', text: ui.decideQ }),
        el('div', { class: 'demo__decidebtns' }, buttons)), said];
    };

    /* What a reader takes into the room: the answer, what stands with its
       sources, and what was struck and why — with their own call on it. */
    const [colon, dash, open, close, comma] = lang === 'zh' ? ['：', '——', '［', '］', '、'] : [': ', ' — ', '[', ']', ', '];
    const note = () => [
      s.headline, '',
      ...s.claims.filter((c) => c.ok).map((c) => `• ${c.text} ${open}${c.cites.map(tag).join(comma)}${close}`),
      ...s.claims.filter((c) => !c.ok).map((c) => `• ${decisions.get(c) ? ui.noteBack : ui.noteOut}${colon}${c.text}${dash}${c.why}`),
      '', ...s.sources.map((x, i) => `${tag(i)} ${x.who}${colon}${x.text}`),
      '', ui.noteFoot,
    ].join('\n');
    const copied = el('p', { class: 'demo__copied', role: 'status' });
    const copyNote = async () => {
      const text = note();
      try {
        await navigator.clipboard.writeText(text);
        copied.replaceChildren(ui.copied);
      } catch {
        const area = el('textarea', { class: 'demo__notetext', readonly: true, rows: '8', 'aria-label': ui.copy });
        area.value = text;
        copied.replaceChildren(ui.copyHere, area);
        area.focus(); area.select();
      }
    };

    const next = el('div', { class: 'demo__next', hidden: true },
      el('p', { class: 'demo__so', text: s.so }),
      el('p', { class: 'demo__yours', text: s.yours }),
      el('p', { class: 'demo__nextline', text: ui.next }),
      el('div', { class: 'demo__nextactions' },
        el('a', { class: 'btn btn--primary', href: APP, rel: 'noopener', text: ui.cta }),
        el('button', { class: 'btn btn--ghost demo__copy', type: 'button', text: ui.copy, onclick: () => copyNote() }),
        el('button', { class: 'btn btn--ghost demo__other', type: 'button', text: ui.other,
          onclick: () => select((index + 1) % SCENARIOS.length, true) })),
      copied);
    const run = el('button', { class: 'btn demo__run', type: 'button', text: ui.run, onclick: () => start() });

    const claimItem = (c) => {
      let decided = null;
      const check = el('div', { class: 'demo__check', hidden: true },
        el('p', { class: 'demo__verdict' },
          el('strong', { text: `${c.ok ? '✓' : '✗'} ${c.ok ? ui.verified : ui.withdrawn}` }),
          el('span', { text: c.why })),
        c.cites.length
          ? el('ul', { class: 'demo__cited' }, c.cites.map((i) => el('li', {},
            el('span', { class: 'demo__srctag', text: tag(i) }), el('span', { text: s.sources[i].text }))))
          : null,
        c.ok ? null : (decided = decide(c))[0]);
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
        check, decided?.[1]);
    };

    let startedAt = 0;
    function finish() {
      mark([]);
      claims.replaceChildren(...s.claims.map(claimItem));
      result.hidden = false;
      next.hidden = false;
      status.textContent = ui.done;
      run.textContent = ui.rerun;
      run.disabled = false;
      /* The withdrawal is the moment the demo exists for, and it sat behind
         a second click. It opens by itself; the verified claims wait to be
         doubted. Readers in round 71 found the answer after the fact, if at
         all: on a phone it lands a screen and a half below the button. If
         they have not scrolled since pressing it, bring the answer to them. */
      claims.querySelector('.is-withdrawn .demo__doubt')?.click();
      if (Math.abs(window.scrollY - startedAt) < 4) {
        const top = result.getBoundingClientRect().top;
        if (top > window.innerHeight * 0.6) {
          window.scrollTo({ top: window.scrollY + top - window.innerHeight * 0.2, behavior: still() ? 'auto' : 'smooth' });
        }
      }
    }

    function start() {
      stop();
      startedAt = window.scrollY;
      idle.hidden = true;
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

    /* The situation, the task and the button that starts the run come first,
       across the full width. On a phone the button used to sit below all
       five sources — a thousand pixels after the task it answers. */
    panel.replaceChildren(
      el('div', { class: 'demo__head' },
        el('div', { class: 'demo__who-am-i' },
          el('p', { class: 'demo__kicker', text: `${ui.situation} · ${s.tab}` }),
          el('p', { class: 'demo__situation' }, el('strong', { text: s.role }), ' ', s.stakes),
          research(s.research)),
        el('div', { class: 'demo__ask' },
          el('p', { class: 'demo__kicker', text: ui.task }),
          el('p', { class: 'demo__task', text: s.task }),
          el('div', { class: 'demo__go' }, run, status))),
      el('div', { class: 'demo__brief' },
        el('p', { class: 'demo__kicker', text: `${ui.sources} (${s.sources.length})` }),
        el('ol', { class: 'demo__sources' }, sourceItems)),
      el('div', { class: 'demo__work' }, idle, log, result, next),
    );
  }

  host.replaceChildren(tabs, panel);
  host.classList.add('is-live');
  const linked = SCENARIOS.findIndex((x) => location.hash === `#demo-${x.id}`);
  select(Math.max(0, linked));
}
