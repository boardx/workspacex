import type { BoardShapeVariant } from "./board-content-adapter";

/** Labels are accessible names and tooltips, never captions inside the icon grid. */
export const BOARD_SHAPE_CATEGORIES = [
  { id: "basic", label: "基础", shapes: [
    { variant: "rectangle", label: "矩形" }, { variant: "rounded-rectangle", label: "圆角矩形" },
    { variant: "circle", label: "圆形" }, { variant: "ellipse", label: "椭圆" },
    { variant: "diamond", label: "菱形" }, { variant: "triangle", label: "三角形" }, { variant: "hexagon", label: "六边形" },
  ] },
  { id: "flow", label: "流程", shapes: [
    { variant: "process", label: "流程" }, { variant: "decision", label: "决策" },
    { variant: "terminator", label: "开始 / 结束" }, { variant: "data", label: "数据" },
    { variant: "predefined-process", label: "预定义流程" },
  ] },
  { id: "resources", label: "资料", shapes: [
    { variant: "cloud", label: "云" }, { variant: "database", label: "数据库" }, { variant: "document", label: "文档" },
  ] },
] as const satisfies readonly { id: string; label: string; shapes: readonly { variant: BoardShapeVariant; label: string }[] }[];
