import { notFound } from "next/navigation";
import { OrgHomeFixture } from "./preview";

/** Explicit opt-in development fixture; never available in production. No auth or API overrides. */
export default function Page() {
  if (process.env.NODE_ENV !== "development" || process.env.WSX_HOME_FIXTURE !== "1") notFound();
  return <OrgHomeFixture />;
}
