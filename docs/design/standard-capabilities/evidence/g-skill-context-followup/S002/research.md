# Acme Widget 当前状态研究

## 结论摘要（保留冲突）

关于 Acme Widget 的“当前状态”，已读取的两份公开来源给出明确冲突结论，且均无发布日期或版本时间线可供消解。本报告按用户要求保留双方结论，不做取舍或合并推断。

- **结论 A**：Acme Widget 在 release 2.0 中已正式可用（generally available）。  
  - 来源 URL：<https://docs.example.test/widget-current>
  - sourceId：`web:4f8ea3aa29631370e435631b6776ba6c92184dbd23a23ab0cc643d1d11997a53`
  - contentHash：`8e22fdd2d334c34dfaed936d7b74c4df5fb4f92c8a88fa3afd1919f2dc69cc4b`
  - 原文摘录：“Acme Widget is generally available in release 2.0.”

- **结论 B**：Acme Widget 仍仅处于 preview 阶段，对应 release 1.5。  
  - 来源 URL：<https://archive.example.test/widget-preview>
  - sourceId：`web:ca4f1a61ef7ddd33f27a277b6cda66fed8f34d81c651f199eec8fa6aa07b0a38`
  - contentHash：`6c5384d27ebb9d44679a0b997f7ef5e75b7ac38b0f782cf07d6b73ca5b09dafa`
  - 原文摘录：“Acme Widget remains preview-only in release 1.5.”

## 来源与主张表

| sourceId | URL | 标题 | retrievedAt | contentHash | 读取类型 | 是否截断 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| web:4f8ea3aa29631370e435631b6776ba6c92184dbd23a23ab0cc643d1d11997a53 | https://docs.example.test/widget-current | Current widget status | 2026-09-07T14:51:06.393Z | 8e22fdd2d334c34dfaed936d7b74c4df5fb4f92c8a88fa3afd1919f2dc69cc4b | extracted-text | 否 | 全文已读；未含发布日期 |
| web:ca4f1a61ef7ddd33f27a277b6cda66fed8f34d81c651f199eec8fa6aa07b0a38 | https://archive.example.test/widget-preview | Archived widget status | 2026-09-07T14:51:07.443Z | 6c5384d27ebb9d44679a0b997f7ef5e75b7ac38b0f782cf07d6b73ca5b09dafa | extracted-text | 否 | 全文已读；未含发布日期 |

### 主张记录

- **主张 A**：Acme Widget 在 release 2.0 为 GA。  
  - 支持来源：`web:4f8ea3aa29631370e435631b6776ba6c92184dbd23a23ab0cc643d1d11997a53`，原文定位/摘录：“Acme Widget is generally available in release 2.0.”  
  - 反对来源：`web:ca4f1a61ef7ddd33f27a277b6cda66fed8f34d81c651f199eec8fa6aa07b0a38`（称仍为 preview-only in release 1.5）  
  - 适用范围：未注明时间、环境或区域；正文未提供发布日期，无法判断是否覆盖“当前”时刻  
  - 事实或推论：事实陈述（来自已读正文）  
  - 尚缺信息：发布时间、release 2.0 与 1.5 的时间顺序、适用环境/租户/地域

- **主张 B**：Acme Widget 仍仅为 preview，属于 release 1.5。  
  - 支持来源：`web:ca4f1a61ef7ddd33f27a277b6cda66fed8f34d81c651f199eec8fa6aa07b0a38`，原文定位/摘录：“Acme Widget remains preview-only in release 1.5.”  
  - 反对来源：`web:4f8ea3aa29631370e435631b6776ba6c92184dbd23a23ab0cc643d1d11997a53`（称 release 2.0 已 GA）  
  - 适用范围：未注明时间、环境或区域；正文未提供发布日期  
  - 事实或推论：事实陈述（来自已读正文）  
  - 尚缺信息：发布时间、release 1.5 与 2.0 的关系、是否针对不同环境/客户群

## 冲突说明

两份来源对 Acme Widget 的状态给出互斥描述（GA vs preview-only），且均未提供可用来排序或限定适用范围的日期、环境或版本生命周期信息。由于缺少可核验的时间锚点与适用范围，本报告不强行消解冲突，也不以“较新”“更权威”等未证假设选择其一。若需进一步判定，需要补充以下至少一项证据：各页面的发布/更新时间、release 1.5 与 2.0 的官方时间线、或针对特定环境/区域的适用声明。

## 研究范围与预算消耗

- 搜索次数：1 / 6  
- 取文次数：2 / 8（均成功）  
- 失败调用：0  
- 已读来源数：2（均为全文提取，未截断）  
- 未读但可能相关：搜索结果仅返回上述两条候选；空结果不代表网上无其他证据  

## 交付检查

- 关键结论均有实际读取的来源支撑，引用可直接回到返回正文  
- 摘要未冒充全文；两处均为 extracted-text 全文读取  
- contentHash 与 sourceId 来自工具返回  
- 冲突已明确保留，未混用样本或口径  
- 文件交付状态以 `wx_artifact_publish` 回执为准
