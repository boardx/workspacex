/**
 * 五种筛选动作 —— **封闭枚举，唯一事实源**（UC-0.2 R3 第 3 步 / F11）
 *
 * ## 为什么这份要单独存在
 *
 * 它原本声明在**两处**：契约的 `context-pack.ts` 里是
 * `recall / downweight / exclude / paired / lead`，
 * 而 `apps/web/lib/mock/brain.ts` 里是
 * `recall / downweight / exclude / pair / clue` —— **后两个键对不上**。
 * 两份都自洽：界面按自己那份渲染，后端按自己那份留痕，谁都不会报错，
 * 直到有人想把界面上的「成对」和 `items[].retrievalReasons` 里的 `paired` 对起来。
 *
 * 这是本项目第 N 次「同一事实声明在两处」（设计 token / 字号档位 / 丢弃原因 /
 * 撤回链 SLA / 估点）。修法与 `omission-reason.ts` 完全一致：**键 + 展示名 + 解释**
 * 收敛到这一份，契约的 `FilterAction` zod enum 从这里的键构造，前端从这里取展示名。
 *
 * ## `tracedIn` 不是装饰
 *
 * 五种动作的留痕位置**不一样**，而这件事此前没有任何地方写着（见
 * `context-pack.ts` 的 `KNOWN_CONTRACT_GAPS.G1`）：
 * 四种动作的结果是「这条进了 items[]」，所以痕迹在 `items[].retrievalReasons`；
 * 而 `exclude` 的结果是「这条**没**进 items[]」——一条被排除的候选**不存在**
 * 于 `items[]`，它的痕迹只能在 `omissions[]`。
 *
 * 把这件事写成字段，是为了让「五种动作都留痕」这句验收可以被机械断言，
 * 而不是被实现成「四种能断言、第五种默默做不到」。
 */

/** 一种筛选动作的痕迹落在 Pack 的哪一段。见文件头。 */
export type FilterActionTraceSite = "items" | "omissions";

export const FILTER_ACTIONS = {
  recall: {
    label: "召回",
    explain: "只取「生效」「待复核」两态；待复核仍进候选，但不参与定题强度计算",
    tracedIn: "items",
  },
  downweight: {
    label: "降权",
    explain: "适用范围不匹配（如「波兰不在本项目范围」）→ 标「跨范围引用」后降权保留——降权不等于排除",
    tracedIn: "items",
  },
  exclude: {
    label: "排除",
    /**
     * ⚠ 被排除的候选**不在 `items[]` 里**，所以它的痕迹只能落在 `omissions[]`。
     * 「已撤销条目永久排除，其反例文本作为『教训』另行召回」——后半句是另一条候选，
     * 走的是 `recall`，不要把它当成 `exclude` 的痕迹。
     */
    explain: "已撤销条目永久排除；其反例文本作为「教训」另行召回（那是另一条候选）",
    tracedIn: "omissions",
  },
  paired: {
    label: "成对",
    explain: "冲突事实的两条同时注入，引擎不替人选——两侧都标记，只标一侧会让这一对看起来像「正文 + 反驳」",
    tracedIn: "items",
  },
  lead: {
    label: "线索",
    explain: "图谱路径只给固定加成，不单独决定结果",
    tracedIn: "items",
  },
} as const satisfies Record<string, { label: string; explain: string; tracedIn: FilterActionTraceSite }>;

export type FilterActionKey = keyof typeof FILTER_ACTIONS;

export const FILTER_ACTION_KEYS = Object.keys(FILTER_ACTIONS) as FilterActionKey[];

/** 痕迹落在 `items[].retrievalReasons` 的那些动作 */
export const ITEM_TRACED_ACTIONS: FilterActionKey[] = FILTER_ACTION_KEYS.filter(
  (k) => FILTER_ACTIONS[k].tracedIn === "items",
);

/** 痕迹只能落在 `omissions[]` 的那些动作 —— 这一栏非空本身就是 G1 缺口的证据 */
export const OMISSION_TRACED_ACTIONS: FilterActionKey[] = FILTER_ACTION_KEYS.filter(
  (k) => FILTER_ACTIONS[k].tracedIn === "omissions",
);

export function filterActionLabel(a: FilterActionKey): string {
  return FILTER_ACTIONS[a].label;
}

export function filterActionExplain(a: FilterActionKey): string {
  return FILTER_ACTIONS[a].explain;
}

export function filterActionTracedIn(a: FilterActionKey): FilterActionTraceSite {
  return FILTER_ACTIONS[a].tracedIn;
}
