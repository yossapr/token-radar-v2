#!/bin/sh
# Capture the three screenshots from a built output directory with headless Edge.
# Usage: sh tools/shoot.sh <out dir> <dest dir> <detail slug>
OUT=$(cd "$1" && pwd -W); DEST="$2"; SLUG="$3"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
PAGE="file:///$OUT/dashboard/index.html"
shot() { timeout 90 "$EDGE" --headless=new --disable-gpu --hide-scrollbars --window-size=1440,1080 --screenshot="$DEST/$1" "$PAGE#$2" >/dev/null 2>&1; }
mkdir -p "$DEST"
shot 1-board.png "tab=board"
shot 2-detail.png "detail=$SLUG"
shot 3-filtered.png "watch=1&sort=hourly"
ls -la "$DEST"
