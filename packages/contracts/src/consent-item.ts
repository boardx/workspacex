/**
 * 同意项 —— **全仓唯一事实源**（裁决 X-7 / XC-18，2026-08-05，issue #533）
 *
 * ## 这份枚举答的是什么问题
 *
 * 「一个人对**这场对话被怎么处理**分别授了哪几项权」。四项各自管一件不同的事，
 * 且**下游出口互不相同**，所以它们不能合并成一个布尔「同意/不同意」：
 *
 * · `record`      —— 采不采音。不给 ⇒ 这一路根本不建轨。
 * · `transcript`  —— 采到的音转不转成文字稿。不给 ⇒ 有音无稿。
 * · `ai_analysis` —— 文字稿进不进 AI 归纳。不给 ⇒ 只能原文引述，不参与任何自动归纳。
 * · `attribution` —— 引述时能不能写出这个人是谁。不给 ⇒ 一律匿名化成职务描述。
 *
 * ## 为什么它在这里，而不是在 `interview.ts` 或 `recording.ts`
 *
 * 2026-08-05 之前它在**两处**分别声明：`interview.ConsentKey` 四位、
 * `recording.RecordingConsentItem` 三项（少 `attribution`）。两处**前三项逐字相同**，
 * 谁改了名字另一处都不会有任何东西报警。
 *
 * coord-main 经人类授权裁决（#533）：**这是漏了，不是两套设计**。
 * 判据是形状——真有两套语义时，差异会体现在**语义**上（某一侧需要另一侧没有的项），
 * 而实际是**严格子集、逐字相同的三项 + 少一项**。且 `attribution` 在录音场景同样成立：
 * 工作坊与聊天线程录音一样会产出可引述的片段，一样需要知道在场者同不同意被署名引述。
 * 少这一项不是「简化」，是**这个系统当时无法记录工作坊参与者是否同意被引述**。
 *
 * ⇒ 收敛为本文件一处；`interview.ConsentKey` 与 `recording.RecordingConsentItem`
 *   **都是本枚举的别名**（同一个对象，不是内容相同的两份声明）。
 *
 * ## 谁在守它
 *
 * · `apps/api/tests/rec/consent-items-single-source.test.ts`
 *   ① 同一性（`toBe`）——两束指向同一个对象；② 扫描 `src/`：除本文件外没有第二处把项名列成表。
 * · `apps/api/tests/rec/recording-consent-single-source.test.ts`
 *   迁移 `recording_consent_cells` 的 `CHECK` 与 `.options` 的逐字对账；
 *   以及「门禁读枚举基数、不写字面量」。
 * · **tsc**：`ConsentBits` 的 shape 与 `CONSENT_ITEM_COPY` 的键都由本元组机械生成/约束，
 *   多一个键或少一个键编译不过。
 *
 * ## 改动纪律
 *
 * ⚠ **成员数不是封闭性**（`contract-design.md` 硬规则 7）：要守的性质是「这是一份**封闭**枚举，
 *   不许在别处临时冒出第五种同意」，不是「永远四项」。增删成员需要一次**人类裁决**，
 *   并在此处逐字记下裁决号——像下面这条一样。人类可推翻本裁决并回退到三项。
 *
 * ⚠ 增删成员会同时改变 `recording` 的开录门禁基数（`blocksStart` 读的是 `.options.length`）
 *   和 `recording_consent_cells` 的 `CHECK`。**不要手改那两处的数字/取值**，改本元组，
 *   让上面那些对账断言驱动。
 */
import { z } from "zod";

/**
 * 四项的**权威顺序**。顺序本身是契约的一部分：同意书按此顺序逐条呈现（`ConsentItemCopy`），
 * `diffConsentBits` 的输出顺序也由它决定。
 */
export const CONSENT_ITEMS = ["record", "transcript", "ai_analysis", "attribution"] as const;

/**
 * 封闭枚举形态。`interview.ConsentKey` 与 `recording.RecordingConsentItem` 都是它。
 *
 * ⚠ **名字里的 `Key` 不是修饰，是防撞**：`apps/web/lib/mock/entry.ts` 已有一个
 *   `interface ConsentItem`（同意书条目的**界面视图模型**：label / desc / defaultChecked），
 *   与本枚举是两件事。若本枚举叫 `ConsentItem`，`lint-contract-source.mjs` 会判
 *   「web 私自重定义契约类型」——实测会红（见 PR #585 正文）。
 *   叫 `ConsentItemKey` 既避开撞名，也说清了它是**键**而不是条目本身。
 */
export const ConsentItemKey = z.enum(CONSENT_ITEMS);

export type ConsentItemValue = (typeof CONSENT_ITEMS)[number];

/**
 * 逐项布尔。⚠ **四位全 false 是合法完整结果**，不是失败态——受访者可以什么都不同意，
 * 访谈照常进行（只是采集/转写/分析/署名全部关掉）。
 *
 * shape 由 `CONSENT_ITEMS` 机械生成而不是手写四个字段：手写的话它就是这份事实的第 N 份副本，
 * 而对象字面量的键逃得过「项名列成表」的文本扫描——这里改用 tsc 兜底，
 * `Record<ConsentItemValue, …>` 的映射类型保证键集恰好等于枚举。
 */
export const ConsentBits = z.object(
  Object.fromEntries(CONSENT_ITEMS.map((k) => [k, z.boolean()])) as {
    [K in ConsentItemValue]: z.ZodBoolean;
  },
).strict();
