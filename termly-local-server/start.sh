#!/bin/bash
# Start Termly Local Server
# Usage: ./start.sh
# 
# To use with Termly CLI:
#   TERMLY_ENV=local termly start
#
# Or with custom port:
#   TERMLY_LOCAL_PORT=4000 ./start.sh
#   TERMLY_ENV=local TERMLY_LOCAL_PORT=4000 termly start

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${TERMLY_LOCAL_PORT:-3001}"
MY_IP=$(hostname -I | awk '{print $1}')

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "=================================="
echo "  Termly Local Server"
echo "=================================="
echo ""
echo "  Local:  ws://localhost:${PORT}"
echo "  Network: ws://${MY_IP}:${PORT}"
echo "  Health: http://localhost:${PORT}/api/health"
echo ""
echo "  CLI usage: TERMLY_ENV=local termly start"
echo "=================================="
echo ""

TERMLY_LOCAL_PORT="${PORT}" node server.js
