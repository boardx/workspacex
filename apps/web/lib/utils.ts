import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { FONT_SCALE_KEYS } from "./font-scale";

/**
 * ⚠ 字号档位从 `font-scale.ts` 取，**不得手抄清单**（ADR-013 / uiux-standards §1.2）。
 * 不登记的后果：`text-13` 这类自定义档位会被 tailwind-merge 当成**文字颜色类**，
 * 与 `text-primary-foreground` 冲突时把颜色吞掉 —— 这就是两次「黑底黑字」事故的机制。
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: FONT_SCALE_KEYS }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
