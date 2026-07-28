# 契约束 `api-kernel` — ④ UC 覆盖证明

> **这一件回答的问题**：前面两件定的门控与管道契约，**真的覆盖住 UC-0.6 的验收线索吗？**
>
> 覆盖 feature：**F18**（13 点）
> 验收线索来源：`uc-0-6` 的 R12 共 **V1–V10 十条**
>
> ⚠ 这个束**没有业务 HTTP API**（见 domain.md 第三节）。所以下表的
> **「API 操作」列填被验证的可执行门控命令**，
> **「前端消费点」列填被验证的后端落点**（路由 / SQL / 角色 / 文件）——
> 与 `web-kernel` 同一处理方式。

## 怎么读这张表

**两个方向都要查**：

- **UC → 门控**：某条 R12 找不到对应门控 ⇒ **验收悬空，规范未落地**
- **门控 → UC**：某道门控没有任何 R12 要它 ⇒ **门控是多余的**

⚠ 签核时（2026-07-29）本束的门控一道都还没跑起来，下表「状态」列当时全是 ⬜。
**F18 已于同日实现并 passing**，八条 verification 全过，故已改为 ✅。
每一道门控都造过反证——过程见第五节。

---

## 一、`uc-0-6` 后端内核与运行时门控（V1–V10）

| R12 | 一句话 | 门控命令（契约的可执行形式） | 后端落点（路由 / SQL / 角色 / 文件） | 状态 |
|---|---|---|---|---|
| **V1** | 骨架：`typecheck` / `lint` exit 0，turbo 命中 | `pnpm --filter api run typecheck` · `pnpm --filter api run lint` | `apps/api/` · `turbo.json` | ✅ |
| **V2** | 洋葱门控**真的在扫**（扫描数 > 0，不是退出码） | `node .harness/scripts/lint-arch-deps.mjs` | `apps/api/src/{domain,application,infrastructure,interface}/` | ✅ |
| **V3** | 洋葱门控·反证：坏 fixture exit 1 且报方向与理由；好 fixture exit 0 | `pnpm --filter api run test`（`arch-gate.test.ts`） | `apps/api/__fixtures__/arch-{bad,good}/` | ✅ |
| **V4** | RLS 角色：应用角色非 owner、无 `BYPASSRLS`、无 DDL；表为 FORCE | `apps/api/scripts/verify-rls.sh`（断言 1–4） | 迁移里的 `CREATE ROLE app_rw` / `GRANT` / `FORCE ROW LEVEL SECURITY` | ✅ |
| **V5** | **RLS 反证（本束最重要）**：绕过应用层过滤，跨租户读 0 行；换租户能读到自己的 | `apps/api/scripts/verify-rls.sh`（断言 5–7） | `rls_probe` 表 · `SET LOCAL app.current_org` | ✅ |
| **V6** | 迁移幂等：空库跑两次摘要一致；每个文件都进版本表 | `pnpm --filter api run migrate:check` | `apps/api/migrations/NNNN-*.sql` · 迁移版本表 | ✅ |
| **V7** | Guard 双向：无凭证 401；有凭证 principal 非空 | `apps/api/scripts/verify-runtime-gates.sh`（G1/G2） | 全局 Guard · 受保护测试路由 | ✅ |
| **V8** | ValidationPipe 双向：违规 400 + 字段级；合规通过；后端无第二份 DTO | `apps/api/scripts/verify-runtime-gates.sh`（G3/G4）· `node .harness/scripts/lint-contract-source.mjs` | 全局 ValidationPipe ← `packages/contracts` zod | ✅ |
| **V9** | 错误边界：响应只含 `internal_error` + traceId，无堆栈/表名/敏感串；日志能按 traceId 找到详情 | `apps/api/scripts/verify-runtime-gates.sh`（G5/G6） | ExceptionFilter · Interceptor（traceId） | ✅ |
| **V10** | 契约单源直达后端：前后端同源于 `packages/contracts`，且门控**扫描范围含 `apps/api`** | `node .harness/scripts/lint-contract-source.mjs` | `packages/contracts/src/*.ts` → `apps/api/src/interface/**` | ✅（门控扫描范围已扩到 apps/api） |

---

## 二、缺口清单（这一件的真正价值所在）

| # | 缺口 | 性质 | 补法 |
|---|---|---|---|
| ~~A-1~~ | ✅ **已关闭（2026-07-29，F18）**：`lint-arch-deps` 此刻是空转门控。它对不存在的 `apps/api/src` 打印「跳过」并 exit 0。ADR-020 称它「与既有七道门控同级、强制」——**实际从未扫过一个文件** | **现存空转门控**（本项目第六次同类） | V2 断言**扫描数 > 0** 而非退出码。⚠ 这条已写进不变量 I-2，是本束存在的直接动因之一 |
| ~~A-2~~ | ✅ **已关闭（2026-07-29，F18）**：`lint-contract-source.mjs` 此前只覆盖前端侧。ADR-020 的「zod → 后端 DTO」这一端**从未被门控过** | 门控覆盖不全 | V10 要求扩其扫描范围到 `apps/api`。⚠ 不扩的话，后端抄一份 DTO 不会有任何东西报警——**这是第七次漂移的最高风险点** |
| **A-3** | **凭证形态未定**（JWT / session / mTLS）。Guard 只能断言「principal 非空」这条结构约束 | 上游未裁决（属 phase-01 `01-auth`） | 本束刻意不决定。⚠ 但须确认「结构约束先落地、凭证后接」这个切法可接受——否则 G2 的测试凭证会被当成实现 |
| **A-4** | **是否引入 ORM 未定**（R4 A1 默认不引入）。理由是 ORM 会把 `SET LOCAL` 的会话语义藏进连接池行为里 | **[待确认]，且一旦定下很难回头** | 签核时请明确表态。这条影响 F01~F13 全部持久化代码的写法 |
| **A-5** | **X-3（出网为零）本束只认领落点，不实现断言**。一致性复核原话：「这条如果没人认领，它会在前后端与运维的缝里掉下去」 | 跨束约束的归属 | 本束在 `docker-compose.dev.yml` 与部署清单里留**明确的网络策略位**并署名；deny-all 的**断言**留给 F16（本地组织完整形态）。⚠ 请确认这个分工，否则它仍会悬空 |
| **A-6** | **迁移工具选型未定**（自研 runner / node-pg-migrate / dbmate） | 实现细节 | 硬约束只有四条（显式 SQL、前向、幂等、可从空库重建），工具不限。不阻塞 |
| ~~A-7~~ | ✅ **不再成立（2026-07-29）**：本束的门控当时一道都没跑过，与另外四束（尤其 `web-kernel` 的七道已在跑）性质不同 | 本束的性质，非缺陷 | 签核的对象是**契约是否定对**，不是**实现是否已完成**。⚠ 请按这个前提读，别把「全是 ⬜」当成质量问题 |

---

## 三、反向检查：有没有多余的门控

| 门控 | 被哪条 R12 要求 | 结论 |
|---|---|---|
| `lint-arch-deps.mjs` | V2 V3 | ✅ |
| `verify-rls.sh` | V4 V5 | ✅ |
| `verify-runtime-gates.sh` | V7 V8 V9 | ✅ |
| `migrate:check` | V6 | ✅ |
| `lint-contract-source.mjs` | V8 V10 | ✅（**扩范围**后） |
| `turbo typecheck/lint/test` | V1 V3 | ✅ |

**六道门控全部有 UC 要求，无孤儿门控。**

---

## 四、签核时请重点看这四处

1. **A-4：不引入 ORM，同意吗** —— 这条会决定 F01~F13 全部持久化代码的写法，
   且很难回头。理由是「ORM 把 `SET LOCAL` 的租户语义藏进连接池行为」，
   而本束的全部价值在于让租户上下文**可读、可断言**。
2. **A-5：X-3 的分工（本束认领落点、F16 实现断言）成立吗** ——
   一致性复核明确警告过它会「掉进缝里」。若不认可这个分工，请指定另一个归属。
3. **V5 是本束最重要的验收，请确认它的形状** —— 「绕过应用层过滤后跨租户读 0 行」
   **且**「换成自己的租户能读到自己的行」。只写前半句，一个「一律拒绝」的策略也会全绿。
4. **A-7：本束是在为尚不存在的东西立契约** —— 与另外四束（既成事实固定成契约）性质相反。
   签核对象是「契约定得对不对」，不是「实现做完没有」。

---

# 五、实现记录（2026-07-29）—— 每一道门控的反证，以及一次真正的空转

> 本项目的纪律是「写完门控必须立刻造反证；**全绿本身不是证据，它可能是空转**」。
> 这一轮把五道门控逐个破坏后重跑，其中**一道确实是空转的**——记在下面。

## 逐道反证结果

| 门控 | 破坏方式 | 结果 |
|---|---|---|
| `lint-arch-deps` | 五个坏 fixture（四个方向 + 一个「不在任何层」的文件） | ✅ 全被抓，且各自报出原因 |
| `lint-arch-deps` 反向 | `infrastructure → application`（依赖倒置，**必须放行**） | ✅ 未误伤 |
| `verify-rls` A | 策略改成 `USING (true)` | ✅ 断言 5/6/7 + 夹具自检全红 |
| `verify-rls` B | 去掉 `FORCE ROW LEVEL SECURITY` | ✅ 断言 4 红 |
| `migrate:check` | 去掉唯一约束与 `ON CONFLICT`（seed 不幂等） | ✅ 红，且直接指出 `rls_probe=3 → 6` |
| `verify-runtime-gates` A | ExceptionFilter 改成回 `String(exception)` | ✅ G5 三条红 |
| `verify-runtime-gates` B | Guard 在 principal 为空时放一个匿名主体 | ✅ G1 三条红 |
| `verify-runtime-gates` C | 去掉「生产不可达」判断 | ❌ **仍然全绿——见下** |
| `lint-error-leak` | 四种泄漏写法 | ✅ 全被抓 |
| `lint-error-leak` 反向 | `chat.message` / `frame.stack`（普通对象） | ✅ 未误伤 |
| `lint-contract-source` | 在 `apps/api` 里手写一份 `Organization` | ✅ 抓到（扩范围前**不会有任何东西报警**） |

## ⚠ G7 第一版是空转的，只有反证能看出来

**现象**：把 `HeaderPrincipalResolver` 里的 `NODE_ENV !== "production"` 判断删掉，
G7「测试注入通道在生产不可达」**依然全绿**。

**原因**：G7 用子进程起一个 `NODE_ENV=production` 的服务，跑完 `child.kill("SIGKILL")`。
但子进程是 `pnpm exec tsx …`——**杀掉的是 pnpm 包装进程，真正的 node 服务被遗弃**，
继续占着端口。于是后续每一次运行：

1. 新子进程起不来（EADDRINUSE），当场死掉；
2. 探活请求被**上一轮遗留的、用正确代码编译的孤儿进程**接走；
3. 孤儿返回 401 → 断言通过。

⇒ **这道断言测的是几十分钟前那个进程，不是当前代码。** 它会一直绿下去。

**修法两条，缺一不可**：
- 起之前先探端口，**已被占用就判失败**——不是我们起的东西给出的回答，证明不了任何事；
- `detached: true` 起进程组，`process.kill(-pid)` 整组杀掉，不留孤儿。

修完再跑反证：删掉生产判断 → **G7 红（got 200）**；恢复 → 绿。

**这是本项目第七次「门控看起来在跑其实没在测」。** 前六次分别是：
设计 token、字号档位、丢弃原因枚举、撤回链 SLA、估点、V9 响应式（写了三版）。
形态每次都不同，共同点只有一个：**没人造反证。**

## 顺带确立的一条纪律

**子进程一律 `detached` + 杀进程组。** 经包装器（pnpm / npm / yarn）起的进程，
`kill(pid)` 只杀包装器；被遗弃的服务会安静地占着端口，
把后续所有断言变成「在测一个旧版本」——而这种失败**永远表现为通过**。
