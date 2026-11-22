/** Deterministic upstream responses for the isolated AIDT browser lane. */
export const problemInitial = "我们想了解大学生在校园食堂买奶茶的体验。";
export const problemRevision = "午休时间有限的学生在校园食堂是怎样决定是否买奶茶新品的？";
export const problemDiscussion = "研究价值是了解买奶茶是否占用午休时间。来源是亲自观察：两位同学看菜单后离开。离开的原因仍待核实。本组选择菜单选择方向。重写为：" + problemRevision;
export function loopbackAidtProblemReply(userText: string): string | null {
  if (userText === "合成访谈验收：午休时，她在食堂饮品窗口的菜单前逐项比较两种口味，随后选择熟悉的饮品。请整理本次发现。") {
    return "### 人物发现卡（草稿）\n一句发现：逐项比较两种口味\n具体情况：午休时，她在食堂饮品窗口的菜单前逐项比较两种口味，随后选择熟悉的饮品。\n受访者原话：我先看口味";
  }
  if (userText === problemInitial) return "你们在哪里观察到这个情况？\n\n### 原始命题\n" + problemInitial;
  if (userText === problemDiscussion) return [
    "### 原始命题", problemInitial, "### 选题价值", "了解买奶茶是否占用午休时间",
    "### 来源类型", "亲自观察", "### 来源说明", "两位同学看菜单后离开",
    "### 已知", "两位同学离开", "### 待验证", "离开的原因仍待核实",
    "### 学生重写命题", problemRevision, "### 研究范围", "菜单选择",
  ].join("\n");
  return null;
}
