# 会话交接 — Sprint 01/15

## 当前已验证
- F961：待 `pnpm harness verify --sprint 01/15` 门控转 `passing`（3 条 verification，
  含一条真栈 playwright）。evidence 见 `evidence/F961.verify.log`。

## 本轮改动
- 前端封装：`apps/web/lib/live-project-prep.ts` —— 新增 `getInterviewSubjects` /
  `saveInterviewSubjects` / `INTERVIEW_SUBJECT_COLUMNS`；**并修了三个 save 函数的 400 bug**（见下）。
- 组件：`apps/web/components/project/tab-prep.tsx` —— 组卡按已签原型补齐三处
  （组员计数 / 访谈对象摘要行 / 展开出六列对象表，含加行·填格·删行·整批提交·冲突提示）。
- 角色：`apps/web/lib/mock/project.ts` 新增 `ROLE_GROUP_SUBMIT`（引导师 + 组长），
  对齐后端 `group.submitOutput`——访谈对象表**不是** facilitator-only。
- 测试：`tests/ui/project-prep-interview-subjects.test.tsx`（新，10 条）+
  `tests/ui/project-prep-live.test.tsx`（纠正一条写反的断言）+
  `e2e/interview-subjects-smoke.spec.ts`（新，2 条真栈）+
  `playwright.fullstack-smoke.config.ts`（把新 spec 排进 `seeded`）。

## ⚠ 本轮最重要的发现：F950 的写路径在真实浏览器里从来没成功过
- **现象**：真栈 e2e 第一次跑就红，界面上是 `http_400`。
- **根因**：controller 的 body schema 是 `xxx.in.omit({ projectId: true })`，而契约那几个
  object 是 `.strict()`——`.omit()` **保留 strict**。前端三个 save 函数却都把路径参数
  （`projectId`，对象表还多一个 `groupId`）塞进了 body ⇒ 未知字段 ⇒ 整条请求 400。
- **为什么一直全绿**：组件测试的 `fetch` 是 mock 的，只**记录** body 不**校验**；
  F950 的断言甚至写的是 `toMatchObject({ projectId: PROJECT, ... })`——把 bug 钉成了期望行为。
- **修法**：三处 body 去掉路径参数；两个组件测试加 `not.toHaveProperty("projectId")` 机械门；
  e2e 补一条 F950 回归用例（定题保存 → 刷新仍在）。
- **教训（值得回流到 mod 知识库）**：`.omit()` 不会解除 `.strict()`。凡是「controller 用
  `.omit(路径参数)` 做 body schema」的端点，前端就绝不能把那个参数放进 body；
  而这一类错误**只有真栈能证伪**——mock 的 fetch 永远不会拒。
  建议后续做一条机械门：扫描 `apps/web/lib/live-*.ts` 里 PUT/POST 的 body 字段，
  与契约 `.in.omit(...)` 的 controller 声明比对，发现路径参数进 body 就红。

## 仍损坏或未验证
- 议程「三角色分工表」仍是 mock（契约无出处，同 F950/F172 的既有判定），本次未动。
- 「现场协作」「成果沉淀」「待办」三个 tab 连契约都没有。
- `[AI 建议人选]`：原型有、能力无实现 ⇒ 禁用 + 如实说明（不是遗漏，是刻意）。
- 上面建议的那条「路径参数进 body」机械门**尚未实现**，只是写在这里；
  在它落地之前，这个 bug 类只被两条针对性断言挡着，不是全面覆盖。

## 下一步最佳动作
- ① 落地上面那条机械门（一次性挡住整类 400，本轮只挡住了已知的三处）；
- ② 「现场协作」/「成果沉淀」/「待办」要先走 requirements → 契约设计 → 人类签核；
- ③ PJ-12 蓝本发布版本端点。
- 不要动：`contracts/templates/design-signoff.md` 的 `status`/`confirmed_by`/
  `confirmed_at`（人的动作，ADR-023）；本次只动了 `covers:`。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/15`
- 真栈 e2e 单跑:`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded -g "interview-subject|F950 regression"`
