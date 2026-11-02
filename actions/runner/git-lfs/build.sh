#!/bin/sh
# CloudForge's reproducible Git LFS build and third-party license collection.
set -eu

case "${1:-}" in
  amd64|arm64) target_arch=$1 ;;
  *) printf 'Unsupported Git LFS architecture: %s\n' "${1:-unset}" >&2; exit 1 ;;
esac

cd /src
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null

# Test on the builder's native architecture before producing the target binary.
mkdir -p bin /out
go build -mod=readonly -buildvcs=false -trimpath -o bin/git-lfs ./git-lfs.go
go test -mod=readonly -count=1 ./...
GOOS=linux GOARCH="$target_arch" go build -mod=readonly -buildvcs=false -trimpath \
  -ldflags='-s -w -X github.com/git-lfs/git-lfs/v3/config.GitCommit=a662a6dbfedf706cfa9fc7a5b7bcc7ba2e2c8a65-cloudforge-security -X github.com/git-lfs/git-lfs/v3/config.Vendor=CloudForge-custom-security-build' \
  -o /out/git-lfs ./git-lfs.go
go version -m /out/git-lfs > /out/git-lfs.buildinfo.txt

license_dir=/out/licenses
mkdir -p "$license_dir/git-lfs" "$license_dir/go"
cp LICENSE.md "$license_dir/git-lfs/LICENSE.md"
cp /usr/local/go/LICENSE "$license_dir/go/LICENSE"
for file in AUTHORS CONTRIBUTORS PATENTS; do
  if [ -f "/usr/local/go/$file" ]; then cp "/usr/local/go/$file" "$license_dir/go/$file"; fi
done
printf '%s\n' \
  'Git LFS: https://github.com/git-lfs/git-lfs/tree/a662a6dbfedf706cfa9fc7a5b7bcc7ba2e2c8a65' \
  'Go: go1.27.3 (https://go.dev/LICENSE)' \
  'Modules: pinned in go.mod/go.sum, downloaded from proxy.golang.org and verified through sum.golang.org.' \
  'CloudForge custom build: the module locks replace the upstream Git LFS dependency versions.' \
  > "$license_dir/SOURCES.txt"
cp go.mod go.sum /out/git-lfs.buildinfo.txt "$license_dir/"

# Include license notices from the complete pinned module graph, including test-only modules.
# `go mod download all` in the Dockerfile guarantees that every module has a source directory.
go list -m -f '{{if not .Main}}{{.Path}}|{{.Version}}|{{.Dir}}{{end}}' all > /tmp/git-lfs-modules.txt
printf 'module\tversion\tlicense_file_count\n' > "$license_dir/modules.tsv"
while IFS='|' read -r module version dir; do
  if [ -z "$module" ]; then continue; fi
  test -n "$dir"
  destination="$license_dir/modules/$module@$version"
  mkdir -p "$destination"
  (
    cd "$dir"
    find . -type f \( -iname 'license*' -o -iname 'licence*' -o -iname 'copying*' -o -iname 'notice*' \
      -o -iname 'patents*' -o -iname 'copyright*' -o -iname 'authors*' \) \
      -exec cp --parents -- '{}' "$destination" \;
  )
  count=$(find "$destination" -type f | wc -l)
  if [ "$count" -eq 0 ]; then
    printf 'Missing license files for %s@%s\n' "$module" "$version" >&2
    exit 1
  fi
  printf '%s\t%s\t%s\n' "$module" "$version" "$count" >> "$license_dir/modules.tsv"
done < /tmp/git-lfs-modules.txt

test -f "$license_dir/modules/golang.org/x/crypto@v0.58.0/LICENSE"
test -f "$license_dir/modules/golang.org/x/crypto@v0.58.0/PATENTS"
test -f "$license_dir/modules/golang.org/x/net@v0.62.0/LICENSE"
test -f "$license_dir/modules/golang.org/x/net@v0.62.0/PATENTS"
test -f "$license_dir/modules/golang.org/x/text@v0.43.0/LICENSE"
test -f "$license_dir/modules/golang.org/x/text@v0.43.0/PATENTS"
cd "$license_dir"
find . -type f ! -name SHA256SUMS -exec sha256sum '{}' \; | sort > SHA256SUMS
