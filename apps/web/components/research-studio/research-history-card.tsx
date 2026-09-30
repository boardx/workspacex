import type { ComponentProps } from "react";
import { StudioHistoryCard } from "@/components/studio/studio-history";

/** Research uses the same compact card layout as the other studio homes. */
export function ResearchHistoryCard(props: ComponentProps<typeof StudioHistoryCard>) {
  return <StudioHistoryCard {...props} />;
}
