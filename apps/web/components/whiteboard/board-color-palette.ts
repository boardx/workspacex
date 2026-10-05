import { STICKY_COLOR_PRESETS, validateTextAttributes } from "@repo/whiteboard-core";

/** Shared standard ink/text/connector palette; sticky fills retain their canonical pastel palette. */
export const BOARD_INK_COLORS = ["#18181B", "#A1A1AA", "#F4F4F5", "#F9A8D4", "#EF4444", "#FB923C", "#FACC15", "#4ADE80", "#2563EB", "#A855F7"] as const;
export const BOARD_DEFAULT_TEXT_COLOR = validateTextAttributes({ preset: "body" }).color;
export const BOARD_FILL_COLORS = Object.values(STICKY_COLOR_PRESETS);
export const BOARD_DEFAULT_FILL_COLOR = STICKY_COLOR_PRESETS.white;
