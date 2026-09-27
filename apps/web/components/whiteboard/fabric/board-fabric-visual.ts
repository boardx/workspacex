/** Renderer chrome only: never persisted into a Board object or a Yjs operation. */
export const BOARD_FABRIC_VISUAL = {
  fontFamily: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  selection: {
    borderColor: '#2563EB', borderScaleFactor: 1, borderOpacityWhenMoving: 1,
    cornerColor: '#FFFFFF', cornerStrokeColor: '#2563EB', cornerStyle: 'circle' as const,
    transparentCorners: false, cornerSize: 10, touchCornerSize: 44,
  },
  marquee: { selectionColor: 'rgba(37,99,235,0.06)', selectionBorderColor: '#2563EB', selectionLineWidth: 1 },
  sticky: { radius: 2, shadow: 'rgba(15,23,42,0.12) 0px 2px 5px' },
  grid: { color: '#DCE2E9', radius: 0.65, worldStep: 24, minScreenStep: 16, maxScreenStep: 48 },
} as const;

/** Dyadic grid keeps a world origin at every zoom without dense low-zoom moiré. */
export function boardDotGridStyle(viewport: { zoom: number; panX: number; panY: number }) {
  const {grid}=BOARD_FABRIC_VISUAL;
  let spacing=grid.worldStep*Math.max(0.05,Math.min(8,Number.isFinite(viewport.zoom)?viewport.zoom:1));
  while(spacing<grid.minScreenStep)spacing*=2;
  while(spacing>grid.maxScreenStep)spacing/=2;
  return {
    backgroundImage: `radial-gradient(circle, ${grid.color} ${grid.radius}px, transparent ${grid.radius}px)`,
    backgroundSize: `${spacing}px ${spacing}px`,
    // Radial gradients center each tile, so subtract half a tile to anchor dots at world zero.
    backgroundPosition: `${viewport.panX-spacing/2}px ${viewport.panY-spacing/2}px`,
  };
}
