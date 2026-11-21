"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import type { useAidtSharedStages } from "../lib/use-aidt-shared-stages";

export function AidtInterviewSaveState({ controller: c, editPending, signature }: {
  controller: ReturnType<typeof useAidtSharedStages>; editPending: boolean; signature: string;
}) {
  const latest = React.useRef(c);
  latest.current = c;
  const { canSave, matchesServer, write } = c;
  React.useEffect(() => {
    if (!editPending || matchesServer || !canSave || write.phase === "error" || write.phase === "conflict") return;
    const timer = window.setTimeout(() => { void latest.current.saveCurrent(); }, 350);
    return () => window.clearTimeout(timer);
  }, [signature, editPending, matchesServer, canSave, write.phase]);
  if (!editPending) return null;
  return <div data-testid="aidt-interview-save-state" role="status" className="text-12 text-muted-foreground">
    {matchesServer ? "已保存" : write.phase === "error" || write.phase === "conflict" ? <>
      {write.error} {write.phase === "conflict" && c.needsBaseReview ? <Button size="xs" variant="ghost" onClick={c.restoreServer}>重新载入服务器版本</Button> : <Button size="xs" variant="ghost" onClick={() => void c.saveCurrent()}>重试保存</Button>}
    </> : "正在保存草稿…"}
  </div>;
}
