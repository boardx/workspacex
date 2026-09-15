# UI 先行原型 — 投后财务项目评级 Agent（`/agent/team2`，F03）

真实组件 + mock 的可运行工作台，供人类在束级 `design-signoff.md` 第 ① 件（UI）签核。
签核材料索引见 `../../design-proposal/postinvest-rating/ui.md`。

## 怎么自己点

```bash
pnpm --filter web dev        # 起 dev server
# 直达（无需登录，原型用 mock identity 渲染壳层；正式权限在服务端，此处仅界面投影）：
open http://localhost:3000/agent/team2
```

### 状态切换（URL query，硬规则 ⑤ 要求七态可见）

| query | 呈现 |
|---|---|
| `?state=default` | 空态·数据供给（默认） |
| `?state=loading` | 加载骨架 |
| `?state=empty` | 空（本项目无历史评级） |
| `?state=running` | 运行态（进度/工具调用） |
| `?state=hitl` | 运行态 + HITL 降级确认卡 |
| `?state=result` | 结果态（成功，含三 Tab） |
| `?state=validation` | 校验失败（录音误走聊天上传，AUDIO_NOT_ALLOWED_IN_CHAT_UPLOAD） |
| `?state=dependency` | 依赖失败（KERNEL/SANDBOX 不可用 + 重试） |
| `?state=forbidden` | 无权限（404 语义） |
| `&dialog=feedback` / `recorded` / `confirm` | 叠加：反馈弹层 / 主观偏差回显 / 采纳二次确认 |
| `&role=consultant` / `lead` / `admin` / `compliance` | 预览视角切换（R5 四角色，见下） |

**视角切换是预览手段，不是权限实现**——真实权限在服务端，这里只做界面投影（硬规则/R5）。
角色影响：`admin`/`compliance` 采纳按钮禁用（管理员不是超级用户 / 合规只读）；`lead` 才可「新项目」。

## 截图清单（每屏每状态一张）

见 `../../design-proposal/postinvest-rating/ui.md` 第三节表格（01–11）。

## 我替 UC 做了哪些它没写明的设计决定（人类请逐条看）

1. **等级色 token 占位**：契约规定颜色从 skill 包读、前端不另写映射。但设计 token 单源里还没有
   `rating.grade.*` 与「深红」token，我用 success/ai/warning/destructive 占位，**E 与 D 暂共用
   destructive**。这是最需要拍板的一处（是否新增五档专用色阶）。
2. **testid 下划线→连字符**：R8 的 `<code>` 锚点里契约枚举带下划线，与 lint-design D-35（禁下划线）
   冲突，统一 kebab 化。e2e 将据此锚定，需确认这个约定。
3. **视角切换器放页面内容区**（不放顶栏），并 `hideRoleSwitcher`，避免「同一页两套角色切换」。
4. **上传文件条的具体列**（名/大小/SHA256 前 10 位/类型标签/解析状态/「原件上传」标记）——R8 只给了
   字段名，列顺序与 SHA256 截断长度是我定的。
5. **数值展示单位**：依据表数值统一按「万元」显示（原始 mock 为「元」），缺失显示「—（缺失）」并用
   warning 色，以落实 R7-3「零与缺失可区分」。
6. **未验证报告卡**（E9）用 `aria-disabled` + 「未验证，暂不可下载」，不做成可点后报错。
7. **运行进度步骤文案与工具名**是按 R3 阶段二七步 + 附录 A 能力矩阵编的示例，非 UC 原文逐字。

## R8 线索之间的矛盾及处理

- R8 建议 testid 用 `<code>` 原样，与 D-35 命名规范冲突 → 见上第 2 点，kebab 化。
- R8「颜色 token 从 skill 包读取，不在前端另写映射」 vs. 设计 token 尚无该色阶 → 见上第 1 点，
  colorToken 仍由数据携带、前端只做 token→CSS 解析（不是等级→颜色业务表），缺的色阶如实记为缺口。

## 待人类确认清单（签核第 ① 件重点核对 3 处）

1. **等级色阶**：是否为 A–E 新增五档专用设计 token（含独立「深红」E 档）？当前 E/D 同色是占位。
2. **testid kebab 约定**：`rating-*-<code>` 中下划线转连字符是否作为正式 e2e 锚点固化？
3. **信息密度是否够签核**：结果态依据表 16 行、版本链 3 版、多标注 chips、白名单 9 域 + 丢弃计数——
   请确认这个量级足以暴露真实的密度/布局问题（硬规则 ③ 的用意），尤其依据表在窄屏的横向滚动。

> 签核状态（`design-signoff.md` 的 `status`）由**人类**改，ui-prototyper 不改（硬规则 ①）。
