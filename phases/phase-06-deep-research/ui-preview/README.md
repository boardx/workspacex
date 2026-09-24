# Deep Research UI 增量待确认清单

## R6 真实投入预算与恢复摘要

开发预览入口：`/research?preview=effort-budget`。

### 待确认

- [ ] 默认态能在检索前比较快速、标准、深入三档，并明确开始后不会自动升级。
- [ ] 档位卡只承担选择；“投入预览 / 已恢复”摘要承担时间、检索与模型调用的真实用量解释。
- [ ] 点击“确认投入并开始检索”后档位锁定，摘要明确说明刷新或恢复不重置用量。
- [ ] 界面明确说明硬上限会在下一次外部调用前停止，并保留已完成任务、来源和草稿。
- [ ] `state=loading|empty|invalid|dep-failed|denied|success` 六个异常/反馈状态均可理解并给出下一步。
- [ ] 375px、768px、1280px 三档无横向溢出，键盘焦点与档位 `aria-pressed` 可感知。

### 截图（浏览器验证后补齐）

- `deep-research/08-effort-budget-selection.png`
- `deep-research/09-effort-budget-resumed.png`
- `deep-research/10-effort-budget-states.png`

> Agent 只维护待确认材料，不修改 `design-signoff.md` 或 `design-coherence.md` 的状态。
