import type { Page } from "@playwright/test";

export type NativeAidtPrintObservation = {
  title: string;
  text: string;
  ideaIds: string[];
  imageSources: string[];
  imagesLoaded: boolean;
  event: "beforeprint";
  /** Optional copy of the actual isolated print DOM; never substitutes the product print event. */
  printableHtml?: string;
};

/** Observe the real isolated print document. Never replace print(), network, or file delivery. */
export async function observeAidtNativePrint(page: Page, captureDocuments = false): Promise<void> {
  await page.evaluate(captureDocuments => {
    const state = window as typeof window & { __aidtV2Prints?: NativeAidtPrintObservation[]; __aidtV2PrintObserver?: MutationObserver };
    state.__aidtV2PrintObserver?.disconnect();
    state.__aidtV2Prints = [];
    const attach = (frame: HTMLIFrameElement) => {
      if (frame.title !== "研究报告 PDF" || !frame.contentWindow) return;
      frame.contentWindow.addEventListener("beforeprint", () => {
        const doc = frame.contentDocument;
        if (!doc) return;
        const images = Array.from(doc.images);
        let printableHtml: string | undefined;
        if (captureDocuments) {
          const clone = doc.documentElement.cloneNode(true) as HTMLElement;
          const copies = Array.from(clone.querySelectorAll("img"));
          for (let i = 0; i < images.length; i++) {
            const image = images[i]!;
            if (!image.complete || !image.naturalWidth) throw new Error("ACTUAL_PRINT_IMAGE_NOT_READY");
            const canvas = doc.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            canvas.getContext("2d")!.drawImage(image, 0, 0); copies[i]!.src = canvas.toDataURL("image/png");
          }
          printableHtml = `<!doctype html>${clone.outerHTML}`;
        }
        state.__aidtV2Prints!.push({ title: doc.title, text: doc.body.innerText,
          ideaIds: Array.from(doc.querySelectorAll<HTMLElement>("[data-idea-id]")).map(node => node.dataset.ideaId!),
          imageSources: images.map(image => image.currentSrc || image.src),
          imagesLoaded: images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0), event: "beforeprint", ...(printableHtml ? { printableHtml } : {}) });
      }, { once: true });
    };
    state.__aidtV2PrintObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLIFrameElement) attach(node);
      }
    });
    state.__aidtV2PrintObserver.observe(document.body, { childList: true });
  }, captureDocuments);
}

export async function readAidtNativePrints(page: Page): Promise<NativeAidtPrintObservation[]> {
  return page.evaluate(() => (window as typeof window & { __aidtV2Prints?: NativeAidtPrintObservation[] }).__aidtV2Prints ?? []);
}
