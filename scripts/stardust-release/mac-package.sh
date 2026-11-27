#!/usr/bin/env bash
set -euo pipefail
out="$T3CODE_DESKTOP_OUTPUT_DIR"
built="$(find "$out" -maxdepth 3 -name '*.app' -path '*mac-arm64*' -print -quit)"
test -n "$built"
plist="$built/Contents/Info.plist"
for key in CFBundleIdentifier CFBundleName CFBundleExecutable; do
  /usr/libexec/PlistBuddy -c "Print :$key" "$plist" > "$out/$key.original"
done
[[ "$(cat "$out/CFBundleIdentifier.original")" == com.opensourcexiaoxin.stardust ]]
staged="$out/Stardust.app"
rm -rf "$staged"
ditto "$built" "$staged"
plist="$staged/Contents/Info.plist"
resources="$staged/Contents/Resources"
plutil -replace CFBundleDisplayName -string Stardust "$plist"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$plist"
plutil -replace LSHasLocalizedDisplayName -bool YES "$plist"

mkdir -p "$resources"/{en,zh-Hans,zh_CN}.lproj
chinese="$(dirname "$0")/zh-Hans.lproj/InfoPlist.strings"
english="$resources/en.lproj/InfoPlist.strings"
plutil -create xml1 "$english"
plutil -convert json -o - "$chinese" | jq -r 'keys[]' | while IFS= read -r key; do
  value="$(plutil -extract "$key" raw "$plist")"
  [[ "$value" == *Stardust* ]]
  plutil -insert "$key" -string "$value" "$english"
done
for locale in zh-Hans zh_CN; do
  cp "$chinese" "$resources/$locale.lproj/InfoPlist.strings"
done

for helper_plist in "$staged"/Contents/Frameworks/*.app/Contents/Info.plist; do
  display_name="$(plutil -extract CFBundleDisplayName raw "$helper_plist")"
  plutil -replace CFBundleDisplayName -string "Stardust Helper${display_name#* Helper}" "$helper_plist"
done
commit="$(git rev-parse HEAD)"
node -e '
  const fs = require("node:fs");
  const meta = {
    customBuild: "v" + process.env.VERSION + "-ci-stardust",
    communityVersion: process.env.VERSION,
    sourceCommit: process.argv[1],
    releaseChannel: "stable",
  };
  for (const f of ["stardust-build.json", "t3-custom-build.json"]) {
    fs.writeFileSync(process.argv[2] + "/Contents/Resources/" + f, JSON.stringify(meta, null, 2) + "\n");
  }
' "$commit" "$staged"
codesign --force --deep --sign - "$staged"
codesign --verify --deep --strict "$staged"
for key in CFBundleIdentifier CFBundleName CFBundleExecutable; do
  [[ "$(/usr/libexec/PlistBuddy -c "Print :$key" "$staged/Contents/Info.plist")" == "$(cat "$out/$key.original")" ]]
done
zip_name="Stardust-v${VERSION}-macOS-arm64.zip"
ditto -c -k --sequesterRsrc --keepParent "$staged" "$out/$zip_name"
(cd "$out" && shasum -a 256 "$zip_name") | tee "$out/SHA256SUMS-macos-arm64.txt"
ls -lh "$out/$zip_name"
executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$staged/Contents/Info.plist")"
printf '%s/%s/Contents/MacOS/%s\n' "$PWD" "$staged" "$executable" > "$out/executable.txt"
