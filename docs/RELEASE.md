# Release Build & Deploy Guide

## Overview

Kite uses a **tag-driven release** process. The git tag **must** exist on the
local HEAD before building the binary, because `scripts/get-version.sh` reads
the tag via `git describe --exact-match --tags HEAD` and injects it into the
Go binary via `-ldflags`. The Docker image tag must match the git tag exactly.

## Prerequisites

- Local dev environment: Go, Node.js, pnpm
- Remote build server: `root@j.cn:/root/kite/` (has Docker + registry access)
- Registry: `kcscis-e8adb339.ecis-suzhou-1.cmecloud.cn/ecloud/eki-ops-kite`
- `static/` is in `.gitignore` — it is rebuilt every release and embedded via
  `//go:embed`, never committed to git.

## Release Steps (Strict Order)

The following steps **must** be executed in order. Do not reorder them.

### Step 1: Pre-commit checks

```bash
make pre-commit
```

> If `golangci-lint` download fails (network issue), run these manually:
> ```bash
> go vet ./...
> go test ./pkg/cluster/... ./pkg/model/...
> pnpm --dir ui run type-check
> pnpm --dir ui run lint
> go fmt ./... && pnpm --dir ui run format
> ```

### Step 2: Commit

```bash
git add <changed-files>
git commit -m "<conventional commit message>"
```

Commit message conventions:
- `feat:` — new feature
- `fix:` — bug fix
- `chore:` — maintenance / cleanup
- Scope is optional: `feat(cluster): ...`

### Step 3: Create git tag

```bash
# Determine next version (look at existing tags)
git tag --sort=-creatordate | head -5

# Create the next tag (e.g. v1.5.9 → v1.5.10)
git tag v1.5.10
```

Tag naming: `v<major>.<minor>.<patch>`, e.g. `v1.5.10`.

### Step 4: Push git commits and tag to origin

```bash
git push origin main
git push origin v1.5.10
```

> **Why before building the image?**
> `scripts/get-version.sh` uses `git describe --exact-match --tags HEAD` to
> read the tag. The tag must exist **locally** before `go build` runs, so
> the `-ldflags` version string is correct. Pushing to origin first ensures
> the remote state is stable before we produce an artifact.

### Step 5: Build frontend (into static/)

```bash
pnpm --dir ui run build
```

This outputs hashed assets into `static/`. The Go binary embeds them via
`//go:embed static/*` in `static.go`. `static/` is `.gitignore`d, so these
files are never committed.

### Step 6: Cross-compile Go binary for linux/amd64

```bash
VERSION=$(bash scripts/get-version.sh)
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
COMMIT_ID=$(git rev-parse HEAD)

GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build \
  -ldflags "-s -w \
    -X 'github.com/zxh326/kite/pkg/version.Version=${VERSION}' \
    -X 'github.com/zxh326/kite/pkg/version.BuildDate=${BUILD_DATE}' \
    -X 'github.com/zxh326/kite/pkg/version.CommitID=${COMMIT_ID}'" \
  -o kite-linux-amd64 .
```

> **Critical**: `VERSION` must be read from `scripts/get-version.sh` **after**
> the tag is created (Step 3). If you build before tagging, the version will be
> `v1.5.9-p1-<hash>` instead of `v1.5.10`, causing the image tag mismatch.

### Step 7: Transfer binary + Dockerfile to build server

```bash
scp kite-linux-amd64 Dockerfile.release root@j.cn:/root/kite/
```

### Step 8: Build Docker image and push to registry

```bash
ssh root@j.cn 'cd /root/kite && \
  mv kite-linux-amd64 kite && \
  docker build -f Dockerfile.release \
    -t kcscis-e8adb339.ecis-suzhou-1.cmecloud.cn/ecloud/eki-ops-kite:v1.5.10 . && \
  docker push kcscis-e8adb339.ecis-suzhou-1.cmecloud.cn/ecloud/eki-ops-kite:v1.5.10'
```

Replace `v1.5.10` with the actual version tag.

### Step 9: Clean up local binary

```bash
rm kite-linux-amd64
```

## One-Liner (After Step 2: Commit)

For convenience, steps 3–9 can be run as a single sequence (replace `V=...`):

```bash
V=v1.5.10

# Step 3: Tag
git tag "$V"

# Step 4: Push git
git push origin main && git push origin "$V"

# Step 5: Build frontend
pnpm --dir ui run build

# Step 6: Cross-compile
VERSION="$V" BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ") COMMIT_ID=$(git rev-parse HEAD)
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build \
  -ldflags "-s -w \
    -X 'github.com/zxh326/kite/pkg/version.Version=${VERSION}' \
    -X 'github.com/zxh326/kite/pkg/version.BuildDate=${BUILD_DATE}' \
    -X 'github.com/zxh326/kite/pkg/version.CommitID=${COMMIT_ID}'" \
  -o kite-linux-amd64 .

# Step 7: SCP
scp kite-linux-amd64 Dockerfile.release root@j.cn:/root/kite/

# Step 8: Docker build + push
ssh root@j.cn "cd /root/kite && mv kite-linux-amd64 kite && docker build -f Dockerfile.release -t kcscis-e8adb339.ecis-suzhou-1.cmecloud.cn/ecloud/eki-ops-kite:${V} . && docker push kcscis-e8adb339.ecis-suzhou-1.cmecloud.cn/ecloud/eki-ops-kite:${V}"

# Step 9: Cleanup
rm kite-linux-amd64
```

## Verification

After the full release flow, verify the version is correct:

```bash
# Locally: confirm tag matches
git describe --exact-match --tags HEAD
# Should output: v1.5.10

# Remotely: run the binary and check /api/v1/version or server logs
ssh root@j.cn 'docker run --rm kcscis-e8adb339.ecis-suzhou-1.cmecloud.cn/ecloud/eki-ops-kite:v1.5.10 /app/kite --version'
# Should output: v1.5.10
```

## Version Reading Mechanism

`scripts/get-version.sh` logic:

1. If HEAD is exactly on a `v*` tag → output that tag (e.g. `v1.5.10`)
2. If HEAD is ahead of the last tag → output `v<major>.<minor>.<patch+1>-p<commits>-<short-hash>`
3. If no tags exist → output `v0.0.0-<short-hash>`

The Makefile uses this script to set `LDFLAGS` automatically when you run
`make backend` or `make build`. However, for cross-compilation on macOS
(targeting linux/amd64), you must pass the ldflags manually as shown above.

## Dockerfile

`Dockerfile.release` is minimal:

```dockerfile
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
COPY kite /app/kite
EXPOSE 8080
WORKDIR /app
ENTRYPOINT ["/app/kite"]
```

The Go binary already embeds `static/` via `//go:embed`, so no `COPY static`
is needed. The binary is self-contained.

## Common Pitfalls

| Pitfall | Cause | Fix |
|---|---|---|
| Image version mismatch | Built image before `git tag` | Always tag before building |
| `static/` not updated | Forgot `pnpm build` before `go build` | Run frontend build first |
| `arm64` binary on macOS M1 | Default `go build` targets host arch | Use `GOOS=linux GOARCH=amd64` |
| `golangci-lint` download fails | Network issue on Mac | Run `go vet` + `tsc --noEmit` manually |
| Duplicate image tag | Rebuilt without incrementing version | Use a new tag or re-push with same tag (overwrites) |

## Quick Reference: Recent Releases

| Tag | Commit | Description |
|---|---|---|
| v1.5.9 | `4a42216` | cluster panel pagination + show cluster tags |
| v1.5.8 | `8856511` | cluster statistics panel |
| v1.5.7 | `55835e5` | cluster connection test action |
| v1.5.6 | `18e0a18` | watermark toggle fix + Prometheus discovery label |
| v1.5.5 | `0b0ecd7` | UpdatePool partial update fix |
| v1.5.4 | `e37d9b0` | pool management Switch toggle |
| v1.5.3 | `52d81e7` | terminal ResolveImage fix |
| v1.5.2 | `f79c28b` | cluster switch header fix |
| v1.5.1 | `b7c984a` | RBAC role save fix |