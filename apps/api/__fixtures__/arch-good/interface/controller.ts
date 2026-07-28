// Interface layer may import application (ports) and domain, never infrastructure.
import type { Repo } from "../application/port";
export class Controller { constructor(private readonly repo: Repo) {} }
