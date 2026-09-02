#!/usr/bin/env bash
# Development process manager for llmEval: start/stop/status/kill-all for the API server (and Vite).
# Everything it kills is scoped to processes started from THIS repository (command line contains the
# repo path) or listening on the ports it manages, so it never touches unrelated processes.
#
#   scripts/dev.sh start [--web] [--port N] [--db PATH] [--no-watch]
#   scripts/dev.sh stop                      # graceful stop of what this script started (plus port owners from this repo)
#   scripts/dev.sh restart [start options]
#   scripts/dev.sh status                    # pids, ports, health, last log lines
#   scripts/dev.sh logs [-f]
#   scripts/dev.sh kill-all                  # SIGKILL every server/vite/tsx process of this repo, including ones from other sessions
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT/.dev"
mkdir -p "$RUN_DIR"
API_PID="$RUN_DIR/api.pid"; API_LOG="$RUN_DIR/api.log"; API_PORT_FILE="$RUN_DIR/api.port"
WEB_PID="$RUN_DIR/web.pid"; WEB_LOG="$RUN_DIR/web.log"
WEB_PORT=5173

env_port() { # PORT from .env unless overridden
  local p
  p=$(grep -E '^PORT=' "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]' || true)
  echo "${p:-3000}"
}
listeners() { lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null || true; }
is_ours() { # pid belongs to this repo? (command line must contain the repo path; nothing else counts)
  ps -o command= -p "$1" 2>/dev/null | grep -qF "$ROOT"
}
alive() { kill -0 "$1" 2>/dev/null; }
descendants() { # all descendant pids of $1 (depth-first)
  local kids; kids=$(pgrep -P "$1" 2>/dev/null || true)
  for k in $kids; do descendants "$k"; echo "$k"; done
}
kill_tree() { # $1 pid, $2 signal
  local sig="${2:-TERM}"
  for p in $(descendants "$1") "$1"; do kill "-$sig" "$p" 2>/dev/null || true; done
}
stop_pidfile() { # $1 pidfile, $2 label
  [ -f "$1" ] || return 0
  local pid; pid=$(cat "$1")
  if alive "$pid"; then
    echo "stopping $2 (pid $pid)…"; kill_tree "$pid" TERM
    for _ in 1 2 3 4 5 6; do alive "$pid" || break; sleep 0.5; done
    alive "$pid" && { echo "  still alive, SIGKILL"; kill_tree "$pid" KILL; }
  fi
  rm -f "$1"
}
kill_port_owners() { # $1 port, $2 signal; only pids from this repo
  for p in $(listeners "$1"); do
    if is_ours "$p"; then echo "killing pid $p on port $1 (this repo)"; kill_tree "$p" "$2"; else echo "port $1 is held by pid $p which is NOT from this repo; leaving it alone: $(ps -o command= -p "$p" | cut -c1-80)"; fi
  done
}
wait_health() { # $1 port
  for _ in $(seq 1 40); do
    if curl -sf "http://localhost:$1/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 0.25
  done
  return 1
}

cmd_start() {
  local web=0 port="" db="" watch=1
  while [ $# -gt 0 ]; do
    case "$1" in
      --web) web=1 ;;
      --port) port="$2"; shift ;;
      --db) db="$2"; case "$db" in /*) ;; *) db="$PWD/$db" ;; esac; shift ;;
      --no-watch) watch=0 ;;
      *) echo "unknown option $1"; exit 2 ;;
    esac; shift
  done
  port="${port:-$(env_port)}"
  if [ -f "$API_PID" ] && alive "$(cat "$API_PID")"; then
    echo "API already running (pid $(cat "$API_PID"), port $(cat "$API_PORT_FILE" 2>/dev/null || echo '?')). Use restart or stop."; exit 1
  fi
  if [ -n "$(listeners "$port")" ]; then
    echo "port $port is already in use:"; kill_port_owners "$port" TERM >/dev/null; sleep 1
    [ -n "$(listeners "$port")" ] && { echo "port $port still busy; run 'scripts/dev.sh kill-all' or pick --port"; exit 1; }
  fi
  local entry="$ROOT/apps/server/bin/server.ts" tsx="$ROOT/apps/server/node_modules/.bin/tsx"
  [ -x "$tsx" ] || { echo "tsx not found at $tsx; run pnpm install"; exit 1; }
  local args=(); [ $watch -eq 1 ] && args+=(watch)
  echo "starting API on port $port (log: $API_LOG)…"
  (
    cd "$ROOT/apps/server"
    export PORT="$port"
    [ -n "$db" ] && export LLMEVAL_DB_PATH="$db"
    # ${args[@]+"${args[@]}"} keeps `set -u` happy on bash 3.2 when the array is empty (--no-watch)
    nohup "$tsx" ${args[@]+"${args[@]}"} "$entry" >"$API_LOG" 2>&1 &
    echo $! >"$API_PID"
  )
  echo "$port" >"$API_PORT_FILE"
  if wait_health "$port"; then echo "API healthy: http://localhost:$port  (MCP: /mcp, OpenAPI: /openapi.json)"; else echo "API did not become healthy; last log lines:"; tail -20 "$API_LOG"; exit 1; fi
  if [ $web -eq 1 ]; then
    if [ -n "$(listeners $WEB_PORT)" ]; then echo "port $WEB_PORT busy; not starting Vite"; else
      echo "starting Vite dev server on $WEB_PORT (log: $WEB_LOG)…"
      local vite="$ROOT/apps/web/node_modules/.bin/vite"
      ( cd "$ROOT/apps/web" && nohup "$vite" --port $WEB_PORT --strictPort >"$WEB_LOG" 2>&1 & echo $! >"$WEB_PID" )
      sleep 2; echo "Vite: http://localhost:$WEB_PORT (proxies /api to :$port)"
    fi
  fi
}

cmd_stop() {
  stop_pidfile "$API_PID" "API"
  stop_pidfile "$WEB_PID" "Vite"
  local port; port=$(cat "$API_PORT_FILE" 2>/dev/null || env_port)
  kill_port_owners "$port" TERM
  kill_port_owners "$WEB_PORT" TERM
  rm -f "$API_PORT_FILE"
  echo "stopped."
}

cmd_status() {
  local port; port=$(cat "$API_PORT_FILE" 2>/dev/null || env_port)
  echo "repo: $ROOT"
  if [ -f "$API_PID" ] && alive "$(cat "$API_PID")"; then echo "API: running (pid $(cat "$API_PID"), port $port)"; else echo "API: not started by this script"; fi
  if [ -f "$WEB_PID" ] && alive "$(cat "$WEB_PID")"; then echo "Vite: running (pid $(cat "$WEB_PID"), port $WEB_PORT)"; else echo "Vite: not running"; fi
  for p in "$port" $WEB_PORT; do
    local l; l=$(listeners "$p" | tr '\n' ' ')
    [ -n "$l" ] && echo "port $p listeners: $l" || echo "port $p: free"
  done
  if curl -sf "http://localhost:$port/api/health" >/dev/null 2>&1; then echo "health: ok (http://localhost:$port/api/health)"; else echo "health: no response on $port"; fi
  echo "--- other processes of this repo:"
  ps -axo pid,ppid,etime,command | grep -F "$ROOT" | grep -vE "grep|dev\.sh" | cut -c1-160 || true
  [ -f "$API_LOG" ] && { echo "--- last API log lines:"; tail -5 "$API_LOG"; }
}

cmd_logs() { if [ "${1:-}" = "-f" ]; then tail -f "$API_LOG"; else tail -50 "$API_LOG" 2>/dev/null || echo "no log yet"; fi; }

cmd_kill_all() {
  echo "force-killing every server/vite/tsx/vitest process started from $ROOT (any session)…"
  local pids
  pids=$(ps -axo pid,command | grep -F "$ROOT" | grep -E 'bin/server\.ts|tsx|vite|vitest|esbuild' | grep -vE "grep|dev\.sh" | awk '{print $1}' || true)
  for p in $pids; do echo "  kill -9 $p: $(ps -o command= -p "$p" 2>/dev/null | cut -c1-90)"; kill -9 "$p" 2>/dev/null || true; done
  # port owners are killed only when their command line contains this repo's path
  for port in "$(env_port)" $WEB_PORT; do kill_port_owners "$port" KILL; done
  rm -f "$API_PID" "$WEB_PID" "$API_PORT_FILE"
  echo "done. remaining listeners on $(env_port)/$WEB_PORT: $(listeners "$(env_port)" | tr '\n' ' ')/$(listeners $WEB_PORT | tr '\n' ' ')"
}

case "${1:-}" in
  start) shift; cmd_start "$@" ;;
  stop) cmd_stop ;;
  restart) shift; cmd_stop; cmd_start "$@" ;;
  status) cmd_status ;;
  logs) shift; cmd_logs "$@" ;;
  kill-all) cmd_kill_all ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
