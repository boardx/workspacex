// 合规样例 —— lint-design.sh 必须对它 exit 0。
export function Good() {
  return (
    <div>
      <span className="bg-accent text-accent-foreground">语义 token</span>
      <div className="gap-4 p-3" />
      <button className="transition-all duration-200 disabled:bg-disabled disabled:text-disabled-foreground">
        提交
      </button>
      <a className="transition-all duration-200 hover:bg-muted">链接</a>
      <img src="/x.png" alt="示意图" />
      <input className="outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <p className="text-13">表内档位</p>
      <div data-testid="files-tree-node" />
      <p>这条<strong className="font-medium">必须</strong>改用 strong</p>
    </div>
  );
}
