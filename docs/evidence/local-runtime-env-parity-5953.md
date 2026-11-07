# #5953 — 本地运行时环境变量清单与 API 同步

2026-10-27，基于 `origin/develop@78a91f5965222eef6ef5a77faf01837c877b204f`，复用 e435。

## 失败证据

develop run 40499219659 的 full-regression-core，以及手动 base run 40493158039，均在 `packages/local-runtime/test/parity.test.ts:33` 报出四个未分类变量：`KERNEL_IMAGE_MAX_BILLABLE_TOKENS`、`KERNEL_VISION_MAX_INPUT_TOKENS`、`PATH`、`WORKSPACEX_CREDIT_RECEIPT_DIR`。

修复前，聚焦 parity / billing-child-env 测试：1 failed、7 passed，复现相同四项。补齐后整包门控继续检出六个 API 已删除的 request-accounting / native-ledger 开关，以及两项能力映射缺失；均同步移除或补齐，保留原有门控强度。

## 修复范围

- 在线图片/视觉计费上限随现有 provider 归为 unavailable-locally，并同步 capabilities 的 envKeys；不虚构计费默认值。
- PATH 沿用进程启动器继承的宿主环境。
- 收据目录沿用 development 下已有的私有缓存默认路径；不改持久化实现、权限检查或生产环境必须显式配置目录的约束。
- 删除 API 已不再引用的六个清单条目；保留仍存在的 product quota 开关。

## 验证

- `pnpm --filter @repo/local-runtime test`：41 files、250 tests passed，38.42s，exit 0。
- `pnpm --filter @repo/local-runtime typecheck`：exit 0。
- 现有 parity 门控仍检查未分类、过时和重复条目，capabilities 门控仍检查不可用变量与能力提示映射；未跳过或弱化测试。

这证明本地运行时整包修复通过，不能据此宣称完整 develop workflow 已绿。完整 base 还有 80 分钟超时诊断待处理；chat-read 的画像测试竞态另案修复。
