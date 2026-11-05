# Task 2 round 4 bounded native-driver SOURCE closure

Verdict: **本轮定位 finding 在 SOURCE 层 ADDRESSED；数值收据/隐私/断言保持通过 scoped source review；此 delta 内无新增 actionable finding。** 不是新 native、geometry、PNG 或整页 PASS。

## 精确绑定及范围

- 固定合并提交：`a14e1392c4558f8a7f519aa2cf2969a12e780e1f`。通过只读 `git show` 独立核对 native spec SHA-256：`6178c0139ab7dae1f383968a2d9aa0623972a3d0480e7cd3bf58b60f52c31597`。
- 输入：本目录 `round4-task2-review.diff`，独立 SHA-256：`997d73241a1b72be38fb42ca45cab1924db695dd4c765c6c990ac4d40a765265`（ROOT 指定 `55d2…` → `48e836…`，仅 helper/anchor delta）。
- 从首个 `test(` 至文件结尾的三 case 源码，在已发布 `55d2e32855f179b7c6d80c72c3a694d5e1047e96` 与固定 `a14…` 上独立计算均为 `fd84b385203536739dc1edd00527a5e94b0c695230adcaadadd5c2b4d0c9d0a6`；三 case bodies byte-identical。
- 只审该 native delta 及直接影响；不重审整页、上游 accepted 改动、notice literal/新语义 case 或全分支。阅读 ROOT 的 registry/normal-recovery 两份 proof，作为所述集成保存边界的既有记录，不据此扩展上游审查或宣称运行行为。

## 1. 原完整卡片 ratio failure 的定位修复 — SOURCE ADDRESSED

固定 spec `:97–122` 的 `position` 保留原 `scrollIntoViewIfNeeded`，随后对**同一 el** 原生调用 `scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" })`。原 audit 控件/full-card selector、visible 条件和 leaf-span 条件没有删改；没有用较小子区域代替完整卡片，也没有新 skip、force click、样式/尺寸/缩放改动。

`:124–141` 继续在同一完整节点/leaf 上断言 exact ratio 1、左右 viewport bounds、`scrollWidth <= clientWidth + 1` 和 document no-overflow。`:148–154` 原 top/bottom 目标也调用同一个 helper，再断言 exact ratio 1；既有 bottom document overflow 检查保留。新定位 helper 不吞掉 assertion failure、不重试断言、不降低阈值。三 case bodies 相同且 helper 中 viewport 仍为 375/1280 × 900，截图调用数/22 planned cap 与请求、timeout/retry 都未改变。

这解决了 source 层的定位策略缺口；不能据此证明 cloud 实际 full-card ratio 已成为 1。ROOT 提供的 `41947987186` case 2 两次 `.9938650131225586` 失败和既有 22 张 QA 是旧 run 事实；本 reviewer 未重读图片。163/162 只能按 ROOT 说明归为 raster/ratio inference，不能写成实际 DOM 尺寸。

## 2. private numeric before/after 收据 — SOURCE ACCEPTED

`:91–95,100–121` snapshot 的值只有 target/card/最近 vertical overflow scrollport 的数值 rect、scrollTop/clientHeight/scrollHeight、viewport 与数字 controlIndex；无 card 时为空数组。selector 仅在 browser evaluation 内用于定位，不写入 receipt。没有读取或附加文本、testid、输入值、raw model/org 数据、URL、token、storage、cookie、headers 或 auth body。

`before` 的准确含义是**保留的 Playwright scroll 完成之后、额外 DOM center 之前**，不是初始未滚动位置；`after` 是同一 evaluation 内原生 instant center 后的 snapshot。收据没有伪装成旧 run 的几何数据。

`:146–158` 每个 width 收集 audit/anchor 的连续索引，并在 `finally` 以静态 attachment 名写入现有 runner；失败时仍可保留已采集条目，原失败继续传播。该 attachment 不新增 PNG，也不自动获得公开权限，必须随 authenticated runner artifacts 保持私有。若失败在首个 snapshot 完成前发生，收据可为空；不能把缺失条目解释成已经测过。

## 3. scoped quality evidence — 已有记录已核对，不重跑

只读核对 ROOT 的 `r4-lint.json`、`r4-web-type.json`、`r4-testid.json`、`r4-discovery.json` 及 `raw/round4-final-recovery/` 对应日志，四份 log SHA-256 均独立匹配 receipt，head 均为固定 `a14…`：

| ROOT 已执行检查 | 记录结果 | 本轮核对 |
| --- | --- | --- |
| scoped 6-file eslint（含 native spec） | exit 0 / 2.275s | 命令含本 spec；空日志 hash 匹配 |
| canonical web typecheck | exit 0 / 68.292s | `tsc --noEmit` 日志及 hash 匹配 |
| testid gate | exit 0 / 3.985s | 完成日志及 hash 匹配；不扩大该 gate 自身承诺 |
| canonical product/seeded-github-import discovery | exit 0 / 2.585s | `--no-deps … --list` 恰列该文件 3 tests；hash 匹配 |

上述是 ROOT 既有 source/collection evidence，不是 reviewer 执行，不是 native 或 geometry evidence。registry proof 的 acceptedProjectionExact、2/2/1 own lines 与 normal-recovery proof 的树/祖先/FF/未改 hook 结论仅作 supplied integration preservation record；本轮不重复 merge 审计或 hook 门控。

## 仍未知的 runtime 边界

新定位和数值收据尚未 native 执行。是否消除旧比例失败、实际 rect/scrollport、瞬时滚动后的可见性、嵌套 clipping、预算耗时、top/bottom 实际构图、长内容中间区覆盖、row 条件下 modal 可达性、有效 workers 以及新 PNG QA 均未知。必须保留原 exact assertions，在 ROOT 原 cloud lane 实测；旧 22 张图片不能替代修复后的图像证据。

本轮只有只读 source/hash/git show/已有报告与 receipts；仅写本 private closure。未运行 test/lint/typecheck/browser/services/DB/network，未修改 Git/源码、未派子 agent。此 closure 不关闭 issue，不声称新三个 native cases PASS。
