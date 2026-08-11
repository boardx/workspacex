# <项目名> 项目事实单点（project facts）

> **填这份文件是接入模板的第一步**。`.harness/instructions/` 里其余文档是可移植的
> 方法论标准；域名、URL、部署目标这类**本项目专属事实**全部收拢到这里，通用文档
> 引用本文件而不是各自硬编码。凭据**永远不放这里**（也不放任何进 git 的文件），
> 只放"凭据文件的路径"。

## 身份
- GitHub org/repo：`<owner>/<repo>`（默认分支 `main`，是否禁止直接 push：<是/否>）
- 同步配置：`.harness/config/github-sync.yaml` 的 `repo` 字段要与此处一致

## 部署面
| 平面 | 域名 | 载体 | CD workflow |
|---|---|---|---|
| <例：开发者门户> | `<域名>` | `<Cloudflare Pages / Vercel / 自托管…>` | `.github/workflows/<文件>` |
| <例：应用全栈> | `<域名>` | `<单机 / k8s / …>` | `.github/workflows/<文件>` |

规则（源自上游事故，见 coordinator-sop 铁律）：**有 CD 的目标不手动部署**；
env/secret 变更必须与部署原子（同 PR 或先加后删）。

## 协调服务（可选——未配置时全套退化为单 agent 模式，依然可用）
- 基址：`<https://….workers.dev，或留空>`（环境变量 `COORD_SERVICE_URL`）
- 协议契约见 `docs/coordination-protocol.md`；客户端在 `packages/coord-protocol`
- 未接线时：`pnpm harness tick` 会明确提示"只读时钟模式/跳过租约"，不静默假装

## 凭据（只列路径，值永不入 git/聊天/issue）
- 本机缓存目录：`.harness/state/.cache/`（已 gitignore）
- CI：repo secrets `<清单>`

## 模块清单（对应 .agents/skills/mod-*）
mod-chat（聊天/对话） / mod-agent-skill-runtime（Agent/Skill 运行时与契约） /
mod-research-studio（研究/访谈/录制/检索/模板） / mod-asset-artifact（产出物/资产治理；画布归官方 mod-canvas-diagram） /
mod-org-identity（身份/鉴权/组织后台） / mod-coord-platform（RepoHub/Directory/Brain/
Projection/Protocol/网关） / mod-devportal（开发者门户） /
mod-project（项目容器：三类容器 / 议程环节 / 项目成员 / 项目工作台外壳）
（2026-08-09 定稿，边界对应 apps/api 的 domain 子目录与 packages/coord-* 的协议边界；
2026-08-12 补 mod-project——它对应 `apps/api/src/domain/project` 与 `packages/contracts/src/project.ts`，
定稿那天漏了，不是新拆的边界；出处 PR #980）；
每个模块复制 `.agents/skills/mod-_template/` 建立自己的活知识库）
