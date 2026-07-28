# 生成 feature_list 的共同简报（2026-07-28）

> 所有 `requirement-author` 分片 agent 都先读这份，再读自己负责的模块。
> 它记录的是**在你之前已经发生的事**——不读会重复劳动或与已定的事实冲突。

## 一、你的产出格式（重要：分片写，不要写整份 feature_list.json）

写到 `phases/<phase>/_fl-parts/<你的分片名>.json`，格式：

```json
{ "part": "<分片名>", "modules": ["01-auth", "02-tpl"], "features": [ … ] }
```

**`id` 一律用 `T01` `T02` …（临时编号，分片内唯一即可）**——主 agent 会合并所有分片、
统一重排成 `F01…Fnn` 并重写 `depends_on`。你**不要**用 `F` 开头，避免合并时撞号。

跨分片依赖用 `"<模块>:<你依赖的能力一句话>"` 的形式写进 `depends_on_note`（字符串数组），
主 agent 合并时解析成真实 id。**分片内**的依赖照常用 `T0x`。

## 二、每个 feature 必须有的字段

`id` / `title`（写用户可见行为，不是技术任务）/ `user_visible_behavior`（做完后人在界面上看到什么）/
`spec_ref`（`<相对路径>.md#R<n>`，**必须真实存在且该 `## R<n>` 章节可匹配**）/
`depends_on`（分片内）/ `depends_on_note`（跨分片，字符串描述）/ `points` / `status`（一律 `not_started`）/
`owner`（`null`）/ `verification`（**可执行命令数组**）/ `evidence`（`[]`）/
`needs_ui_signoff` / `notes`（依据等级、被合并的 UC、已知风险）/
`priority`（1=本阶段必做，2=可延后）/ `area`（模块前缀，如 `auth`）/ `capability`（`CAP-API` / `CAP-UI` / `CAP-WEB`）。

## 三、⚠ 与旧版 requirement-author 规格不同的一点：**现在可以写 UI 断言了**

`.harness/agents/requirement-author.yaml` 里写着「原型零 `data-testid`，没有命名规范就不要写 UI 断言」。
**那条已经过时。** 2026-07-28 前端内核（UC-0.4 / F14）与 18 个业务屏已建成：

- **587 个 `data-testid`，零命名违规**，由 `lint-design.sh` 的 D-35 规则强制
- 七态有**固定保留名**：`loading` / `empty` / `err-<字段>` / `dep-failed` / `denied` / `saved`
- 已有**七道机器门控**（跑 `apps/web/scripts/` 下的脚本可看）：
  `typecheck` · `lint-design` · `lint-dead-controls` · `lint-omission-reason` ·
  `lint-withdrawal-flow` · `check-token-contrast` · `verify-ui-states`
- `verify-ui-states.sh` 已覆盖 18 屏 × 6 异常态 = 108 格

⇒ **verification 优先级仍是**：① round-trip / 纯函数断言 ② API / SQL 断言 ③ UI 断言。
但 ③ 现在**可用**了——凡行为必须靠界面才能观察的，可以锚真实 testid。
写 UI 断言前请先 `grep -r 'data-testid="<你要锚的>"' apps/web/components` 确认它真的存在，
**不要发明不存在的 testid**。

已建成的路由（可作为 verification 的落点）：
`/` `/kitchen-sink` `/login` `/join` `/consent` `/group` `/session` `/chat`
`/projects` `/projects/[id]` `/projects/[id]/canvas` `/projects/[id]/files`
`/tasks` `/brain` `/admin` `/admin/{agent,skill,model,mcp,members,feedback}`
`/studio/{prototype,interview,survey,research}`

## 四、口径纪律（这批文档的核心资产，别弄丢）

四标记决定 feature 的可信度与排期风险：
- `[原型]` 运行态实际存在 → verification 可锚 UI
- `[Backlog]` 文档要求，原型未必实现 → **需先补画原型**，不可直接开工
- `[设计]` 反推补全，需人类确认 → 同上，且要在 feature 上标注
- `[待确认]` 不应由实现者决定 → **禁止**据此生成 feature；查裁决文件，找不到就挂阻塞

缺失三态成本差一个数量级，**不可混用**：
**未探明**（没点进去看过，补抽取即可）/ **原型待补**（按钮在、点了没屏，补接线）/
**原型确认缺失**（枚举完毕确认不存在，**必须补画整屏且卡 sign-off**）。

凡主要依据是 `[Backlog]` / `[设计]` / `原型确认缺失` 的，`needs_ui_signoff: true` 并在 notes 写明依据等级。

## 五、必须读的裁决文件（按此顺序）

1. `phases/requirements/DECISIONS-FINAL.md` —— 权威裁决（D-01…D-41）
2. `phases/requirements/DECISIONS-OPEN.md` —— O-01…O-40，已全部填写
3. `phases/requirements/DECISIONS-UI-ROUND.md` —— **2026-07-28 新增的 12 项 UI 落地裁决**
4. 架构：`docs/architecture/context-engine.md`、`.harness/instructions/architecture.md`

⚠ **别重蹈我的覆辙**：我曾把一个 SLA 判成「实现者编造的」，据此让人类做了决定，
后来才发现 `DECISIONS-FINAL.md` 里的 **D-15** 早已裁定了那个数——
人类在错误前提上做了决定，而「修正」反而削弱了一条已拍板的对外承诺。
**凡你觉得某个数值/规则是「编的」，先全文搜三份裁决文件再下结论。**

## 六、2026-07-28 新增的硬约束（会影响很多模块，务必吸收）

### UC-0.5 组织配置平面 + 个人本地组织（新 UC，13→15 点，已在 phase-00 的 F15/F16/F17）
- **六类能力清单是组织配置，不是产品内置**：agent / skill / 模型 / MCP / 画布模板 / 项目蓝本。
  ⇒ **`03-skill` / `04-agent` / `20-model` / `21-mcp` 四个模块不得把清单硬编码**，
  它们的 feature 必须依赖 phase-00 的 F15。原型里那 6 个 agent、18 台模型都只是**示例**。
- **个人本地组织**（`personal-local`）：注册即有、恒为单人、不可邀请他人；
  三条硬隔离是**产品承诺不是配置项**（模型只走本地 / 禁 MCP 出网 / 数据不出本地），
  违反时拒绝并显式报错，**不得静默降级到云端**。
- **正式组织可配 `modelPolicy: "self-hosted-only"`** —— ⚠ 它是**可配置策略**，
  与本地组织那条**不可关闭的产品承诺**性质不同，**界面与数据模型必须能分辨**。
- **本地 → 正式组织的导出**是隐私承诺的唯一豁口：显式人工动作、逐项预览、复制非迁移、
  两侧留痕、**单向**（反向导入被拒）、**禁止任何自动同步**。

### 12 项 UI 裁决里对你影响最大的
- **D-U1**：含机密 ⇒ **整轮所有模型调用走本地**，云端模型本轮不可用（**不是**分流）。
  后端 gateway 按同一规则拦截。凡涉及模型选择的 feature 都要遵守。
- **D-U3**：**不加第三层「场景角色」**。合规负责人归**组织角色**（第四种）；
  受访者走一次性令牌；研究员/参与者是引导师/组员的**展示别名，不落库**。
  ⇒ **O-03「项目角色恒为四种」保住**，权限矩阵仍是两层交集。
- **D-U4**：`omissions[].reason` 是**封闭枚举**七类
  （`withdrawn`/`expired`/`unauthorized`/`low-confidence`/`budget`/`deduped`/`out-of-scope`），
  **新增类别必须走 ADR**。其中前三类是**合规性丢弃，必须始终可见**，不得因折叠截断而消失。
- **D-U5**：停用能力时给管理员「立即中断（默认）/ 允许跑完当前一轮」二选一，
  确认弹窗说清影响范围（当前有 N 个进行中的调用会被中断）。
- **D-U11**：摄取复核的**权威入口是摄取抽屉**，独立复核屏是同一动作的批量视图，两处共享状态。

### 撤回链已收敛为单一事实源
`apps/web/lib/withdrawal-flow.ts`，数值来自 **D-13**（内容）/ **D-15**（时限：逻辑失效 ≤5 分钟、
物理删除 ≤30 天）/ **D-19**（对外替换需人工确认）。
⇒ 凡 feature 涉及撤回/删除时限的，**引用这三条裁决，不要另立数值**。

## 七、切分方法

1. 逐份读 UC 的 **R11 切分提示**——那是原作者给的建议，**优先采纳**。
2. **横切关注点合并成共享 feature，不要每个 UC 做一遍**：权限判定、审计留痕、通知、
   七种界面状态、Context Pack 装配——这些在 95 份 UC 里逐字重复。
   ⚠ 其中**权限两层交集、Artifact 模型、Context Pack、七态外壳、组织配置**
   都**已在 phase-00**（F01–F17），你的 feature 应当**依赖它们而不是重做**。
3. 一个 feature 的粒度：**能被一个 agent 在一个会话内做完并验证**。
   R11 若把一个 UC 拆成 6 段，通常合并成 2–3 个 feature 更合适。
4. **UI 已经建好的部分**：对应 feature 的工作量主要是**接后端**，不是画界面——
   在 notes 里写明「界面已建成于 `<路径>`，本 feature 交付的是数据与规则」。

## 八、估点

UC 头部有 `估点`。feature 的点数 = 它覆盖的 UC 片段之和。
**合并横切关注点时不要重复计点。** 已知的重复计点风险：
- 22-files 的 47 点是 `artifacts/artifact_versions` 的 **UI 投影**，**不重复实现存储**（存储在 phase-00 F04）
- D-13 前置的 UC-17.2 最小切片与 `uc-22-4` 删除传播是同一批实现，**只计一次**
- 各模块的界面已建成（见第三节路由清单），点数应反映「接后端」而非「从零画屏」

分片合计与你负责模块的 UC 头部声明值应对得上，**差异必须在 notes 说明**。

## 九、verification 的禁忌

**禁止**：`echo "done"`、`test -f xxx` 这类不验证行为的占位；依赖人工判断的
（「打开页面确认样式正确」）；依赖尚未定稿的数值。

⚠ **三个数值尚未定稿，不得据此写断言**（见 `DECISIONS-UI-ROUND.md` 的 TODO-1/2/3）：
① 人时折算系数 ② 最小样本量阈值 ③ D-14 的五个留存期参数默认值。
涉及它们的 AC 请改写为**结构性断言**（例：把「低于 8 显示样本不足」改写为
「样本量低于阈值时必须显示『样本不足』且不显示折算值」，阈值本身来自配置）。

## 十、输出前自检（逐条过）

1. 每个 `spec_ref` 指向的文件存在，且 `## R<n>` 能匹配到 —— **用 grep 实际验一遍**
2. 每条 `verification` 是可执行命令；UI 断言锚的 testid **确实存在于代码里**
3. 没有任何 feature 的 status 不是 `not_started`
4. 分片内 `depends_on` 无环
5. 主要依据为 `[Backlog]`/`[设计]`/`原型确认缺失` 的都标了 `needs_ui_signoff`
6. 估点合计与 UC 头部声明对得上（差异写进 notes）
