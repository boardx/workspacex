// Use-case layer may import domain.
import type { Entity } from "../domain/entity";
export interface Repo { get(id: string): Promise<Entity | null> }
