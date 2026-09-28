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
  shape: "形状",
  drawing: "绘图",
  image: "图片",
  card: "结构化卡片",
  panel: "区域",
  group: "组合",
  connector: "连接线",
  placeholder: "暂不支持的对象",
};

function describeObject(object: BoardFabricObject): string {
  if (object.kind !== "image" || object.boardContent?.type !== "image") return `对象类型：${KIND_LABEL[object.kind]}`;
  const imageState = object.boardContent.status === "failed"
    ? "图片上传失败"
    : object.boardContent.status === "ready" && !object.imageAssetUrl
      ? "图片需在当前会话重新验证"
      : object.boardContent.status === "ready"
        ? "图片已验证"
        : "图片上传中";
  return `对象类型：${KIND_LABEL[object.kind]}；${imageState}`;
}

export function BoardA11yMirror({ objects, selectedObjectIds, onSelect, readOnly }: BoardA11yMirrorProps) {
  const selected = new Set(selectedObjectIds);
  const byId = new Map(objects.map((object) => [object.id, object]));
  const orderedObjects = [...objects].sort((left, right) => left.orderKey.localeCompare(right.orderKey));
  return (
    <section className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:bottom-4 focus-within:right-4 focus-within:z-30 focus-within:max-h-[min(12rem,30vh)] focus-within:w-[min(14rem,calc(100vw-2rem))] focus-within:overflow-y-auto focus-within:rounded-xl focus-within:border focus-within:border-border focus-within:bg-card focus-within:p-3 focus-within:shadow-xl" data-testid="board-a11y-mirror" aria-label="白板对象大纲">
      <h2 className="text-sm font-semibold">白板对象</h2>
      <p className="mt-1 text-xs text-muted-foreground">{readOnly ? "只读模式；可浏览和选择对象。" : "使用 Tab 浏览对象，Enter 选择。"}</p>
      <ul className="mt-2 space-y-1" aria-label="白板对象">
        {orderedObjects.map((object) => (
          <li             data-world-x={object.geometry.x}
            data-world-y={object.geometry.y}
            data-world-width={object.geometry.width}
            data-world-height={object.geometry.height}
            data-world-rotation={object.geometry.rotation}
            key={object.id} data-object-id={object.id} data-object-kind={object.kind} data-object-text={object.content.text} data-geometry={JSON.stringify(object.geometry)} data-parent-id={object.parentId ?? ""} data-z-index={object.zIndex ?? 0}
            data-x={object.geometry.x} data-y={object.geometry.y} data-width={object.geometry.width} data-height={object.geometry.height} data-rotation={object.geometry.rotation}
            data-clip-parent-id={object.parentId && byId.get(object.parentId)?.panel?.clipContent ? object.parentId : undefined}
            data-connector-from={object.connector?.from ?? ""} data-connector-to={object.connector?.to ?? ""}
            data-connector-start={object.connector ? JSON.stringify(object.connector.start) : undefined} data-connector-end={object.connector ? JSON.stringify(object.connector.end) : undefined}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start truncate transition-colors"
              aria-label={`图形：${object.content.text || KIND_LABEL[object.kind]}`}
              aria-description={describeObject(object)}
              aria-pressed={selected.has(object.id)}
              disabled={object.kind === "placeholder"}
              data-testid={`board-a11y-object-${object.id}`}
              onClick={() => onSelect(object.id)}
            >
              {object.content.text || KIND_LABEL[object.kind]}
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
