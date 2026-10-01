import { homeConfig } from "@repo/contracts";
import type { CSSProperties } from "react";
import type { z } from "zod";
import { readableTextOn } from "./home-config-catalog";

export type ThemeColors = z.infer<typeof homeConfig.ThemeColors>;
export const THEME_LABELS: Record<keyof ThemeColors, string> = {
  primary: "主色", secondary: "辅助色", accent: "强调色", success: "成功", warning: "警告", error: "错误",
};

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function hex(channels: number[]): string {
  return `#${channels.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
function mix(color: string, amount: number): string {
  return hex(rgb(color).map((v) => v + (255 - v) * amount));
}

/** Deterministic quantization: ignore transparent and near-white background pixels. */
export function paletteFromPixels(pixels: Uint8ClampedArray): ThemeColors {
  const buckets = new Map<string, { count: number; sum: number[] }>();
  for (let i = 0; i < pixels.length; i += 4) {
    const channels = [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
    if ((pixels[i + 3] ?? 0) < 192 || Math.min(...channels) > 235) continue;
    const key = channels.map((v) => Math.floor(v / 32)).join(",");
    const bucket = buckets.get(key) ?? { count: 0, sum: [0, 0, 0] };
    bucket.count++;
    channels.forEach((v, index) => { bucket.sum[index] = (bucket.sum[index] ?? 0) + v; });
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()].sort((a, b) => b.count - a.count);
  const dominant = ranked[0];
  if (!dominant) return { ...homeConfig.DEFAULT_HOME_THEME };
  const primary = hex(dominant.sum.map((v) => v / dominant.count));
  const secondaryBucket = ranked.find((b) => {
    const candidate = b.sum.map((v) => v / b.count);
    return candidate.reduce((sum, v, index) => sum + (v - (rgb(primary)[index] ?? 0)) ** 2, 0) > 6400;
  });
  const secondary = secondaryBucket ? hex(secondaryBucket.sum.map((v) => v / secondaryBucket.count)) : mix(primary, 0.25);
  // Status colors keep their established meaning, independent of the logo hue.
  return { ...homeConfig.DEFAULT_HOME_THEME, primary, secondary, accent: mix(secondary, 0.8) };
}

export async function paletteFromImage(src: string): Promise<ThemeColors> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("无法读取 Logo 图片，请重新上传"));
    image.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器不支持图片取色，请手动设置主题颜色");
  context.drawImage(image, 0, 0, 64, 64);
  return paletteFromPixels(context.getImageData(0, 0, 64, 64).data);
}

function hsl(color: string): string {
  const channels = rgb(color);
  const r = channels[0] / 255, g = channels[1] / 255, b = channels[2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  if (delta) {
    hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return `${hue.toFixed(1)} ${(saturation * 100).toFixed(1)}% ${(lightness * 100).toFixed(1)}%`;
}

/** Scoped to the homepage/preview; foregrounds follow WCAG contrast selection. */
export function homeThemeStyle(colors?: ThemeColors | null): CSSProperties {
  if (!colors) return {};
  const variables: Record<string, string> = {};
  Object.entries(colors).forEach(([key, color]) => {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    const token = key === "error" ? "destructive" : key;
    variables[`--${token}`] = hsl(color);
    variables[`--${token}-foreground`] = readableTextOn(color) === "light" ? "0 0% 100%" : "240 6% 8.4%";
  });
  if (/^#[0-9a-f]{6}$/i.test(colors.primary)) {
    variables["--ring"] = hsl(colors.primary);
    variables["--primary-hover"] = hsl(hex(rgb(colors.primary).map((v) => v * 0.85)));
  }
  return variables as CSSProperties;
}
