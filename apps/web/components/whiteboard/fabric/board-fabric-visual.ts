/** Renderer chrome only: never persisted into a Board object or a Yjs operation. */
export const BOARD_FABRIC_VISUAL = {
  fontFamily: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  selection: {
    borderColor: '#0B6FFF', borderScaleFactor: 1, borderOpacityWhenMoving: 1,
    cornerColor: '#FFFFFF', cornerStrokeColor: '#0B6FFF', cornerStyle: 'circle' as const,
    transparentCorners: false, cornerSize: 9, touchCornerSize: 44,
  },
  marquee: { selectionColor: 'rgba(11,111,255,0.06)', selectionBorderColor: '#0B6FFF', selectionLineWidth: 1 },
  sticky: { radius: 3, padding: 24, shadow: 'rgba(15,23,42,0.14) 0px 5px 14px' },
  grid: { background: '#FCFCFB', color: '#D8DEE7', radius: 0.55, worldStep: 20, minScreenStep: 16, maxScreenStep: 40 },
} as const;

/** Dyadic grid keeps a world origin at every zoom without dense low-zoom moiré. */
export function boardDotGridStyle(viewport: { zoom: number; panX: number; panY: number }) {
  const {grid}=BOARD_FABRIC_VISUAL;
  let spacing=grid.worldStep*Math.max(0.05,Math.min(8,Number.isFinite(viewport.zoom)?viewport.zoom:1));
  while(spacing<grid.minScreenStep)spacing*=2;
  while(spacing>grid.maxScreenStep)spacing/=2;
  return {
    backgroundColor: grid.background,
    backgroundImage: `radial-gradient(circle, ${grid.color} ${grid.radius}px, transparent ${grid.radius}px)`,
    backgroundSize: `${spacing}px ${spacing}px`,
    // Radial gradients center each tile, so subtract half a tile to anchor dots at world zero.
    backgroundPosition: `${viewport.panX-spacing/2}px ${viewport.panY-spacing/2}px`,
  };
}
