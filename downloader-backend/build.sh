#!/bin/bash
set -euo pipefail

mkdir -p bin

echo "==> Installing yt-dlp (standalone binary)"
curl -fsSL --retry 3 --retry-delay 5 --max-time 300 -o bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux
chmod +x bin/yt-dlp
bin/yt-dlp --version

echo "==> Installing ffmpeg (ffmpeg-static release binary)"
curl -fsSL --retry 3 --retry-delay 5 --max-time 300 -o bin/ffmpeg "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64"
chmod +x bin/ffmpeg
bin/ffmpeg -version | head -1

echo "==> Installing Node dependencies"
npm install --omit=dev

echo "==> Build complete"