"""
可复现数据分析脚本
输入: /inputs/d0ea0ab4b7c5919171dc3e516d5285e9a9eec066c78f5a4279257deef306863e/data.csv
口径: 保留重复行；amount 为空值的记录不参与金额合计（不计为0，也不从分母中剔除行数统计）
输出: /workspace/result.csv, /workspace/summary.txt
依赖: pandas (已验证版本见运行输出)
"""
import hashlib
import pandas as pd
from pathlib import Path

INPUT = Path("/inputs/d0ea0ab4b7c5919171dc3e516d5285e9a9eec066c78f5a4279257deef306863e/data.csv")
RESULT_CSV = Path("/workspace/result.csv")
SUMMARY_TXT = Path("/workspace/summary.txt")

# 1. 读取与基本校验
raw_bytes = INPUT.read_bytes()
sha256 = hashlib.sha256(raw_bytes).hexdigest()
df = pd.read_csv(INPUT)

total_rows = len(df)
columns = list(df.columns)
dtypes = df.dtypes.to_dict()

# 2. 数据质量：空值与重复
null_amount_count = int(df["amount"].isna().sum())
duplicate_row_count = int(df.duplicated().sum())  # 完全重复行计数

# 3. 按指定口径计算：保留重复；amount 空值不参与求和（pandas sum 默认 skipna=True）
grouped = df.groupby("team", sort=True)["amount"].sum(min_count=1)  # min_count=1 使全NaN组返回NaN而非0
grouped = grouped.fillna(0).astype(int)  # 本数据集每组至少有一个非空，安全转int
grand_total = int(grouped.sum())

result_df = pd.DataFrame({"team": grouped.index, "amount_sum": grouped.values})
result_df.loc[len(result_df)] = ["TOTAL", grand_total]

# 4. 保存结果表
result_df.to_csv(RESULT_CSV, index=False)

# 5. 保存摘要文本（供 analysis.md 引用）
summary_lines = [
    f"input_sha256: {sha256}",
    f"total_rows: {total_rows}",
    f"columns: {columns}",
    f"dtypes: {dtypes}",
    f"null_amount_count: {null_amount_count}",
    f"duplicate_row_count: {duplicate_row_count}",
    f"group_sums: {dict(zip(result_df['team'], result_df['amount_sum']))}",
    f"grand_total: {grand_total}",
    f"pandas_version: {pd.__version__}",
]
SUMMARY_TXT.write_text("\n".join(summary_lines), encoding="utf-8")

print("\n".join(summary_lines))
print(f"\nresult saved to: {RESULT_CSV}")
print(f"summary saved to: {SUMMARY_TXT}")
