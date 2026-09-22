export async function apiRequest(path: string) {
  return fetch(path).then((r) => r.json());
}
