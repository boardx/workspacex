# 契约束 `curated-capability-packs` — 用例与端口

## UC: `GenerateGardenAdvisorsPack`（构建期，无 HTTP）

- **in**：固定 adapter sources、四项 upstream pin/provenance、完整 MIT license。
- **out**：`garden-advisors/1.0.0.json`，符合 `wave2Runtime.SkillStarterPack`，byte-for-byte deterministic。
- **pre**：所有 source path 均在 reviewed allowlist；不得在生成时访问网络或 ambient secret。
- **err**：`SOURCE_NOT_ALLOWLISTED | PROVENANCE_INCOMPLETE | EXECUTABLE_CONTENT_DENIED |
  NON_DETERMINISTIC_OUTPUT | GENERATED_ARTIFACT_DRIFT`。
- 这些是 build/check 的退出原因，不是新 HTTP 错误码。

## UC: `ImportGardenAdvisorsPack`（复用既有 HTTP 操作）

- **operation**：`wave2Runtime.operations.importSkillStarterPack`。
- **method/path**：`POST /admin/skills/starter-pack-imports`。
- **in**：`{ packId: "garden-advisors", packVersion: "1.0.0", idempotencyKey }`。
- **out**：既有 `SkillStarterImportResult`；首次 `201`，相同重试 `200`；两组 ID 均恰 4 项。
- **pre**：当前 principal 是当前组织 admin；部署已显式设置 `SKILL_STARTER_PACK_ROOT`。
- **err**：只使用既有五码：
  `SKILL_STARTER_PACK_NOT_FOUND | SKILL_STARTER_PACK_INVALID | SKILL_STARTER_PACK_CONFLICT |
  SKILL_STARTER_IMPORT_IDEMPOTENCY_CONFLICT | SKILL_STARTER_IMPORT_ADMIN_REQUIRED`。

### 事务后置条件

- 成功：四个 Skill + 四个 published immutable version + 固定 allowlisted files + 四个目录投影 + 一条成功 import provenance。
- 失败：上述产品行全部为 0；允许既有 `starter_pack_imports` 记录持久失败 provenance。
- 相同重试：返回首次 durable result，不重新读取后来替换的 pack，不增加任何产品行。

## UC: `AdviseOnly`（声明式内容行为，无新端口）

- **in**：用户已授权给既有 Skill runtime 的文本/Context Pack 片段。
- **out**：仅 advisory text：设计 critique/plan、Mode C 图片 prompt、文章编辑 plan、视频 script/storyboard plan。
- **pre**：本 feature 不创建 mount，不隐式调用；由未来显式绑定/调用链选择具体不可变 SkillVersion。
- **denied**：请求写文件、跑 shell/browser、生成图片、构建 HTML/PDF/Web、TTS、录屏、安装 package、
  探测 secret 或调用任意 tool 时，wrapper 明确说明该模式不可用；结构上不存在工具/脚本入口。
- **err**：不新增 HTTP 或 AgentRun error。若未来需要可执行模式，必须另建契约束/feature。

## 失败模式不扩张证明

- provenance 完整性、adapter allowlist 和 deterministic check 在部署产物生成前 fail closed；
  它们不扩充 `importSkillStarterPack.err`。
- manifest 使用现有 `z.record(z.unknown())` 存 provenance；不要求新 API 字段或 source enum。
- 若实现发现必须把 provenance 新增到 HTTP response、或必须显示 `source=Garden/community`，立即停工并扩大签核，
  不能在 F149 顺手添加。
