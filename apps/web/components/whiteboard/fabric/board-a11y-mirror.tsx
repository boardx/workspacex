"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import type { BoardFabricObject } from "./board-fabric-object";

export interface BoardA11yMirrorProps {
  objects: readonly BoardFabricObject[];
  selectedObjectIds: readonly string[];
  onSelect: (objectId: string) => void;
  readOnly: boolean;
}

const KIND_LABEL: Record<BoardFabricObject["kind"], string> = {
  sticky: "便利贴",
  text: "文字",
  rectangle: "矩形",
  ellipse: "椭圆",
};

export function BoardA11yMirror({ objects, selectedObjectIds, onSelect, readOnly }: BoardA11yMirrorProps) {
  const selected = new Set(selectedObjectIds);
  return (
    <section className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:bottom-4 focus-within:right-4 focus-within:z-30 focus-within:w-72 focus-within:rounded-xl focus-within:border focus-within:border-border focus-within:bg-card focus-within:p-3 focus-within:shadow-xl" data-testid="board-a11y-mirror" aria-label="白板对象大纲">
      <h2 className="text-sm font-semibold">白板对象</h2>
      <p className="mt-1 text-xs text-muted-foreground">{readOnly ? "只读模式；可浏览和选择对象。" : "使用 Tab 浏览对象，Enter 选择。"}</p>
      <ul className="mt-2 space-y-1" aria-label="白板对象">
        {objects.map((object) => (
          <li key={object.id} data-object-id={object.id}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start truncate transition-colors"
              aria-pressed={selected.has(object.id)}
              data-testid={`board-a11y-object-${object.id}`}
              onClick={() => onSelect(object.id)}
            >
              <span className="sr-only">{KIND_LABEL[object.kind]}：</span>{object.content.text || `未命名${KIND_LABEL[object.kind]}`}
            </Button>
          </li>
        ))}
      </ul>
      <p className="sr-only" aria-live="polite" data-testid="board-a11y-selection-announcement">
        {selectedObjectIds.length === 0 ? "未选择对象" : `已选择 ${selectedObjectIds.length} 个对象`}
      </p>
    </section>
  );
}

