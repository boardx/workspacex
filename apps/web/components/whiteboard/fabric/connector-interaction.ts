/** Connector geometry comes from its endpoints. Its empty bounding rectangle must
 * never intercept objects underneath; Fabric tests rendered stroke/tip/label alpha. */
export function connectorInteraction(kind: string) {
  return kind === "connector" ? {
    perPixelTargetFind: true,
    hasControls: false,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    hoverCursor: "pointer",
  } : {};
}
