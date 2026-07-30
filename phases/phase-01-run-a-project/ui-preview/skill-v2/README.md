# UI 先行原型 v2 · `skill` 试跑整屏补画 —— ADR-003 关卡材料

> **本版是补画试跑整屏**：v1（`ui-preview/skill/`，59 张）把「试跑」降格成一个四行面板，`回归用例` 在 `apps/web` 命中 0。
> 逐条错处见同目录 `V1-WAS-WRONG.md`。v2 = 59 张原样复制 + 8 张试跑整屏，路由沿用 `/skill?screen=tryrun`。
> URL 维度：`?screen=tryrun` · `?state=`（七态）· `?as=`（maintainer/reviewer/facilitator/…）。

---

## 一、截图 → UC → 屏映射（本轮新增 8 张）

| 截图前缀 | 屏 | 对应 UC / 节 | 覆盖状态 |
|---|---|---|---|
| `uc-3-1-tryrun-{default,loading,empty,invalid,dep-failed,denied,success}` | 试跑整屏（场景×执行轨迹×自动校验×回归用例） | UC-3.1 · 原型 isSkRun 15728257 | 七态全 |
| `uc-3-1-tryrun-role-denied` | 引导师视角投影（试跑台组织级职能不可见） | UC-3.1 R5 | 视角态 |

其余 59 张（`uc-3-1-library-*` / `uc-3-2-binding-*` / `uc-3-3-temp-*` / `uc-3-4-versioning-*` / `uc-3-5-promotion-*` / `uc-3-6-feedback-*`）是 v1 原样复制，未改。

### 关键 testid 锚点
- 输入：`skill-tryrun-input` `skill-tryrun-scenario-{real,empty,counter}` `skill-tryrun-material` `skill-tryrun-swap-material` `skill-tryrun-params` `skill-tryrun-run` `skill-tryrun-run-all`
- 结果：`skill-tryrun-result` `skill-tryrun-cost` `skill-tryrun-trace` `skill-tryrun-trace-{i}` `skill-tryrun-output` `skill-tryrun-checks` `skill-tryrun-check-{i}` `skill-tryrun-save-regression` `skill-tryrun-rerun`

---

## 二、我替 UC 做的、UC 没写明的设计决定（逐条，请人类核对）

1. **试跑台 = 组织级职能屏**（`allow: ["maintainer","reviewer"]`）。原型试跑从编辑器进入，未标可见角色；
   我按 skill 域口径把它归为能力维护者/审核人可用，引导师/组员看不到（`uc-3-1-tryrun-role-denied`）。
2. **自动校验 4 条按 skill 版原型**（段落齐全 / 无证据处不给置信度 / 反对证据保留 / 组织层知识标有效期）。
   agent 版原型是另 4 条，我未混用——见 `V1-WAS-WRONG.md` §无法自洽点 2。
3. **回归用例入口 = 「存为回归用例」+「跑全部用例」+「重跑」**三处，照原型底部条。「存为」的落库形态
   （evals/regression.jsonl）原型有提及，但**回归用例的数据结构待迁入 `packages/contracts` · SkillTryRun**。
4. **`try-run 不落库`** 显式写在右栏约束与屏内 hint，强调「用未发布契约跑、不影响线上」。
5. **保留 v1 的库内 `TryRunPanel` 四行面板**（作为库里的行内快捷试跑），试跑整屏是**新增独立屏**，两者并存。

---

## 三、R8 线索矛盾与处理

- **D-06（无沙箱）是否挡掉试跑**：这是最大的线索矛盾。D-06 说 phase-1 skill 不做沙箱；但原型的自动校验与回归用例
  并不需要执行任意代码——它们是对**声明式契约输出**的断言。我据此判定 **D-06 挡不住这条**，把整屏画出来，
  并在右栏显式写明这个判断，交人类确认。
- **agent 试跑 vs skill 试跑**：原型两版并存（`isAgRun` 15694415 / `isSkRun` 15728257），结构几乎一致。
  任务点名 skill 试跑，我只画 skill 版；agent 版未画（留 agent-runtime 域）。

---

## 四、界面上无法自洽的点（sign-off 重点）

- **执行轨迹里的「拦截越权调用」**：skill 版轨迹写「组织层仅已验证·越权调用已拦截」，agent 版写具体到
  `拦截 1 次越权调用 crm_customer_records`。skill 版更抽象；我按 skill 版复刻，未把 agent 版的具体工具名塞进来。
- **运行成本 `￥0.11` 是示例定价**：与 library 屏「本月组织额度」口径需对齐，本轮未联动。

---

## 五、建议 sign-off 时重点核对的 3 处

1. **D-06 判断：自动校验 + 回归用例不需要沙箱**（§三）—— 这是本屏能否成立的前提。若产品坚持「凡试跑必落 D-06 无沙箱」，
   则回归用例要另想落点。越早定越省。
2. **自动校验断言集（skill 版 4 条）是否权威**（§二.2）—— 它是「skill 契约合格」的界面判据，牵动发布门禁。
3. **试跑台可见角色**（§二.1）—— 组织级职能 vs 项目角色，决定 `role-gate` 与谁能钉回归用例。
