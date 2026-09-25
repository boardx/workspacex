/**
 * 代码目录的归属——开源方案归属表落到代码上的**唯一事实源**。
 *
 * 归属表（`docs/research/open-source-business-model.md` §2）把东西分成三类：
 *   · oss        开源，Apache-2.0（D1，2026-09-24 人类决策）
 *   · sold       售卖：技能包内容、托管执行、企业治理、市场通道
 *   · ops        不交付 · 内部运营平面
 * 另加一类 **undecided**：归属还没定的目录。它不是「以后再说」的借口——门控会逐个列出它们，
 * 并且**不许**给它们标任何许可证，免得有人顺手一标，替组织做了开源决策。
 *
 * 运营平面名单不在这里重复声明，从 `ops-plane.mjs` 取（同一事实不得声明在两处）。
 */
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { expandOpsDirs } from "./ops-plane.mjs";

/**
 * 企业版边界（C3，D26）：企业版代码一律放在 `packages/ee-*` 或 `apps/ee-*`，按目录名自动归为售卖，
 * 不必逐个登记——新写的 SSO、SCIM 之类只要放对地方，归属与许可证自动正确。
 * 开源部分不得依赖它们，由 `lint-ee-boundary.mjs` 检查。
 */
export const EE_DIR = /^(apps|packages)\/ee-[a-z0-9-]+$/;

export const LICENSE_BY_CLASS = { oss: "Apache-2.0", sold: "UNLICENSED", ops: "UNLICENSED" };

/**
 * Apache-2.0 官方正文（https://www.apache.org/licenses/LICENSE-2.0.txt）的 md5。
 * 开源包必须随代码附上**未经改动**的许可证正文；五份拷贝靠这个哈希保持一致，不会各自漂。
 * 版权方写在 NOTICE 里，不改 LICENSE 正文——Apache 的惯例，也是正文附录自己的要求。
 */
export const APACHE_2_0_MD5 = "3b83ef96387f14655fc854ddc3c6bd57";

/** 除运营平面外的每个工作区目录。新增目录不登记 ⇒ 门控判红，逼着有人做归属判断。 */
export const OWNERSHIP = {
  "packages/contracts": { class: "oss", why: "API 契约：第三方照着它写客户端，是最该开放的包" },
  "packages/local-runtime": { class: "oss", why: "桌面本地版运行时（归属表 OSS 列）" },
  "apps/desktop": { class: "oss", why: "桌面本地版（归属表 OSS 列）" },
  "apps/local-asr-gateway": { class: "oss", why: "桌面本地版的本机语音转写网关" },
  "apps/skill-sandbox": { class: "oss", why: "沙箱（归属表 OSS 列）" },
  "apps/api": { class: "oss", why: "C3 盘点：归属表列的企业功能绝大多数还不存在；已建的 token 配额按 D25 开源；审计日志与平台管理按 D26 开源" },
  "apps/web": { class: "oss", why: "同 apps/api（C3 盘点 + D25、D26）" },
  "packages/dev-mode-accounts": { class: "oss", why: "apps/api 与 apps/web 的开发夹具，归属随它们" },
  "packages/cloud-deploy": { class: "oss", why: "自托管客户要用的部署、TLS、备份与发布工具（D23，2026-09-24 人类决策）；其中阿里云专属部分待改成通用写法" },
  "packages/fabric-markdown": { class: "undecided", why: "vendored 上游分支，仓库里没有记录上游许可证（npm 上也查不到）；需人核实上游许可后保留其声明" },
  "packages/whiteboard-core": { class: "undecided", why: "作者在 README 里明确写了「package remains private until repository license/release policy is settled」，归属待人决定" },
};

/** 仓库里每个带 package.json 的工作区目录，连同它的归属。 */
export function classifyWorkspace(root) {
  const ops = new Set(expandOpsDirs(root, readdirSync, existsSync, join, dirname));
  const out = [];
  for (const top of ["apps", "packages"]) {
    if (!existsSync(join(root, top))) continue;
    for (const e of readdirSync(join(root, top))) {
      const dir = `${top}/${e}`;
      if (!existsSync(join(root, dir, "package.json"))) continue;
      if (ops.has(dir)) out.push({ dir, class: "ops", why: "内部运营平面（lib/ops-plane.mjs）" });
      else if (EE_DIR.test(dir)) out.push({ dir, class: "sold", why: "企业版包（目录名 ee-*，C3 / D26）" });
      else if (OWNERSHIP[dir]) out.push({ dir, ...OWNERSHIP[dir] });
      else out.push({ dir, class: null, why: null });
    }
  }
  return out;
}
