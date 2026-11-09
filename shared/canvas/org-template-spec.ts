import { canvas } from '../../packages/contracts/src/index';
import { buildAutoTemplateSpec } from './auto-template-layout';
import { buildExplicitTemplateSpec, hasPlacedSection } from './explicit-template-layout';
type Row = (typeof canvas.operations.listTemplates.out)['_output']['templates'][number];
export function orgTemplateSpec(row: Row, key = row.key) {
  const framing = { displayName: row.title || row.displayName, footer: row.footer };
  const { spec } = hasPlacedSection(row.sections)
      ? buildExplicitTemplateSpec({
        key,
        ...framing,
        gridCols: row.gridCols ?? canvas.DEFAULT_GRID_COLS,
        // 行数同理（issue #3358 第 8 项）：编辑器现在能把一张模板存成 16 行，
        // 这里若仍然吃缺省的 8 行，同一份 `layout.row/h` 在真实 chat 里指的是
        // 纸面上另一个位置——列数那条链刚修过的同一个 bug，换成纵轴。
        gridRows: row.gridRows ?? canvas.DEFAULT_GRID_ROWS,
        sections: row.sections
          .filter((s) => s.layout != null)
          .map((s) => (
            {
              sectionId: s.sectionId, name: s.name, layout: s.layout!, type: s.type,
              content: s.content, color: s.color, fontSize: s.fontSize, fontWeight: s.fontWeight,
              hideFieldTitle: s.hideFieldTitle,
              align: s.align, valign: s.valign,
            }
          )),
      })
      : buildAutoTemplateSpec({
        key,
        ...framing,
        // 自动布局算法不认识「文本对象」（它没有 capacity/自动排版的概念，本就只在
        // 拖拽版显式布局里出现）——过滤掉，不喂进一个它不懂的类型。`filter` 本身不
        // 收窄联合类型的字面量成员，显式断言掉已经排除的那一档。
        sections: row.sections
          .filter((s) => s.type !== "文本对象")
          .map((s) => ({ ...s, type: s.type as "便利贴列表" | "短文本" | "长文本" | undefined })),
      });
  return spec;
}
