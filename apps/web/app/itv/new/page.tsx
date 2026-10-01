import { redirect } from "next/navigation";

export default function Page({ searchParams }: { searchParams: { projectId?: string } }) {
  const query = new URLSearchParams({ create: "1" });
  if (searchParams.projectId) query.set("projectId", searchParams.projectId);
  redirect(`/itv?${query.toString()}`);
}
