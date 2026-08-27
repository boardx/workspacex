# 平台级 skill 全局可见

## 原始需求（人类原话）

- "word，pdf，excel都可以在chat使用了吗？" → 回答：sandbox/执行层已完成并真栈测试过，
  但没有任何 org 导入过这三个 skill（加上已有的 pptx），所以现在**不能**在 chat 里用。
- "这些skill应该是所有的org都可以用的，不需要导入到任何的org，请检查现在的系统逻辑" →
  检查确认：现状确实是每个 org 都要各自导入才能用，没有平台级机制。

## 要什么

四个官方 skill——pptx-create（F962 已交付）、docx-create/xlsx-create/pdf-create
（F979 已交付）——对**所有**组织默认可见、可挂载、可执行，**不需要**任何组织的
admin 手动走一遍 starter-pack 导入。一个全新注册、从未做过任何 skill 相关操作的
组织，进 chat 就能 `#` 挂上这四个 skill 并用。

## 不要什么

- 不是"所有 skill 都平台化"——用户/组织自己导入的第三方 skill（GitHub 导入/
  starter-pack 导入自建内容）依然严格按 org 隔离，这是安全边界，不因为平台机制
  存在就默认放宽。
- 不需要"复制一份到我的组织"这类 fork 操作——直接用平台行本身即可（详见
  design-delta `platform-owned-skills` §2，与 canvas 模板的 fork 机制不同）。

## 依据/先例

已有 `phases/phase-13-platform-owned-skills/design-deltas/platform-owned-skills/`
（design-delta，待签核）——复用 canvas 模板已经上线的 `PLATFORM_ORG_ID`/`org-platform`
RLS 读策略模式（见 `apps/api/migrations/20260826120000_platform_canvas_template_
library.sql`），不是从零发明。
