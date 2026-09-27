import { makeSticky } from './sticky';
/** Shared fresh object factory for opening and duplicating untouched demo boards. */
export function createPreviewSeedObjects() {
 return [makeSticky(100, 130, '#fff1a8', '让每个想法\n都被看见'), makeSticky(385, 210, '#d8e8ff', '一起画出\n下一步')];
}
