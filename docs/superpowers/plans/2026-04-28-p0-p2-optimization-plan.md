# P0-P2 Optimization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all P0-P2 reliability, performance, deployment, and maintainability improvements one at a time, with docs updates and an atomic commit after each item.

**Architecture:** The work preserves the existing React desktop frontend, Tauri shell, Go sidecar backend, and Docker Web architecture. Each item is independently verifiable and committed with its matching `CLAUDE.md` and `README.md` updates before moving to the next item.

**Tech Stack:** Go/Gin/GORM/SQLite, React 18/TypeScript/Zustand/Vite/Tauri, Docker/Nginx, GitHub Actions.

---

## Global Rules

- Do not combine multiple optimization IDs in one commit.
- Every task must update `CLAUDE.md` and `README.md` in the same commit as the code/config change.
- Every git command must use `GIT_MASTER=1`.
- Commit style: English semantic commits.
- If a verification command fails, fix the root cause before committing.
- If a task expands beyond the listed files, stop and document why before adding scope.

## File Responsibility Map

- `.github/workflows/pr-check.yml`: PR verification, backend smoke test, blocking checks.
- `.github/workflows/release.yml`: release build/test pipeline.
- `backend/internal/api/multipart_helper.go`: multipart reference image parsing and size limits.
- `backend/internal/api/handlers.go`: local reference image path loading and API task handling.
- `backend/internal/provider/*.go`: provider HTTP response logging and request behavior.
- `backend/cmd/server/main.go`: HTTP server configuration and worker pool initialization.
- `backend/internal/worker/pool.go`: worker timeout and provider execution lifecycle.
- `desktop/src/components/TemplateMarket/TemplateMarketDrawer.tsx`: template market shell and grid rendering.
- `desktop/src/services/api.ts`: frontend API helper and image URL diagnostics.
- `desktop/src/store/historyStore.ts`: persisted history cache behavior.
- `desktop/src/components/**`: Zustand subscription narrowing and large component splits.
- `docker/nginx.conf`, `Dockerfile`, `docker-compose.yml`: Web deployment proxy and health behavior.
- `frontend/package.json`: standalone Web frontend version/build strategy.
- `desktop/src/i18n/index.ts`: locale loading strategy.
- `desktop/src-tauri/tauri.conf.json`: desktop security boundaries.
- `CLAUDE.md`: AI/developer project constraints.
- `README.md`: user/developer-facing behavior and setup documentation.

## Reusable Per-Task Commit Checklist

For every task below:

- [ ] Inspect the listed files and confirm current behavior.
- [ ] Make the smallest code/config change that satisfies the task.
- [ ] Update `CLAUDE.md` with the new constraint or verification note.
- [ ] Update `README.md` with user/developer-facing behavior.
- [ ] Run the task-specific verification commands.
- [ ] Run `GIT_MASTER=1 git status --short` and review changed files.
- [ ] Stage only files for this task.
- [ ] Commit with the task's commit message, Sisyphus footer, and co-author trailer.

Commit body template:

```bash
GIT_MASTER=1 git commit -m "<message>" \
  -m "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-openagent)" \
  -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

### Task 1: P1-01 Align Go workflow version

**Files:**
- Modify: `.github/workflows/pr-check.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Replace hard-coded Go `1.21` workflow setup with `go-version-file: ./backend/go.mod` or explicit current `1.24.3` consistently.
- [ ] Ensure Go cache still points at `./backend/go.sum`.
- [ ] Document that CI Go version follows `backend/go.mod`.
- [ ] Run: `cd backend && go test ./... && go vet ./...`
- [ ] Commit: `ci: align go workflow version`

### Task 2: P1-02 Fix PR smoke health check

**Files:**
- Modify: `.github/workflows/pr-check.yml`
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Change smoke test curl path to `http://localhost:8080/api/v1/health`.
- [ ] Remove `continue-on-error: true` from smoke test so failure blocks PR.
- [ ] Ensure PR summary depends on smoke-test if it reports smoke status.
- [ ] Document `/api/v1/health` as the canonical backend health endpoint.
- [ ] Run equivalent local check: start backend, then `curl -sf http://localhost:8080/api/v1/health`.
- [ ] Commit: `ci: fix backend smoke health check`

### Task 3: P1-03 Use npm ci for release builds

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Replace release build `npm install` calls with `npm ci` where lockfiles exist.
- [ ] Keep any platform-specific setup unchanged.
- [ ] Document that release artifacts must respect lockfiles.
- [ ] Run: `cd desktop && npm run type-check && npm run build`
- [ ] Commit: `ci: use npm ci for release builds`

### Task 4: P0-01 Limit reference image upload size

**Files:**
- Modify: `backend/internal/api/multipart_helper.go`
- Modify: `backend/internal/api/handlers.go`
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Add constants for max reference image count, single image size, and total image bytes.
- [ ] Enforce limits in streaming multipart parser before appending bytes.
- [ ] Enforce equivalent limits in standard library fallback parser.
- [ ] Check local `refPaths` with `os.Stat` before `os.ReadFile`.
- [ ] Return clear errors for count/size violations.
- [ ] Document limits and error behavior.
- [ ] Run: `cd backend && go test ./... && go vet ./...`
- [ ] Commit: `fix: limit reference image upload size`

### Task 5: P0-02 Summarize provider response logs

**Files:**
- Modify: `backend/internal/provider/openai.go`
- Modify: `backend/internal/provider/gemini.go`
- Modify: `backend/internal/provider/openai_image.go`
- Modify: `backend/internal/diagnostic/*` if a shared helper is needed
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Add or reuse a helper that logs response length and safe preview only.
- [ ] Replace full response body diagnostic logs in OpenAI, Gemini, and OpenAI Image providers.
- [ ] Preserve status, elapsed time, request id, and response size.
- [ ] Keep full error previews bounded.
- [ ] Document that provider diagnostics are redacted and length-limited by default.
- [ ] Run: `cd backend && go test ./... && go vet ./...`
- [ ] Commit: `fix: summarize provider response logs`

### Task 6: P1-04 Add backend server timeouts

**Files:**
- Modify: `backend/cmd/server/main.go`
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Configure `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, and `IdleTimeout` on `http.Server`.
- [ ] Ensure timeout values do not break long-running generation status/SSE behavior.
- [ ] Document server connection timeout strategy.
- [ ] Run: `cd backend && go test ./... && go vet ./...`
- [ ] Start backend and verify: `curl -sf http://localhost:8080/api/v1/health`
- [ ] Commit: `fix: add backend server timeouts`

### Task 7: P2-01 Tighten worker timeout handling

**Files:**
- Modify: `backend/internal/worker/pool.go`
- Modify: provider call comments or interfaces only if necessary
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Review current provider goroutine pattern and context cancellation behavior.
- [ ] Prefer executing `p.Generate(ctx, task.Params)` directly in the worker goroutine if panic recovery can be preserved.
- [ ] If direct execution is unsafe, add explicit leak-risk guardrails and diagnostics.
- [ ] Preserve task failure semantics for deadline exceeded.
- [ ] Document provider context requirements.
- [ ] Run: `cd backend && go test ./... && go vet ./...`
- [ ] Commit: `fix: tighten worker timeout handling`

### Task 8: P0-03 Virtualize template market grid

**Files:**
- Modify: `desktop/src/components/TemplateMarket/TemplateMarketDrawer.tsx`
- Create/Modify: focused template grid component if needed under `desktop/src/components/TemplateMarket/`
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Reuse `react-window` grid patterns from `HistoryPanel/HistoryList.tsx`.
- [ ] Render only visible template cards while preserving responsive columns.
- [ ] Preserve filtering, empty state, preview modal, and apply behavior.
- [ ] Document template market virtualization.
- [ ] Run: `cd desktop && npm run type-check && npm run build`
- [ ] Commit: `perf: virtualize template market grid`

### Task 9: P1-05 Gate image URL diagnostics

**Files:**
- Modify: `desktop/src/services/api.ts`
- Modify: diagnostic/config helper if needed
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Find all hot-path `getImageUrl` console logs.
- [ ] Guard logs behind an existing verbose/diagnostic flag or add a minimal local helper.
- [ ] Keep actionable logs available when diagnostics are enabled.
- [ ] Document that image URL diagnostics are off by default.
- [ ] Run: `cd desktop && npm run type-check && npm run build`
- [ ] Commit: `perf: gate image url diagnostics`

### Task 10: P1-06 Narrow Zustand subscriptions

**Files:**
- Modify: `desktop/src/components/Settings/SettingsModal.tsx`
- Modify: `desktop/src/components/ConfigPanel/BatchSettings.tsx` if present
- Modify: `desktop/src/components/GenerateArea/BatchActions.tsx` if present
- Modify: `desktop/src/components/Toast.tsx` or actual toast component path
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Replace whole-store subscriptions with selectors.
- [ ] Use shallow comparison where multiple fields are selected.
- [ ] Avoid behavior changes while reducing re-render triggers.
- [ ] Document Zustand selector convention.
- [ ] Run: `cd desktop && npm run type-check && npm run build`
- [ ] Commit: `perf: narrow zustand subscriptions`

### Task 11: P1-07 Slim persisted history cache

**Files:**
- Modify: `desktop/src/store/historyStore.ts`
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Reduce `partialize` to lightweight fields or recent bounded items only.
- [ ] Ensure persisted data merge strips derived URLs and handles old cache safely.
- [ ] Preserve history load-more and current task sync behavior.
- [ ] Document history cache persistence limits.
- [ ] Run: `cd desktop && npm run type-check && npm run build`
- [ ] Commit: `perf: slim persisted history cache`

### Task 12: P2-02 Align Web frontend version strategy

**Files:**
- Modify: `frontend/package.json`
- Modify: Docker or docs only if version strategy requires it
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Decide from repo evidence whether standalone Web frontend should remain independent or align to desktop version.
- [ ] If aligning, update version metadata and docs consistently.
- [ ] If independent, add explicit docs explaining the split and prevent accidental confusion.
- [ ] Run: `cd frontend && npm run type-check && npm run build`
- [ ] Run: `docker compose config`
- [ ] Commit: `chore: align web frontend version strategy`

### Task 13: P2-03 Correct Nginx upgrade headers

**Files:**
- Modify: `docker/nginx.conf`
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Replace duplicate `Connection` header configuration with a standard upgrade-safe pattern.
- [ ] Avoid breaking normal API proxy requests.
- [ ] Document long-connection proxy behavior.
- [ ] Run: `docker compose config`
- [ ] Commit: `fix: correct nginx upgrade headers`

### Task 14: P2-04 Improve Docker health checks

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `docker/nginx.conf` if needed
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Ensure health checks cover backend API and Nginx/frontend availability.
- [ ] Keep checks fast and non-flaky.
- [ ] Document Docker health coverage.
- [ ] Run: `docker compose config`
- [ ] If practical: `docker compose build`
- [ ] Commit: `fix: improve docker health checks`

### Task 15: P2-05 Consolidate provider config API

**Files:**
- Modify: `desktop/src/services/configApi.ts`
- Modify: `desktop/src/services/providerApi.ts`
- Modify: affected imports/callers
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Pick one authoritative ProviderConfig type and update method location.
- [ ] Remove duplicate definitions or re-export from one source.
- [ ] Update all imports to the canonical source.
- [ ] Document provider API ownership.
- [ ] Run: `cd desktop && npm run type-check && npm run build`
- [ ] Commit: `refactor: consolidate provider config api`

### Task 16: P2-06A Split template market components

**Files:**
- Modify: `desktop/src/components/TemplateMarket/TemplateMarketDrawer.tsx`
- Create: one focused component or hook under `desktop/src/components/TemplateMarket/`
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Extract one clear responsibility, such as filter bar, grid shell, or card list wrapper.
- [ ] Keep behavior and styling identical.
- [ ] Do not rewrite the full file.
- [ ] Document template market component boundary.
- [ ] Run: `cd desktop && npm run type-check && npm run build`
- [ ] Commit: `refactor: split template market components`

### Task 17: P2-06B Split reference image upload logic

**Files:**
- Modify: `desktop/src/components/ConfigPanel/ReferenceImageUpload.tsx`
- Create: one focused hook or component near the existing file
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Extract one clear responsibility: drag/drop, paste handling, compression, or persistence.
- [ ] Preserve add/delete/drag/paste behavior.
- [ ] Do not rewrite the full file.
- [ ] Document reference upload logic boundary.
- [ ] Run: `cd desktop && npm run type-check && npm run build`
- [ ] Commit: `refactor: split reference image upload logic`

### Task 18: P2-06C Split settings modal sections

**Files:**
- Modify: `desktop/src/components/Settings/SettingsModal.tsx`
- Create: one focused provider form/field-group component or hook
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Extract one settings section without changing save/test/switch behavior.
- [ ] Keep props explicit and typed.
- [ ] Do not rewrite the full file.
- [ ] Document settings modal section boundary.
- [ ] Run: `cd desktop && npm run type-check && npm run build`
- [ ] Commit: `refactor: split settings modal sections`

### Task 19: P2-07 Clarify React Query usage

**Files:**
- Modify: `desktop/src/App.tsx`
- Modify: `desktop/package.json` and lockfile if removing dependency
- Modify: service layer only if migrating one small call
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Search for actual `useQuery`/`useMutation` usage.
- [ ] If unused, remove provider and dependency cleanly.
- [ ] If intentionally retained, document the migration strategy and keep runtime behavior unchanged.
- [ ] Run: `cd desktop && npm run type-check && npm run build`
- [ ] Commit: `chore: clarify react query usage`

### Task 20: P2-08 Lazy load desktop locales

**Files:**
- Modify: `desktop/src/i18n/index.ts`
- Modify: language switching logic if needed
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Load default language at startup.
- [ ] Dynamically import non-default locale JSON when language changes.
- [ ] Preserve zh-CN, en-US, ja-JP, ko-KR availability.
- [ ] Document locale loading strategy.
- [ ] Run: `cd desktop && npm run type-check && npm run build`
- [ ] Commit: `perf: lazy load desktop locales`

### Task 21: P2-09 Tighten Tauri asset security

**Files:**
- Modify: `desktop/src-tauri/tauri.conf.json`
- Modify: related asset path code only if needed
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] Narrow asset protocol scope away from broad `$HOME/**` where possible.
- [ ] Add a minimal CSP that still permits required asset/blob/http(s) image sources.
- [ ] Verify local image loading expectations from existing asset protocol docs.
- [ ] Document Tauri asset/CSP constraints.
- [ ] Run: `cd desktop && npm run type-check && npm run build`
- [ ] If practical: `cd desktop && npm run tauri build`
- [ ] Commit: `fix: tighten tauri asset security`

## Final Verification Task

- [ ] Run backend verification: `cd backend && go test ./... && go vet ./...`
- [ ] Run desktop verification: `cd desktop && npm run type-check && npm run build`
- [ ] Run Web verification: `cd frontend && npm run type-check && npm run build`
- [ ] Run Docker config verification: `docker compose config`
- [ ] Run `GIT_MASTER=1 git log --oneline -25` and confirm each optimization has its own commit.
- [ ] Report completed commits and any skipped expensive verification with reasons.
