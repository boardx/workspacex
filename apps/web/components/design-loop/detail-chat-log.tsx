"use client";
/**
 * 深度评测 S1（#3988）——从 `detail-screen.tsx` 拆出来的**对话记录**：起手模板、每一轮气泡（系统 / 未生成标记、
 * 退路原因与重试、时间、再发一次、写回了哪些字段）、下一步建议。只搬家、不改行为；
 * 发消息仍由详情页的 `send` 做（这里只回调 `onSend`），状态也都留在详情页。
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import {
  DESIGN_WORKBENCH_CHAT_INTRO,
  DESIGN_WORKBENCH_STARTERS,
  type DesignChatFallbackReason,
  type DesignProject,
  type DesignWritebackField,
} from "@/lib/live-design-workbench";
import { humanTime } from "@/lib/human-time";

/**
 * 2026-09-07：退路原因 → 人话。键集合来自契约闭集 `DesignChatFallbackReason`（穷举，
 * 漏一个编译不过），不另抄一份，也不透传服务端异常细节。
 */
const FALLBACK_REASON_TEXT: Record<DesignChatFallbackReason, string> = {
  MODEL_NOT_CONFIGURED: "这个部署还没配置 AI 模型，画布生成用不了——需要运维在部署配置里补上模型 provider。",
  MODEL_CALL_FAILED: "调用 AI 模型失败（网络或鉴权）。可以重试一次；一直失败就让运维看部署日志。",
  MODEL_TIMEOUT: "这次画的东西太大，AI 没能在时限内画完。试试少要几页、或把要求说得更具体一点再发一次。",
  MODEL_EMPTY_OUTPUT: "AI 模型这次返回了空结果。换个说法再试一次通常就好了。",
  MODEL_BAD_JSON: "AI 这次的输出不是有效的格式，画布没有更新。换个说法再试一次通常就好了。",
  MODEL_OUTPUT_TRUNCATED: "AI 这次没说完就被长度截断了。已经画好的页留着了——没画完的那页可以单独重试，或者把要求拆小一点。",
  MODEL_NO_REPLY_TEXT: "AI 模型这次没给出可用的回复文本；如果画布有变化，那部分已经生效。",
};

/** B5.2：`reply.applied` 的展示文案——键集合来自契约枚举，不另抄一份。 */
const WRITEBACK_LABEL: Record<DesignWritebackField, string> = {
  problem: "背景",
  criteria: "验收标准",
  frames: "画布页",
  prototype: "原型画布",
};

/**
 * 迭代 16（#3773 R8）：哪些退路原因值得给一个「再试一次」。
 *
 * ⚠ `MODEL_NOT_CONFIGURED` **不在**这里：这个部署根本没配模型，重试一百次也一样，
 *   给一个必然失败的按钮是在骗人。那一条的下一步是找运维，文案里已经说了。
 * `MODEL_NO_REPLY_TEXT` 也不在：写回可能已经生效了，重发同一句会再改一遍。
 */
/**
 * 迭代 20：「少画几页再试」按几页。
 *
 * 3 是骨架轮页数区间（3–6）的下限——再少就不是"这个产品长什么样"而是一张孤立的屏了。
 * 这个数会作为 `maxScreens` 交上去，由服务端**截断执行**，不是一句提示。
 */
const FEWER_PAGES_CAP = 3;

const RETRYABLE_FALLBACK: ReadonlySet<DesignChatFallbackReason> = new Set([
  "MODEL_CALL_FAILED", "MODEL_TIMEOUT", "MODEL_EMPTY_OUTPUT", "MODEL_BAD_JSON", "MODEL_OUTPUT_TRUNCATED",
]);

export const DetailChatLog = React.forwardRef<HTMLDivElement, {
  readonly project: DesignProject;
  readonly suggestions: readonly string[];
  readonly sending: boolean;
  readonly fallbackReason: DesignChatFallbackReason | null;
  readonly lastUserText: string | null;
  readonly lastApplied: readonly DesignWritebackField[];
  /** 发一句话；`maxScreens` 是「只画 N 页再试」的服务端截断上限。 */
  readonly onSend: (text: string, maxScreens?: number) => void;
}>(function DetailChatLog({ project, suggestions, sending, fallbackReason, lastUserText, lastApplied, onSend }, ref) {
  return (
    <div ref={ref} className="flex flex-1 flex-col gap-2 overflow-y-auto p-3" data-testid="design-detail-chat">
      {project.chat.length === 0 && (
        <div className="flex max-w-[90%] flex-col gap-2 self-start">
          <div className="rounded-card bg-card px-2.5 py-1.5 text-12 text-card-foreground">{DESIGN_WORKBENCH_CHAT_INTRO}</div>
        </div>
      )}
      {/*
        * 迭代 30：起手模板原来锁在 `chat.length === 0` 里——也就是说，**只要说过一句话**，
        * 哪怕那句是「你好」、哪怕那一轮失败了一页没画出来，三条示例就永远消失。
        * 第一次来的人最可能干的事恰恰是先随便说一句。真正的条件是「还没画出来东西」，
        * 这个条件原本就写在里层（`prototype.length === 0`），只是被外层那道门挡住了。
        */}
      {/*
        * ⚠ 迭代 30 的修法在真浏览器上撞到了一条既有约定（`design-prototype-loop.spec.ts`
        *   「空项目：起手模板 → 发送 → …」）：点了一条起手模板、AI 回过话并给出
        *   **它自己的下一步建议**之后，那三条通用示例就该让位——两排 chip 叠在一起，
        *   更贴题的那一排反而被淹掉。
        *
        *   所以条件不是「说过话就收起」（那正是迭代 30 要修的 bug：随口一句「你好」
        *   把示例永久关掉），而是「还没画出东西 **且** 还没有更贴题的建议」。
        */}
      {project.prototype.length === 0 && suggestions.length === 0 && (
        <div className="flex max-w-[90%] flex-col gap-2 self-start">
          {project.chat.length > 0 && (
            <p className="text-10 text-muted-foreground" data-testid="design-detail-starters-again">
              还没画出东西？直接点一条试试：
            </p>
          )}
          <div className="flex flex-wrap gap-1.5" data-testid="design-detail-starters">
              {DESIGN_WORKBENCH_STARTERS.map((s) => (
                <button key={s.label} type="button" onClick={() => onSend(s.prompt)} disabled={sending}
                  className="rounded-full border border-border px-2.5 py-1 text-11 text-muted-foreground transition-colors duration-fast hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground"
                  data-testid={`design-detail-starter-${s.label}`}>
                  {s.label}
                </button>
              ))}
          </div>
        </div>
      )}
      {project.chat.map((turn, i) => (
        <div
          key={i}
          data-testid={`design-detail-turn-${turn.role}`}
          className={cn(
            /*
             * 迭代 30：`whitespace-pre-wrap`。输入框的 placeholder 一直写着
             * 「Shift+Enter 换行」，而气泡把换行全折成了一行——教了一个手势，
             * 又把它的结果吞掉。粘一段分行的需求进来时尤其明显。
             */
            "max-w-[90%] whitespace-pre-wrap rounded-card px-2.5 py-1.5 text-12",
            turn.role === "user" ? "self-end bg-primary text-primary-foreground" : "self-start bg-card text-card-foreground",
          )}
        >
          {turn.text}
          {/* 迭代 13（delta §2）：`source: "system"` 不是一次模型回合，是服务端留下的痕迹。
              标成「系统」而不是「未生成」——后者的含义是"模型本该说话却没说成"，这里模型压根没被叫过。 */}
          {turn.role === "ai" && turn.source === "system" && (
            <span className="ml-1.5 rounded-control border border-border px-1 text-10 text-muted-foreground" title="这条不是 AI 说的，是系统在这里留下的一条记录（比如你从别处导入了一段对话）" data-testid="design-detail-turn-system">
              系统
            </span>
          )}
          {/* B5.2：模型不可用时服务端退回固定回执并标 source=fallback——如实显示，不装成模型说的 */}
          {turn.role === "ai" && turn.source === "fallback" && (
            <span className="ml-1.5 rounded-control border border-border px-1 text-10 text-muted-foreground" title="这一轮 AI 没能给出画布，下面那句话说了原因；这条回执是系统写的，不是 AI 的答复" data-testid="design-detail-turn-fallback">
              未生成
            </span>
          )}
          {/* 2026-09-07：退路原因（闭集 → 人话），只挂最后一条，说清该重试还是该找运维 */}
          {turn.role === "ai" && i === project.chat.length - 1 && fallbackReason !== null && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-10 text-muted-foreground">
              <p data-testid="design-detail-fallback-reason">{FALLBACK_REASON_TEXT[fallbackReason]}</p>
              {/*
                * 迭代 16（#3773 R8）：退路里**该重试的那几种**给一个「再试一次」。
                *
                * 在这之前这里只有一句解释，而屏上唯一的重试入口挂在"没能发送"那条
                * 错误条带上——也就是说：网络层失败给了重试，**模型层失败反而没有**，
                * 而后者才是用户真正会撞上的那一类（超时、被截断、输出不是 JSON）。
                * 用户当时能做的只有把刚才那句话再手打一遍。
                *
                * 「没配模型」不给重试：它不是"再来一次就好"的事，重试一百次也一样，
                * 那句话已经说了该找运维。给一个必然失败的按钮是在骗人。
                */}
              {/*
                * 迭代 20：超时的那句话一直写着「试试少要几页」，而用户**没有任何
                * 控制页数的手段**——页数由骨架轮自己定，界面上没有旋钮，
                * 说「只画 3 页」也只是一句模型可以不听的话。又一句做不到的许诺。
                * 现在这个按钮把那句话变成一个真的动作：`maxScreens` 是服务端
                * 强制截断的上限，不是提示。
                * 只在**超时**时给——别的退路原因（输出不是 JSON、没配模型）
                * 与页数无关，给了只会把人往错的方向引。
                */}
              {fallbackReason === "MODEL_TIMEOUT" && lastUserText !== null && !sending && (
                <button
                  type="button"
                  onClick={() => onSend(lastUserText, FEWER_PAGES_CAP)}
                  className="rounded-control border border-border px-1.5 py-0.5 transition-colors duration-fast hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="design-detail-fewer-pages"
                >
                  只画 {FEWER_PAGES_CAP} 页再试
                </button>
              )}
              {RETRYABLE_FALLBACK.has(fallbackReason) && lastUserText !== null && !sending && (
                <button
                  type="button"
                  onClick={() => onSend(lastUserText)}
                  className="rounded-control border border-border px-1.5 py-0.5 transition-colors duration-fast hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="design-detail-fallback-retry"
                >
                  再试一次
                </button>
              )}
            </div>
          )}
          {/*
            * 迭代 30：每条气泡说一句「什么时候」。这条对话就是这个项目的全部来龙去脉，
            * 隔一天回来接着做时，「哪些是今天说的」只能靠猜。`at` 契约里一直有，
            * 只是从来没显示过。时间格式走 `humanTime` 这一份，不另写。
            */}
          <span className={cn("ml-1.5 align-baseline text-10", turn.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground")} data-testid={`design-detail-turn-at-${String(i)}`}>{humanTime(turn.at)}</span>
          {/*
            * 迭代 30：用户那一侧的「再说一遍这句」。原来只有模型退路那一类给了重试，
            * 而「这轮画得不对，我想用同一句话再要一次」是普通人最常想做的事——
            * 他能做的只有把刚才那句手打一遍。
            */}
          {turn.role === "user" && !sending && (
            <button
              type="button"
              onClick={() => onSend(turn.text)}
              className={cn("ml-1.5 rounded-control px-1 text-10 underline underline-offset-2 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", turn.role === "user" ? "text-primary-foreground/80 hover:text-primary-foreground" : "text-muted-foreground hover:text-background-foreground")}
              data-testid={`design-detail-resend-${String(i)}`}
            >
              再发一次
            </button>
          )}
          {/* B5.2：这轮回复写回了哪些字段（服务端 `reply.applied`），只挂在最后一条 AI 气泡下 */}
          {turn.role === "ai" && i === project.chat.length - 1 && lastApplied.length > 0 && (
            <div className="mt-1 text-10 text-muted-foreground" data-testid="design-detail-chat-applied">
              已更新：{lastApplied.map((f) => WRITEBACK_LABEL[f]).join(" / ")}
            </div>
          )}
        </div>
      ))}
      {/* 迭代 9：下一步建议 chips——只跟最后一条 AI 气泡，发下一句时清掉 */}
      {suggestions.length > 0 && !sending && (
        <div className="flex max-w-[90%] flex-wrap gap-1.5 self-start" data-testid="design-detail-suggestions">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => onSend(s)}
              className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-11 text-primary transition-colors duration-fast hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="design-detail-suggestion">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
