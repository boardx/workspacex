// 合规样例 —— U10 规则必须对它 exit 0。
// 这个文件是门控自身的测试输入，不参与构建（tsconfig 已 exclude）。

export function MotionGood() {
  return (
    <div>
      <div className="transition-all duration-fast ease-fast">微反馈</div>
      <div className="transition-all duration-base ease-base">默认档</div>
      <div className="transition-all duration-slow ease-slow">编排档</div>
    </div>
  );
}
