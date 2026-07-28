// Reverse counter-proof: infrastructure -> application is DEPENDENCY INVERSION and MUST pass.
// A gate that also blocks this line is over-firing, which is just as broken as one that
// misses violations. (This project has two precedents: lint-omission-reason flagged 42
// free-text strings, and lint-contract-source flagged 5 correct z.infer derivations.)
import type { Repo } from "../application/port";
import type { Entity } from "../domain/entity";
export class InMemoryRepo implements Repo {
  async get(_id: string): Promise<Entity | null> { return null; }
}
