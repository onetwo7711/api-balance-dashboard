#!/bin/bash
# 双击启动API账户余额看板（macOS）
# 优先使用系统自带Python 3，其次PATH中的python3，最后Node.js；无需安装任何依赖。
cd "$(dirname "$0")" || exit 1

PORT="${PORT:-8787}"
HOST="${HOST:-127.0.0.1}"

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    nc -z 127.0.0.1 "$1" >/dev/null 2>&1
  fi
}

is_dashboard() {
  curl -s --max-time 2 "http://127.0.0.1:$1/" 2>/dev/null | grep -q "API账户余额看板"
}

PYTHON=""
for candidate in /usr/bin/python3 /usr/local/bin/python3 /opt/homebrew/bin/python3; do
  if [ -x "$candidate" ]; then
    PYTHON="$candidate"
    break
  fi
done
if [ -z "$PYTHON" ] && command -v python3 >/dev/null 2>&1; then
  PYTHON="$(command -v python3)"
fi

if [ -z "$PYTHON" ] && ! command -v node >/dev/null 2>&1; then
  echo "未检测到可用的Python 3或Node.js 18及以上版本。"
  echo "本软件需要其中任意一个运行时；macOS通常自带/usr/bin/python3。"
  read -r -p "按回车键关闭…" _
  exit 1
fi

if port_in_use "$PORT"; then
  if is_dashboard "$PORT"; then
    echo "检测到余额看板已在运行（端口$PORT），正在打开浏览器…"
    open "http://127.0.0.1:$PORT" 2>/dev/null || true
    read -r -p "按回车键关闭窗口…" _
    exit 0
  fi
  NEW_PORT="$PORT"
  COUNT=0
  while port_in_use "$NEW_PORT" && [ "$COUNT" -lt 20 ]; do
    NEW_PORT=$((NEW_PORT + 1))
    COUNT=$((COUNT + 1))
  done
  if [ "$NEW_PORT" != "$PORT" ]; then
    echo "端口$PORT已被其他程序占用，已自动切换到端口$NEW_PORT。"
    PORT="$NEW_PORT"
  fi
fi

if [ -n "$PYTHON" ]; then
  echo "正在启动API账户余额看板（使用系统Python，无需安装任何依赖）…"
  echo "运行时：$PYTHON"
  PORT="$PORT" HOST="$HOST" "$PYTHON" server.py
  echo "服务已停止。"
  read -r -p "按回车键关闭窗口…" _
  exit 0
fi

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)
  if [ "$NODE_MAJOR" -ge 18 ] 2>/dev/null; then
    echo "正在启动API账户余额看板（使用Node.js）…"
    PORT="$PORT" HOST="$HOST" node server.js
    echo "服务已停止。"
    read -r -p "按回车键关闭窗口…" _
    exit 0
  fi
fi

echo "未检测到可用的Python 3或Node.js 18及以上版本。"
echo "本软件需要其中任意一个运行时；macOS通常自带/usr/bin/python3。"
read -r -p "按回车键关闭…" _
exit 1
