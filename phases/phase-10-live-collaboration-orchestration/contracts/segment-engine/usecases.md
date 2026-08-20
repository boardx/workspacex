# `segment-engine` — 用例接口与失败模式

## 端口（草案，签核通过后落进 `packages/contracts/src/live-collab-segment-engine.ts`）

| 端口 | 输入 | 输出 | 说明 |
|---|---|---|---|
| `listAgendaSegments`（复用，非新增） | `projectId` | `{title, state}[]` | F963 已接的真实数据源，本束只读取，不重新声明 |
| `advanceAgendaSegment`（复用，非新增） | `projectId`, `segmentId` | `void` | F119 已限定仅引导师可调用；编排层的"下一环节"按钮直接转发这个调用 |
| `getSegmentCountdown`（**新增，跨 phase-01 议程束**） | `projectId`, `segmentId` | `{remainingSeconds, resetAt}` | **落点未定**——归属 phase-01 议程契约还是本束新开只读补充端口，待跨束确认；本轮只是形状草案 |

## 失败模式

| 场景 | 错误码（草案） | 前端表现 |
|---|---|---|
| `getSegmentCountdown` 字段尚不存在（当前实况） | 无接口，前端渲染 `＊` 占位 | 状态条倒计时位置显示 `12:48 剩余＊`，不发起真实请求 |
| 非引导师调用 `advanceAgendaSegment` | 沿用 F119 已有错误码（需核实具体值） | 按钮本身不可点（前端已禁用），不是靠后端拒绝兜底 |
| 环节数据加载失败 | 沿用 F963 已有处理 | 沿用 `tab-live.tsx` 现有的错误态，不在编排层另建一套 |

## 签核前请重点确认

- [ ] **编排层状态条组件必须是 F963 数据源的另一种渲染**，不是重新发起一次查询——
      如果技术实现上确实需要一次独立请求（比如分组视角的请求上下文不同），
      请求返回的内容也必须与 F963 那份内容保持字段级一致，不能出现两份状态互相打架。
- [ ] **`getSegmentCountdown` 是否要等 phase-01 那边先确认字段，本束才建骨架**——
      还是可以先把前端骨架和这个端口草案定下来，实现时再对接真实字段。
