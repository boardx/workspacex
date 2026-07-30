import { describe, it, expect } from 'vitest';
import { extractNodeGeometry } from '../src/mermaid-parser';

// Fixture mirroring the real mermaid 11 flowchart SVG structure:
// every node also contains a <g class="label"> subtree with its own small
// <rect>, which must NOT be mistaken for the shape.
const LABEL = '<g class="label"><rect width="30" height="12"></rect><foreignObject width="30" height="12"><div><span class="nodeLabel">x</span></div></foreignObject></g>';

const FIXTURE = `
<svg xmlns="http://www.w3.org/2000/svg">
  <g class="nodes">
    <g class="node default" id="flowchart-A-0" transform="translate(100, 50)">
      <rect class="basic label-container" x="-40" y="-20" width="80" height="40"></rect>
      ${LABEL}
    </g>
    <g class="node default" id="flowchart-B-1" transform="translate(100,150)">
      <polygon class="label-container" points="45,0 90,-30 45,-60 0,-30"></polygon>
      ${LABEL}
    </g>
    <g class="node default" id="flowchart-End-2" transform="translate(100, 260)">
      <circle class="basic label-container" r="25"></circle>
      ${LABEL}
    </g>
    <g class="node default" id="flowchart-S-3" transform="translate(100, 360)">
      <g class="basic label-container outer-path">
        <path d="M-30 -15 L30 -15 C38 -15, 38 15, 30 15 L-30 15 C-38 15, -38 -15, -30 -15 Z"></path>
      </g>
      ${LABEL}
    </g>
  </g>
</svg>`;

function parseSvg(str: string): Element {
  const doc = new DOMParser().parseFromString(str, 'image/svg+xml');
  return doc.documentElement;
}

describe('extractNodeGeometry', () => {
  it('reads rect nodes and ignores the label rect', () => {
    const geo = extractNodeGeometry(parseSvg(FIXTURE));
    expect(geo.get('A')).toEqual({ x: 100, y: 50, width: 80, height: 40 });
  });

  it('reads polygon (diamond) nodes via point bounds', () => {
    const geo = extractNodeGeometry(parseSvg(FIXTURE));
    expect(geo.get('B')).toEqual({ x: 100, y: 150, width: 90, height: 60 });
  });

  it('reads circle nodes via radius', () => {
    const geo = extractNodeGeometry(parseSvg(FIXTURE));
    expect(geo.get('End')).toEqual({ x: 100, y: 260, width: 50, height: 50 });
  });

  it('reads path-based shapes (stadium) via coordinate bounds fallback', () => {
    const geo = extractNodeGeometry(parseSvg(FIXTURE));
    const s = geo.get('S');
    expect(s).toBeDefined();
    expect(s!.width).toBeGreaterThanOrEqual(60);
    expect(s!.height).toBeGreaterThanOrEqual(30);
  });

  it('ignores groups without a parseable id', () => {
    const geo = extractNodeGeometry(
      parseSvg('<svg xmlns="http://www.w3.org/2000/svg"><g class="node" id="junk"><rect width="10" height="10"/></g></svg>'),
    );
    expect(geo.size).toBe(0);
  });
});
