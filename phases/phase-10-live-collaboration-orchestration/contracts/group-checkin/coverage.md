# `group-checkin` — feature ↔ 需求映射

| feature | 需求出处 | 覆盖情况 |
|---|---|---|
| F05 | `requirements/02-group-checkin.md#R1` | 分组签到聚合视图（4 组卡片网格）——UI 骨架已建，服务端聚合查询待落地 |
| F06 | `requirements/02-group-checkin.md#R2` | 到场判定/二维码/加入页三个待确认点——Q2/Q4/Q5 已裁决，待实现 |

## 反向检查

- `requirements/02-group-checkin.md` 全文两节（R1/R2）均已被 F05/F06 覆盖，无遗漏章节。
- R2 列出的 3 个待确认点（到场判定口径、二维码生成方式、看加入页目标）均已在
  `OPEN-QUESTIONS.md` Q2/Q4/Q5 裁决，本束 notes 与本文件均已同步这三条结论，
  未出现"同一事实声明在两处却结论不同"的漂移。
- `ui.md` 列出的组长/观察者可见性缺口（G-系列以外，视角/态矩阵里的"待定"格）尚未对应到
  任何 feature 的 verification——是否需要新增一个 feature 覆盖这两个角色的可见性，
  还是靠 `viewer-role` 束的角色矩阵间接约束，签核时请一并定。

## R12 验收线索 → API 操作 → 门控命令（ADR-023 第 ③ 件实质性判据）

`domain.md` 不变量与 `usecases.md` 失败模式表的验收线索，逐条编号 V1…V6，对应到
`packages/contracts/src/live-collab-checkin.ts` 的操作与真实门控命令；后端 controller
尚未实现（本文件顶部注释已声明），故大多数行只能落到 UI 骨架层面的门控命令，
后端级门控显式标记为缺口，不假装存在。

| 行键 | API 操作 | 门控命令 |
|---|---|---|
| V1 | `getGroupCheckinBoard`（4 组卡片网格渲染） | `grep -rq 'data-testid="lc-checkin-grid"' apps/web/components/live-collab/orchestration-preview.tsx` |
| V2 | `getGroupCheckinBoard`（空态：项目还没有任何分组到场） | `pnpm --filter web exec playwright test -c playwright.live-collab-shots.config.ts -g 'checkin'` |
| V3 | `recordCheckinEvent`（到场后 `arrived` 单调不回退，domain.md 不变量 1） | ⚠ 缺口：后端 controller 未实现（F06 未开工），当前无可执行的服务端断言，见 `KNOWN_CONTRACT_GAPS.C1` |
| V4 | `getJoinPreview`（站内预览出口） | `grep -rq 'data-testid="lc-checkin-view-join"' apps/web/components/live-collab/orchestration-preview.tsx` |
| V5 | `GROUP_LEAD_MISSING` 校验失败态（`stage-checkin-invalid.png`） | `grep -rq 'data-testid="lc-checkin"' apps/web/components/live-collab/orchestration-preview.tsx`（err-link 态；该错误码本身是否保留待签核，见 usecases.md） |
| V6 | 二维码不经过后端（domain.md 不变量 3） | `grep -Lq 'generateQrCode\|qr.*生成' packages/contracts/src/live-collab-checkin.ts`（反向断言：契约文件不包含二维码生成端口） |
