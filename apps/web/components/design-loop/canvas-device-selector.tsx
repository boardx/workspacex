"use client";

import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PrototypeDevicePreset } from "./prototype-canvas";

export function CanvasDeviceSelector({ devices, deviceId, onDevice, landscape, onLandscape, rotatable }: {
  readonly devices: readonly PrototypeDevicePreset[];
  readonly deviceId: string;
  readonly onDevice: (id: string) => void;
  readonly landscape: boolean;
  readonly onLandscape: () => void;
  readonly rotatable: boolean;
}) {
  return (
    <div className="ml-auto flex max-w-full items-center gap-1" role="group" aria-label="设备预览">
      <span className="shrink-0 text-11 text-muted-foreground">设备</span>
      <select
        value={deviceId} onChange={(event) => onDevice(event.target.value)}
        data-testid="design-detail-device" aria-label="设备尺寸"
        className="h-7 min-w-0 max-w-full rounded-control border border-border bg-panel px-1 text-11 text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {devices.map((device) => <option key={device.id} value={device.id}>{device.label} {device.w}×{device.h}</option>)}
      </select>
      <button
        type="button" onClick={onLandscape} disabled={!rotatable}
        aria-pressed={landscape && rotatable} data-testid="design-detail-rotate"
        aria-label="旋转设备" title={rotatable ? "横过来看" : "这个尺寸没有竖屏一说"}
        className={cn("inline-flex shrink-0 items-center rounded-control px-1.5 py-1 transition-colors duration-fast disabled:bg-disabled disabled:text-disabled-foreground",
          landscape && rotatable ? "bg-panel text-card-foreground" : "text-muted-foreground hover:bg-panel/60")}
      >
        <RotateCw aria-hidden className="h-3 w-3" />
      </button>
    </div>
  );
}
