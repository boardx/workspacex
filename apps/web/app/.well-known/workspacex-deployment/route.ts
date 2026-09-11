/** A non-secret deployment identity for public ingress verification. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(): Promise<Response> {
  const deploymentMarker = process.env.WORKSPACEX_DEPLOYMENT_MARKER;
  const headers = { "Cache-Control": "no-store, max-age=0" };
  if (!deploymentMarker) {
    return Response.json({ error: "DEPLOYMENT_MARKER_UNAVAILABLE" }, { status: 503, headers });
  }
  return Response.json({ deploymentMarker }, { headers });
}
