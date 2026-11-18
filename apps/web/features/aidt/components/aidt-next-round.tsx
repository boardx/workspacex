"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { isAidtReflectionConfirmed } from "../lib/aidt-verification-loop";

/** Only starts a new local working draft after the current round has a saved receipt. */
export function AidtNextRound({ draft, savedRevision, matchesServer, readOnly, onStart }: {
  draft: AidtUiStageDraft; savedRevision?: number; matchesServer: boolean; readOnly: boolean;
  onStart: () => void;
}) {
  const [review, setReview] = React.useState(false);
  const ready = !readOnly && !!savedRevision && matchesServer && isAidtReflectionConfirmed(draft);
  React.useLayoutEffect(() => { setReview(false); }, [savedRevision, ready]);
  return <div className="space-y-2 border-t border-border pt-3" data-testid="aidt-next-round">
    {review && ready ? <div role="alertdialog" aria-label="开始下一轮测试" className="space-y-2 text-12"><p>本轮已保存为第6步 V{savedRevision}，可在下方历史中回看。开始后清空本轮表单，其他五步与原型历史保留；下一轮需重新带入已保存的验证问题。</p><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setReview(false)}>继续查看本轮</Button><Button size="sm" onClick={() => { if (ready) { setReview(false); onStart(); } }}>确认开始下一轮草稿</Button></div></div> : <Button size="sm" variant="outline" disabled={!ready} onClick={() => { if (ready) setReview(true); }}>开始下一轮测试草稿</Button>}
    {!ready && !readOnly && <p className="text-11 text-muted-foreground">本轮学习记录确认并保存后，可开始下一轮。无需先生成新版原型。</p>}
  </div>;
}
