"use client";

/**
 * 「这个版次做不到什么」——**说在入口处，不是等用户点了才报错。**
 *
 * ## 为什么需要它（2026-09-23 实测）
 * 本地版的能力选择器里，「图片生成」赫然写着「就绪」。而契约的能力矩阵里
 * `image-generation` 在本地版是 `absent`，后端也刻意不注册出图 provider——
 * 用户选它、输入提示词、等一会儿，拿到的是一次不可解释的失败。
 * 界面不但让点，还主动声称自己就绪，这比不说更糟。
 *
 * 离线应用十大缺陷的第 7 条就是这个形状：不可用功能仍可点，点了才弹错，
 * 而且不说为什么、什么时候能用。9 分的判据是「在入口处就说明原因与替代」。
 *
 * ## 为什么只是一条说明，而不是把那个 agent 禁掉
 * 禁掉才是对的，但今天做不对：没有任何字段把一个 agent 关联到它需要的那项能力
 * ——出图 provider 是按环境变量选的（`select-image-provider.ts`），agent 的
 * `CapabilityListing.endpoint` 是 `null`（实测），所以既有的「本地组织里云端端点整行
 * 禁用」那条规则对它根本不触发。要做对得先补上那个关联，那是契约改动。
 * 在补上之前，「说清楚」比「装作没事」强，而且它不会因为将来补了关联就作废。
 */

import * as React from "react";
import { CAPABILITY_AVAILABILITY_LABEL } from "@repo/contracts/deployment";
import { useEdition, useMissingCapabilities } from "@/lib/edition";

/** 这一行在当前版次下的可用性。矩阵里每行都直接带着两个版次的取值。 */
function availabilityIn(
  edition: "local" | "cloud",
  row: { readonly local: string; readonly cloud: string },
): string {
  return edition === "local" ? row.local : row.cloud;
}

export function CapabilityEditionNote(): React.ReactElement | null {
  const edition = useEdition();
  const missing = useMissingCapabilities();
  /*
    判据是「当前版次里这项能力是 absent」，不是写死看 `c.local`。

    我第一版写的是 `edition !== "local" || …` 再加 `c.local === "absent"` 两道，
    反证时发现前一道是冗余的：真正让云端不画的是后一道过滤，把前一道删掉测试照绿。
    留一个没有断言打在上面的分支，就是在推没被测过的复杂度。
    现在只剩一条承重的判据，而且它在两个版次下都表达的是同一件事。
  */
  const absent = missing.filter((c) => availabilityIn(edition, c) === "absent");
  if (absent.length === 0) return null;
  return (
    <div
      data-testid="capability-edition-note"
      className="mt-1 rounded-md border border-dashed border-border px-2.5 py-2"
    >
      <p className="text-11 font-medium text-card-foreground">
        {edition === "local" ? "这台电脑上做不到的事" : "这个版次做不到的事"}
      </p>
      <ul className="mt-1 space-y-0.5">
        {absent.map((c) => (
          <li key={c.id} data-testid={`capability-edition-absent-${c.id}`} className="text-11 leading-snug text-muted-foreground">
            {c.capability}
            <span className="text-muted-foreground">（{CAPABILITY_AVAILABILITY_LABEL.absent}）</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-11 leading-snug text-muted-foreground">
        {edition === "local"
          ? "这些要连在线正式系统才行。本地版的数据和模型都在这台电脑上，这是代价的另一半。"
          : "这些在当前版次里不可用。"}
      </p>
    </div>
  );
}
