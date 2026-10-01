import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const original=readFileSync(new URL('../../migrations/20260925130000_whiteboard_trusted_collaboration.sql',import.meta.url),'utf8');
const forward=readFileSync(new URL('../../migrations/20260925140000_whiteboard_commenter_world_anchor.sql',import.meta.url),'utf8');

describe('whiteboard trusted collaboration forward migration',()=>{
  it('leaves the applied migration immutable and upgrades object/world anchors plus commenter ACL',()=>{
    expect(original).toMatch(/object_id text NOT NULL/);
    expect(original).not.toContain('commenter');
    expect(forward).toMatch(/ALTER TABLE whiteboard_comment_threads ALTER COLUMN object_id DROP NOT NULL/);
    expect(forward).toMatch(/CHECK\(role IN \('editor','commenter','viewer'\)\)/);
  });
});
