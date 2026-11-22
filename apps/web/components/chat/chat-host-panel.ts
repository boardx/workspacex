import { createContext } from "react";

import type { ReactNode } from "react";

/** Optional workspace tools share the native Inspector; ordinary Chat has no host panel. */
export interface ChatHostPanel {
  readonly scope: string;
  readonly title: string;
  readonly placement?: "artifacts";
  readonly materialsContent?: ReactNode;
  readonly recordingContent?: (openMaterials: () => void) => ReactNode;
  readonly savedArtifactTitle?: string;
  readonly open: boolean;
  readonly content: ReactNode;
  readonly onOpenChange: (open: boolean) => void;
}

/** Optional workspace controls powered by the native Chat timeline. */
export const ChatHostConversationContext = createContext<{
  target?: HTMLElement | null;
  render: (messages: readonly { id: string; role: string; content?: unknown }[], loading: boolean, running: boolean) => ReactNode;
} | null>(null);
