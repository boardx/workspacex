/**
 * 迭代 15 —— 节点动作的纯逻辑。三个入口（面板按钮 / 图层面板 / 键盘）共用这一份，
 * 所以这里测透了，三处就都不会各自跑偏。
 */
import { describe, expect, it } from "vitest";
import { designPrototype } from "@repo/contracts";
import { locate, stripIds, duplicateOps, moveOps, navigate } from "@/lib/prototype-node-actions";

/** 一棵有根、有三个兄弟、其中一个还有孩子的树——上移/下移/进出层级都能验。 */
const tree = (): designPrototype.PrototypeNode[] => [
  {
    id: "root", type: "stack", children: [
      { id: "a", type: "button", props: { label: "甲" } },
      { id: "b", type: "card", props: { title: "乙" }, children: [{ id: "b1", type: "text", props: { content: "乙的孩子" } }] },
      { id: "c", type: "button", props: { label: "丙" } },
    ],
  },
];

describe("locate：家庭关系", () => {
  it("认得父、下标与兄弟；根节点没有父", () => {
    const at = locate(tree(), "b")!;
    expect(at.parent?.id).toBe("root");
    expect(at.index).toBe(1);
    expect(at.siblings.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(locate(tree(), "root")!.parent).toBeNull();
    expect(locate(tree(), "没这个节点")).toBeNull();
  });
});

describe("stripIds：复制必须去 id", () => {
  it("整棵子树的 id 都去掉，其余原样", () => {
    const b = locate(tree(), "b")!.node;
    const copy = stripIds(b) as unknown as { id?: string; children: { id?: string }[]; props: { title: string } };
    // ⭐ 反证：不去 id ⇒ 插进去会有两个 id="b"，之后按 id 寻址一律命中第一个，
    //   表现是"改了 A 却看到 B 变"。这条红。
    expect(copy.id).toBeUndefined();
    expect(copy.children[0]?.id).toBeUndefined();
    expect(copy.props.title).toBe("乙");
  });
});

describe("duplicateOps", () => {
  it("副本紧跟在原节点后面，且没有 id", () => {
    const ops = duplicateOps(tree(), "a")!;
    expect(ops).toHaveLength(1);
    const op = ops[0] as { op: string; parentId: string; index: number; node: { id?: string } };
    expect([op.op, op.parentId, op.index]).toEqual(["insert", "root", 1]);
    expect(op.node.id).toBeUndefined();
  });

  it("根节点不可复制（一页只有一个根）", () => {
    expect(duplicateOps(tree(), "root")).toBeNull();
  });
});

describe("moveOps：先删再插，下标要按删完之后算", () => {
  /** 真的把 op 应用到树上再看顺序——只断言 op 的形状会漏掉"差一格"。 */
  const orderAfter = (id: string, dir: -1 | 1): string[] | null => {
    const before = tree();
    const ops = moveOps(before, id, dir);
    if (ops === null) return null;
    const after = designPrototype.applyPrototypePatch([{ root: before[0]! }], ops);
    const root = after[0]!.root as designPrototype.PrototypeNode & { children: { id?: string }[] };
    return root.children.map((c) => c.id ?? "?");
  };

  it("下移一格就是一格，不是两格也不是原地不动", () => {
    // ⭐ 反证：把插入下标写成 index+2（"删完之后要补回来"的直觉）⇒ 这条红。
    expect(orderAfter("a", 1)).toEqual(["b", "a", "c"]);
  });

  it("上移一格", () => {
    expect(orderAfter("c", -1)).toEqual(["a", "c", "b"]);
  });

  it("到头了返回 null——不发一个什么都不做的请求", () => {
    expect(moveOps(tree(), "a", -1)).toBeNull();
    expect(moveOps(tree(), "c", 1)).toBeNull();
    expect(moveOps(tree(), "root", -1)).toBeNull();
  });

  it("移动**保留** id（和复制相反：它还是同一个节点）", () => {
    const ops = moveOps(tree(), "a", 1)!;
    const ins = ops[1] as { node: { id?: string } };
    // ⭐ 反证：移动时也去 id ⇒ 选中态与连线会指向一个不存在的节点。
    expect(ins.node.id).toBe("a");
  });
});

describe("navigate：键盘四向", () => {
  it("上=父，下=第一个孩子，左右=兄弟", () => {
    expect(navigate(tree(), "b", "up")).toBe("root");
    expect(navigate(tree(), "b", "down")).toBe("b1");
    expect(navigate(tree(), "b", "prev")).toBe("a");
    expect(navigate(tree(), "b", "next")).toBe("c");
  });

  it("走不动返回 null（保持原选中，不清空）", () => {
    // ⭐ 反证：走不动时返回 undefined 并被当成"取消选中" ⇒ 用户按一下方向键选中就没了。
    expect(navigate(tree(), "root", "up")).toBeNull();
    expect(navigate(tree(), "a", "down")).toBeNull();  // 叶子没有孩子
    expect(navigate(tree(), "a", "prev")).toBeNull();
    expect(navigate(tree(), "c", "next")).toBeNull();
  });
});
