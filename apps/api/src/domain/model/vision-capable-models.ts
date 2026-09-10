/**
 * issue #3355 —— 「哪个模型能看图」的**唯一权威声明**。
 *
 * ## 为什么必须只有一处
 *
 * 在 #3355 之前，这个事实住在两个互不相干的 env 变量里，回答同一个问题、默认值不同、
 * 名字只差一个 S：
 *
 *   · `KERNEL_MODEL_VISION_IDS`（复数）→ `model-vision-wire.ts`，默认 `qwen-vl-max,qwen-vl-plus`，
 *     管 **agent run 的多模态请求体**；
 *   · `KERNEL_VISION_MODEL_ID`（单数）→ `bailian-vision-extractor.ts`，默认 `qwen-vl-max`，
 *     管**聊天附件的视觉抽取 worker**。
 *
 * 两个都没在任何部署 env 里配过，于是两边跑的都是各自的手写默认值——而**两份默认值都漏了
 * 部署实际在用的内核模型 `qwen3.8-max`**。表现是：用户上传的图从来没进过模型输入，界面看
 * 起来和「模型不支持视觉」一模一样（#3346 / PR #3350）。这是本仓「同一事实声明在两处」的
 * 第十二例。
 *
 * 收敛方式（人类 2026-09-10 裁决，方案 A）：清单进代码、**只写一次**，两个 env 变量降级为
 * 可选覆盖。人类因此不需要改 deploy.env、不需要为此单独重启。
 * `tests/model/vision-model-single-source.test.ts` 机械门控：再出现第二处声明即红。
 *
 * ## 清单来源：2026-09-10 私有 MaaS 端点实测，不是推断
 *
 * 判据是「给一张 32×32 棋盘图，模型是否准确描述出图的内容」——不是「模型名里有没有 -vl」。
 * 下面每一个 id 都实测通过。
 *
 * 同批实测 **403 未开通**的：`qwen-vl-max-latest`、`qwen2.5-vl-72b-instruct`、
 * `qwen2.5-vl-7b-instruct`。⚠ 403 是**账号没开通**，**不是**「不支持视觉」——不要据此
 * 断言它们看不了图，也不要把这三个名字写成反例。换账号/换区域后它们可能就能用了，届时
 * 用 `apps/api/scripts/probe-bailian-vision.mjs` 重测再决定要不要加进来。
 *
 * ## 明确不做的两件事
 *
 * · **不按 id 模式猜**（比如「含 `-vl` 就是视觉模型」）：`qwen3.8-max` 正好猜不中，
 *   而它恰恰是这次踩的坑本身——猜出来的清单会以「一切正常」的样子静默漏掉真正在用的模型。
 * · **不做启动期能力探测**：那才是真正消灭手写清单的办法（模型自己是事实源），但引入启动
 *   期网络调用与失败语义。人类已定不塞进本次收敛，另记为后续可选项。
 */

/**
 * 视觉可用模型清单（**顺序有语义**，见 `DEFAULT_VISION_EXTRACTOR_MODEL_ID`）。
 *
 * 第一项固定为 `qwen-vl-max`：#3355 之前抽取器的默认模型就是它，收敛必须**逐字节保持**
 * 抽取器实际选用的模型不变（`vision-model-single-source.test.ts` 钉住这一条）。
 */
export const VISION_CAPABLE_MODEL_IDS = [
  "qwen-vl-max",
  "qwen-vl-plus",
  "qwen-vl-ocr",
  "qwen3-vl-plus",
  "qwen3.8-max",
] as const;

/**
 * 附件视觉抽取 worker 的默认模型 = 清单第一项。
 *
 * 这里**故意不写第二次字面量**：写成 `"qwen-vl-max"` 就又是一处独立声明，正是本文件要消灭
 * 的形状。要换默认模型，改清单顺序。
 */
export const DEFAULT_VISION_EXTRACTOR_MODEL_ID: string = VISION_CAPABLE_MODEL_IDS[0];

/** 覆盖 env 设了却解析不出任何 id 时抛这个——静默回落到默认值等于「设了没反应」。 */
export class VisionModelOverrideError extends Error {
  constructor(readonly envName: string, readonly rawValue: string) {
    super(
      `${envName} 设置了但解析不出任何模型 id（原值去除空白后为空）。` +
      `不静默回落到默认清单——设了要么生效、要么报错，不许「点了没反应」。` +
      `不想覆盖就把 ${envName} 整个删掉。`,
    );
    this.name = "VisionModelOverrideError";
  }
}

function parseIdList(raw: string): readonly string[] {
  return raw.split(",").map((v) => v.trim()).filter((v) => v !== "");
}

/**
 * 视觉可用模型集合 = 默认清单，或 `KERNEL_MODEL_VISION_IDS`（可选覆盖，逗号分隔）。
 *
 * 覆盖是**整体替换**而不是追加：运维要能表达「这个部署只有 X 能看图」，追加语义下这句话
 * 说不出来。env 未设置 ⇒ 用权威清单；设置了但为空/全空白 ⇒ 抛 `VisionModelOverrideError`。
 */
export function resolveVisionCapableModelIds(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  const raw = env.KERNEL_MODEL_VISION_IDS;
  if (raw === undefined) return new Set<string>(VISION_CAPABLE_MODEL_IDS);
  const ids = parseIdList(raw);
  if (ids.length === 0) throw new VisionModelOverrideError("KERNEL_MODEL_VISION_IDS", raw);
  return new Set(ids);
}

/**
 * 抽取器模型 id = 默认（清单第一项），或 `KERNEL_VISION_MODEL_ID`（**deprecated** 可选覆盖）。
 *
 * ⚠ deprecated：单数变量与复数变量回答同一个问题，是 #3355 的病灶本身。保留它只为不砸掉
 * 已经在用它的部署——**设了仍然真生效**（不是「兼容但忽略」那种假兼容），只是会打一行
 * 弃用警告。新部署不要再用它；要改清单请改本文件。
 */
export function resolveVisionExtractorModelId(
  env: NodeJS.ProcessEnv,
  warn: (message: string) => void = (m) => console.warn(m),
): string {
  const raw = env.KERNEL_VISION_MODEL_ID;
  if (raw === undefined) return DEFAULT_VISION_EXTRACTOR_MODEL_ID;
  const [first] = parseIdList(raw);
  if (first === undefined) throw new VisionModelOverrideError("KERNEL_VISION_MODEL_ID", raw);
  warn(
    `[deprecated] KERNEL_VISION_MODEL_ID 已弃用（#3355：它与 KERNEL_MODEL_VISION_IDS 回答同一个` +
    `问题）。本次仍按它生效：modelId=${first}。权威清单在 domain/model/vision-capable-models.ts。`,
  );
  return first;
}
