/**
 * 产物动作条的判据：文件名怎么来。
 *
 * 抽出来是因为「下载」在 jsdom 里没法端到端跑（真下载要浏览器），
 * 但**文件名**恰恰是最容易出错的一段：标题可以是任意用户输入，带 `/` 会被当成
 * 路径分隔、带控制字符在 Windows 上直接写不进去、空标题会落出一个只有扩展名的
 * 隐藏文件。判据写在这里就能被单测钉住；`chat-task-inspector.tsx` 只负责触发。
 */

/** 文件名里一律不允许出现的字符（Windows 保留集 + 路径分隔 + 控制字符）。 */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;
const MAX_STEM = 60;

/**
 * 由产物标题推出下载文件名。
 *
 * 空标题 / 全是非法字符时退回 `产物`——不退回空串，否则落出来的是一个名叫
 * `.md` 的隐藏文件，用户在下载目录里根本看不见它。
 */
export function artifactFileName(title: string, extension = "md"): string {
  const stem = title.replace(UNSAFE, " ").replace(/\s+/g, " ").trim().slice(0, MAX_STEM);
  return `${stem === "" ? "产物" : stem}.${extension}`;
}
