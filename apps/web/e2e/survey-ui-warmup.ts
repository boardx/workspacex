import { request, type FullConfig } from "@playwright/test";

/** Compile local UI routes before timing interactions; never bypass authentication. */
export default async function warmSurveyUi(config: FullConfig) {
  const context = await request.newContext({ baseURL: config.projects[0]?.use.baseURL });
  try {
    for (const route of ["/home", "/studio/survey", "/studio/survey/new/design", "/studio/survey/acceptance-warmup/responses"]) {
      const response = await context.get(route);
      if (response.status() >= 500) throw new Error(`Survey route warmup failed: ${route} HTTP ${response.status()}`);
    }
  } finally {
    await context.dispose();
  }
}
