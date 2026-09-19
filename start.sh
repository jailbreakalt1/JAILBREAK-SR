#!/usr/bin/env bash
# JAILBREAK-SR one-shot: update -> deps -> patch -> launch (Termux tmux)
# Usage: ./start.sh            (update + verify + launch bot in tmux 'bot')
#        ./start.sh --check    (do everything EXCEPT launching; safe preview)

set -u
set -o pipefail

# Termux defines $PREFIX (e.g. /data/data/com.termux/files/usr); default it
# so the script still runs on a normal Linux box (used for ./start.sh --check).
PREFIX="${PREFIX:-/usr}"

cd "$(dirname "$0")" || exit 1

if [ "${1:-}" = "--check" ]; then
  DRY=1
else
  DRY=0
fi

say() { printf '\n[*] %s\n' "$*"; }
warn() { printf '[!] %s\n' "$*"; }

# ── 1. Pull latest code (skip when no .git, e.g. zip install) ──────────────
if [ -d .git ]; then
  say "git pull"
  if ! git pull origin main 2>&1 | tail -3; then
    warn "git pull failed (dirty tracked files?). Run: git status"
    warn "Continuing with what's already on disk."
  fi
else
  warn "no .git here — skipping git pull (zip install?)"
fi

# ── 2. Install deps only when needed ─────────────────────────────────────────
need_install=0
if [ ! -d node_modules ]; then
  need_install=1
elif [ package.json -nt node_modules ]; then
  need_install=1
fi
if [ "$need_install" = "1" ]; then
  say "npm install"
  npm install --no-audit --no-fund || { warn "npm install failed"; exit 1; }
  # ── 2b. libsignal no-op guard: scrub noisy session logs if they exist ──
  PATCH="$PWD/node_modules/libsignal/src/session_record.js"
  if [ -f "$PATCH" ] && grep -q 'console\.log' "$PATCH"; then
    say "libsignal: removing console.log session spam"
    sed -i '/console\.log/d' "$PATCH"
  fi
else
  say "node_modules up to date (skipping npm install)"
fi

# ── 3. Export + persist env for yt-dlp/ffmpeg/Termux memory ─────────────────
export YTDLP_BINARY="${YTDLP_BINARY:-$PREFIX/bin/yt-dlp}"
export FFMPEG_BINARY="${FFMPEG_BINARY:-$PREFIX/bin/ffmpeg}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=256}"

for line in \
  "export YTDLP_BINARY=\$PREFIX/bin/yt-dlp" \
  "export FFMPEG_BINARY=\$PREFIX/bin/ffmpeg" \
  "export NODE_OPTIONS=--max-old-space-size=256"; do
  grep -qF "$line" "$HOME/.bashrc" 2>/dev/null || echo "$line" >> "$HOME/.bashrc"
done
say "env: YTDLP=$YTDLP_BINARY FFMPEG=$FFMPEG_BINARY NODE_OPTIONS=$NODE_OPTIONS"

# ── 4. Preflight ────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || { warn "node not found — pkg install nodejs-lts"; exit 1; }
[ -f index.js ] || { warn "index.js missing — am I in the bot folder?"; exit 1; }
for tool in yt-dlp ffmpeg unzip; do
  command -v "$tool" >/dev/null 2>&1 || warn "$tool not found — pkg install yt-dlp ffmpeg unzip"
done
command -v python3 >/dev/null 2>&1 || warn "python3 not found — media backend can't build .venv (pkg install python)"
command -v tmux >/dev/null 2>&1 || { warn "tmux not found — pkg install tmux"; exit 1; }

if [ "$DRY" = "1" ]; then
  say "--check done: all preflight OK, bot NOT launched"
  exit 0
fi

# ── 5. Keep the phone awake + launch in tmux (auto-restarts) ────────────────
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
fi

if tmux has-session -t bot 2>/dev/null; then
  say "re-attaching to existing tmux session 'bot'"
  tmux attach -t bot
  exit 0
fi

say "starting bot in tmux session 'bot' (Ctrl-B then d to leave, tmux attach to return)"
tmux new-session -d -s bot
tmux send-keys -t bot \
  "export YTDLP_BINARY=$PREFIX/bin/yt-dlp; export FFMPEG_BINARY=$PREFIX/bin/ffmpeg; export NODE_OPTIONS=--max-old-space-size=256; while :; do node index.js; sleep 3; done" \
  Enter
tmux attach -t bot