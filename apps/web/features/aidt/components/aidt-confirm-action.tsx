"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

export function AidtConfirmAction({ blocker, blockerAction, onConfirm, onBlocked, ...button }: Omit<React.ComponentProps<typeof Button>, "onClick" | "asChild"> & {
  blocker?: string | null;
  blockerAction?: React.ReactNode;
  onConfirm: () => void;
  onBlocked?: () => void;
}) {
  const [attempted, setAttempted] = React.useState(false);
  const messageId = React.useId();
  return <>
    <Button {...button} type="button" aria-describedby={attempted && blocker ? messageId : button["aria-describedby"]} onClick={() => {
      if (blocker) {
        setAttempted(true);
        onBlocked?.();
        return;
      }
      setAttempted(false);
      onConfirm();
    }} />
    {attempted && blocker && <div className="basis-full rounded-md border border-destructive/30 bg-destructive/5 p-2 text-13">
      <p id={messageId} role="alert">{blocker}</p>
      {blockerAction}
    </div>}
  </>;
}
