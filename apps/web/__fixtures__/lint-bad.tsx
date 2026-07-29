// 故意违规的样例 —— lint-design.sh 必须对它 exit 1 并报出全部类别。
// 这个文件是门控自身的测试输入，不参与构建（tsconfig 已 exclude）。
export function Bad() {
  return (
    <div>
      {/* U5a 硬编码颜色 + Tailwind 调色板类 */}
      <span className="text-[#ff0000] bg-slate-200">红</span>
      {/* U5b 任意值像素间距 */}
      <div className="p-[11px] gap-[23px]" />
      {/* U1.1 禁用态用 opacity */}
      <button className="disabled:opacity-50">提交</button>
      {/* U1.2 opacity 表达状态 */}
      <a className="hover:opacity-70">链接</a>
      {/* U4 hover 无 transition */}
      <div className="hover:bg-muted" />
      {/* U7a img 缺 alt */}
      <img src="/x.png" />
      {/* U7b 裸 outline-none */}
      <input className="outline-none" />
      {/* §1.2 表外字号档位 */}
      <p className="text-15">表外档位</p>
      {/* D-35 testid 携带业务数据 */}
      <div data-testid="files-node-合同2024" />
      {/* MD JSX 文本里残留 Markdown 加粗 */}
      <p>这条**必须**改用 strong</p>
    </div>
  );
}
