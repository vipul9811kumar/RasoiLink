#!/bin/bash
# Upload latest EAS Android build to GitHub release.
# Preserves cumulative download count across uploads via a hidden
# <!-- downloads_offset:N --> marker in the release body.

set -e

REPO="vipul9811kumar/RasoiLink"
TAG="v1.0.0-beta"
APK_NAME="rasoilink-latest.apk"

echo "🔍 Fetching current release info..."
RELEASE_JSON=$(gh api repos/$REPO/releases/tags/$TAG)

# Current download count on the existing asset (before we clobber it)
CURRENT_COUNT=$(echo "$RELEASE_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
asset = next((a for a in d.get('assets',[]) if a['name'] == '$APK_NAME'), None)
print(asset['download_count'] if asset else 0)
")

# Existing cumulative offset stored in the release body
RELEASE_BODY=$(echo "$RELEASE_JSON" | python3 -c "
import sys, json
print(json.load(sys.stdin).get('body',''))
")
EXISTING_OFFSET=$(echo "$RELEASE_BODY" | grep -oP '(?<=<!-- downloads_offset:)\d+(?= -->)' || echo "0")
if [ -z "$EXISTING_OFFSET" ]; then EXISTING_OFFSET=0; fi

NEW_OFFSET=$((EXISTING_OFFSET + CURRENT_COUNT))
echo "📊 Downloads: $EXISTING_OFFSET (historical) + $CURRENT_COUNT (current asset) = $NEW_OFFSET total"

# Get latest finished EAS build URL
echo "📦 Getting latest EAS build URL..."
cd "$(dirname "$0")/../mobile"
LATEST_URL=$(eas build:list --platform android --limit 1 --json 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['artifacts']['applicationArchiveUrl'])")

if [ -z "$LATEST_URL" ] || [ "$LATEST_URL" = "None" ]; then
  echo "❌ Could not find a finished EAS build. Run: eas build:list --platform android --limit 1"
  exit 1
fi
echo "⬇️  Downloading APK from EAS..."
curl -L "$LATEST_URL" -o "/tmp/$APK_NAME" --progress-bar

echo "⬆️  Uploading to GitHub release $TAG..."
cd /tmp
gh release upload $TAG $APK_NAME --repo $REPO --clobber

# Update release body with new offset (strip old marker first)
CLEAN_BODY=$(echo "$RELEASE_BODY" | sed 's/<!-- downloads_offset:[0-9]* -->//g' | sed '/^[[:space:]]*$/d')
NEW_BODY="${CLEAN_BODY}
<!-- downloads_offset:${NEW_OFFSET} -->"
gh release edit $TAG --repo $REPO --notes "$NEW_BODY"

rm -f "/tmp/$APK_NAME"
echo "✅ Done! APK uploaded. Cumulative download offset: $NEW_OFFSET"
