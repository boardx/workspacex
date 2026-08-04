# 契约束 `curated-capability-packs` — UC 覆盖矩阵

> 依据：`requirements/25-curated-capability-packs/garden-skills.md` R12。
> API 只复用 `wave2Runtime.operations.importSkillStarterPack`；build/check 行明确标作非 HTTP，避免伪造新端口。

| R12 | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 未配置 root 的新组织保持 0 Skills | `importSkillStarterPack`（NOT_FOUND）+ startup 反证 | `/admin/skill` `admin-skill-empty` | 待 F149 |
| V2 | generator 确定且提交产物无 drift | —（build-time generator `--check`） | —（构建期验收） | 待 F149 |
| V3 | pack 坐标与四 stableName 精确集合 | `importSkillStarterPack` | `skill-starter-import-result` + `admin-skill-list` | 待 F149 |
| V4 | 每项仅四条 allowlisted file path | `importSkillStarterPack` 校验后持久化 | —（API/DB 层验收） | 待 F149 |
| V5 | provenance 与 MIT 完整持久化 | `importSkillStarterPack` → immutable manifest/files | —（API/DB 层验收） | 待 F149 |
| V6 | file/pack 两级 tamper 都 fail closed | `importSkillStarterPack`（INVALID） | `skill-starter-import-result` | 待 F149 |
| V7 | 非管理员 DOM 无入口且 API 拒绝 | `importSkillStarterPack`（ADMIN_REQUIRED） | `/admin/skill` `skill-starter-import` 不存在 | 待 F149 |
| V8 | 管理员显式导入新增恰四项 | `importSkillStarterPack`（201） | `skill-starter-import-confirm/result` + `admin-skill-list` | 待 F149 |
| V9 | 相同重试幂等、换载荷冲突 | `importSkillStarterPack`（200 / IDEMPOTENCY_CONFLICT） | `skill-starter-import-result` | 待 F149 |
| V10 | 跨组织隔离且可各自显式导入 | `importSkillStarterPack` + RLS | `/admin/skill` 按当前组织刷新 | 待 F149 |
| V11 | advisor-only，执行型能力不可到达 | —（declarative wrapper/manifest check） | —（Skill 内容验收） | 待 F149 |
| V12 | 无默认/推荐/seed/implicit import | `importSkillStarterPack` 是唯一写入口 | `/admin/skill` 真实空态、无推荐项 | 待 F149 |

## 反向检查：端口 → UC

| 端口/入口 | 需求依据 | 结论 |
|---|---|---|
| `POST /admin/skills/starter-pack-imports` | R3、R4 E1–E5、R5 | 复用；无新字段/错误码 |
| `SKILL_STARTER_PACK_ROOT` pack source | R2、R7.4、R12 V1/V12 | 只显式部署配置；无 fallback |
| `/admin/skill` starter import panel | R2、R3、R5、R8 | 复用；无新屏/testid |
| build-time generator/check | R4 E6、R7、R9、R12 V2–V5/V11 | 内部交付端口，不是产品 API |
