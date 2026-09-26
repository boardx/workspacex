"use client";
/**
 * 深度 S10（#3988）—— 属性面板里 image 节点的「图片」字段：选一张图换掉占位，或者移除它回到占位。
 *
 * 选了就生效（不等「应用」）：选文件本身就是「我要这张」，再让人找一个按钮是多一步。
 * 缩图、压质量在 `lib/prototype-image-upload`；这里只管界面和把失败说出来。
 */
import * as React from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { fileToImageSrc } from "@/lib/prototype-image-upload";

export function InspectorImageField({ id, src, busy, onChange }: {
  readonly id: string;
  readonly src: string | undefined;
  readonly busy: boolean;
  /** 新图的 data URL；`null` = 移除，回到占位。 */
  readonly onChange: (src: string | null) => Promise<void>;
}): React.ReactElement {
  const [reading, setReading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const input = React.useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (file === undefined) return;
    setError(null);
    setReading(true);
    try {
      await onChange(await fileToImageSrc(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "没能读这张图");
    } finally {
      setReading(false);
      if (input.current !== null) input.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {src !== undefined && (
        // eslint-disable-next-line @next/next/no-img-element -- data URL（用户上传的图），不是可优化的远程图
        <img src={src} alt="" className="max-h-24 w-full rounded-control border border-border object-cover" data-testid="design-inspector-image-preview" />
      )}
      <div className="flex items-center gap-2">
        <label
          htmlFor={id}
          className="inline-flex cursor-pointer items-center gap-1 rounded-control border border-border px-2 py-1 text-11 text-card-foreground transition-colors duration-fast hover:bg-panel"
        >
          {reading ? <Loader2 aria-hidden className="h-3 w-3 animate-spin" /> : <ImagePlus aria-hidden className="h-3 w-3" />}
          {src === undefined ? "上传一张图" : "换一张"}
        </label>
        <input
          ref={input} id={id} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only"
          disabled={busy || reading}
          onChange={(e) => void pick(e.target.files?.[0])}
          data-testid="design-inspector-image-file"
        />
        {src !== undefined && (
          <button
            type="button" onClick={() => void onChange(null)} disabled={busy || reading}
            className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-11 text-muted-foreground transition-colors duration-fast hover:bg-panel disabled:text-disabled-foreground"
            data-testid="design-inspector-image-clear"
          >
            <Trash2 aria-hidden className="h-3 w-3" /> 移除，回到占位
          </button>
        )}
      </div>
      {error !== null && <p role="alert" className="text-11 text-destructive">{error}</p>}
    </div>
  );
}
