import { missingTemplateFields } from "@repo/fabric-markdown";
import type { CanvasFenceLang } from "@/lib/canvas/canvas-fence";

export function CanvasFieldCompleteness({ code, lang }: { code: string; lang: CanvasFenceLang }) {
  const missing = missingTemplateFields(code, lang === "persona" ? "persona" : undefined);
  if (missing.length === 0) return null;
  return (
    <p role="status" data-testid="canvas-missing-fields" className="border-b border-border-subtle px-3 py-2 text-11 text-muted-foreground">
      尚未填写：{missing.join("、")}。可在最大化画布中补充。
    </p>
  );
}
