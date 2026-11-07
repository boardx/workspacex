import { OwnActivityDisplay } from "@repo/contracts/identity";
import type { MessageKey, MessageParams } from "./messages";
type Translate = (key: MessageKey, params?: MessageParams) => string;
/** Validate metadata separately so older/newer servers always retain a readable source summary. */
export function activitySummary(event: { summary: string; display?: unknown }, t: Translate): string {
  const result = OwnActivityDisplay.safeParse(event.display);
  if (!result.success) return event.summary;
  const display = result.data;
  switch (display.code) {
    case "profile-renamed":
      return display.params.displayName ? t("activity.profileRenamed", { displayName: display.params.displayName }) : t("activity.profileRenamedGeneric");
    case "avatar-changed":
      return t(display.params.cleared ? "activity.avatarCleared" : "activity.avatarChanged");
    case "password-changed":
      return t("activity.passwordChanged");
    case "team-created":
      return display.params.name ? t("activity.teamCreated", { name: display.params.name }) : t("activity.teamCreatedGeneric");
    case "team-renamed":
      return display.params.name ? t("activity.teamRenamed", { name: display.params.name }) : t("activity.teamRenamedGeneric");
    case "team-deleted":
      return display.params.name ? t("activity.teamDeleted", { name: display.params.name }) : t("activity.teamDeletedGeneric");
  }
}
