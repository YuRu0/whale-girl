#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node build.cjs --runtime "${1:?Pass an unpacked Electron 43.3.0 directory}"
