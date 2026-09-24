/**
 * 车队只读视图：一页静态 HTML，客户端拉 /api/fleet 渲染。无写操作、无外部脚本。
 * 所有值用 textContent 写入（投影里只有哈希、枚举、数字，仍不信任它们做 HTML）。
 */
export const FLEET_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>实例车队</title>
<style>
:root{--bg:#fafafa;--fg:#1a1a1a;--muted:#666;--line:#ddd;--warn:#b45309;--bad:#b91c1c;--ok:#15803d}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#eee;--muted:#999;--line:#333;--warn:#f59e0b;--bad:#f87171;--ok:#4ade80}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
h1{font-size:18px;margin:0 0 12px}section{margin:0 0 16px}
.tiles{display:flex;flex-wrap:wrap;gap:8px}.tile{border:1px solid var(--line);border-radius:6px;padding:8px 12px;min-width:96px}
.tile b{display:block;font-size:20px}.muted{color:var(--muted)}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left}
.wrap{overflow-x:auto}.id{font-family:ui-monospace,monospace}.overdue{color:var(--bad)}.degraded{color:var(--warn)}.down{color:var(--bad)}.healthy{color:var(--ok)}
</style></head><body>
<h1>实例车队 <span class="muted" id="gen"></span></h1>
<section><div class="tiles" id="health"></div></section>
<section><h2 style="font-size:15px">版本 / 版次</h2><div class="tiles" id="dist"></div></section>
<section><h2 style="font-size:15px">实例（逾期 = 超过 2× 上报周期未上报）</h2><div class="wrap"><table>
<thead><tr><th>实例</th><th>版次</th><th>版本</th><th>健康</th><th>最近上报</th></tr></thead><tbody id="rows"></tbody></table></div></section>
<script>
const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=String(x);return e};
const tile=(label,n,c)=>{const d=el("div","tile "+(c||""));d.append(el("b",null,n),el("span","muted",label));return d};
fetch("api/fleet",{credentials:"same-origin"}).then(r=>{if(!r.ok)throw new Error(r.status);return r.json()}).then(p=>{
document.getElementById("gen").textContent="· "+new Date(p.generatedAt).toISOString()+" · 共 "+p.total;
const h=document.getElementById("health");for(const[k,v]of Object.entries(p.health))h.append(tile(k,v,k));
h.append(tile("overdue",p.overdue.length,"overdue"));
const d=document.getElementById("dist");for(const[k,v]of Object.entries(p.byEdition))d.append(tile(k,v));
for(const[k,v]of Object.entries(p.byVersion))d.append(tile("v"+k,v));
const rows=document.getElementById("rows");for(const i of p.instances){const tr=el("tr");
tr.append(el("td","id",i.instanceId.slice(0,12)+"…"),el("td",null,i.edition),el("td",null,i.productVersion),el("td",i.health,i.health),
el("td",i.overdue?"overdue":null,new Date(i.receivedAt).toISOString()+(i.overdue?"（逾期）":"")));rows.append(tr)}
}).catch(e=>{document.body.append(el("p","overdue","加载失败："+e.message))});
</script></body></html>`;
