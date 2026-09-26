#!/usr/bin/env bash
# Put the chat + embedding models into the desktop bundle (apps/desktop/models), so the DMG
# needs no download on first start. Pulls them into the local Ollama store first if missing,
# then exports exactly those manifests + blobs (packages/local-runtime/src/model-bundle.ts).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STORE="${OLLAMA_MODELS:-$HOME/.ollama/models}"
# 模型集合按平台分（人类决策 2026-09-24：体积优先，接受没有 GGUF 退路）。
#
# Apple Silicon 上 `preferredChatModel` 只会选 `-mlx` 那个（实测 2026-09-22：同一提示、
# 温机，首 token 3 984 → 2 106 ms），GGUF 那份一行都不会被加载——它**只是退路**：
# MLX 运行器起不来时 `up.ts` 回落到它。
#
# ⚠ 去掉 GGUF 就是**去掉那条退路**，代价不是「变慢」而是那台机器**完全没有聊天**。
#   实测两份权重不共享任何 blob：qwen3.5:4b = 3.16 GB、qwen3.5:4b-mlx = 3.70 GB。
#   已知会让 MLX 起不来的处境（实测/推断见 evidence 里 R19 那节）：
#     · 虚拟机里没有 GPU 直通（MLX 报 device=gpu，没有 CPU 退路）
#     · 8 GB 机型（本机 16 GB 时可用 VRAM 11.8 GiB ≈ 74%，8 GB 按比例约 5.9 GB，
#       而 MLX 那份比 GGUF 还大 0.54 GB；llama.cpp 能 mmap 让系统分页，MLX 不行）
#   所以这条路径的文案必须说人话、给出路——见 up.ts 里那条 warning。
#
# 要改回「两份都带」：MODELS="qwen3.5:4b,qwen3.5:4b-mlx,..." 覆盖即可，不用改代码。
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) DEFAULT_MODELS="qwen3.5:4b-mlx,qwen3.5:2b,qwen3-embedding:0.6b" ;;
  *)            DEFAULT_MODELS="qwen3.5:4b,qwen3.5:2b,qwen3-embedding:0.6b" ;;
esac
MODELS="${MODELS:-$DEFAULT_MODELS}"
command -v ollama >/dev/null || { echo "ollama CLI not found; install Ollama first" >&2; exit 1; }
IFS=, read -ra LIST <<< "$MODELS"
for m in "${LIST[@]}"; do
  ollama show "$m" >/dev/null 2>&1 || { echo "pulling $m"; ollama pull "$m"; }
done
cd "$ROOT/packages/local-runtime"
pnpm exec tsx src/cli.ts export-models --source "$STORE" --dest "$ROOT/apps/desktop/models" --models "$MODELS"
du -sh "$ROOT/apps/desktop/models"
