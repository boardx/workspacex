# 22-files · UI 先行原型截图与 sign-off 说明

> ADR-003 关卡材料。**能力域 `files`（文件与摄取），17 feature / 48 点。**
> 路由：`/projects/[projectId]/files`。代码：`apps/web/app/projects/[projectId]/files/page.tsx`
> ＋ `apps/web/components/files/*` ＋ `apps/web/lib/mock/files.ts`（纯 mock，不接后端）。
>
> 截图用真实组件跑 dev server（`next dev`，视口 1360×900，2×）抓的，**不是设计稿**。
> 每屏都可点、可切状态、可切视角。抓图时 **0 条真实控制台报错**（仅被沙箱拦掉的 Google 字体请求，非致命）。
>
> ⚠ **我没有改任何 `ui-signoff.md` / `design-signoff.md` 的 status。** 那是人类的动作。
> 下面「待确认清单」是给 sign-off 用的，不是已确认结论。
>
> ⚠ 本模块整体是**原型确认缺失**（`00-index.md` 第五节）：原型只有四处计数钩子
> （材料准备 9 已入库 / 蓝本项目材料 9 件 / 分组打印素材 4 件 / 对话右栏 材料 12），
> 没有浏览器本体。故这里**每一张屏都是原创设计**，需逐条 sign-off。

---

## 一、截图清单 —— 每张对应哪份 UC 的哪一节、哪些 feature

| 截图 | 屏 / 状态 | UC 节次 | 对应 feature |
|---|---|---|---|
| `uc-22-1-browser-default.png` | 浏览器主屏（三栏：来源树 / 列表 / 预览） | UC-22.1 R3 第 1–4、6–7 步；R8 信息架构 | F31 F32 F44 |
| `uc-22-1-browser-loading.png` | 主屏 · 加载态（skeleton） | UC-0.4 七态 / U1 | F34 |
| `uc-22-1-browser-empty.png` | 主屏 · 空态（引导上传/等物化） | UC-22.1 A5；U2 | F34 |
| `uc-22-1-browser-invalid.png` | 主屏 · 校验失败态（导出 1,240 > 上限 1,000） | UC-22.1 R3 第 8 步 E1；U3 | F33 F34 |
| `uc-22-1-browser-dep-failed.png` | 主屏 · 依赖失败态（对象存储不可用，预览/下载置灰） | UC-22.1 R7；UC-22.2 A4 | F34 |
| `uc-22-1-browser-denied.png` | 主屏 · 无权限态（观察者只见已发布已脱敏） | UC-22.1 R5/R10 🔴；UC-0.3 R8 | F31 F34 |
| `uc-22-1-browser-success.png` | 主屏 · 成功态（导出包已生成） | UC-22.1 R3 第 8 步 | F33 |
| `uc-22-1-browser-observer.png` | 主屏 · 观察者**默认态**（视角投影，非拒绝） | UC-22.1 R5 多角色预览 | F31 |
| `uc-22-2-upload.png` | 上传弹层（白名单预检 / 机密勾选 / 可见性 / 幂等去重） | UC-22.2 R3 第 1–2 步、A3、E1；R8 | F35 F37 |
| `uc-22-2-ingestion-ladder.png` | 摄取进度抽屉（九态 + 每态出口 + 失败三段式） | UC-22.2 R3 第 3–13 步；R7/R8 | F36 F37 F40 |
| `uc-22-2-review-pending.png` | 人工复核屏（REVIEW_PENDING 接受/拒绝） | UC-22.2 R3 第 11 步、R11 | F39 F42 |
| `uc-22-4-versions.png` | 版本列表 + 派生物（原件不覆盖，各带 derived_from） | UC-22.4 R3.a/R3.b | F44 |
| `uc-22-4-delete-impact.png` | 删除确认 + 影响面（六类级联 + 已出域回执 + 二次确认） | UC-22.4 R3 第 8–9 步、R7 | F45 F47 |
| `uc-22-4-trash-compliance.png` | 待删除队列（合规视角：五步 + SLA + legal hold + 部分失败） | UC-22.4 R3.c/d、R5；D-13 | F46 |
| `uc-22-4-trash-denied.png` | 待删除队列（组员视角：无权限投影） | UC-22.4 R5 | F46 |

**UC-22.3（非文件来源物化）没有独立屏**——按 R8「界面就是 UC-22.1 的浏览器」，它的落点是
来源树里 7 类系统节点（问卷/访谈/工作坊/研究/对话/画布/AI 生成）＋ 列表里的 `物化器 · xxx`
上传者标记 ＋ `synthesized` 标记。见 `uc-22-1-browser-default.png` 左树与列表。对应 F41 F42 F43。

### 预览怎么走
顶部「预览控制条」（仅 dev，生产 `NODE_ENV=production` 不渲染）三行：
- **屏** `?screen=`：browser / upload / ingestion / review / versions / delete / trash
- **视角** `?as=`：facilitator / groupLead / member / observer / compliance（预览手段，真实权限在服务端 RLS）
- **七态** `?state=`：default / loading / empty / invalid / dep-failed / denied / success（走共享 `StateShell`）

每个可交互元素都带 `data-testid`（`files-*`、七态保留名 `loading/empty/err-*/denied/dep-failed/saved`），
供后续 verification 锚定。这是与旧原型（零 testid、零异常态）最大的差别。

---

## 二、从 UC 读出来、但界面上**无法自洽**的点（sign-off 必须先裁的）

1. **🔴 来源类型词表：mock 与 phase-00 契约是两套，且对不上（第 7 次同名不同义风险）。**
   `apps/web/lib/mock/files.ts` 的 `SourceType` 是 8 值
   `file / survey / interview / workshop / research / conversation / canvas / generated`；
   而 `packages/contracts/src/artifact.ts` 的 `ArtifactSource` 是 7 值
   `survey / conversation / interview / prototype-run / research-run / upload / ai-generated`。
   **`file↔upload`、`research↔research-run`、`generated↔ai-generated` 是同义不同名；
   `workshop`、`canvas` 在契约里根本没有对应值。** 界面把它们当一等来源画进了左树七类系统节点。
   → 这正是 CLAUDE.md 反复警告的漂移形状（前六次每次都真漂了）。**我没有擅自合并**——
   哪套词表是权威、workshop/canvas 是否进 `ArtifactSource`，是契约裁决，应由 phase-01 契约束的
   `design-signoff.md` ③ 节拍板（另有 agent 正在建 `contracts/`，不应由我这边单方定）。
   **落点建议**：收敛为单一 `ArtifactSource`，mock `import` 之；补 `workshop`/`canvas` 两值或说明其归并到哪。

2. **`IngestState` 也是本地副本，只是值恰好没漂。** mock 自己声明了 10 态枚举，未从契约
   `IngestionStatus` import（值今天完全一致）。字段名此前已按一致性复核 B-6 对齐（`status` 不叫 `state`），
   但**枚举清单本身仍是第二份**——今天一致，改一处即漂。建议同 #1 一起收敛。

3. **观察者是否有「下载权」——界面被迫先替 UC 表了态。** UC-22.1 R10 🔴 明确「观察者是否可把文件带走」
   待人类裁决。当前 `browser-denied.png` 画的是「观察者进来只见已发布已脱敏，含机密/未发布不进结果集」，
   预览区把下载按钮保留但依赖态可置灰。**「只读=能不能带走文件」这条边界我在界面上只能二选一地呈现，
   实际未定**——sign-off 必须先给这个答案，否则 F31/F32 的 RLS 断言写不出。

4. **机密材料的搜索命中片段展示与否——界面留了搜索框，但没有对应态。** 同属 UC-22.1 R10 🔴。
   搜索框 `files-search` 在，但「机密文件命中的正文片段是否显示给非授权者」没有第八种状态可切。
   这条不定，搜索对机密材料要么失效、要么泄露，二者都在界面上不可见地存在。

5. **七类来源的物化时限（五个数值）在界面上是空的。** UC-22.3 R10 🔴：问卷 60s / 对话 5min+60s /
   画布 30s / 研究 5min / 音频 5min 只是 R9 提议值。上传弹层与摄取抽屉里**没有把「多久算物化完成」
   显示出来**，因为没有权威数。AC2「物化是同步契约」的验收断言依赖这五个数。

6. **能否删单个中间版本 / 宽限期内能否撤销——版本屏与删除屏各画了一半，未接上。** UC-22.4 R10 🔴。
   `versions.png` 每个历史版本都给了「下载」但**没给「删除此版本」**（默认取「不能删中间版本」的保守解）；
   `delete-impact.png` 的确认按钮写「逻辑失效 ≤5 分钟」但**没有「撤销删除」入口**（默认取「宽限期由后台
   物理删除计时，前端不提供撤销」）。这两个默认都需要合规+产品确认，否则误删刚需与「已删除」承诺冲突。

---

## 三、我替 UC 做的判断（UC 没写明、我在界面上定了的，逐条看）

1. **来源树用「箭头展开 / 点名筛选」两段式**：R8 只说左树是「来源类型 → agenda_segment」，
   没说展开与选中是否同一动作。我拆开，避免「想筛却误折叠」。默认展开 `文件`/`访谈`，其余折叠。
2. **上传原件 vs 系统产出用文字角标 + 上传者名区分**（列表里 `物化器 · survey`、`Scout · 同行情报`），
   不靠颜色/图标。file-first 第 1 条要求「一眼区分」，但没规定表现形式。
3. **摄取九态做成「进度阶梯 + 每态一句话意义 + 出口」**，不是转圈圈。R7 要求「每态有出口」，
   我把 `STORED` 之后统一标「原件可下载」，失败态用三段式「在哪步失败 / 为什么 / 能做什么」。
4. **删除二次确认 = 填删除原因（≥4 字）才解锁 + legal hold 直接拒**，不是输入文件名。
   R7 只要求「影响面预览 + 二次确认」，确认形式我定为原因门控（`delete-dialog.tsx` `canDelete`）。
5. **已出域内容单列橙条**「已导出为 zip，客户已下载 —— 已出域内容无法回收」（`delete-impact.png`），
   对应 UC-22.4 E2「回执须如实说明无法回收」。UC 未规定它在删除屏的位置，我放在影响面顶部。
6. **待删除队列做成合规专属屏 + 其余角色走无权限投影**（`trash-denied.png`），
   而不是对非合规角色隐藏入口。R5 只说「合规角色」，我选择「入口在、点开是可理解的拒绝」以符合 UC-0.3 R8。
7. **`.svg` / 含脚本类型在上传预检里显式标红「被拒（见 UC-22.2 R10 待确认）」**，
   而不是静默放行或静默拦。把「待人类裁决的白名单」做成界面上看得见的一条，正是 ADR-003 的用意。
8. **完整性校验失败（SHA-256 不符）在列表行内红标 `完整性校验失败`**（见 `a-007 客户品牌手册`），
   UC 只在 R 里提到完整性校验，未规定它在列表的呈现，我做成行内 badge。

---

## 四、R8 线索之间互相矛盾、我怎么处理的

- **「观察者只读」vs「客户交付=把文件带走」**（UC-22.1 R5 要求可见性沿用 ACL、R10 又把下载权挂起）：
  我在 `denied` 态按「不可带走」呈现，但**保留下载按钮结构**，等 sign-off 给答案后只改一处 gate。
  没有硬编码「观察者不能下载」到组件逻辑里。
- **「物化是同步契约」（UC-22.3）vs「音频先入库、转录后到」（UC-22.4 A4 派生物可 `generating`）**：
  看似冲突。我的处理：原件入库是同步的（STORED 即可见可下载），**派生物允许异步**并在版本屏标
  `generating`（见 mock `a-021` 访谈 09 的 transcript `generating:true`）。同步契约约束的是原件可见性，不是派生物。

---

## 五、**没做 / 做不到**的部分（如实说，不糊）

1. **全部是 mock，零后端**：搜索框不真过滤、下载/导出只弹乐观 toast、上传不真跑摄取、
   删除不真删。九态是**静态陈列**九个例子，不是真的状态机流转。
2. **预览器是占位**：`file-preview` 右栏给的是 PDF/图片/音频等**类型说明 + 骨架占位**，
   没有真的渲染 PDF 分页 / 音频波形 / CSV 表格。五类预览器（F32）的真实渲染未做。
3. **搜索/筛选是展示壳**：六项筛选按钮可点亮、可清空、可从 URL 还原，但**不真正过滤列表**
   （真过滤在服务端 RLS，见组件注释）。FTS 命中高亮未做。
4. **批量 zip 的 round-trip（目录≡树）无法在 mock 演示**（F33 的验收面在后端）。
5. **prompt injection 防线（F38）、synthesized 的 evidencePolicy 服务端强制（F42）** 是后端不变量，
   界面只能标 `synthesized` 角标，防线本身不可见、未做。
6. **物化时限、白名单五个上限、机密搜索片段** —— 见第二节，界面上是**空缺或占位**，因为没有权威数值。
7. **响应式**：只抓了 1360 宽桌面图。375/768 档没抓图（`e2e/responsive.spec.ts` 有断言，但本次未跑该屏）。
8. **树视图（`?view=tree` 内切换）** 只给了「与列表联动」的提示占位，没做独立的树形铺开渲染。

---

## 六、建议 sign-off 时重点核对的三处

1. **来源类型词表（第二节 #1）**——这是会真漂的契约分歧，且牵动 UC-22.3 七类物化清单、
   左树七节点、上游 5 个模块的物化路径。**先定词表，再让 requirement-author 锚 testid。**
2. **观察者下载权 + 机密搜索片段（第二节 #3、#4，UC-22.1 R10 两条 🔴）**——直接定义客户交付边界与
   合规边界，界面已被迫先替它表了一半态。这条不定，F31/F32 的 RLS 验收断言写不出。
3. **删除的两条默认（第二节 #6，UC-22.4 R10 🔴）**——「不能删中间版本」「不提供撤销」是我取的保守默认，
   与误删刚需 / 对受访者「已删除」承诺直接冲突，必须合规+产品共同拍板。
