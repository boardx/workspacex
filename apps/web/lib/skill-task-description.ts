/** Source maintenance instructions describe storage, not what a skill helps a user do. */
export function skillTaskDescription(item: { readonly duty: string }): string | null {
  const description = item.duty.trim();
  return description.length === 0 || description.includes("文件形式") ? null : description;
}
