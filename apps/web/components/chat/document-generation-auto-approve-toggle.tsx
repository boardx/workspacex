"use client";
import * as React from "react";
import { FileCheck2 } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import {
  getDocumentGenerationAutoApprove, setDocumentGenerationAutoApprove,
} from "@/lib/document-generation-auto-approve";

/**
 * issue #3440 —— composer 里的「自动批准文档生成所需权限」开关。
 *
 * 默认关闭；打开是用户的**唯一一次显式同意**，此后 PDF/PPTX/DOCX/XLSX 四类文档
 * 生成全程零确认（`apps/api` 的 `tool-permission-gate.ts` + `document-generation-
 * skills.ts`：范围锁死在这四个 skill 各自声明的工具清单上——清单之外的任何调用，
 * 无论这个开关开着还是关着，都照常询问，这条边界与本组件无关，由网关那一侧的
 * 断言守住）。
 *
 * 状态常驻可见、可关闭（`role="switch"` + `aria-checked`）——不是点一下就消失的
 * toast。未登录/请求中读不到状态时按"关闭"渲染（fail closed：宁可让用户重新点一次
 * 开，也不能在不确定当前状态时显示"已开启"）。
 */
export function DocumentGenerationAutoApproveToggle({ disabled }: { disabled?: boolean }) {
  const [enabled, setEnabled] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    getDocumentGenerationAutoApprove()
      .then((status) => { if (!cancelled) { setEnabled(status.enabled); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); }); // 读不到就按关闭渲染，见头注 fail-closed。
    return () => { cancelled = true; };
  }, []);

  const onChange = (next: boolean) => {
    setPending(true);
    const previous = enabled;
    setEnabled(next); // 乐观更新——回执由常驻开关状态本身承担，不需要额外 toast。
    void setDocumentGenerationAutoApprove(next)
      .then((status) => setEnabled(status.enabled))
      .catch(() => setEnabled(previous)) // 写失败回滚，不留一个界面说"开着"而后端其实没生效的假状态。
      .finally(() => setPending(false));
  };

  return (
    <span
      className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-panel px-2 py-1"
      data-testid="chat-document-generation-auto-approve"
      title="打开后，生成 PDF / Word / Excel / PPT 全程不再询问权限"
    >
      <FileCheck2 aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-11 text-muted-foreground">自动批准文档生成所需权限</span>
      <Toggle
        checked={enabled}
        onCheckedChange={onChange}
        label="自动批准文档生成所需权限"
        id="document-generation-auto-approve-toggle"
        disabled={disabled || !loaded || pending}
        data-testid="chat-document-generation-auto-approve-toggle"
      />
    </span>
  );
}
