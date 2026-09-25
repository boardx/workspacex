"use client";
import * as React from "react";
import {
  fetchBrainOverview,
  fetchPersonalKnowledge,
  knowledgeGraphErrorCode,
  type BrainOverview,
  type PersonalKnowledge,
} from "@/lib/knowledge-graph-api";

/**
 * 大脑页的两份真实数据，并行取。任一份失败整页进错误态（不拿半份数据拼一个看似完整的页）。
 *
 * `denied`：服务端说「看不到」（`KG_NOT_VISIBLE`，契约 getPersonalKnowledge.err：个人空间只有本组织成员本人读得到）——
 * 多半是刚被移出当前组织；与网络 / 服务不可用（`failed`）分开，给的出路不一样。
 */
export type BrainData =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly personal: PersonalKnowledge; readonly overview: BrainOverview }
  | { readonly status: "denied" }
  | { readonly status: "failed" };

export function useBrainData(orgId: string): { state: BrainData; reload: () => void } {
  const [state, setState] = React.useState<BrainData>({ status: "loading" });
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    const ctl = new AbortController();
    setState({ status: "loading" });
    Promise.all([fetchPersonalKnowledge(ctl.signal), fetchBrainOverview(ctl.signal)]).then(
      ([personal, overview]) => { if (!ctl.signal.aborted) setState({ status: "ready", personal, overview }); },
      (e: unknown) => {
        if (ctl.signal.aborted) return;
        setState({ status: knowledgeGraphErrorCode(e) === "KG_NOT_VISIBLE" ? "denied" : "failed" });
      },
    );
    return () => ctl.abort();
  }, [orgId, nonce]);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);
  return { state, reload };
}
