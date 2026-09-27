#!/usr/bin/env bash
# 把随包的 Ollama 目录收窄到 arm64（#3872 R22）。用法：thin-darwin-arm64.sh <dir>
#
# 官方 ollama-darwin.tgz 是通用包：ollama / llama-server / llama-quantize 是 x86_64+arm64 胖二进制，
# 另外 22 个 libggml*/libllama*/libmtmd* 只有 x86_64。实测（otool -arch arm64 -L）：arm64 切片
# 是静态链接的，一个 @rpath 库都不引用——那些 dylib 只服务 x86 切片。于是 mac-arm64 包里
# 躺着约 70 MB 永远不会被加载的东西。
#
# 规则：含 arm64 的 Mach-O → lipo -thin arm64；只有 x86_64 的 Mach-O → 删；其余（metallib、
# 许可证）不碰。删完清掉悬空的符号链接。任何一个 arm64 切片仍引用 @rpath 库就中止——
# 那说明上游改了链接方式，这时删库会让模型加载失败，宁可不瘦。
set -euo pipefail
# 先解析成物理路径：传进来的若是符号链接（开发机上 apps/desktop/bin 常链到别处的共享目录），
# 后面的 find 不会穿过它，悬空链接就清不掉；更要紧的是让调用方看清自己改的是哪一份。
DIR="$(cd -P "${1:?usage: thin-darwin-arm64.sh <dir>}" && pwd)"
echo "thinning $DIR"
for f in "$DIR"/*; do
  [ -f "$f" ] && [ ! -L "$f" ] || continue
  archs="$(lipo -archs "$f" 2>/dev/null)" || continue
  case " $archs " in
    *" arm64 "*)
      if otool -arch arm64 -L "$f" | tail -n +2 | grep -q "@rpath/"; then
        echo "✗ $(basename "$f") 的 arm64 切片引用了 @rpath 库——上游链接方式变了，不瘦" >&2; exit 1
      fi
      [ "$archs" = "arm64" ] || { lipo -thin arm64 "$f" -output "$f.arm64" && mv "$f.arm64" "$f"; } ;;
    *) rm -f "$f" ;;
  esac
done
find "$DIR" -maxdepth 1 -type l ! -exec test -e {} \; -delete
echo "thinned to arm64: $DIR ($(du -sh "$DIR" | cut -f1))"
