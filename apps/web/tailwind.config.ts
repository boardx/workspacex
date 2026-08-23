import type { Config } from "tailwindcss";
import { FONT_SCALE } from "./lib/font-scale";

/**
 * ⚠ fontSize 必须来自 `lib/font-scale.ts`（唯一事实源，见 ADR-013 / uiux-standards §1.2）。
 * 在这里手写第二份档位清单会重现 2026-07-09/07-10 的「黑底黑字」事故。
 * `lint-design.sh` 会正则断言本文件不含字面量档位表。
 */
const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontSize: FONT_SCALE as unknown as Record<string, [string, { lineHeight: string }]>,
      fontFamily: {
        sans: ["var(--font-sans)", "Noto Sans SC", "-apple-system", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        "border-subtle": "hsl(var(--border-subtle))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: { DEFAULT: "hsl(var(--background))", foreground: "hsl(var(--background-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        disabled: { DEFAULT: "hsl(var(--disabled))", foreground: "hsl(var(--disabled-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(var(--success-foreground))" },
        warning: { DEFAULT: "hsl(var(--warning))", foreground: "hsl(var(--warning-foreground))" },
        ai: { DEFAULT: "hsl(var(--ai))", foreground: "hsl(var(--ai-foreground))" },
        "ai-tint": { DEFAULT: "hsl(var(--ai-tint))", foreground: "hsl(var(--ai-tint-foreground))" },
        rail: { DEFAULT: "hsl(var(--rail))", foreground: "hsl(var(--rail-foreground))" },
        panel: { DEFAULT: "hsl(var(--panel))", foreground: "hsl(var(--panel-foreground))" },
        "panel-alt": { DEFAULT: "hsl(var(--panel-alt))", foreground: "hsl(var(--panel-alt-foreground))" },
        inverse: { DEFAULT: "hsl(var(--inverse))", foreground: "hsl(var(--inverse-foreground))" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      // 实测骨架尺寸（原型 computed style）：图标栏 76 / 左栏 272 / 右栏 300
      width: { rail: "76px", panel: "272px", "panel-alt": "300px" },
      minWidth: { rail: "76px" },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
      },
      animation: { "fade-in": "fade-in 160ms ease-out" },
      /**
       * ⚠ 语义化动效 token（F03；契约束 motion-microinteraction I-1，ADR 见
       * contracts/motion-microinteraction/domain.md）。三档 fast/base/slow 是
       * 唯一事实源，取值依据与选值过程写在 app/globals.css 顶部注释——不要在这里
       * 重写第二份依据说明（同一事实不得声明在两处，见 AGENTS.md）。
       * `lint-design.sh` U10 规则拦截裸 `duration-<数字>` / 内建 `ease-linear|in|out|in-out`，
       * 只放行这里定义的语义类名（`duration-fast/base/slow`、`ease-fast/base/slow`）。
       */
      transitionDuration: {
        fast: "150ms",
        base: "200ms",
        slow: "300ms",
      },
      transitionTimingFunction: {
        fast: "cubic-bezier(0.4, 0, 0.2, 1)",
        base: "cubic-bezier(0.4, 0, 0.2, 1)",
        slow: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
