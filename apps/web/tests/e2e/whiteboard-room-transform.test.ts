import { describe, expect, it } from "vitest";
import { parseRoomTransform } from "../../e2e/support/room-transform";

describe("parseRoomTransform", () => {
  it.each([
    "translate(-263px,-151px) scale(0.9)",
    "translate(-263px, -151px) scale(0.9)",
    "translate( -263px -151px ) scale( 0.9 )",
  ])("accepts equivalent translate serialization: %s", (serialized) => {
    expect(parseRoomTransform(serialized)).toEqual({
      x: -263,
      y: -151,
      scaleX: 0.9,
      scaleY: 0.9,
      crossX: 0,
      crossY: 0,
    });
  });

  it.each([
    "matrix(0.9,0,0,0.9,-263,-151)",
    "matrix(0.9, 0, 0, 0.9, -263, -151)",
  ])("accepts the computed matrix serialization: %s", (serialized) => {
    expect(parseRoomTransform(serialized)).toEqual({
      x: -263,
      y: -151,
      scaleX: 0.9,
      scaleY: 0.9,
      crossX: 0,
      crossY: 0,
    });
  });

  it.each([
    "translate(-262px, -151px) scale(0.9)",
    "translate(-263px, -151px) scale(1)",
    "matrix(0.9, 0.1, 0, 0.9, -263, -151)",
    "matrix(0.9, 0, 0, 0.9, -263)",
    "matrix(0.9, 0, 0, 0.9, -263, )",
    "not-a-transform",
  ])("does not turn a wrong or malformed value into the expected transform: %s", (serialized) => {
    expect(parseRoomTransform(serialized)).not.toEqual({
      x: -263,
      y: -151,
      scaleX: 0.9,
      scaleY: 0.9,
      crossX: 0,
      crossY: 0,
    });
  });
});
