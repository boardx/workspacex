# 契约束 `curated-capability-packs` — 领域模型与不变量

> 本束只定义一个经管理员选择的声明式 Skill pack。它复用 Wave 2 Skill import/persistence，
> 不定义新的执行器、工具、API 或 source 枚举。

## 实体和值对象

### `CuratedSkillPack`

- `packId = garden-advisors`
- `packVersion = 1.0.0`
- `adapterVersion = 1`
- `skills`：四个有序、稳定、不可变的 `CuratedAdvisorSkill`
- `packDigest`：Wave 2 对 unsigned pack 的 SHA-256

### `CuratedAdvisorSkill`

- `stableName` / `displayName` / `semanticVersion`
- `advisorMode`：`web-design` / `image-prompt-mode-c` / `article-planning` / `video-planning`
- `files`：固定 allowlist 的声明式文本文件
- `upstream`：repo、tag、annotated tag object、commit、review-time archive SHA-256、license
- `capabilityPolicy`：封闭 deny-by-default 声明；允许值只有 `advisory-text`

### `AdapterProvenance`

`{ upstreamRepo, upstreamTag, upstreamTagObject, upstreamCommit, upstreamArchiveSha256,
license: "MIT", adapterVersion, reviewedSourcePaths }`。它同时进入 manifest 与 `NOTICE.md`；
`LICENSE.upstream.txt` 保存完整 MIT 文本。

## 固定身份与上游坐标

| stableName | displayName | adapter semanticVersion | upstream tag | commit | review-time archive SHA-256 |
|---|---|---|---|---|---|
| `garden-web-design-advisor` | `Garden · Web Design Advisor` | `1.0.0` | `web-design-engineer-v1.3.0` | `ea45dc563a42042341de36cc11806d8a870a6606` | `83bbc80e06145e9a8479f41cb45f2c9d7b8ea940c81794a8188379b6ef9993a7` |
| `garden-gpt-image-prompt-advisor` | `Garden · GPT Image Prompt Advisor` | `1.0.0` | `gpt-image-2-v1.0.4` | `78b4d081493e2a4a1c199d074f63e57814ed7e30` | `95be4b77d5703bfdfa8fd198e1770d746cda8d3b2c5e3a2e52c2fa9cd6eeda10` |
| `garden-beautiful-article-advisor` | `Garden · Beautiful Article Advisor` | `1.0.0` | `beautiful-article-v0.1.0` | `78b4d081493e2a4a1c199d074f63e57814ed7e30` | `696b266005fe362148a8d375a80d1c95e1e1b80ddb352630a6ecb51cbb35ad71` |
| `garden-web-video-planning-advisor` | `Garden · Web Video Planning Advisor` | `1.0.0` | `web-video-presentation-v1.2.2` | `78b4d081493e2a4a1c199d074f63e57814ed7e30` | `6856c64336dfb50fdbf674a7f05d4b5ab53f9fd00dee723c5a0e1f5df0e489ef` |

annotated tag object 的四个值以 requirements R7.2 为单一完整登记处；本表刻意不再复制。

## Reviewed upstream source allowlist

这些路径只用于 provenance 和人工改编依据；generator 不在构建时下载或整文件复制它们。
运行时 `references/advisor-guide.md` 是 WorkspaceX 审阅后的安全摘编。

| Advisor | reviewedSourcePaths（相对上游 repo） |
|---|---|
| Web Design | `LICENSE`; `skills/web-design-engineer/SKILL.md`; `references/design-calibration.md`; `references/critique-guide.md`; `references/failure-patterns.md`; `references/redesign-protocol.md` |
| GPT Image Prompt | `LICENSE`; `skills/gpt-image-2/SKILL.md`; `references/prompt-writing.md` |
| Beautiful Article | `LICENSE`; `skills/beautiful-article/SKILL.md`; `references/article-types.md`; `references/information-density.md`; `references/layout.md`; `references/plan-template.md`; `references/theme-selection.md` |
| Web Video Planning | `LICENSE`; `skills/web-video-presentation/SKILL.md`; `references/SCRIPT-STYLE.md`; `references/OUTLINE-FORMAT.md`; `references/CHAPTER-CRAFT.md` |

上游 source 即使在上述 allowlist 内，其中涉及 browser/image/TTS/scripts/subagent/build 的段落也不得原样进入
adapter；安全边界由 WorkspaceX adapter sources 单独表达并由生成检查锁定。

## 不变量

- **I-1 固定集合**：`skills.map(stableName)` 与需求 R3.4 的四值集合双向相等；目录扫描不能增加第五项。
- **I-2 确定性**：同一 adapter source tree 的两次生成结果字节相等，`packDigest` 相等。
- **I-3 文件封闭**：每项只含 `SKILL.md`、`references/advisor-guide.md`、`NOTICE.md`、
  `LICENSE.upstream.txt`，且恰一个根 `SKILL.md`。
- **I-4 无执行载荷**：pack 中 `scripts/`、`templates/`、package manifest、二进制和 symlink 数量恒为 0。
- **I-5 权限封闭**：`capabilityPolicy.allow == ["advisory-text"]`；network、browser、image、TTS、
  shell、package-install、arbitrary-fs、secret-discovery、tool/MCP 全部显式 deny。
- **I-6 Advisor 语义**：四项分别只产出设计建议、Mode C 图片提示词、文章编辑计划、视频脚本/storyboard 计划。
- **I-7 provenance 完整**：任一 Skill 缺 repo/tag/tag-object/commit/archive-SHA/MIT/adapter 字段，整包无效。
- **I-8 不可变**：import 后的 published SkillVersion、manifest、file bytes/digest 不能更新或删除。
- **I-9 租户隔离**：Skill/version/file/import 的 `orgId` 与当前组织相等；跨组织读写为 0。
- **I-10 显式发现**：未配置 `SKILL_STARTER_PACK_ROOT` 时 pack source 必然 NOT_FOUND；没有 fallback root。
- **I-11 零内置**：migration/startup/bootstrap/fixture/enrollment/first-login 均不创建或推荐本 pack。
- **I-12 许可保留**：每项不可变文件集合都包含完整 MIT license 与 NOTICE，不能只把 attribution 放在构建日志。

## 跨束边界

- `skills`：复用声明式 Skill 和真实目录；不修改其 `Skill.source` 封闭枚举。
- `wave2-runtime` design delta：复用 `SkillStarterPack` 形状、显式管理员导入、digest 与 RLS；不改语义。
- `agent-runtime`：本 pack 没有 Agent、AgentRun、MCP 或 tool policy；将 Skill 挂 Agent 属后续 feature。
- `asset-governance`：上游供应链审阅信息只作为 provenance；不在本 feature 引入社区自动同步。
- phase-01 coherence：上述四条形成新增交叉约束 XC-31，必须由人类重新复核。
