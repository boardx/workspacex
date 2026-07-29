// Counter-proof fixture: four ways to leak error detail into a response.
export function a(res: { json(x: unknown): void }, err: Error) { res.json({ error: err.message }); }
export function b(res: { json(x: unknown): void }, exception: Error) { res.json({ error: String(exception) }); }
export function c(res: { json(x: unknown): void }, e: Error) { res.json({ trace: e.stack }); }
export function d(res: { json(x: unknown): void }, error: unknown) { res.json({ raw: JSON.stringify(error) }); }
