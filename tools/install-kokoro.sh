#!/usr/bin/env bash
# 显式安装 Kokoro 神经 TTS；不会在普通 provision/升级时自动下载大模型。
set -euo pipefail
ROOT=/var/lib/habitat/models/tts
DIR="$ROOT/kokoro-multi-lang-v1_0"
VENV=/opt/habitat/runtime/tts-venv
URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2
SHA=60703707bc05ccd48d60e1eb723f38b07d6e474795a0b6a588d7220400e0f7a4

if [ ! -x "$VENV/bin/sherpa-onnx-offline-tts" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --no-cache-dir --no-index \
    -f https://k2-fsa.github.io/sherpa/onnx/cpu-cn.html \
    sherpa_onnx_bin==2.0.1 sherpa_onnx_core==2.0.1 sherpa_onnx==2.0.1
fi

if [ ! -f "$DIR/model.onnx" ]; then
  mkdir -p "$ROOT" /tmp/habitat-kokoro
  curl -fL --retry 3 "$URL" -o /tmp/habitat-kokoro/model.tar.bz2
  echo "$SHA  /tmp/habitat-kokoro/model.tar.bz2" | sha256sum --check -
  tar -xf /tmp/habitat-kokoro/model.tar.bz2 -C "$ROOT"
  printf '%s' "$SHA" > "$DIR/DOWNLOAD.sha256"
  rm -f /tmp/habitat-kokoro/model.tar.bz2
fi
chown -R tlb3:tlb3 "$ROOT" "$VENV"
echo "Kokoro ready: $DIR"
