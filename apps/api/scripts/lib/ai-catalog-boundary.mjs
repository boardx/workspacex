import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
/** The catalog's narrowly exempted configuration stores are callable only through this audited boundary. */
export function verifyAiCatalogBoundary(root) {
  const read = (p) => readFileSync(join(root, p), "utf8");
  const controller = read(
    "src/interface/controllers/ai-catalog-admin.controller.ts",
  );
  const platformRoutes = [
    ...controller.matchAll(/@(?:Get|Post|Patch)\(['"]\/platform[^'"]*['"]\)/g),
  ];
  if (
    platformRoutes.length !==
    [...controller.matchAll(/@UseGuards\(PlatformOperatorGuard\)/g)].length
  )
    throw new Error("ai_catalog_unguarded_platform_route");
  for (const method of [
    "list",
    "detail",
    "create",
    "update",
    "publish",
    "disable",
  ]) {
    const pattern = new RegExp(
      "@UseGuards\\(PlatformOperatorGuard\\)[\\s\\S]*?async " + method + "\\(",
    );
    if (!pattern.test(controller))
      throw new Error(`ai_catalog_missing_platform_guard:${method}`);
    const before = controller.slice(0, controller.indexOf(`async ${method}(`));
    if (
      before.lastIndexOf("@UseGuards(PlatformOperatorGuard)") <
      before.lastIndexOf("async ")
    )
      throw new Error(`ai_catalog_guard_not_adjacent:${method}`);
  }
  if (/\.query\(/.test(controller))
    throw new Error("ai_catalog_controller_sql");
  const service = read("src/application/ai-catalog/admin-service.ts")
    .replace(/\s/g, "")
    .replaceAll('"', "'");
  if (/\.query\(|\.withoutTenant\(/.test(service))
    throw new Error("ai_catalog_service_sql");
  if (
    !service.includes("p.orgId!==orgId") ||
    !service.includes("m.orgRole!=='admin'")
  )
    throw new Error("ai_catalog_membership_gate");
  for (const [method, gate] of [
    ["publicList", "orgMember(p,orgId)"],
    ["enable", "orgMember(p,orgId,true)"],
  ]) {
    const body = service.slice(service.indexOf(`async${method}(`));
    if (body.indexOf(gate) < 0 || body.indexOf(gate) > body.indexOf("this.db."))
      throw new Error(`ai_catalog_gate_order:${method}`);
  }
  const reviewPath = "src/interface/controllers/platform-skill-review.controller.ts";
  const review = read(reviewPath).replace(/\s/g, "");
  if (!review.includes("@UseGuards(PlatformOperatorGuard)@Controller()exportclassPlatformSkillReviewController"))
    throw new Error("ai_catalog_unguarded_legacy_review");
  for (const method of ["scan", "submit", "review"]) {
    const body = review.slice(review.indexOf(`async${method}(`));
    if (body.indexOf("awaitthis.catalog.assertReviewTarget(orgId)") < 0 ||
        body.indexOf("awaitthis.catalog.assertReviewTarget(orgId)") > body.indexOf(`this.actions.${method}(`))
      throw new Error(`ai_catalog_legacy_target_gate:${method}`);
  }
  const allowed = new Set([
    "src/kernel.module.ts",
    "src/infrastructure/ai-catalog/catalog-storage.ts",
  ]);
  const walk = (dir) =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(`${dir}/${e.name}`)
        : e.name.endsWith(".ts")
          ? [`${dir}/${e.name}`]
          : [],
    );
  for (const path of walk("src")) {
    const text = read(path);
    if (
      /from ["'][^"']*ai-catalog\/admin-service["']/.test(text) &&
      ![
        "src/kernel.module.ts",
        "src/interface/controllers/ai-catalog-admin.controller.ts",
        reviewPath,
      ].includes(path)
    )
      throw new Error(`ai_catalog_unguarded_service_consumer:${path}`);

    if (
      /from ["'][^"']*(?:ai-catalog\/catalog-storage|ai-catalog\/agent-adapter|skill\/ai-catalog-skill-storage)["']/.test(
        text,
      ) &&
      !allowed.has(path)
    )
      throw new Error(`ai_catalog_untrusted_consumer:${path}`);
  }
  for (const path of [
    "src/infrastructure/ai-catalog/catalog-storage.ts",
    "src/infrastructure/ai-catalog/agent-adapter.ts",
    "src/infrastructure/skill/ai-catalog-skill-storage.ts",
  ]) {
    if (/\.withoutTenant\(/.test(read(path)))
      throw new Error(`ai_catalog_global_read:${path}`);
  }
}
