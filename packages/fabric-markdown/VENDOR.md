# VENDOR.md —— `fabric-markdown` 的并入基线

> 决策与理由见 **`docs/adr/ADR-100-fabric-markdown.md`**。本文件只记录**基线事实**，
> 让下一次上游回流有个可比对的起点。它是 ADR 决策五的落点。

## 基线

| 项 | 值 |
|---|---|
| 上游名称 / 版本 | `fabric-markdown` `v0.1.0` |
| 上游位置 | 本机 `~/Documents/projects/fabric-markdown`（**非 git 仓库，无 commit 可引**——这是本基线最薄的一环） |
| 并入日期 | 2026-07-30 |
| 并入内容 | `src/**`、`tests/**`（**逐字**，未改一行） |
| 未并入 | `demo/`、`dist/`、`vite.config.ts`、`package-lock.json`、`BACKLOG.md`、`node_modules/` |
| `src` + `tests` 树摘要 | `sha256:55199e79f433bdbc0ee50c479631589edfd28fb1516b58e354fac6a29fa67f99` |

树摘要的复算方式（在上游目录里跑，结果应与上表一致）：

```bash
find src tests -type f | sort | xargs shasum -a 256 | shasum -a 256
```

上游没有 git 历史，所以「上游改了什么」只能靠这个摘要发现**是否改过**，
发现不了**改了哪里**。若上游后续进 git，请把这一行换成 commit hash。

## 本仓相对上游的改动清单（**完整**，改这里的同时必须改本节）

| 文件 | 性质 | 说明 |
|---|---|---|
| `package.json` | 新增 | `@repo/fabric-markdown`，workspace 私有包。`fabric` / `mermaid` 由 caret 改为**确切版本**（ADR-100 决策二） |
| `tsconfig.json` | 新增 | 沿用上游 compilerOptions，去掉 `demo` 与 `fabric-markdown` 自指 path 别名 |
| `vitest.config.ts` | 新增 | 从上游 `vite.config.ts` 里只取 `test` 段（jsdom + `tests/**`），不带 lib 打包配置 |
| `src/templates-entry.ts` | 新增 | **纯 Node 入口**：只激活 19 个 A0 模板，不触碰 `fabric` / `mermaid`（ADR-100 决策三） |
| `UPSTREAM-README.md` | 新增（重命名） | 上游 `README.md` 原文，改名以免与本仓文档混淆 |
| `VISUAL-SPEC.md` | 原样 | 上游同名文件 |
| `src/**`（除 `templates-entry.ts`）、`tests/**` | **未改动** | 19 个 `key` 一个未动；222 个单测一个未改 |

## 回流规程

1. 在上游目录复算树摘要，与上表比对；不同 ⇒ 有改动。
2. `diff -ru <上游>/src packages/fabric-markdown/src`（`templates-entry.ts` 是本仓独有，忽略它）。
3. 按文件挑，**不整目录覆盖**——整目录覆盖会抹掉本表列出的本仓改动。
4. 挑完必须跑：
   ```bash
   pnpm --filter @repo/fabric-markdown exec vitest run          # 上游 222 个单测
   pnpm --filter api exec vitest run tests/canvas               # 本仓 key/displayName 契约
   ```
5. **任何改动 19 个 `key` 的上游提交一律拒收**（ADR-100 决策四 / 契约 I-1 I-36）。
   若上游确有改名需求，本仓保留旧 key 作为注册别名，注册表对外仍只暴露旧 key。
6. 改完回来更新本文件的树摘要与改动清单——**没更新 = 下一次回流没有基线**。
