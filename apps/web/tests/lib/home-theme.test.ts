import { describe, expect, it } from "vitest";
import { homeConfig } from "@repo/contracts";
import { homeThemeStyle, paletteFromPixels } from "@/lib/home-theme";
import { toFormState, toUpdateInput, validateForm } from "@/components/org-admin/home-config-form-model";
import type { HomeConfig } from "@/lib/live-home-config";

const config: HomeConfig = {
  orgId: "o1", title: "Team", tagline: null, bannerHeadline: "Work together", bannerTagline: "",
  bannerPreset: "ocean", bannerColor: null, bannerImageUrl: null,
  quickActions: [], recommendedCapabilities: [], recommendedAgents: [],
  sections: { recentWork: true, currentTasks: true }, updatedAt: "", updatedBy: null,
};
describe("organization homepage brand palette", () => {
  it("ignores transparent and white backgrounds and selects two distinct logo colors", () => {
    const palette = paletteFromPixels(new Uint8ClampedArray([
      255,255,255,255, 255,0,0,0, 30,90,210,255, 30,90,210,255, 20,160,140,255,
    ]));
    expect(palette.primary).toBe("#1E5AD2");
    expect(palette.secondary).toBe("#14A08C");
    expect(homeConfig.ThemeColors.safeParse(palette).success).toBe(true);
    expect(palette.error).toBe(homeConfig.DEFAULT_HOME_THEME.error);
  });
  it("falls back for an empty/transparent logo and handles monochrome logos", () => {
    expect(paletteFromPixels(new Uint8ClampedArray([0,0,0,0]))).toEqual(homeConfig.DEFAULT_HOME_THEME);
    expect(paletteFromPixels(new Uint8ClampedArray([0,0,0,255])).primary).toBe("#000000");
  });
  it("keeps theme in update payload and rejects malformed colors", () => {
    const form = toFormState(config);
    form.themeColors.primary = "#123456";
    expect(toUpdateInput(form).themeColors?.primary).toBe("#123456");
    expect(validateForm(form)).toEqual({});
    form.themeColors.primary = "red";
    expect(validateForm(form).themeColors).toBeTruthy();
    expect(homeConfig.ThemeColors.safeParse(form.themeColors).success).toBe(false);
  });
  it("scopes CSS variables and chooses readable foregrounds for bright and dark colors", () => {
    const style = homeThemeStyle({ ...homeConfig.DEFAULT_HOME_THEME, primary: "#FFFFFF", secondary: "#000000" }) as Record<string,string>;
    expect(style["--primary-foreground"]).toBe("240 6% 8.4%");
    expect(style["--secondary-foreground"]).toBe("0 0% 100%");
    expect(homeThemeStyle(null)).toEqual({});
  });
});
