import type { survey } from "@repo/contracts";
import { reportChartSvg } from "./report-chart";
import { reportNumber } from "./report-document";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = setTimeout(
      () => reject(new Error("图片加载超时，请检查图片地址后重试")),
      8000,
    );
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.onload = () => {
      clearTimeout(timeout);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("图片加载失败，请检查图片地址及跨域访问权限"));
    };
    image.src = url;
  });
}
async function rasterImage(url: string) {
  const image = await loadImage(url);
  const scale = Math.min(
    1,
    600 / image.naturalWidth,
    740 / image.naturalHeight,
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale)),
    height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("图片转换不可用，请使用支持 Canvas 的浏览器");
  try {
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = Uint8Array.from(
      atob(canvas.toDataURL("image/png").split(",")[1]!),
      (c) => c.charCodeAt(0),
    );
    return { data, width, height };
  } catch {
    throw new Error("图片转换失败，请检查图片跨域访问权限");
  }
}

/** Build the entire document before triggering download, so failures never create partial files. */
export async function buildSurveyReportWord(
  report: survey.CompiledSurveyReport,
): Promise<Blob> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    HeadingLevel,
    ImageRun,
    PageBreak,
  } = await import("docx");
  const children: (
    | InstanceType<typeof Paragraph>
    | InstanceType<typeof Table>
  )[] = [];
  const paragraph = (
    text: string,
    heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel],
  ) =>
    children.push(
      new Paragraph({
        children: text
          .split("\n")
          .map(
            (line, i) =>
              new TextRun({ text: line, ...(i ? { break: 1 } : {}) }),
          ),
        heading,
        spacing: { after: 160 },
        ...(heading ? { keepNext: true } : {}),
      }),
    );
  paragraph(report.title, HeadingLevel.TITLE);
  for (const section of report.sections) {
    paragraph(section.title, HeadingLevel.HEADING_1);
    if (!section.blocks.length) paragraph("本章尚无内容");
    for (const block of section.blocks) {
      if (block.type === "page-break") {
        children.push(new Paragraph({ children: [new PageBreak()] }));
        continue;
      }
      paragraph(block.title, HeadingLevel.HEADING_2);
      if (block.text) paragraph(block.text);
      let image: Awaited<ReturnType<typeof rasterImage>> | undefined;
      if (block.type === "image") {
        if (!block.imageUrl)
          throw new Error(`图片「${block.title}」尚未配置，无法完整导出`);
        image = await rasterImage(block.imageUrl);
      } else if (
        ["bar", "radar", "line"].includes(block.type) &&
        block.rows.length
      ) {
        const svg = reportChartSvg(block);
        const url = URL.createObjectURL(
          new Blob([svg], { type: "image/svg+xml" }),
        );
        try {
          image = await rasterImage(url);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      if (image)
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                type: "png",
                data: image.data,
                transformation: { width: image.width, height: image.height },
              }),
            ],
          }),
        );
      if (block.caption) paragraph(block.caption);
      if (!["text", "image"].includes(block.type)) {
        if (block.answerTexts?.length) {
          for (const answer of block.answerTexts) {
            paragraph(answer.label);
            paragraph(answer.value);
          }
        } else if (!block.rows.length) paragraph("暂无可展示数据");
        else if (block.type === "metric") {
          for (const row of block.rows) paragraph(`${[row.label, row.group].filter(Boolean).join(" · ")}：${reportNumber(row.value)}（有效样本 ${row.count}）`);
        } else if (["table", "gap"].includes(block.type)) {
          const values = [
            [
              "指标",
              "数值",
              "有效样本",
              ...(block.type === "gap" ? ["目标", "差距"] : []),
            ],
            ...block.rows.map((row) => [
              [row.label, row.group].filter(Boolean).join(" · "),
              reportNumber(row.value),
              String(row.count),
              ...(block.type === "gap"
                ? [
                    row.target === undefined
                      ? "未设置"
                      : reportNumber(row.target),
                    row.gap === undefined ? "无法计算" : reportNumber(row.gap),
                  ]
                : []),
            ]),
          ];
          children.push(
            new Table({
              rows: values.map(
                (cells, i) =>
                  new TableRow({
                    tableHeader: i === 0,
                    children: cells.map(
                      (text) =>
                        new TableCell({ children: [new Paragraph(text)] }),
                    ),
                  }),
              ),
            }),
          );
        }
      }
      [...block.issues, ...(block.warnings ?? [])].forEach((paragraphText) =>
        paragraph(paragraphText),
      );
    }
  }
  return Packer.toBlob(
    new Document({
      styles: {
        default: { document: { run: { font: "Noto Sans SC", size: 22 } } },
      },
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
            },
          },
          children,
        },
      ],
    }),
  );
}
export async function exportSurveyReportWord(
  report: survey.CompiledSurveyReport,
) {
  const blob = await buildSurveyReportWord(report),
    url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.title.replace(/[\\/:*?"<>|]/g, "-") || "调研报告"}.docx`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Isolated native print uses the whole report, not a screenshot of the scroll viewport. */
export async function printSurveyReport(
  reportRoot: HTMLElement,
): Promise<void> {
  if (reportRoot.querySelector("[data-report-image-error]"))
    throw new Error("图片加载失败，无法完整打印报告");
  const frame = document.createElement("iframe");
  frame.title = "调研报告 PDF";
  frame.style.cssText = "position:fixed;width:0;height:0;border:0";
  document.body.append(frame);
  const imageUrls: string[] = [];
  const cleanup = () => {
    imageUrls.forEach((url) => URL.revokeObjectURL(url));
    frame.remove();
  };
  try {
    const target = frame.contentDocument,
      view = frame.contentWindow;
    if (!target || !view) throw new Error("浏览器不支持打印报告");
    const report = target.importNode(reportRoot, true);
    report
      .querySelectorAll("[data-report-ui],button,input,textarea,script")
      .forEach((node) => node.remove());
    const style = target.createElement("style");
    style.textContent =
      '@page{size:A4;margin:20mm}body{font:11pt/1.8 "Noto Sans SC",sans-serif;color:#111}article{padding:0!important}h1{font-size:22pt}h2{font-size:17pt;margin-top:22pt}h3{font-size:13pt}h1,h2,h3{break-after:avoid}p{white-space:pre-wrap;orphans:3;widows:3}table{width:100%;border-collapse:collapse;font-size:10pt}th,td{padding:6pt;border-bottom:1px solid #bbb;text-align:left}tr,figure,svg{break-inside:avoid}thead{display:table-header-group}svg,img{max-width:100%;height:auto}svg{width:100%;color:#222}figcaption,ul{font-size:10pt}[data-page-break]{break-after:page}[data-report-block]{margin-bottom:20pt}';
    target.head.append(style);
    target.body.append(report);
    target.title = reportRoot.querySelector("h1")?.textContent ?? "调研报告";
    // Replace external sources with self-contained pixels before opening the print dialog.
    for (const image of Array.from(report.querySelectorAll("img"))) {
      const pixels = await rasterImage(image.src);
      const blob = new Blob([pixels.data], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      imageUrls.push(url);
      image.src = url;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("图片加载失败，无法打印"));
        if (image.complete && image.naturalWidth) resolve();
      });
    }
    await target.fonts?.ready;
    view.addEventListener("afterprint", cleanup, { once: true });
    // Hidden frames can suspend animation callbacks indefinitely. Yield a bounded
    // task after fonts and images are ready; native print performs final layout.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    view.focus();
    view.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}
