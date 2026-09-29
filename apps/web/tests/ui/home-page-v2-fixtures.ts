import type { QuickAction } from "@/lib/live-home-config";

/** 与后端 `DEFAULT_HOME_CONFIG_QUICK_ACTIONS` 同形（未建过配置的组织拿到的默认入口）。 */
export const HOME_DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { key: "chat", enabled: true, order: 0 },
  { key: "projects", enabled: true, order: 1 },
  { key: "research", enabled: true, order: 2 },
  { key: "interview", enabled: true, order: 3 },
  { key: "survey", enabled: true, order: 4 },
  { key: "recording", enabled: true, order: 5 },
  { key: "design", enabled: true, order: 6 },
  { key: "brain", enabled: true, order: 7 },
  { key: "board", enabled: false, order: 8 },
  { key: "tasks", enabled: false, order: 9 },
];
