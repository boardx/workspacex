import type { Page } from "@playwright/test";

export type NativeAidtPrintObservation = {
  title: string;
  text: string;
  ideaIds: string[];
  imageSources: string[];
  imagesLoaded: boolean;
  event: "beforeprint";
};

/** Observe the real isolated print document. Never replace print(), network, or file delivery. */
export async function observeAidtNativePrint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as typeof window & { __aidtV2Prints?: NativeAidtPrintObservation[]; __aidtV2PrintObserver?: MutationObserver };
    state.__aidtV2PrintObserver?.disconnect();
    state.__aidtV2Prints = [];
    const attach = (frame: HTMLIFrameElement) => {
      if (frame.title !== "研究报告 PDF" || !frame.contentWindow) return;
      frame.contentWindow.addEventListener("beforeprint", () => {
        const doc = frame.contentDocument;
        if (!doc) return;
        const images = Array.from(doc.images);
        state.__aidtV2Prints!.push({ title: doc.title, text: doc.body.innerText,
          ideaIds: Array.from(doc.querySelectorAll<HTMLElement>("[data-idea-id]")).map(node => node.dataset.ideaId!),
          imageSources: images.map(image => image.currentSrc || image.src),
          imagesLoaded: images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0), event: "beforeprint" });
      }, { once: true });
    };
    state.__aidtV2PrintObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLIFrameElement) attach(node);
      }
    });
    state.__aidtV2PrintObserver.observe(document.body, { childList: true });
  });
}

export async function readAidtNativePrints(page: Page): Promise<NativeAidtPrintObservation[]> {
  return page.evaluate(() => (window as typeof window & { __aidtV2Prints?: NativeAidtPrintObservation[] }).__aidtV2Prints ?? []);
}
