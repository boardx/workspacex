"use client";
import { listWidgets } from "@/lib/live-widgets";

export function WidgetsScreen() {
  return <ul data-testid="widgets">{listWidgets.name}</ul>;
}
