/**
 * Issue #4290（第 8 轮）—— 本人明确改口时，新决定取代本人的旧决定。
 *
 * 场景：同一个人在个人会话 A 说「我决定关注 211 高校」，之后在会话 B 说「改成关注 985 高校吧」。F16
 * （`conflict.ts`）只认「同一组实体、同一指标、不同数值」，211 → 985 的 about 实体不同，不出冲突卡；
 * 于是两条决定都活着，会话 C 的模型同时拿到互相矛盾的两条。
 *
 * 人类决定（2026-09-26，usecases.md #4290 条目 5）：
 *   1. **只有明确改口才算**：新决定带改口信号，且与**同一作者**一条仍生效的旧决定主题相同。
 *      并列的补充（「也关注 985」）两条都保留。
 *   2. **高把握自动、低把握弹卡**（2026-09-26 第二次决定：三轮独立评审找到的误取代几乎都出在 frame_only 这一档）：
 *      - 明说（explicit）与对齐的同类（same_kind），且整句干净（第 6 条）⇒ **自动取代、可撤销**：旧决定转 superseded
 *        （原因 `decision_changed`），不再召回；会话里显示「已用〈新〉取代〈旧〉 · 撤销」，撤销后旧决定恢复；
 *      - 只有框架动词相同（frame_only），或整句说不准 ⇒ **从不自动**：会话里弹一张卡「用〈新〉取代〈旧〉？」——复用 F16 的冲突卡表与出口
 *        （`kg_conflict_prompts.kind = possible_change`）：[取代] = F16 keep_new，[两条都保留] = 只关卡。卡开着的时候
 *        两条都保持原状态（不像 F16 那样转 contested）、都照常召回。
 *
 * 本文件是纯函数：只回答「这条新决定是不是在改掉那条旧决定、把握多大」（`planSupersedes`：自动取代的对 + 要弹卡问的对）。
 * 候选怎么取（这条消息刚抽出的决定；本会话里同一作者的活决定，个人线程里再加所有者本人个人空间的活决定）、落不落表
 * （复核、改状态、留撤销快照、开卡）都在数据库函数 `kg_supersede_candidates` / `kg_apply_supersedes`（迁移 20260926140000）。
 *
 * ## 判定规则（确定、可复现，不调模型——同 `conflict.ts` / `decision-claim.ts` 的理由）
 *
 * 文本先归一：NFKC、小写、去掉全部空白。**核心是分句规则**：改口词只对它所在的那个分句说话，新框架只从改口分句里读，
 * 别的分句里的框架永远不和另一处的改口词配对。没有「哪些词不算」的词表——分不清的，一律不取代。
 *
 * 一对（新决定 N，旧决定 O）进入候选，当且仅当**全部**成立：
 *   1. 两条都是 decision；id 不同；
 *   2. **同一作者**：两边作者都已知且相等（作者未知 ⇒ 不取代；不同作者之间只走 F16）；
 *   3. N 整句不落在任何一条否决里：并列补充（`ADDITIVE`：也 / 还要 / 另外 / 同时 / 加上……）；否定的改口（「不改成」
 *      「没换成」「别改用」「不再改成」……）；问句（**句中任何位置**的问号——「改成用React？不行，还是用Vue」——、疑问词、
 *      句末「吗 / 呢 / 么」）；假设（「如果 / 要是……」开头）；
 *      附加问句（`TAG_QUESTION`：「，对吧」「，是吧」「，是不是」「，好吗」…… 整个分句，或句末的「对吧 / 是吧」）；
 *      且 N 至少有一个**改口分句**（`changeClauses`）：
 *      - **分句**：按 ，,；;。!！?？、 与连接词（但 / 但是 / 不过 / 然后 / 可是 / 只是 / 而是 / 因为 / 由于 / 毕竟 / 所以）切开，
 *        去掉决定动词；因为 / 由于 / 毕竟 三个一样剥掉，后面那个分句记成**原因分句**（剥掉后才看它是不是评判：「毕竟我反对」）；
 *      - **改口分句**只有下面五种句式，改口标记都**直接**支配同一分句里紧跟的框架动词或对象：
 *        a. 改成 / 改为 / 换成 / 换为 / 转为 + 紧跟的框架动词 + 对象，或直接跟对象（新框架 = 后面那段；「改成周五」动词为空）；
 *           改用 / 换用 + 对象（读作「用 + 对象」）。改口词前面剥掉虚词（我 / 那就 / 还是……）后剩下的是**主语**；
 *        b. 把 + 旧 + 换成 / 改成…：「把」和改口词之间是**点名的旧对象**（它同时是主语）；
 *        c. 不再 + 框架动词 + 旧：点名旧对象，没有新框架；
 *        d. 不 + 框架动词 + 旧 + 了（「了」在分句末）：点名旧对象，没有新框架。「不用多想了」「不做过多讨论了」句式上与
 *           「不用 Vue 了」相同，只点名「多想」「过多讨论」——它们不是任何旧决定的对象，所以不取代任何东西；
 *        e. 旧 + 算了（整个分句）：后面紧跟另一个改口分句或句子到此结束 ⇒ 点名旧对象。唯一跨分句的窄口子：「（旧）算了，
 *           还是 + 框架动词 + 对象」——只有紧跟在「算了」分句后、以「还是」开头的那一个分句可以提供新框架；
 *      - **新对象在谓语 / 否定标记处结束**（`OBJECT_STOP`：是 / 不 / 没 / 被 / 而 / 的提议 / 的方案 / 的话 / 的事……）。标记后面
 *        是同一分句里一个「不 + 框架动词 + 旧 + 了」式的点名（「改成用React不用Vue了」）⇒ 对象截在标记前；否则那是对这个改口
 *        本身的评判（「改成用React是不可能的 / 不现实 / 没必要」「改成用React的提议被否了」）⇒ 整个改口分句丢掉；
 *      - **紧跟着的评判分句**（`VERDICT`：「我觉得不行」「不现实」「没必要」「算了」……整个分句只是一句评判）⇒ 它前面那个
 *        改口分句丢掉（「有人提议，改成用React，我觉得不行」）；
 *      - **话题分句带主语**：改口分句自己没有主语时，往前找最近的非改口分句（跳过「好的 / 我想了想」这类空话）：
 *        「关于X / 至于X / X那块 / X方面 / X的话」取 X，其余不带框架动词的分句（光秃秃的名词短语「周报，」、转述「有人提议，」）
 *        取整个分句；带框架动词的分句是一句陈述、不是话题（「决定用React，不用Vue了」不带主语）——话题就是这个改口的主语，照第 5 条要求出现在旧决定里（「关于周会，改成用腾讯会议」不取代「用Vue」）；
 *   4. **不是重说**：任一改口分句的新对象与 O 的对象相等、或一个包含另一个（React 对 React做前端、Vue 对 Vue写原型、
 *      985 对 985高校）⇒ 不取代——重说 / 重申旧决定永远不是改口；
 *   5. **主题相同**：存在一个改口分句，它的主语为空或出现在 O 的原文里（「后端改用 Rust」对「后端用 Go」可以，「周会改成用
 *      腾讯会议」对「用 Vue」不行），并且落在下面三档之一，取最强的一档。主语出现在 O 里、却不在 O 的框架**自己那个分句的
 *      框架动词前面**（`subjectTied`：「前端改用JS语言」对「后端用Go语言，前端用TS语言」，O 的框架是「后端用…」）⇒ 最多到卡；
 *      「把 X 换成…」的主语就是点名的旧对象，由 explicit 的整段相等核对：
 *      - 明说（explicit）：它点名的旧对象（b–e，至少两个字符）**等于** O 的对象——整段相等，所以 ASCII 天然按词边界（Go ≠ Google）；
 *      - 同框架同类（same_kind）：它的新框架动词与 O 的相同，两边对象的类别词相同，且**对齐**（`aligned`）：去掉类别词后两边
 *        剩下的都是短限定语——不超过 4 个字符或单个 ASCII 词，不含框架 / 动作动词（`SPEC_VERB`）与「的」——「关注 211 高校」→
 *        「改成关注 985 高校」算；「用React做前端开发」→「改成用Rust做后端开发」（剩下「react做前端」）不算，落到 frame_only；
 *      - 同框架、一边缺类别词或没对齐（frame_only）：框架动词相同，至少一边的对象没有类别词——「关注 211 高校」→「改成关注 985 吧」。
 *      框架动词相同但两边类别词**不同**（「关注 211 高校」对「改成关注 AI 方向」、「报考北大」对「改成报考清华」）⇒ 不算同一主题。
 *   6. **整句门**（`sentenceCertainty`，第 8 轮第四次评审：误自动取代是唯一不许出现的结果，多一张卡很便宜）——看改口分句
 *      以外的每个分句：
 *      - **收回** ⇒ 什么都不做（不取代、不弹卡）：一个分句是评判（`VERDICT`：「我反对」「不可行」「不赞成」「没同意」……），
 *        或带「还是」又提到旧对象（「不对，还是关注211高校」）；整句级的收回在第 3 条之前就挡掉：自我更正分句
 *        （`SELF_CORRECTION`：不对 / 哦不……）、「开玩笑的 / 说着玩的」（`JOKE`）；
 *      - **干净** ⇒ 这一档照旧（explicit / same_kind 自动）：每个其余分句都是下面之一——整句空话（`CLEAN_FILLER`，小的封闭表：
 *        好 / 嗯 / 哦 / ok / 想了想 / 这样 / 这么定 / 定——**没有**单独的「对 / 是 / 行」：「对吧」「是吧」剥掉「吧」就是它们）；
 *        另一个改口分句，它点名的旧对象就是 O 的对象、主语对得上 O 的框架分句（第 5 条）、新对象与别的改口相同；原因分句，
 *        且内容里没有否定 / 不确定的字或词（`REASON_DOUBT`：不 / 没 / 否 / 未 / 非 / 还没 / 假设 / 暂 / 可能 / 也许 / 先 / 反对 /
 *        拒绝 / 驳回 / 或许 / 大概 / 说不定 / 万一 / 如果 / 要是——「因为离家近」干净，「由于还没最终确定」「毕竟不急」不干净）；
 *        已当成这个改口主语、且在 O 的框架动词前面的话题分句（「关于前端，…」）；同框架说出的那个新选择（「决定用React，不再用Vue了」）；
 *        且全句只有一个新对象；
 *      - 其余都是**说不准** ⇒ 最多到 frame_only（弹卡）：认不出的后续分句（「这是老板说的」「暂定」「不过要看预算」）、
 *        别的分句提到旧对象（「211高校继续关注」「因为211高校太远」）、别的分句里的「还是」、带否定 / 不确定的原因分句、
 *        勉强的应允（`RELUCTANT`：「行吧」「好吧」「好的吧」）、「是的」「对」这类不在空话表里的应答。
 *      自动的路上不加词表：干净是「只允许这几种」，认不出的一律下到卡。
 *   7. **复合的旧决定从不自动**（第 8 轮第五次评审）：O 有不止一个带框架动词的分句（「后端用Go语言，前端用TS语言」「关注211高校，
 *      主攻计算机」），或它的框架前面是并列主语（`COORDINATED`：和 / 与 / 及 / 跟 / 都，或原文里有「、」——「前端和后端都用Vue框架」）
 *      ⇒ 最多到 frame_only（弹卡）。自动取代是整条转 superseded，O 说的另一件事（后端的 Go）会跟着一起丢。
 *
 * **框架**（`decisionFrame`，也用来读 O）：有带新框架的改口分句 ⇒ 取第一个；否则取第一个不是改口分句的分句里第一个框架动词
 * （`FRAME_VERBS`，同一位置取最长的：采用 > 用；单字的 用 / 做 / 选 在词里——费用、用户、做法、选项、不用……——不算），
 * 它后面到分句末、去掉句末语气词的部分是「对象」；对象末尾连续汉字的最后两个字是「类别词」（「211高校」→「高校」，「985」没有）。
 *
 * **一条新决定取代哪几条**：取最强的非空一档；这一档里的旧决定按归一文本分组——只有**一组**（同一句话可能在
 * 会话里和个人空间里各有一条）才算；多于一组 ⇒ 说不清改的是哪一条，既不取代也不弹卡。
 *   - 这一档是 explicit / same_kind（整句干净）⇒ 自动取代这一组的全部（`supersedes`）；
 *   - 这一档是 frame_only（含被整句门降下来的）⇒ 弹一张卡（`prompts`），〈旧〉取这一组的代表：本会话的那条优先，其次 id 最小的
 *     （[取代] 走 F16 keep_new，连带收掉本人由它晋升出去的 L1 副本）。
 * 宁可漏，不可误（R4 A1 同一原则）：漏了，用户还能在面板里手动忘掉旧的；误取代会让一条还有效的决定悄悄消失。
 */
import { INTERROGATIVE } from "./question-detection";

export type SupersedeClaimKind = "fact" | "hypothesis" | "decision" | "todo" | "risk";

/** 这条消息刚抽出、还没人看过的结论。 */
export interface SupersedeFresh {
  readonly id: string;
  readonly kind: SupersedeClaimKind;
  readonly statement: string;
  /** 说出它的人（这条消息的作者）；未知为 null。 */
  readonly authorId: string | null;
}

/** 还活着的旧决定（本会话的，或所有者本人个人空间的）。 */
export interface LiveDecision {
  readonly id: string;
  readonly kind: SupersedeClaimKind;
  readonly statement: string;
  /** 会话里的：它全部原话的唯一作者（不唯一 / 不是人 ⇒ null）；个人空间的：空间主人。 */
  readonly authorId: string | null;
  readonly scope: "chat_session" | "personal";
}

export interface SupersedePair {
  readonly newerClaimId: string;
  readonly olderClaimId: string;
}

/** 一批新结论的判定结果：高把握的自动取代，低把握（frame_only）的弹卡问人（`kg_conflict_prompts.kind = possible_change`）。 */
export interface SupersedePlan {
  readonly supersedes: readonly SupersedePair[];
  readonly prompts: readonly SupersedePair[];
}

/** 主题相同的三档（数字越小越强）。 */
export type TopicMatch = "explicit" | "same_kind" | "frame_only";
const MATCH_RANK: Record<TopicMatch, number> = { explicit: 0, same_kind: 1, frame_only: 2 };

/** 肯定的改口词：必须直接支配紧跟在后面的框架动词或对象。 */
const CHANGE_WORD = /改成|改为|换成|换为|改用|换用|转为/;
const ADDITIVE = /也|还要|还想|另外|同时|再加|加上|以及|并且|额外|增加|补充/;
const NEGATED_CHANGE = /(?:不|没有?|未|别|不要|不想|不再|不会)(?:改成|改为|换成|换为|改用|换用|转为)/;
const QUESTION_MARK = /[?？]/;
const QUESTION_TAIL = /(?:吗|呢|么)[。.!！~～]*$/;
const HYPOTHETICAL_LEAD = /^(?:如果|假如|假设|要是|倘若|假使|万一)/;

const DECISION_WORDS = /决定|选定|确定|定为|敲定|拍板/g;
/** 框架动词：同一位置按长度优先匹配（「采用」不会被读成「用」）。 */
const FRAME_VERBS = [
  "选择", "选用", "采用", "使用", "关注", "聚焦", "主攻", "侧重", "研究", "面向", "针对", "报考", "用", "选", "做",
] as const;
/** 单字框架动词在词里时不算（费用、用户、做法、选项……；前面是「不 / 没」的是否定，也不算肯定的框架）。 */
const COMPOUND_BEFORE: Readonly<Record<string, string>> = {
  用: "费信作使采应适通享试可有没实常专备惯运引挪征录雇不",
  做: "看叫当不没",
  选: "挑筛候人精入当评海初复推落普竞不没",
};
const COMPOUND_AFTER: Readonly<Record<string, string>> = {
  用: "户品途法力料语词量具例",
  做: "法工",
  选: "项手题票举区民型",
};
/** 分句：标点与连接词（连接词两边是两个分句）。 */
const CLAUSE_BREAK = /[，。,；;！!？?、]/;
const CONNECTIVES = /但是|但|不过|然后|可是|只是|而是|因为|由于|毕竟|所以/g;
/** 原因连接词：切分时和别的连接词一样剥掉，另外把后面那个分句记成原因分句。 */
const REASON_WORDS = new Set(["因为", "由于", "毕竟"]);
/**
 * 原因分句里带否定 / 不确定的字或词 ⇒ 这个原因可能在否这个改口（「由于我不同意这个改动」「由于还没最终确定」「毕竟不急」）
 * ⇒ 说不准（弹卡）。只有不带这些的原因（「因为离家近」「毕竟生态好」）留在自动的路上。
 */
const REASON_DOUBT = /不|没|否|未|非|还没|假设|暂|可能|也许|先|反对|拒绝|驳回|或许|大概|说不定|万一|如果|要是/;
/** 分句开头不算「主语」的虚词（剥不掉 ⇒ 当成主语，旧决定必须包含它——剥漏只会让取代变少）。 */
const LEAD_FILLERS = /^(?:我们|我|咱们|咱|那就|那么|那|就|还是|干脆|索性|最后|最终|直接|现在|以后|今后)+/;
const TAIL_PARTICLES = /(?:吧|了|啊|呀|哦|啦|嘛|的)+$/;
const GIVE_UP = /^(.*?)算了[吧啊呀啦哦嘛]*$/;
/** 新对象在这里结束：谓语 / 否定 / 「…的提议」这类把改口本身当成被评判对象的标记。 */
const OBJECT_STOP = /是|不|没|被|而|的(?:提议|方案|想法|建议|计划|话|说法|主意|做法|意见|事)/;
/** 整个分句只是一句评判（「我觉得不行」「不现实」「算了」）：紧跟在改口分句后面 ⇒ 否掉那个改口。 */
const VERDICT = new RegExp(
  "^(?:我们|我|大家|领导|老板)?(?:觉得|认为|看|感觉)?(?:这样|那样|这个|那个|这|那|它)?(?:也|还是|肯定|实在|真的|根本|恐怕|估计|好像)?(?:是)?"
  + "(?:不行|不好|不妥|不可能|不现实|不合适|不太合适|不靠谱|不太行|不太好|不太现实|行不通|不可行|没必要|不必要|没用|没意义|不同意|没同意|反对|不赞成|不划算|不值得|否了|被否了?|算了)"
  + "[吧啊呀啦哦嘛了的]*$",
);
/** 话题分句：「关于 / 至于 / 对于 / 说到 X」「X 那块 / 方面 / 的话」⇒ 话题 X。 */
const TOPIC_LEAD = /^(?:关于|至于|对于|说到|提到)/;
const TOPIC_TAIL = /(?:那块|这块|那边|这边|方面|那部分|这部分|部分|的话|这件事|那件事|这事|那事|的事)$/;
/** 不带主题的空话分句（往前找话题时跳过）。 */
const FILLER_CLAUSE = /^(?:好的?|行|嗯+|哦|对|是的|ok|okay|想了想|想了一下|考虑了一下|再想想|这样吧?|那这样|这么说吧?|总之|综上|说实话|老实说)$/;
const STILL_LEAD = /^(?:那就|那|就|我们|我)?还是/;
/** 收回整句的改口：说着玩的（整句不算），或自我更正分句（「不对」「哦不」）——既不取代也不弹卡。 */
const JOKE = /开玩笑|说着玩|闹着玩/;
const SELF_CORRECTION = /^(?:不对|哦不|噢不|啊不|不不+|错了|说错了|口误)$/;
/**
 * 自动取代的整句门（文件头 A）：其余分句只允许整句空话——小的封闭表，只放不带态度的应答 / 收尾（没有「再想想」「暂定」）。
 * 比对的是剥掉开头虚词（我 / 那就……）与句末语气词（吧 / 了 / 的……）之后的分句：「好的」→ 好、「就这么定了」→ 这么定。
 */
const CLEAN_FILLER = /^(?:好|嗯+|哦|ok|okay|想了想|想了一下|考虑了一下|这样|这么定|定)$/;
/**
 * 附加问句（第 8 轮第五次评审）：「对吧 / 是吧 / 是不是 / 对不对 / 好吗……」是在问，不是在定 ⇒ 整句不算改口（什么都不做）。
 * 单独的「对 / 是 / 行」因此不在 CLEAN_FILLER 里——「对吧」剥掉「吧」后就是「对」。
 */
const TAG_QUESTION = /^(?:(?:对|是|没错)(?:吧|吗|么)|(?:好|行|可以)(?:吗|么)|对不对|是不是|好不好|行不行|可不可以|不是吗)[啊呀吧]*$/;
const TAG_QUESTION_TAIL = /(?:对吧|是吧|对吗|是吗|好吗|行吗|没错吧)[。.!！~～]*$/;
/** 勉强的应允（「行吧」「好吧」）：不是收回，也不是干净的同意 ⇒ 说不准（弹卡）。比对剥掉开头虚词后的原分句。 */
const RELUCTANT = /^(?:行|好)的?吧[啊呀]*$/;
/** 并列主语（「前端和后端都用…」「前端、后端…」）：旧决定说的是不止一件事 ⇒ 永远不自动。 */
const COORDINATED = /和|与|及|跟|都|、/;
/** 同类（same_kind）的对齐：类别词前面的限定语里不许出现框架 / 动作动词（文件头 B）。 */
const SPEC_VERB = /做|写|用|沟通|关注|开发|处理|负责|搞|跑|选|研究|的/;

/** 归一：NFKC、小写、去掉全部空白。 */
export function normalizeStatement(statement: string): string {
  return statement.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/** text 第 i 位上的框架动词（最长的那个）；单字动词在词里（费用 / 用户……）不算。checkBefore=false：前一个字已知是「不」。 */
function frameVerbAt(text: string, i: number, checkBefore = true): string | null {
  const verb = FRAME_VERBS.find((v) => text.startsWith(v, i));
  if (verb === undefined) return null;
  if (verb.length > 1) return verb;
  if (checkBefore && i > 0 && COMPOUND_BEFORE[verb]!.includes(text[i - 1]!)) return null;
  const next = text[i + 1];
  if (next !== undefined && COMPOUND_AFTER[verb]!.includes(next)) return null;
  return verb;
}

export interface DecisionFrame {
  /** 框架动词；找不到为 null。 */
  readonly verb: string | null;
  /** 对象（框架动词之后到分句末、去掉句末语气词）；没有框架动词时为空串。 */
  readonly object: string;
  /** 对象末尾连续汉字的最后两个字；没有则为 null。 */
  readonly kind: string | null;
}

const NO_FRAME: DecisionFrame = { verb: null, object: "", kind: null };

function makeFrame(verb: string | null, rawObject: string): DecisionFrame {
  const object = rawObject.replace(TAIL_PARTICLES, "");
  const han = /\p{Script=Han}+$/u.exec(object)?.[0] ?? "";
  return { verb, object, kind: han.length >= 2 ? han.slice(-2) : null };
}

/** 从 text 开头读「框架动词 + 对象」；开头不是框架动词 ⇒ verbOptional 时整段当对象（动词为 null），否则 null。 */
function frameAtStart(text: string, verbOptional: boolean): DecisionFrame | null {
  const rest = text.replace(/^了/, "");
  const verb = frameVerbAt(rest, 0);
  if (verb !== null) return makeFrame(verb, rest.slice(verb.length).replace(/^(?:了|在)/, ""));
  return verbOptional && rest !== "" ? makeFrame(null, rest) : null;
}

/** 分句：按标点与连接词切开，去掉决定动词（决定 / 确定……），丢掉空分句；同时记下哪些分句是原因分句（因为 / 由于 / 毕竟）。 */
function splitClauses(text: string): { clauses: string[]; reason: boolean[] } {
  const clauses: string[] = [];
  const reason: boolean[] = [];
  for (const part of text.replace(CONNECTIVES, (m) => (REASON_WORDS.has(m) ? "，\u0000" : "，")).split(CLAUSE_BREAK)) {
    const c = part.replace(/\u0000/g, "").replace(DECISION_WORDS, "");
    if (c === "") continue;
    clauses.push(c);
    reason.push(part.startsWith("\u0000"));
  }
  return { clauses, reason };
}

/** 一个改口句式（都出自同一个分句；「算了 + 还是…」是唯一跨到下一分句的窄口子）。 */
export interface ChangeClause {
  /** 这个分句自己读出的新框架（改成 / 换成……后面那段）；否定式与「旧 + 算了」没有新框架。 */
  readonly frame: DecisionFrame | null;
  /** 改口句式里被点名的旧对象（不再 + 动词 + 旧、不 + 动词 + 旧 + 了、把旧换成…、旧 + 算了）。 */
  readonly namedOld: string | null;
  /** 改口词前面剥掉虚词后剩下的主语（「后端改用 Rust」的「后端」）；非空时旧决定原文必须包含它。 */
  readonly subject: string;
}

const lead = (s: string): string => s.replace(LEAD_FILLERS, "");
const nonEmpty = (s: string): string | null => (s === "" ? null : s);

/** 一个分句里的改口句式（不含「算了」，它要看下一个分句）。 */
function clauseChanges(clause: string): ChangeClause[] {
  const out: ChangeClause[] = [];
  // 否定式：「不再 + 框架动词 + 旧」「不 + 框架动词 + 旧 + 了」——只点名旧对象，没有新框架。记下位置：肯定式的对象
  // 撞上的「不」若正是这里的一个点名，那是「改成 A 不用 B 了」的对照，不是对改口本身的否定。
  const negatedAt = new Set<number>();
  for (let i = clause.indexOf("不"); i !== -1; i = clause.indexOf("不", i + 1)) {
    const subject = lead(clause.slice(0, i));
    if (clause.startsWith("不再", i)) {
      const verb = frameVerbAt(clause, i + 2, false);
      if (verb === null) continue;
      const old = clause.slice(i + 2 + verb.length).replace(TAIL_PARTICLES, "");
      if (old !== "") { out.push({ frame: null, namedOld: old, subject }); negatedAt.add(i); }
      continue;
    }
    const verb = frameVerbAt(clause, i + 1, false);
    if (verb === null) continue;
    const m = /^(.+?)了[吧啊呀啦哦嘛]*$/.exec(clause.slice(i + 1 + verb.length));
    const old = m?.[1]?.replace(TAIL_PARTICLES, "") ?? "";
    if (old !== "") { out.push({ frame: null, namedOld: old, subject }); negatedAt.add(i); }
  }
  // 肯定式：改成 / 换成……必须紧跟框架动词或对象；改用 / 换用 本身读作「用」
  const cw = CHANGE_WORD.exec(clause);
  if (cw !== null) {
    let subject = lead(clause.slice(0, cw.index));
    const ba = subject.startsWith("把");
    if (ba) subject = subject.slice(1);
    const restAt = cw.index + cw[0].length;
    let rest = clause.slice(restAt);
    // 新对象在谓语 / 否定标记处结束；标记后面不是本分句里的一个「不…了」点名 ⇒ 那是对这个改口的评判，整个丢掉
    const stop = OBJECT_STOP.exec(rest);
    let judged = false;
    if (stop !== null) {
      if (negatedAt.has(restAt + stop.index)) rest = rest.slice(0, stop.index);
      else judged = true;
    }
    if (!judged) {
      const frame = cw[0] === "改用" || cw[0] === "换用"
        ? frameAtStart(rest, false) ?? (rest === "" ? null : makeFrame("用", rest))
        : frameAtStart(rest, true);
      if (frame !== null) out.unshift({ frame, namedOld: ba ? nonEmpty(subject.replace(TAIL_PARTICLES, "")) : null, subject });
    }
  }
  return out;
}

/**
 * 话题分句的主语：「关于X」「X那块」取 X；其余不带框架动词的分句（光秃秃的名词短语、转述「有人提议」）取整个分句。
 * 空话（好的 / 我想了想）⇒ undefined（接着往前找）；带框架动词的分句本身是一句陈述（「决定用React，不用Vue了」），
 * 不是话题 ⇒ null（停下，不带主语）。
 */
function topicOf(clause: string): string | null | undefined {
  const t = lead(clause.replace(TOPIC_LEAD, "").replace(TOPIC_TAIL, "")).replace(TAIL_PARTICLES, "");
  if (t === "" || FILLER_CLAUSE.test(t)) return undefined;
  for (let i = 0; i < clause.length; i += 1) if (frameVerbAt(clause, i) !== null) return null;
  return t;
}

interface RawChanges {
  readonly clauses: string[];
  readonly reason: boolean[];
  /** 每个分句读出的改口句式（「算了 + 还是…」记在「算了」那个分句上）。 */
  readonly per: ChangeClause[][];
  readonly changes: ChangeClause[];
  /** 属于改口句式的分句（含被评判否掉的、含「算了」后面那个「还是…」分句）。 */
  readonly changed: Set<number>;
}

/** 全部改口句式，不看句子级否决（decisionFrame 读旧决定时也用）。 */
function rawChangeClauses(text: string): RawChanges {
  const { clauses, reason } = splitClauses(text);
  const per = clauses.map((c) => (GIVE_UP.test(c) ? [] : clauseChanges(c)));
  const changed = new Set<number>();
  per.forEach((cs, k) => { if (cs.length > 0) changed.add(k); });
  clauses.forEach((c, k) => {
    const g = GIVE_UP.exec(c);
    if (g === null) return;
    changed.add(k);
    const old = nonEmpty(lead(g[1]!).replace(/就$/, ""));
    const next = clauses[k + 1];
    if (next === undefined) {
      if (old !== null) per[k]!.push({ frame: null, namedOld: old, subject: "" });
      return;
    }
    if (per[k + 1]!.length > 0) {
      if (old !== null) per[k]!.push({ frame: null, namedOld: old, subject: "" });
      return;
    }
    const still = STILL_LEAD.exec(next);
    const frame = still === null ? null : frameAtStart(next.slice(still[0].length), false);
    if (frame === null) return;
    changed.add(k + 1);
    per[k]!.push({ frame, namedOld: old, subject: "" });
  });
  // 紧跟着的评判分句否掉它前面那个改口分句（「改成用React，我觉得不行」）
  clauses.forEach((c, k) => { if (k > 0 && VERDICT.test(c)) per[k - 1] = []; });
  // 话题分句带主语：改口分句自己没有主语 ⇒ 往前找最近的非改口分句（跳过空话；带框架动词的陈述句不是话题），它就是主语
  per.forEach((cs, k) => {
    if (!cs.some((c) => c.subject === "")) return;
    let topic: string | null | undefined;
    for (let j = k - 1; j >= 0 && !changed.has(j) && topic === undefined; j -= 1) topic = topicOf(clauses[j]!);
    if (topic === null || topic === undefined) return;
    per[k] = cs.map((c) => (c.subject === "" ? { ...c, subject: topic } : c));
  });
  return { clauses, reason, per, changes: per.flat(), changed };
}

/** 新决定的改口分析；句子是并列补充 / 否定的改口 / 问句 / 假设 / 说着玩 / 自我更正 ⇒ null（一个改口都没有）。 */
function analyseChange(statement: string): RawChanges | null {
  const text = normalizeStatement(statement);
  if (ADDITIVE.test(text) || NEGATED_CHANGE.test(text) || JOKE.test(text)) return null;
  // 问号在句中任何位置（「改成用React？不行，还是用Vue」）都算问句
  if (QUESTION_MARK.test(text) || QUESTION_TAIL.test(text) || INTERROGATIVE.test(text) || TAG_QUESTION_TAIL.test(text)) return null;
  if (HYPOTHETICAL_LEAD.test(text)) return null;
  const raw = rawChangeClauses(text);
  // 自我更正（「不对」）收回整句；附加问句分句（「，对吧」「，是吧」）是在问 ⇒ 都什么都不做
  if (raw.clauses.some((c) => SELF_CORRECTION.test(c) || TAG_QUESTION.test(lead(c)))) return null;
  return raw;
}

/** 新决定里的改口句式；句子是并列补充 / 否定的改口 / 问句 / 假设 / 说着玩 / 自我更正 ⇒ 一个都没有。 */
export function changeClauses(statement: string): ChangeClause[] {
  return analyseChange(statement)?.changes ?? [];
}

/** 新决定里有没有至少一个改口分句（见文件头第 3 条）。 */
export function hasChangeSignal(statement: string): boolean {
  return changeClauses(statement).length > 0;
}

/**
 * 一条决定的「框架动词 + 对象 + 类别词」：有带新框架的改口分句 ⇒ 取第一个；否则取第一个不是改口分句的分句里
 * 第一个框架动词（否定式的「不用 Vue 了」因此不会被读成肯定的「用 Vue」）。
 */
export function decisionFrame(statement: string): DecisionFrame {
  return frameSite(statement).frame;
}

/** 旧决定的框架 + 它在自己分句里的位置：框架动词前面的那段（`prefix`，主语就该在这里）、有几个分句带框架（`frameClauses`）。 */
interface FrameSite {
  readonly frame: DecisionFrame;
  readonly prefix: string;
  readonly frameClauses: number;
}

function frameSite(statement: string): FrameSite {
  const { clauses, per, changed } = rawChangeClauses(normalizeStatement(statement));
  let fromChange: { frame: DecisionFrame; prefix: string } | null = null;
  let frameClauses = 0;
  // 改口分句带的新框架优先（旧决定本身就是一句改口：「后端改用Rust」的主语「后端」）
  for (const cs of per) {
    const c = cs.find((x) => x.frame !== null);
    if (c === undefined || c.frame === null) continue;
    frameClauses += 1;
    fromChange ??= { frame: c.frame, prefix: c.subject };
  }
  let fromPlain: { frame: DecisionFrame; prefix: string } | null = null;
  for (let k = 0; k < clauses.length; k += 1) {
    if (changed.has(k)) continue;
    const clause = clauses[k]!;
    for (let i = 0; i < clause.length; i += 1) {
      const verb = frameVerbAt(clause, i);
      if (verb === null) continue;
      frameClauses += 1;
      fromPlain ??= { frame: makeFrame(verb, clause.slice(i + verb.length).replace(/^(?:了|在)/, "")), prefix: clause.slice(0, i) };
      break;
    }
  }
  const site = fromChange ?? fromPlain;
  return site === null ? { frame: NO_FRAME, prefix: "", frameClauses } : { ...site, frameClauses };
}

/** 重说：两个对象相等、或一个包含另一个（React 对 React做前端、Vue 对 Vue写原型）。 */
const restates = (a: string, b: string): boolean => a !== "" && b !== "" && (a.includes(b) || b.includes(a));

function hasFrameVerb(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) if (frameVerbAt(s, i) !== null) return true;
  return SPEC_VERB.test(s);
}

/**
 * 同类对齐（文件头 B）：共同的类别词前面，两边都只是一个短的限定语（211 / 985、周一 / 周三、Vue / React）——
 * 去掉类别词后不超过 4 个字符或是单个 ASCII 词，且不含框架 / 动作动词（「React做前端开发」对「Rust做后端开发」不算）。
 */
function aligned(a: DecisionFrame, b: DecisionFrame): boolean {
  if (a.kind === null || a.kind !== b.kind || hasFrameVerb(a.kind)) return false;
  const spec = (f: DecisionFrame): boolean => {
    const r = f.object.slice(0, f.object.length - f.kind!.length);
    if (r === "") return false;
    return /^[a-z0-9][a-z0-9._+#-]*$/.test(r) || ([...r].length <= 4 && !hasFrameVerb(r));
  };
  return spec(a) && spec(b);
}

type Certainty = "clean" | "uncertain" | "rejected";

/**
 * 改口的主语是否落在旧框架自己的分句里、框架动词前面（「前端改用JS语言」对「后端用Go语言，前端用TS语言」：旧框架是
 * 「后端用…」，主语「前端」不在「后端」里 ⇒ 没对上）。「把 X 换成…」的主语就是点名的旧对象，它由 explicit 的整段相等去核对。
 */
function subjectTied(ch: ChangeClause, oldPrefix: string): boolean {
  return ch.subject === "" || ch.subject === ch.namedOld || oldPrefix.includes(ch.subject);
}

/**
 * 整句门（文件头 A）：改口分句以外的每个分句都只能是空话 / 一致的另一个改口 / 原因 / 已当作主语的话题 /
 * 同框架说出的那个新选择——才算「干净」，可以自动；别的都是「说不准」（弹卡）。明确收回（评判分句、「还是 + 旧」）⇒ rejected。
 */
function sentenceCertainty(raw: RawChanges, o: DecisionFrame, oldPrefix: string): Certainty {
  const old = o.object;
  const { clauses, reason, per, changed } = raw;
  // 收回：任何非改口分句是一句评判（「不可行」「我反对」），或「还是 + 旧对象」（「不对，还是关注211高校」）
  for (let k = 0; k < clauses.length; k += 1) {
    if (changed.has(k)) continue;
    const c = clauses[k]!;
    if (VERDICT.test(c) || (c.includes("还是") && c.includes(old))) return "rejected";
  }
  const all = per.flat();
  const newObjects = new Set<string>();
  for (const ch of all) {
    if (ch.namedOld !== null && ch.namedOld !== old) return "uncertain";
    if (!subjectTied(ch, oldPrefix)) return "uncertain";
    if (ch.frame !== null) newObjects.add(ch.frame.object);
  }
  for (let k = 0; k < clauses.length; k += 1) {
    if (changed.has(k)) continue;
    const c = clauses[k]!;
    if (RELUCTANT.test(lead(c))) return "uncertain";
    const bare = lead(c).replace(TAIL_PARTICLES, "");
    if (bare === "" || CLEAN_FILLER.test(bare)) continue;
    if (c.includes(old) || c.includes("还是")) return "uncertain";
    // 原因分句：内容不带否定 / 不确定才算干净（「因为离家近」）；「由于还没最终确定」「毕竟不急」⇒ 说不准
    if (reason[k]) {
      if (REASON_DOUBT.test(c)) return "uncertain";
      continue;
    }
    const topic = topicOf(c);
    if (typeof topic === "string" && oldPrefix.includes(topic) && all.some((ch) => ch.subject === topic)) continue;
    // 同框架说出的新选择（「决定用React，不再用Vue了」的「用React」）：算作新对象，和改口分句的新对象必须是同一个
    const f = frameAtStart(lead(c), false);
    if (f !== null && f.verb === o.verb && f.object !== "" && !OBJECT_STOP.test(f.object)) { newObjects.add(f.object); continue; }
    return "uncertain";
  }
  return newObjects.size > 1 ? "uncertain" : "clean";
}

/**
 * 单对判定：N 是不是在改掉 O，是的话落在哪一档主题匹配（见文件头 1–5）。不是 ⇒ null。
 */
export function supersedeMatch(fresh: SupersedeFresh, older: LiveDecision): TopicMatch | null {
  if (fresh.kind !== "decision" || older.kind !== "decision" || fresh.id === older.id) return null;
  if (fresh.authorId === null || older.authorId === null || fresh.authorId !== older.authorId) return null;
  const raw = analyseChange(fresh.statement);
  const changes = raw?.changes ?? [];
  if (raw === null || changes.length === 0) return null;
  const site = frameSite(older.statement);
  const o = site.frame;
  if (o.object === "") return null;
  // 重说 / 重申旧决定（任一改口分句的新对象与旧对象相等或互相包含）永远不是改口
  if (changes.some((c) => c.frame !== null && restates(c.frame.object, o.object))) return null;
  const olderText = normalizeStatement(older.statement).replace(DECISION_WORDS, "");
  let best: TopicMatch | null = null;
  for (const c of changes) {
    // 主语不在旧决定里 ⇒ 不是同一主题；在旧决定里、但不在旧框架自己那个分句的框架动词前面 ⇒ 下面由 subjectTied 降到卡
    if (c.subject !== "" && !olderText.includes(c.subject)) continue;
    let m: TopicMatch | null = null;
    if (c.namedOld !== null && c.namedOld.length >= 2 && c.namedOld === o.object) m = "explicit";
    else if (c.frame !== null && c.frame.verb !== null && c.frame.verb === o.verb) {
      if (c.frame.kind !== null && o.kind !== null) {
        // 类别词不同 ⇒ 不是同一主题；相同但限定语没对齐（「React做前端开发」对「Rust做后端开发」）⇒ 只到 frame_only（弹卡）
        if (c.frame.kind !== o.kind) m = null;
        else m = aligned(c.frame, o) ? "same_kind" : "frame_only";
      } else m = "frame_only";
    }
    if (m !== null && (best === null || MATCH_RANK[m] < MATCH_RANK[best])) best = m;
  }
  if (best === null) return null;
  // 整句门：明确收回 ⇒ 什么都不做；句子里还有说不准的分句 ⇒ 最多弹卡
  const certainty = sentenceCertainty(raw, o, site.prefix);
  if (certainty === "rejected") return null;
  // 复合的旧决定（不止一个带框架的分句，或并列主语「前端和后端都用…」）说的不止一件事 ⇒ 永远不自动，最多弹卡
  const compound = site.frameClauses > 1 || COORDINATED.test(site.prefix) || normalizeStatement(older.statement).includes("、");
  return certainty === "clean" && !compound ? best : "frame_only";
}

/**
 * 这一批新结论各自取代哪些旧决定、哪些要弹卡问人（见文件头「一条新决定取代哪几条」）。结果按新条、旧条 id 排序，确定可复现。
 */
export function planSupersedes(fresh: readonly SupersedeFresh[], live: readonly LiveDecision[]): SupersedePlan {
  const supersedes: SupersedePair[] = [];
  const prompts: SupersedePair[] = [];
  for (const f of fresh) {
    let best: TopicMatch | null = null;
    let hits: LiveDecision[] = [];
    for (const o of live) {
      const m = supersedeMatch(f, o);
      if (m === null) continue;
      if (best === null || MATCH_RANK[m] < MATCH_RANK[best]) { best = m; hits = [o]; } else if (m === best) hits.push(o);
    }
    if (best === null) continue;
    const keys = new Set(hits.map((o) => normalizeStatement(o.statement)));
    if (keys.size !== 1) continue;
    if (best === "frame_only") {
      // 低把握：只问、不动。〈旧〉取这一组的代表（本会话的优先，其次 id 最小）
      const rep = [...hits].sort((x, y) => Number(y.scope === "chat_session") - Number(x.scope === "chat_session") || x.id.localeCompare(y.id))[0]!;
      prompts.push({ newerClaimId: f.id, olderClaimId: rep.id });
    } else {
      for (const o of hits) supersedes.push({ newerClaimId: f.id, olderClaimId: o.id });
    }
  }
  const order = (x: SupersedePair, y: SupersedePair) => x.newerClaimId.localeCompare(y.newerClaimId) || x.olderClaimId.localeCompare(y.olderClaimId);
  return { supersedes: supersedes.sort(order), prompts: prompts.sort(order) };
}

/** 只要自动取代的那部分（explicit / same_kind）。 */
export function findSupersedes(fresh: readonly SupersedeFresh[], live: readonly LiveDecision[]): SupersedePair[] {
  return [...planSupersedes(fresh, live).supersedes];
}
