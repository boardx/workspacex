import type { ReactNode } from "react";

/** Optional workspace tools share the native Inspector; ordinary Chat has no host panel. */
export interface ChatHostPanel {
  readonly scope: string;
  readonly title: string;
  readonly open: boolean;
  readonly content: ReactNode;
  readonly onOpenChange: (open: boolean) => void;
}
