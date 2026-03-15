#!/usr/bin/env bash
set -euo pipefail

COPILOT_VERSION="${COPILOT_VERSION:-latest}"
TARGET_BIN="/usr/local/bin/copilot"
TMP_ARCHIVE="/tmp/copilot-cli.tar.gz"
TMP_DIR="/tmp/copilot-cli"

mkdir -p "$TMP_DIR"

if [[ "$COPILOT_VERSION" == "latest" ]]; then
  RELEASE_URL="https://api.github.com/repos/github/copilot-cli/releases/latest"
  ASSET_URL="$({
    curl -fsSL "$RELEASE_URL" \
      | grep -Eo 'https://[^\"]*copilot-linux-amd64.tar.gz' \
      | head -n 1
  })"
else
  ASSET_URL="https://github.com/github/copilot-cli/releases/download/${COPILOT_VERSION}/copilot-linux-amd64.tar.gz"
fi

if [[ -z "${ASSET_URL:-}" ]]; then
  echo "failed to resolve copilot CLI download URL"
  exit 1
fi

curl -fsSL "$ASSET_URL" -o "$TMP_ARCHIVE"
tar -xzf "$TMP_ARCHIVE" -C "$TMP_DIR"
install -m 0755 "$TMP_DIR/copilot" "$TARGET_BIN"

rm -rf "$TMP_ARCHIVE" "$TMP_DIR"

echo "copilot CLI installed to $TARGET_BIN"
