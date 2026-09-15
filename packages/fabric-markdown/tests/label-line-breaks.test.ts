/**
 * `normalizeLabelLineBreaks` —— 节点/边标签里的 `<br>` 换行。
 *
 * 这条测试的来历值得记下来：它不是从需求文档推出来的，是 2026-09-15 **看了一眼
 * 真实渲染截图**才发现的——产业图谱的每个节点上都明晃晃写着
 * `EDA工具<br>国产化: 严重缺失`。在那之前，解析、渲染、类型检查、lint 全绿。
 *
 * 没有任何一层会对一段它不认识的文本报错，它只是忠实地把字面量画出来。
 * 所以这一类缺陷只有两种发现方式：有人真的看一眼，或者有这条测试。
 */
import { describe, expect, it } from 'vitest';
import { normalizeLabelLineBreaks } from '../src/mermaid-parser';

describe('normalizeLabelLineBreaks', () => {
  it.each(['<br>', '<br/>', '<br />', '<BR>', '<Br />'])(
    'mermaid 的三种换行写法及其大小写变体 %s 都变成真换行',
    (br) => {
      expect(normalizeLabelLineBreaks(`EDA工具${br}国产化: 严重缺失`)).toBe('EDA工具\n国产化: 严重缺失');
    },
  );

  it('HTML 转义后的 &lt;br&gt; 同样处理（两条解析路径产出的字符串不同）', () => {
    expect(normalizeLabelLineBreaks('晶圆制造&lt;br&gt;国产化: 部分')).toBe('晶圆制造\n国产化: 部分');
  });

  it('多个换行连续出现时逐个处理', () => {
    expect(normalizeLabelLineBreaks('一<br>二<br/>三')).toBe('一\n二\n三');
  });

  it('每行各自 trim——`a <br> b` 不该留下行首行尾空格（居中会看起来歪）', () => {
    expect(normalizeLabelLineBreaks('车规芯片 <br> 需求高增')).toBe('车规芯片\n需求高增');
  });

  it('没有 br 的标签原样返回，不引入任何变化', () => {
    expect(normalizeLabelLineBreaks('封装测试')).toBe('封装测试');
  });

  it('不误伤名字里带 br 的正常文本', () => {
    expect(normalizeLabelLineBreaks('Brookfield 资本')).toBe('Brookfield 资本');
    expect(normalizeLabelLineBreaks('abbreviation')).toBe('abbreviation');
  });
});
