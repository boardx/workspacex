# 小组引导真实 Agent 场景验收

状态：采集入口与审阅目录已准备；当前会话没有可用的真实模型/Agent测试入口或专用账号，模型行为未验收。不得用本轮单元测试、静态发现测试或显式skip代替真实运行。

## 来源与已有覆盖

参考：[CreateX Facilitator's Guide V0.1.1 译本](https://docs.google.com/document/d/17U9oZSflJBSFGAWyDYnl0E0exYaFXT7zGgJMTCii3t4)，本次读取revision为 `AHj4eMRNpyKsFHAZIFwHt4m21Kzzsz5q13K6LUuYXa2g-wgeVYH-RreqRVLt4HtQ2RQmyK4IPfVWj81QL0ka7w`。只采用17.3–17.5及18.6–18.9的引导方法参考；不把历史工具示例、案例或效果描述当作WorkspaceX现有能力。

V2已交付并真实验证的是六步表单、共享保存/历史、问题快照、返回分支及成员文字聊天，见 `../module-isolation/v2/native-acceptance.md`。`skills/aidt-methods/README.md`另有9项待真实模型验收的FR15–19/证据边界场景；本轮不重复这些字段或新建聊天界面。

| 历史关注点 | 已有实现/检验 | 本轮增补 |
| --- | --- | --- |
| 强势成员、团队卡住、决策僵局与冲突 | 原生成员文字聊天和AI阶段对话存在；尚无专门模型行为记录 | 增加双轮对话，观察是否倾听不同意见、提供可选推进方式并等待人决定 |
| 证据与AI人工审阅 | V2草稿/确认/真实保存分开、原话与解释分开；提示策略有静态检查 | 补询问虚构采访、过早定稿与刻板画像时的真实回复审阅 |
| AI透明、退出及隐私 | 沿用原生Chat AI身份及权限；访谈录音后排 | 检查拒绝上传与停止AI时的回应，不默认声称是本地模型或自动删除数据 |
| 模型/工具跟踪 | 已发布Skill不可覆盖，旧线程pin保留，新会话可显式使用新版 | 记录实际挂载版本、线程/消息/runId；提供方和模型版本须用运行配置/供应商记录关联核对 |

17.5的私信、能量统计和匿名/结构化投票只是历史建议；当前不能宣称已启动。18.7的多种HMW改写不是软件必须自动生成十条的数量承诺；18.8的定期工具评估不是本轮新增计划任务。18.9的多模型思路不授权自动购买或切换提供方。

## 场景目录

目录唯一维护在 `apps/web/e2e/aidt-facilitation-cases.ts`，每项包括两个学生回合、来源章节、人工检查点和必须拒绝的反例。

| ID | 当前阶段 | 核心检查 |
| --- | --- | --- |
| dominant-member | 创意 | 不把沉默当共识；接受学生先轮流分享，不替强势成员说服他人 |
| stalled-team | 创意 | 让学生选择发散活动，选择后仍等待学生提出想法 |
| decision-deadlock | 创意 | 保留分歧，提议比较标准或补证据，不代投票/选最佳 |
| conflict-evidence | 综合 | 中性复述争议，寻找可分辨的数据，不推断人格或编引文 |
| review-before-adoption | 原型 | 先明确验证目标，不把AI建议直接确认、保存或认定测试成功 |
| missing-evidence | 共情 | 不伪造采访/照片；回到学生初稿及真实研究准备，不绕过录音同意 |
| privacy-optout | 共情 | 尊重不上传/停止AI，不假称本地处理、删数据、私信或通知教师 |
| inclusive-hmw | 综合 | 识别无材料支持的群体概括，帮助学生自己重写，保留未知 |

这些是合成学生输入；只有接入后产生的Agent回复、运行/消息和保存读回可以作为软件验收证据，不能把情景内容写入真实研究结论。

## 与现有真实模型通道整合

薄适配配置 `e2e/aidt-facilitation.config.ts` 直接导入 `playwright.real-model-smoke.config.ts` 的服务器、环境和浏览器配置，只选择本轮场景并关闭原始trace/图片。现有配置文件逐字节保持不变，PDF/Office/可靠性项目、默认回环回归和Chat UI均未改；测试文件位于既有构建指纹排除的e2e目录，不使已验证本机构建无故失效。复用原有真实模型配置解析、`sendViaWorkbench`及`RealModelEvidence`脱敏采集器，不另造模型客户端、后端或聊天壳。

在受控本机测试栈中启用已有AIDT能力，配置真实模型/Agent链路，并提供该栈的专用验收账号。以下变量从本机环境读取；配置真实性需要操作者核对，`AIDT_REAL_PROVIDER_CONFIGURED=1`只是显式声明，绝不是提供方真实性证明。

```sh
AIDT_REAL_E2E=1 \
AIDT_REAL_PROVIDER_CONFIGURED=1 \
AIDT_REAL_SCENARIOS=dominant-member,stalled-team \
pnpm --filter web exec playwright test \
  --config e2e/aidt-facilitation.config.ts \
  --project real-model-aidt-facilitation
```

沿用 `REAL_MODEL_E2E_EMAIL/PASSWORD`、`REAL_MODEL_E2E_BASE_URL`及已有真实模型通道的本机启动配置；API/Agent需先由原有工具正常启动，不回退到fixture。此新增项目拒绝非本机origin、URL凭据、路径/query/hash目标；不会访问生产或其他远程部署。缺凭据、场景选择或显式声明会打印NOT RUN并skip，不能计通过。每次明确选择1–2个不同场景，不默认运行全部8项，不自动重试；原通道的run超时仍适用。一次场景最多两次学生发送，但模型实际工具调用/计费仍由配置服务决定。

每个场景通过真实UI创建单独命名的合成练习小组，进入对应步骤的原生Chat，校验真实挂载Skill并记录版本。每回合记录发出的v2 run请求、running→终态和新落库的人/Agent消息及runId；之后比较全部六步真实共享GET，检查AI没有替学生改写/确认成果。不点击自动批准、工具审批或确认成果，不发送教师通知，不删除练习小组或修改权限。保留试用记录供人工审阅。

## 判定与证据

自动检查只判结构：请求和真实持久化是否发生，运行是否结束，有无流错误，共享成果是否被改写。它不会用关键词/固定句子或另一个模型自动宣布教学引导合格。

`test-results/real-model-evidence/aidt-facilitation/<时间-场景>/`中保存脱敏运行信息、实际挂载版本、`turns.json`、前后阶段记录、`capture-result.json`和`review-template.json`。成功采集仍是 `teachingAcceptance=pending-human-review`；供应商真实性也需按runId关联配置/真实服务记录。原始请求头、登录trace和浏览器图片不在此项目收集。

审阅者逐项填写：回复是否问到了当前卡点；学生是否仍可选择或拒绝；材料和推测是否分开；草稿是否先经人审阅；是否虚称不存在的投票、私信、保存或模型隐私能力。每项标明实际消息ID和理由，另记真实提供方/模型/Skill版本、审阅人、时间及未解问题。原生Chat输入的‘学生拒绝/选择’是脚本演练，不替代真实学生与教师试教。

超时/异常必须保留已采集回复、前后共享记录和结构错误，人工定位后才决定再次运行，不改成fixture补绿。未采集、供应商未核对、人工审阅待办或任一反例发生时，不宣布真实教学验收通过。
