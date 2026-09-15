# 契约束 `postinvest-rating` — ① UI（签核面第 ① 件）

> **自检**：本文件引用 11 张截图，目录下实际 11 张。（2026-09-15 ui-prototyper 交付，签核用真实组件原型 + mock）
>
> ⚠ 现阶段本束尚未签核，四份材料按 phase-15 先例暂放 `design-proposal/`（不放 `contracts/`，
> 否则 `pnpm harness doctor` 判 FAIL）。签核后随束一并移入 `contracts/` 时，再往
> `.harness/scripts/ui-material-map.json` 的 `phase-16-postinvest-rating-agent` 下登记
> `"postinvest-rating": "ui-preview/postinvest-rating"`，让 `lint-ui-material.mjs` 覆盖本目录。

覆盖 feature：F03（`/agent/team2` 工作台 UI，空态/运行态/结果态）。判据单一事实源是
`requirements/01-postinvest-rating-agent.md` 的 R3/R4/R5/R8/R12 与契约
`packages/contracts/src/postinvest-rating.ts`（本文件只引用条目号，不重抄正文/数值）。

## 一、本束需要哪几块屏

只替换 `/agent/[teamId]` 的 **Team2** 分支为真实工作台（其余 team 保持只读示例）。一页三态
（空态 / 运行态 / 结果态），七种状态经 URL query `?state=` 切换，弹层经 `?dialog=`、视角经 `?role=`。

| 屏 | 一句话 | 对应需求 | 现状 |
|---|---|---|---|
| **S1 空态·数据供给** | 项目选择器 + 上传区（文件条：名/大小/SHA256 缩略/类型标签/解析状态；录音显示「原件上传」路径 D5）+ 缺失原因表单 + 开始按钮（无文件禁用）+ 历史评级 | R3 阶段一、R8 | 已建（真实组件） |
| **S2 运行态** | 复用 agent workbench 进度/工具调用卡结构 + 取消 | R3 阶段二、R8 | 已建 |
| **S3 HITL 卡** | 降级触发（净资产<0）二次确认，批准/驳回 | R3-11、R4 A4、R8 | 已建 |
| **S4 结果态·结论卡** | 等级大字 + 颜色条 + 含义 + 投后管理建议 + 标注 chips + 状态徽标 draft/confirmed | R3-11/12、R7-1、R8 | 已建 |
| **S5 三 Tab** | 依据表（每行反馈按钮）/ 不确定性（含可信渠道白名单只读面板 + 丢弃计数）/ 报告下载（produced-file 禁用→就绪） | R3-12/13、R7-8/9、R8 | 已建 |
| **S6 反馈弹层** | 5 类错误类型单选 + 修正依据；主观偏差回显「已记录，评级不变」 | R3-13/14、R7-6、R8 | 已建 |
| **S7 采纳二次确认** | 危险动作显式：draft→confirmed 不可逆 + 影响范围 | R3-16、R7-7、硬规则 ⑦ | 已建 |
| **S8 异常/权限态** | 依赖失败（KERNEL/SANDBOX 不可用 + 重试）、无权限（404 语义）、加载骨架、校验失败（AUDIO_NOT_ALLOWED_IN_CHAT_UPLOAD） | R4 E4/E8、R5、R8 | 已建 |

## 二、界面落点与稳定 `data-testid`

> ⚠ 命名冲突处理：R8 建议的 `<code>` 里契约枚举含下划线（如 `confidentiality_period`、
> `calc_error`、`business_abnormal`），但 `lint-design.sh` 的 D-35 禁止 testid 带下划线。
> 已统一把 code 中的 `_` 转为 `-`（`rating-missing-reason-confidentiality-period` 等），
> 请人类签核时确认这个 kebab 化是可接受的锚点约定（e2e 据此锚定）。

| 组件 | data-testid | 触发条件 |
|---|---|---|
| 主容器 | `rating-workbench` | Team2 页面 |
| 预览视角切换 | `rating-role-{consultant,lead,admin,compliance}` | R5 多角色预览 |
| 项目选择器 | `rating-project-picker` / `rating-new-project-button` | 空态 |
| 上传区 / 文件条 | `rating-upload-dropzone` / `rating-upload-item-<n>` / `rating-upload-empty` | 空态 |
| 缺失原因表单 | `rating-missing-reason-form` / `rating-missing-reason-<code>` / `rating-missing-reason-other-text` / `rating-missing-{standalone-only,operating-only,no-prior-year}` | 空态 |
| 开始评级 | `rating-start-button` | 无文件时禁用 |
| 运行进度 / 取消 | `rating-run-progress` / `rating-run-cancel` | 运行态 |
| HITL 卡 | `rating-hitl-card` / `rating-hitl-approve` / `rating-hitl-reject` | 降级触发 |
| 结论卡 / 标注 chip / 状态徽标 | `rating-result-card` / `rating-flag-<code>` / `rating-status-badge` | 结果态 |
| 三 Tab | `rating-tab-evidence` / `rating-tab-uncertainty`(+`-panel`) / `rating-tab-reports` | 结果态 |
| 依据行 / 反馈按钮 | `rating-evidence-row-<n>` / `rating-feedback-button-<n>` | 依据 Tab |
| 报告卡 | `rating-report-{pdf,xlsx,png}` | 报告 Tab（未验证 aria-disabled） |
| 可信渠道白名单 | `rating-trusted-source-panel` | 不确定性 Tab |
| 反馈弹层 | `rating-feedback-dialog` / `rating-feedback-type-<code>` / `rating-feedback-submit` / `rating-feedback-type-error` | 点反馈 |
| 主观偏差回显 | `rating-feedback-recorded-only` | 提交 subjective 类 |
| 版本链 / 采纳 | `rating-version-list` / `rating-version-<n>` / `rating-confirm-button` / `rating-confirm-blocked` | 结果态 |
| 采纳二次确认 | `rating-confirm-dialog` / `rating-confirm-submit` | 点采纳 |
| 异常/权限态 | `rating-loading` / `rating-forbidden` / `rating-dependency-error`(+`-retry` 为 `rating-dependency-retry`) / `rating-upload-validation-error` | 各态 |

## 三、已产出（截图）

| 编号 | 文件 | 对应上表 | URL query |
|---|---|---|---|
| 01 | `ui-preview/postinvest-rating/01-empty.png` | S1 空态 | `?state=default` |
| 02 | `ui-preview/postinvest-rating/02-running.png` | S2 运行态 | `?state=running` |
| 03 | `ui-preview/postinvest-rating/03-hitl.png` | S3 HITL | `?state=hitl` |
| 04 | `ui-preview/postinvest-rating/04-result.png` | S4+S5 结果/依据 | `?state=result` |
| 05 | `ui-preview/postinvest-rating/05-evidence-feedback.png` | S6 反馈弹层 | `?state=result&dialog=feedback` |
| 06 | `ui-preview/postinvest-rating/06-recorded-only.png` | S6 主观偏差回显 | `?state=result&dialog=recorded` |
| 07 | `ui-preview/postinvest-rating/07-confirm.png` | S7 采纳二次确认 | `?state=result&dialog=confirm` |
| 08 | `ui-preview/postinvest-rating/08-error-dependency.png` | S8 依赖失败 | `?state=dependency` |
| 09 | `ui-preview/postinvest-rating/09-forbidden.png` | S8 无权限 | `?state=forbidden&role=admin` |
| 10 | `ui-preview/postinvest-rating/10-loading.png` | S8 加载 | `?state=loading` |
| 11 | `ui-preview/postinvest-rating/11-validation.png` | S8 校验失败 | `?state=validation` |

七种规范状态映射：默认=01 · 加载=10 · 空=01（`?state=empty` 为无历史变体） · 校验失败=11 ·
依赖失败=08 · 无权限=09 · 成功=04。

## 四、缺口（文字，非链接）

- ⚠ 设计 token 缺 `rating.grade.*` 专用色阶：结论卡颜色由 `gradeMeta.colorToken` 从 skill 包带回
  （前端不另写等级→颜色映射，见 `lib/postinvest-rating/grade-visual.ts`），但设计 token 单源
  （`app/globals.css`）暂无 A–E 五档专用色，也无独立「深红」token。原型先复用最接近的既有语义色
  （success/ai/warning/destructive），E 档与 D 档目前共用 destructive。待人类签核时决定是否新增
  rating 专用色阶——这是本束最需要人类拍板的一处。
- ⚠ 未产出：E1（单文件解析失败但其余继续）在结果态的呈现——原型只在上传区文件条显示「解析失败」，
  未画「关键字段全部来自失败文件 ⇒ 走 A1 数据需求说明」的完整结果态变体。
- ⚠ 未产出：A4（多份报表期间不一致）指定本期/上期的 HITL 变体——当前 HITL 卡只画了降级触发一种，
  本期/上期指定复用同一 `rating-hitl-card` 落点但未单独截图。
- ⚠ 未产出：F08 定期评级提醒入口（`wx_schedule_*`）——本期 F03 范围外，属另一 feature。
