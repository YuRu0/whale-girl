#!/usr/bin/env bash
# 一键重新打包鲸鱼娘安装包
# 用法：在 Git Bash 里执行  bash 重新打包.sh
# 产物：pkg/dist/鲸鱼娘-<版本>-安装版.exe
set -e

SRC="/c/Users/wids/Documents/Codex/2026-10-21/new-chat-2/outputs/WhaleGirl"
PKG="/c/Users/wids/WorkBuddy/2026-10-22-20-25-05/pkg"
NODE="C:/Users/wids/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
NPM="$NODE C:/Users/wids/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/npm/bin/npm-cli.js"

# 1. 复制程序并精简（不动原程序）
B="$PKG/WhaleGirl"
rm -rf "$B"; mkdir -p "$B"
cp -r "$SRC"/* "$B/"
rm -rf "$B/data"                                   # 运行时数据/日志/用户配置，不打进包
rm -f "$B/LICENSES.chromium.html" "$B/dxcompiler.dll" "$B/dxil.dll"
(cd "$B/locales" && ls | grep -v -E "^(zh-CN|en-US)\.pak$" | xargs rm -f)   # 只留中英语言包

# 2. 装打包工具（只在缺的时候装）
cd "$PKG"
[ -d node_modules/electron-builder ] || $NPM install --registry=https://registry.npmmirror.com --no-audit --no-fund

# 3. 构建 NSIS 安装包（二进制走 npmmirror 镜像，GitHub 不通也能装）
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
"$NODE" node_modules/electron-builder/cli.js --win --x64 --prepackaged ./WhaleGirl

echo "==> 产物: $PKG/dist/"
ls -la "$PKG/dist"
