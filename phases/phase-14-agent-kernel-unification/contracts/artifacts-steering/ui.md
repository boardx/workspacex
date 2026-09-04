# 契约束 `artifacts-steering` — ① UI（签核面第 ① 件）

> **自检**：本文件引用 3 张截图，目录下实际 3 张。（2026-09-04 ui-prototyper 交付，签核用静态原型）

覆盖 feature：F09 F10 F11 F12。判据单一事实源是 `requirements/04-artifacts-steering.md`
的 R3/R3'/R4/R8/R12（本文件只引用条目号，不重抄正文）。

## 一、本束需要哪几块屏

本束**不新建独立路由**。产出物面板独立于聊天流的侧栏，中途插话入口在既有输入区域，
签核阶段承载于 `/preview/agent-kernel`（同前两束的说明）。

| 屏 | 一句话 | 对应需求 | 现状 |
|---|---|---|---|
| **S1 产出物面板 · 空态** | 尚无产出物时的侧栏空态 | R3 步骤 1（首次产出前） | 已建（原型） |
| **S2 产出物面板 · 有版本** | 版本历史缩略图列表，可查看/基于某版本继续修改 | R3 步骤 2-6、R8 | 已建（原型） |
| **S3 中途插话入口** | `running` 态下输入区域可交互 + 发送后「已收到」反馈 | R3' 步骤 1-2、5、R8 | 已建（原型） |

## 二、界面落点与稳定 `data-testid`

| 组件 | data-testid | 触发条件 |
|---|---|---|
| 产出物面板 · 空态 | `agent-kernel-artifacts-panel-empty` | 该线程尚无任何 Artifact |
| 产出物面板 · 版本列表 | `agent-kernel-artifacts-panel`（含逐条 `-version-{n}`） | 至少 1 个版本 |
| 「基于此版本继续修改」 | `agent-kernel-artifact-continue` | 用户点击某版本的继续修改动作 |
| 插话输入框 | `agent-kernel-interjection-input`，`disabled={false}` when `running` | run 处于 `running`（R6 后置条件，可直接断言的 UI 状态） |
| 「已收到」反馈 | `agent-kernel-interjection-ack` | 发送后 1 秒内出现（R3' 步骤 5、R9） |

## 三、已产出（截图）

| 编号 | 文件 | 对应上表 |
|---|---|---|
| 04 | `ui-preview/artifacts-steering/04-interjection-composer.png` | S3 |
| 05a | `ui-preview/artifacts-steering/05-artifacts-panel-empty.png` | S1 |
| 05b | `ui-preview/artifacts-steering/05-artifacts-panel.png` | S2 |

## 四、缺口

- ⚠ 未产出：A2（插话内容与当前任务无关时的"是否要开始新任务"提示）对应截图——需求原文
  声明"具体识别策略属于内核实现细节，只要求有此边界处理"，UI 呈现形态未定，待细化。
- ⚠ 未产出：版本间可视化 diff——R6 明确声明为增强项、本 phase 不强制，故不产出对应屏，
  如实记录而非默默略过。
