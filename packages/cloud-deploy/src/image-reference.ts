/** Docker Hub defaults: omitted registry => docker.io; omitted namespace => library. */
export function canonicalDockerReference(reference: string): string {
  const at = reference.indexOf("@");
  const name = at < 0 ? reference : reference.slice(0, at);
  const digest = at < 0 ? "" : reference.slice(at);
  const slash = name.indexOf("/");
  if (slash < 0) return `docker.io/library/${name}${digest}`;
  const first = name.slice(0, slash);
  if (first === "docker.io" || first === "index.docker.io") {
    const path = name.slice(slash + 1);
    return `docker.io/${path.includes("/") ? path : `library/${path}`}${digest}`;
  }
  if (first.includes(".") || first.includes(":") || first === "localhost") return reference;
  return `docker.io/${reference}`;
}
