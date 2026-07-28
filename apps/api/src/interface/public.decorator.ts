import { SetMetadata } from "@nestjs/common";

/**
 * Marks a route as not requiring a principal.
 *
 * Note the polarity: protection is the DEFAULT (the Guard is registered globally) and
 * exemptions are explicit. The other way round -- public by default, annotate what needs
 * protecting -- means one missed annotation is a silent authorization hole, and nothing
 * would ever report it.
 */
export const IS_PUBLIC = "kernel:isPublic";
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
