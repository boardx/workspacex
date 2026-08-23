// 故意违规的样例 —— U10 规则必须对它 exit 1。
// 这个文件是门控自身的测试输入，不参与构建（tsconfig 已 exclude）。

export function MotionBad() {
  return (
    <div>
      {/* U10 裸 duration-<数字>，未走语义 token */}
      <div className="transition-all duration-500">裸时长</div>
      {/* U10 内建 ease-linear，未走语义 token */}
      <div className="transition-all duration-base ease-linear">裸曲线</div>
    </div>
  );
}
