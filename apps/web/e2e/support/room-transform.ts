const NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?";
const NUMBER_VALUE = new RegExp(`^${NUMBER}$`, "i");
const TRANSLATE_SCALE = new RegExp(
  `^translate\\(\\s*(${NUMBER})px\\s*(?:,\\s*|\\s+)(${NUMBER})px\\s*\\)\\s*scale\\(\\s*(${NUMBER})\\s*\\)$`,
  "i",
);

export type RoomTransform = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  crossX: number;
  crossY: number;
};

function finiteNumbers(serialized: string, expected: number): number[] | null {
  const parts = serialized.split(",").map((part) => part.trim());
  if (parts.some((part) => !NUMBER_VALUE.test(part))) return null;
  const values = parts.map(Number);
  return values.length === expected && values.every(Number.isFinite) ? values : null;
}

/**
 * Decode the two serializations Chromium may expose for the room viewport:
 * the authored translate/scale value and the computed 2D matrix value.
 * Returning the cross terms lets the caller reject a rotated or skewed matrix
 * that happens to have the same translation and apparent scale.
 */
export function parseRoomTransform(serialized: string): RoomTransform | null {
  const authored = TRANSLATE_SCALE.exec(serialized.trim());
  if (authored) {
    const x = Number(authored[1]);
    const y = Number(authored[2]);
    const scale = Number(authored[3]);
    if (![x, y, scale].every(Number.isFinite)) return null;
    return { x, y, scaleX: scale, scaleY: scale, crossX: 0, crossY: 0 };
  }

  const matrix = /^matrix\((.*)\)$/i.exec(serialized.trim());
  if (!matrix) return null;
  const values = finiteNumbers(matrix[1]!, 6);
  if (!values) return null;
  const scaleX = values[0]!;
  const crossX = values[1]!;
  const crossY = values[2]!;
  const scaleY = values[3]!;
  const x = values[4]!;
  const y = values[5]!;
  return { x, y, scaleX, scaleY, crossX, crossY };
}
