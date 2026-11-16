"use client";
import { Button } from "@/components/ui/button";

/** Host-supplied plain text. It is neither a message nor an automatic model instruction. */
export type DesignComposerContextOffer = Readonly<{ id: string; label: string; text: string }>;
export function ComposerContextOffer({ offer, occupied, sending, onAccept }: {
  offer: DesignComposerContextOffer; occupied: boolean; sending: boolean; onAccept: () => void;
}) {
  return <section className="space-y-2 border-t border-border px-3 py-2 text-12" aria-label="待审阅制作说明" data-testid="design-composer-context-offer">
    <details><summary className="cursor-pointer font-medium">{offer.label}</summary><p className="mt-2 whitespace-pre-wrap break-words">{offer.text}</p></details>
    <Button type="button" size="sm" variant="outline" disabled={occupied || sending} onClick={onAccept}>带入制作说明到输入框</Button>
    <p role="status" className="text-muted-foreground">{occupied ? "输入框已有未发送内容，未覆盖；请先处理原草稿。" : sending ? "正在发送，待本次请求结束后再带入。" : "带入只填写现有输入框；请审阅、修改后自行发送，才会调用原生Design。"}</p>
  </section>;
}
