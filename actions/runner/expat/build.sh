#!/bin/sh
# Build official Expat sources with Debian packaging on the runner's own distribution.
set -eu
export LC_ALL=C.UTF-8 DEB_BUILD_OPTIONS=parallel=2

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. /etc/os-release
test "$VERSION_CODENAME" = trixie
native_arch=$(dpkg --print-architecture)
multiarch=$(dpkg-architecture -qDEB_HOST_MULTIARCH)
build_root=$(mktemp -d /tmp/cloudforge-expat.XXXXXX)
mkdir -p /out/provenance
cd "$build_root"

# The lock is data, never sourced as shell code. Download all three files before
# extracting anything, then verify the independently pinned DSC and archive hashes.
python3 - "$script_dir/sources.json" <<'PY'
import json
import pathlib
import re
import sys

lock = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert lock["distribution"] == "trixie"
for entry in lock["sources"]:
    assert re.fullmatch(r"[A-Za-z0-9_.+-]+", entry["file"])
    assert re.fullmatch(r"[a-f0-9]{64}", entry["sha256"])
    assert entry["url"] == "https://deb.debian.org/debian/pool/main/e/expat/" + entry["file"]
pathlib.Path("downloads.tsv").write_text("".join(f'{e["file"]}\t{e["url"]}\n' for e in lock["sources"]))
pathlib.Path("SHA256SUMS").write_text("".join(f'{e["sha256"]}  {e["file"]}\n' for e in lock["sources"]))
pathlib.Path("package-version").write_text(lock["packageVersion"])
pathlib.Path("upstream-version").write_text(lock["upstreamVersion"])
pathlib.Path("source-dsc").write_text(f'expat_{lock["debianSourceVersion"]}.dsc')
pathlib.Path("changelog-header").write_text(
    f'expat ({lock["packageVersion"]}) trixie; urgency=medium\n\n'
    '  * Rebuild the pinned official source on trixie for the CloudForge runner.\n\n'
    f' -- CloudForge Maintainers <maintainers@cloudforge.invalid>  {lock["changelogDate"]}\n\n'
)
PY
while IFS="$(printf '\t')" read -r file url; do
  curl --fail --location --retry 3 --proto '=https' --tlsv1.2 "$url" --output "$file"
done < downloads.tsv
sha256sum --check SHA256SUMS
dpkg-source -x "$(cat source-dsc)" source

# Compare against the distribution libraries before installing the rebuilt package.
for lib in libexpat.so.1 libexpatw.so.1; do
  nm -D --defined-only "/usr/lib/$multiarch/$lib" | awk '{print $3}' | sort \
    > "/out/provenance/$lib.symbols.before"
done
cat changelog-header source/debian/changelog > changelog
cp changelog source/debian/changelog
package_version=$(cat package-version)
upstream_version=$(cat upstream-version)
cd source
dpkg-buildpackage -b -us -uc -Pnoudeb

# Debian's rules build the suite but do not run it. Capture and propagate failures.
if ! make -C build check > /out/provenance/upstream-tests.log 2>&1; then
  cat /out/provenance/upstream-tests.log
  exit 1
fi
cat /out/provenance/upstream-tests.log
cp build/tests/test-suite.log /out/provenance/upstream-test-suite.log
cp build/tests/runtests.log /out/provenance/upstream-runtests.log

package="$build_root/libexpat1_${package_version}_${native_arch}.deb"
dev_package="$build_root/libexpat1-dev_${package_version}_${native_arch}.deb"
test "$(dpkg-deb -f "$package" Version)" = "$package_version"
test "$(dpkg-deb -f "$package" Architecture)" = "$native_arch"
test "$(dpkg-deb -f "$dev_package" Version)" = "$package_version"
test "$(dpkg-deb -f "$dev_package" Architecture)" = "$native_arch"
# Debian's development package depends on the exact runtime package version.
# Keep headers/static libraries and the installed shared libraries in one build.
dpkg -i "$package" "$dev_package"
for lib in libexpat.so.1 libexpatw.so.1; do
  nm -D --defined-only "/usr/lib/$multiarch/$lib" | awk '{print $3}' | sort \
    > "/out/provenance/$lib.symbols.after"
  comm -23 "/out/provenance/$lib.symbols.before" "/out/provenance/$lib.symbols.after" \
    > "/out/provenance/$lib.symbols.removed"
  test ! -s "/out/provenance/$lib.symbols.removed"
  readelf -d "/usr/lib/$multiarch/$lib" > "/out/provenance/$lib.dynamic"
  grep -F "Library soname: [$lib]" "/out/provenance/$lib.dynamic"
done

# Upstream's tests explicitly reject Debian's UTF-16/unsigned-short configuration.
# Exercise the installed UTF-16 library directly, keeping that limitation explicit.
cc -DXML_UNICODE -I "$build_root/source/srcw/lib" "$script_dir/utf16-smoke.c" \
  -Wl,-l:libexpatw.so.1 -o "$build_root/utf16-smoke"
"$build_root/utf16-smoke" "$upstream_version"
python3 - "$upstream_version" <<'PY'
import pyexpat
import sys
import xml.etree.ElementTree as ET

assert pyexpat.EXPAT_VERSION == "expat_" + sys.argv[1]
assert ET.fromstring("<fixture><item>ok</item></fixture>")[0].text == "ok"
print("Python links to", pyexpat.EXPAT_VERSION)
PY

cp "$package" /out/libexpat1.deb
cp "$dev_package" /out/libexpat1-dev.deb
cp "$script_dir/sources.json" /out/provenance/sources.json
cp "$build_root"/*.buildinfo "$build_root"/*.changes /out/provenance/
cp debian/changelog debian/control /out/provenance/
cp debian/copyright /out/provenance/copyright
cp expat/COPYING /out/provenance/COPYING
dpkg-deb -f "$package" > /out/provenance/libexpat1-control
dpkg-deb -f "$dev_package" > /out/provenance/libexpat1-dev-control
cd /out
sha256sum libexpat1.deb libexpat1-dev.deb > provenance/package-sha256
