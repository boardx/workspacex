import { readAidtResearchMaterial, uploadAidtResearchMaterial, type AidtMaterialContext } from "./aidt-research-materials";

type IdeaText = { title: string; description: string };

function drawText(context: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, maxLines: number, lineHeight: number) {
  let line = "";
  let row = 0;
  for (const character of text.replace(/\s+/gu, " ")) {
    if (context.measureText(line + character).width <= width - 24) {
      line += character;
      continue;
    }
    if (++row === maxLines) {
      context.fillText(line + "…", x, y);
      return;
    }
    context.fillText(line, x, y);
    y += lineHeight;
    line = character;
  }
  context.fillText(line, x, y);
}

export async function createAidtIdeaConceptImage(context: AidtMaterialContext, idea: IdeaText) {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 600;
  const drawing = canvas.getContext("2d");
  if (!drawing) throw new Error("AIDT_CONCEPT_IMAGE_UNAVAILABLE");

  drawing.fillStyle = "#e6eeea";
  drawing.fillRect(0, 0, canvas.width, canvas.height);
  drawing.fillStyle = "#fff";
  drawing.beginPath();
  drawing.roundRect(54, 52, 852, 496, 28);
  drawing.fill();
  drawing.fillStyle = "#14534c";
  drawing.font = "600 24px sans-serif";
  drawing.fillText("点子概念图", 100, 130);
  drawing.fillStyle = "#182b28";
  drawing.font = "700 50px sans-serif";
  drawText(drawing, idea.title, 100, 208, 760, 2, 62);
  drawing.strokeStyle = "#9db9b1";
  drawing.beginPath();
  drawing.moveTo(100, 323);
  drawing.lineTo(860, 323);
  drawing.stroke();
  drawing.font = "28px sans-serif";
  drawText(drawing, idea.description, 100, 381, 760, 4, 39);

  const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("AIDT_CONCEPT_IMAGE_UNAVAILABLE")), "image/png"));
  const file = new File([png], "点子概念图.png", { type: "image/png" });
  const receipt = await uploadAidtResearchMaterial(context, file, "use-existing");
  return (await readAidtResearchMaterial(context, receipt)).reference;
}
