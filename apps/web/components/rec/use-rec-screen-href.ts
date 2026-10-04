"use client";

import { useSearchParams } from "next/navigation";
import type { RecScreen } from "@/lib/mock/rec";

/** Change the panel without dropping the current project, carrier or preview role. */
export function useRecScreenHref(screen: RecScreen): string {
  const searchParams = useSearchParams();
  const next = new URLSearchParams(searchParams?.toString());
  next.set("screen", screen);
  return `?${next.toString()}`;
}
