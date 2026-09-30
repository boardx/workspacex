# 上游溯源（S193）

本目录不复制上游正文；下列来源均为 `anthropics/knowledge-work-plugins` @ `da38ec1ee89d41e5380e652a97382695003396e7`，许可 Apache-2.0（各插件目录下 `LICENSE`）。

- `sales/skills/customer-voice/SKILL.md`（adapt；章节 Scope / Gather sources / Extract quotes (strict) / Output）：只取带归属的逐字引语（严格抽取）；个人范围为空时停下询问、不静默放宽到全组织（落为 `VOC_EMPTY_SCOPE`）。该上游止于跨账户检索引语，没有主题聚合、去重计数、阈值与趋势，这些为本 Skill 原创。
- `customer-support/skills/customer-research/SKILL.md`（reference-only）：借鉴「多源检索并标注来源、Gaps & Unknowns、先给答案再给证据」的输出顺序；该上游是单问题检索而非主题聚合，不 adapt 正文。

方法学出处（无文字引用）：亲和图/主题分析思路（开放编码 → 主题归并）；公开的客户流失原因分类（价格、产品缺口、服务、竞品、业务变化）。

Apache-2.0 NOTICE：本 Skill 借鉴上游的结构化思路并以 WorkSpaceX 的输出契约重写，未复制上游文件内容；`copied=false`，故无逐字复制义务，仍在此保留许可与出处。
