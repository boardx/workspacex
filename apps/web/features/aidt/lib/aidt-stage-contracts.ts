/** Teaching task contracts, not runtime Skill registrations or completion gates. */
export type AidtContractStageId = 1 | 2 | 3 | 4 | 5 | 6;
export type AidtStageContractItem = Readonly<{ title: string; detail: string }>;
export type AidtStageContractDefinition = Readonly<{
  title: string;
  suggestedSkill: string;
  inputs: readonly AidtStageContractItem[];
  feedback: readonly string[];
  deliverables: readonly AidtStageContractItem[];
  boundary: string;
}>;

export const AIDT_STAGE_CONTRACTS: Readonly<Record<AidtContractStageId, AidtStageContractDefinition>> = {
  1: {
    title: "从原始命题到学生重写的研究主题",
    suggestedSkill: "dt-frame-problem",
    inputs: [
      { title: "原始命题", detail: "先保留学生最初关心的命题与自己的表达，不先替学生写答案。" },
      { title: "选题理由与问题来源", detail: "提交命题后先回答为什么值得研究、来自亲自观察／听到抱怨／猜测；说明具体情况与尚不确定之处，可以如实写暂不清楚。" },
      { title: "学生的拆解", detail: "拆出涉及的人、发生情境、现象与疑问，区分已知信息和自己的假设。" },
      { title: "学生的回答与选择", detail: "学生回应追问，比较可研究的方向，说明选择或保留不同意见的理由。" },
    ],
    feedback: ["先等待学生说明选题价值与来源，再澄清含义、提示遗漏并反馈可选聚焦方向；由学生判断，再重写主题。"],
    deliverables: [
      { title: "方向反馈与选择依据", detail: "保留原始命题、拆解、反馈方向及学生取舍的联系。" },
      { title: "学生重写的研究主题", detail: "写清准备研究谁、什么情境中的什么现象，作为第2步的主题输入。" },
      { title: "问题反思记录", detail: "由学生核对理由、观察／抱怨／猜测的来源状态及未解问题，与原始和重写命题关联，带入访谈检验。" },
    ],
    boundary: "确认研究方向与选题依据，不等于事实已验证；猜测可以成为研究起点。本步交付研究主题；HMW留到第3步，不提前定稿。",
  },
  2: {
    title: "从研究主题到访谈清单与受访者发现卡",
    suggestedSkill: "dt-empathize-users",
    inputs: [
      { title: "承接的研究主题与问题反思", detail: "引用第1步重写主题与选题理由、观察／抱怨／猜测来源，了解人群、情境，并准备检验最初判断。" },
      { title: "学生先写的访谈初稿", detail: "先提出自己的访谈问题，再依据反馈修改成开放、具体且不诱导的问题。" },
      { title: "真实采集与学生先整理的发现", detail: "保留真实访谈、观察的原始材料与来源；学生先指出值得注意的内容，再请Agent辅助整理。" },
    ],
    feedback: ["对访谈初稿给定性反馈与追问建议；实际采集后，帮助区分原话、概括与学生解释，不代造访谈。"],
    deliverables: [
      { title: "访谈问题清单PDF与定性反馈", detail: "保留学生初稿、修改后的问题清单与反馈依据。" },
      { title: "每位受访者的发现卡", detail: "包含有来源的照片、headline和具体情况；直接引文与概括分开标注，缺少照片或原话时如实留缺口。" },
    ],
    boundary: "模拟访谈不是真实用户材料；发现卡不能补写受访者没有说过的话。",
  },
  3: {
    title: "从发现卡到用户画像与HMW",
    suggestedSkill: "dt-synthesize-hmw",
    inputs: [
      { title: "发现卡与原始来源", detail: "比较受访者的共同点、差异和反例，让归纳能够回到具体材料。" },
      { title: "意外发现或暂无", detail: "画像前先对照原先想法，记录意外、矛盾或例外并关联发现卡与访谈位置；也可以明确填写暂无。" },
      { title: "学生的用户画像初稿", detail: "学生先综合人群、行为、需要与情境，标出依据和仍待验证的特征。" },
      { title: "教师引导后的HMW草稿", detail: "经过教师引导，由学生写出“我们如何能够……”并说明它与画像、发现的联系；尚无引导记录时保留待补。" },
    ],
    feedback: ["先核对学生记录的意外发现与材料；暂无也可继续，不编造惊喜。再辅助综合与检查证据，学生结合教师引导修改画像和HMW。"],
    deliverables: [
      { title: "意外发现记录", detail: "保留原先想法、差异、材料关联与解释；可记录暂无，引用不齐则标待补充，不把例外自动推广到所有人。" },
      { title: "用户画像", detail: "说明材料支持的特征、需要与情境，并保留差异和未知项。" },
      { title: "选定HMW", detail: "用可探索的问题表达与画像关联的机会，交给第4步开展创意。" },
    ],
    boundary: "暂无意外发现不扣分、不强制补访，不抹去矛盾与少数例外。不强制另交独立的用户问题卡。年龄、兴趣、生活方式未知时留空或标未知，不补编。",
  },
  4: {
    title: "从选定HMW到不同点子与原型方向",
    suggestedSkill: "dt-diverge-ideas",
    inputs: [
      { title: "选定的HMW", detail: "明确这轮创意针对哪个问题，保留形成时的问题依据。" },
      { title: "学生先做的头脑风暴", detail: "先各自提出想法，再由小组讨论；保留初始点子、不同意见和比较标准。" },
      { title: "学生的点子分类与理由", detail: "整理后按最容易实现、最具突破性、最有趣分类；允许多标签、暂未分类和类别为空，保留不同成员意见。" },
      { title: "学生选择的点子与理由", detail: "比较不同方向，由学生决定哪个点子进入原型，理由归属对应点子。" },
    ],
    feedback: ["鼓励先发散再收敛，可尝试类比、反转、组合等方法；Agent提供方法或补充选项，不替学生选题或投票。"],
    deliverables: [
      { title: "小组确认的点子分类视图", detail: "分类引用原点子并保留学生理由，与投票结果分别记录；AI不替学生归类确认。" },
      { title: "至少3个不同点子描述单PDF", detail: "每个点子包含名称、图和2–3句核心说明，体现不同方向；图或说明未完成时保留交付缺口。" },
      { title: "本轮进入原型的点子", detail: "保留所选描述单及选择理由；具体票规待定，不把本页拟选当作已完成投票。" },
    ],
    // Refs #6908 / #6956: saving a draft is separate from confirming the stage.
    boundary: "草稿随时可保存；确认本阶段并进入原型须至少3份不同的完整图文描述单，经学生逐份审阅并确认分类。三个类别不是每类一份的配额，跨类点子仍只算一个，不以容易实现淘汰突破性方向；投票方式与票数规则尚待确定。",
  },
  5: {
    title: "从点子描述单到可比较的静态粗原型",
    suggestedSkill: "dt-prototype-concept",
    inputs: [
      { title: "所选点子描述单与历史", detail: "承接名称、图、说明及选择理由，保留此前描述和修改关系。" },
      { title: "本轮最想验证的问题", detail: "生成前由学生回答最想知道什么，记录先前看法及依据，并说明原型能观察什么、不能证明什么。" },
      { title: "原型的表达要求", detail: "说明形式、用户情境、与用户接触的方式，以及需要表达的内容和预备验证的问题。" },
      { title: "可选参考与修改反馈", detail: "按需要提供参考图或材料；学生先提出反馈与修改意图，缺少参考不补造。" },
    ],
    feedback: ["先等待学生明确并确认验证问题，再比较回应同一问题的静态方案，按学生选择和反馈修改；方案数量不固定为3个。"],
    deliverables: [
      { title: "与版本绑定的验证问题卡", detail: "保留原问题、先前看法与依据、观察方式和验证边界，随确认原型带入第6步；后续修订不覆盖原始预期。" },
      { title: "可比较的静态粗原型", detail: "使用静态图、简单界面、服务流程或故事板表达概念，供学生比较与修改。" },
      { title: "学生确认的原型版本", detail: "学生选定并确认用于测试的版本，保留实际原型引用及修改依据，交给第6步。" },
    ],
    boundary: "验证问题未明确可存草稿，不启动生成。静态图的理解或口头意向反馈不能证明实际时间投入或付费。本步不要求视频或生产App；文字要求不等于原型已制作，确认也不代表效果已经验证。",
  },
  6: {
    title: "从真实测试到认识变化与下一轮行动",
    suggestedSkill: "dt-test-iterate",
    inputs: [
      { title: "被测原型与学生的测试问题", detail: "带入第5步同一验证问题、先前看法与被测版本；学生先拟测试任务，说明如何观察原问题。" },
      { title: "真实采集记录与来源", detail: "开展真实测试，保留观察、反馈、照片或录音等材料，区分记录和解释。" },
      { title: "对原问题的认识变化", detail: "学生先对照测试前后认识并关联材料；允许暂未改变或证据不足，记录仍不确定之处。" },
      { title: "学生先反思、采纳与修改", detail: "先说明哪些反馈被采纳、暂不采纳及其理由，再提出修改内容和下一次需要验证的问题。" },
      { title: "优先返回步骤与下一轮行动", detail: "由学生选择1理解问题、2共情用户、3综合定义、4创意发散、5原型制作，说明理由及行动；未决定时可保存并请求教师支持。" },
    ],
    feedback: ["Agent辅助检查测试问题、整理反馈与反例，提示可返回的方向；先等待学生说明认识变化与选择，不自动判定成功或替小组路由。"],
    deliverables: [
      { title: "测试问题清单", detail: "保留测试任务、问题及对应被测版本。" },
      { title: "反馈与学生反思", detail: "关联真实采集材料，说明观察、解释、采纳与未采纳的理由。" },
      { title: "认识变化与下一轮行动记录", detail: "保留原问题、测试前后认识、证据与未解问题，以及返回步骤、理由和具体行动；尚未决定也如实记录。" },
      { title: "继续修改原型时的新版本 · 待复测", detail: "回第5步继续原型时保留前后引用与修改依据；新版本默认待复测，不能因已修改就认定改进有效。" },
    ],
    boundary: "回第1至4步或尚未决定时，不强制先生成新版，仍保留旧原型与本轮学习。未真实测试就标尚未验证；认识改变、完成修改或归档均不代表测试成功，返回不清空历史。",
  },
};

export function getAidtStageContract(stageNumber: number): AidtStageContractDefinition | null {
  if (!Number.isInteger(stageNumber) || stageNumber < 1 || stageNumber > 6) return null;
  return AIDT_STAGE_CONTRACTS[stageNumber as AidtContractStageId];
}
