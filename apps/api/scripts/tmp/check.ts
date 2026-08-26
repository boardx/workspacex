import { listTemplates } from "@repo/fabric-markdown/templates";
import { buildBuiltinSections } from "../../src/domain/canvas/builtin-template-config";

for (const key of ["bmc", "ai-bmc"]) {
  const t = listTemplates().find((x: any) => x.key === key)!;
  const built = buildBuiltinSections(t as never);
  const grid: (string | null)[][] = Array.from({ length: 8 }, () => Array(12).fill(null));
  for (const s of built) {
    const { col, row, w, h } = s.layout;
    for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) grid[r-1]![c-1] = s.name.slice(0,2);
  }
  console.log(`=== ${key} ===`);
  for (const row of grid) console.log(row.map(c => c ?? "··").join(" "));
  const empty = grid.flat().filter(c => c === null).length;
  console.log(`空格数: ${empty} / 96`);
}
