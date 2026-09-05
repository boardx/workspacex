// issue #2785 截图用：复用 apps/web 真实 tailwind.config.ts，只把 content 指到 harness 输出 + 真实组件。
require("tsx/cjs");
const path = require("node:path");
const web = path.resolve(__dirname, "..");
const base = require(path.join(web, "tailwind.config.ts"));
const cfg = base.default ?? base;
const out = process.env.OUT || path.join(web, "node_modules/.cache/butterfly-shots");
module.exports = { ...cfg, content: [path.join(out, "index.html"), path.join(web, "components/chat/run-progress-butterfly.tsx")] };
