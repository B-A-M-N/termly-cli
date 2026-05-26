#!/bin/bash
# termly-server — one-command launcher for Termly local + CLI
#
# Usage:
#   termly-server          # Start server + launch termly (default)
#   termly-server start    # Same as above
#   termly-server stop     # Stop just the server
#   termly-server status   # Check if server is running
#   termly-server restart  # Stop + start + launch
#
# Environment:
#   TERMLY_LOCAL_PORT  Port to use (default: 3001)

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PORT="${TERMLY_LOCAL_PORT:-3001}"
ACTION="${1:-start}"
shift || true

case "$ACTION" in
  start|"")
    # Start the background server
    if lsof -i ":${PORT}" -t >/dev/null 2>&1; then
      echo "Server already running on port ${PORT}"
    else
      echo "Starting Termly local server on port ${PORT}..."
      TERMLY_LOCAL_PORT="${PORT}" node "${SCRIPT_DIR}/server.js" &
      SERVER_PID=$!

      # Wait for server ready
      for i in $(seq 1 20); do
        sleep 0.5
        if curl -s "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
          break
        fi
      done

      MY_IP=$(hostname -I | awk '{print $1}')
      echo ""
      echo "========================================"
      echo "  Termly Local Server running!"
      echo "========================================"
      echo ""
      echo "  Local:   ws://localhost:${PORT}"
      echo "  Network: ws://${MY_IP}:${PORT}"
      echo "  Health:  http://localhost:${PORT}/api/health"
      echo ""
    fi

    # Now launch termly CLI in local mode
    echo "Starting Termly CLI in local mode..."
    echo "  (Ctrl+C stops the CLI. Server keeps running.)"
    echo ""
    export TERMLY_ENV=local
    export TERMLY_LOCAL_PORT="${PORT}"
    exec termly start "$@"
    ;;

  stop)
    PID=$(lsof -i ":${PORT}" -t 2>/dev/null)
    if [ -n "$PID" ]; then
      kill $PID 2>/dev/null && echo "Stopped server on port ${PORT}" || echo "Failed to stop"
    else
      echo "No server running on port ${PORT}"
    fi
    ;;

  status)
    PID=$(lsof -i ":${PORT}" -t 2>/dev/null)
    MY_IP=$(hostname -I | awk '{print $1}')
    if [ -n "$PID" ]; then
      echo "Server running on port ${PORT} (PID: ${PID})"
      echo "  Local:   ws://localhost:${PORT}"
      echo "  Network: ws://${MY_IP}:${PORT}"
    else
      echo "Server not running on port ${PORT}"
      echo "Start it: termly-server start"
    fi
    ;;

  restart)
    $0 stop 2>/dev/null
    sleep 1
    exec $0 start "$@"
    ;;

  help|--help|-h)
    echo "Usage: termly-server [action]"
    echo ""
    echo "Actions:"
    echo "  (none)   Start server + launch termly CLI (default)"
    echo "  start    Same as default"
    echo "  stop     Stop the local server"
    echo "  status   Check server status"
    echo "  restart  Stop + start + launch"
    echo ""
    echo "Environment:"
    echo "  TERMLY_LOCAL_PORT  Port to use (default: 3001)"
    ;;
esac
