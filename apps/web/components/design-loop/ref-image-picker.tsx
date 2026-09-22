"use client";
/**
 * 迭代 23 —— **新建时就能带参考图**的选择器（"照这个画"）。
 *
 * ## 为什么不直接复用 `RefImageStrip`
 *
 * 那一份的每一个动作都是**对一个已存在项目**的 API 调用（`uploadRefImage(projectId, …)`）。
 * 新建弹窗里还没有 projectId——用户正是在这一刻手里攥着一张截图。此前的路径是：
 * 先建一个空项目 → 进详情页 → 传图 → 再说一句"照这个画"。一件事被拆成四步，
 * 而第一步要求他先给一个还不存在的东西起名字。
 *
 * 所以这里只在内存里攥住 `File`，由调用方在项目建好之后统一上传。
 * 三条入口与 `RefImageStrip` 保持一致（按钮 / 拖进来 / 直接粘贴）——**粘贴是截图党的
 * 主路径**，而"我有一张截图，照这个画"正是这个入口最主要的用法，少了它等于没做。
 *
 * ## 校验只做前端真的知道的那一件事
 *
 * 张数上限。类型与大小仍由服务端按字节判（`file.type` 是浏览器猜的，改个扩展名就能骗过）
 * ——与 `RefImageStrip` 同一条纪律，这里不抢着判一遍再判错。
 */
import * as React from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PROTOTYPE_MAX_REF_IMAGES } from "@/lib/live-design-workbench";

export function RefImagePicker({
  files,
  onChange,
  disabled = false,
}: {
  readonly files: readonly File[];
  readonly onChange: (next: readonly File[]) => void;
  readonly disabled?: boolean;
}): React.ReactElement {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const full = files.length >= PROTOTYPE_MAX_REF_IMAGES;

  /*
   * 缩略图用 object URL。**必须在 files 变了之后撤销旧的**，否则每换一张就泄一个 blob；
   * 这个弹窗会被反复打开关闭，泄漏是累积的。
   */
  const [urls, setUrls] = React.useState<readonly string[]>([]);
  React.useEffect(() => {
    const made = files.map((f) => URL.createObjectURL(f));
    setUrls(made);
    return () => { for (const u of made) URL.revokeObjectURL(u); };
  }, [files]);

  const add = (incoming: readonly File[]) => {
    if (disabled) return;
    const room = PROTOTYPE_MAX_REF_IMAGES - files.length;
    if (room <= 0) return;
    onChange([...files, ...incoming.slice(0, room)]);
  };

  /*
   * 粘贴挂在容器上而不是 window：弹窗之外还有别的粘贴用途（标签输入框、问题描述），
   * 挂在 window 上会把用户粘进文本框的图也吞掉。
   */
  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (imgs.length > 0) { e.preventDefault(); add(imgs); }
  };

  return (
    <div className="flex flex-col gap-1" data-testid="ref-image-picker" onPaste={onPaste}>
      <span className="text-11 font-medium text-muted-foreground">
        参考图（可选，最多 {PROTOTYPE_MAX_REF_IMAGES} 张）
      </span>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/")));
        }}
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-control border border-dashed p-2 transition-colors duration-fast",
          dragging ? "border-primary" : "border-border",
        )}
      >
        {files.map((f, i) => (
          <span key={`${f.name}-${String(i)}`} className="relative" data-testid={`ref-image-picked-${String(i)}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- 本地 object URL，没有远端地址可给 next/image */}
            <img src={urls[i] ?? ""} alt={f.name} className="h-12 w-12 rounded-control object-cover" />
            <button
              type="button"
              aria-label={`移除 ${f.name}`}
              data-testid={`ref-image-remove-${String(i)}`}
              disabled={disabled}
              onClick={() => onChange(files.filter((_, k) => k !== i))}
              className="absolute -right-1 -top-1 rounded-full bg-card p-0.5 text-muted-foreground shadow transition-colors duration-fast hover:text-background-foreground"
            >
              <X aria-hidden className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Button
          type="button" variant="ghost" size="sm" disabled={disabled || full}
          onClick={() => inputRef.current?.click()} data-testid="ref-image-pick"
        >
          <ImagePlus aria-hidden className="h-3.5 w-3.5" />
          {files.length === 0 ? "照着一张图画" : "再加一张"}
        </Button>
        <input
          ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden
          data-testid="ref-image-input"
          onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = ""; }}
        />
      </div>
      <p className="text-10 text-muted-foreground">
        {full
          ? `已经 ${PROTOTYPE_MAX_REF_IMAGES} 张了，去掉一张才能再加。`
          : "拖进来、粘贴截图，或点上面的按钮。生成时 AI 会照着它画。"}
      </p>
    </div>
  );
}
