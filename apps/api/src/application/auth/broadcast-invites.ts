/**
 * `BroadcastInvites`（F15 / UC-1.3）—— [群发邀请] 按名单批量发出。
 *
 * ## 「不得把部分失败呈现为整批成功」是这个用例的**全部内容**
 *
 * 契约 E4 / `PARTIAL_DELIVERY`：`delivered` 与 `failed` **同时**返回，失败项可单条重试。
 * 所以这里没有 `Promise.all` + 一个 catch：那种写法下第一个失败会吞掉后面全部的结果，
 * 而返回值只剩「成功」或「异常」两种，`failed` 永远是空数组。逐条 settle，逐条记账。
 *
 * ## 渠道是注入的，而且**默认注入的那个会失败**
 *
 * `SmsSender` / `MailSender` 的服务商是 `[待确认]`（契约 `KNOWN_CONTRACT_GAPS.OA5`，
 * 与 uc-1-2 同一条）。绑一个「记条日志然后返回成功」的假发送器，会让
 * `delivered` 这个数组变成一句没有任何测试能戳穿的谎——F10 的 `sentAt` 记过同一个坑。
 * ⇒ 不注入 sender 时，**每一条都进 `failed`**，理由是 `SMS_UNAVAILABLE` / `MAIL_UNAVAILABLE`。
 *   那是真话：现在确实一条都发不出去。`last_sent_at` 只对真正 delivered 的那些写。
 */
import type { orgAdmin as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import { assertCanManageInviteLinks, type InviteLinkActor } from "./invite-link-authz";
import type { ParticipantRosterRepository } from "./invite-link-ports";

/**
 * ⚠ **派生，不重述**。第一版在这里手写了 `"sms" | "email" | "both"`，
 * `lint-contract-source` 当场抓住——它是对的：三取值是契约里的一个占位形状
 * （`KNOWN_CONTRACT_GAPS.OA5`：渠道与模板尚未裁决），而裁决落地时改的是契约那一份。
 * 手写的副本不会跟着变，表现是「契约加了 `wechat`，这里的 switch 静默走 default」。
 */
export type BroadcastChannel = z.infer<typeof C.BroadcastChannel>;

export interface InviteSender {
  /** 抛出 = 这一条没发出去。抛什么由实现决定，用例只记「失败了，理由是这个」。 */
  send(participantId: string, channel: Exclude<BroadcastChannel, "both">): Promise<void>;
}

export interface BroadcastInvitesDeps {
  readonly roster: ParticipantRosterRepository;
  /** 见文件头：不注入 = 一条都发不出去，且如实返回。 */
  readonly sender?: InviteSender;
  readonly now?: () => Date;
}

export interface BroadcastInvitesInput extends InviteLinkActor {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly participantIds: readonly string[];
  readonly channel: BroadcastChannel;
}

export interface BroadcastInvitesOutput {
  readonly delivered: readonly string[];
  readonly failed: readonly { readonly id: string; readonly reason: string }[];
}

/** `both` 展开成两条真实渠道；其余各自一条。 */
function channelsOf(channel: BroadcastChannel): Exclude<BroadcastChannel, "both">[] {
  return channel === "both" ? ["sms", "email"] : [channel];
}

function unavailableReason(channel: Exclude<BroadcastChannel, "both">): string {
  return channel === "sms" ? "SMS_UNAVAILABLE" : "MAIL_UNAVAILABLE";
}

export async function broadcastInvites(
  deps: BroadcastInvitesDeps,
  input: BroadcastInvitesInput,
): Promise<BroadcastInvitesOutput> {
  assertCanManageInviteLinks(input);

  const channels = channelsOf(input.channel);
  const delivered: string[] = [];
  const failed: { id: string; reason: string }[] = [];

  for (const id of input.participantIds) {
    if (deps.sender === undefined) {
      // 见文件头。`both` 时报第一条渠道的不可用——两条都报会让同一个人在 failed 里出现两次，
      // 而契约的 failed 是「失败项可单条重试」的清单，一人一条。
      failed.push({ id, reason: unavailableReason(channels[0] as Exclude<BroadcastChannel, "both">) });
      continue;
    }
    let ok = false;
    let reason = "";
    for (const ch of channels) {
      try {
        await deps.sender.send(id, ch);
        // `both` 的语义取「任一渠道送达即算送达」：两条都要成功才算，
        // 会让一个没填邮箱的参与者永远进不了 delivered，而短信已经到了他手机上。
        ok = true;
      } catch (e) {
        reason = e instanceof Error ? e.message : unavailableReason(ch);
      }
    }
    if (ok) delivered.push(id);
    else failed.push({ id, reason: reason === "" ? unavailableReason(channels[0] as Exclude<BroadcastChannel, "both">) : reason });
  }

  // ⚠ 只对真正送达的那些写 `last_sent_at`。给失败的也写，界面上的
  // 「未接受邀请 · 已发送 N 天」就会从一次根本没发出去的群发开始计天。
  if (delivered.length > 0) {
    await deps.roster.markSent(
      input.orgId,
      input.projectId,
      delivered,
      (deps.now ?? (() => new Date()))(),
    );
  }

  return { delivered, failed };
}
