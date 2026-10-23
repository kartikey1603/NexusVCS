# NexusVCS

NexusVCS is a lightweight college-project version-control website for code and large digital assets. It uses a React frontend, a Node.js/Express backend, MongoDB for application state and file metadata, and Amazon S3 for large objects.

## Features

- Signup, login and logout with hashed passwords and HTTP-only cookie authentication.
- Public/private repositories owned by users.
- **Staged-changes workflow**: uploading, editing, deleting, or restoring a file never commits anything by itself. Every one of those actions creates a `StagedChange` in your own personal staging area for that repository; nothing becomes a `FileVersion`/`Commit` until you explicitly **Push** with a commit message, which promotes every currently staged change into one atomic commit.
- Soft-deleted files: a staged deletion, once pushed, hides the file from normal listings but keeps its full version history so it can be revived by reverting that commit or by re-adding the same path.
- File version retention: the current version plus the latest 10 previous versions are kept; older versions are pruned (S3 objects only removed once nothing else references them).
- 50 MB configurable small-upload threshold; large files (up to 8 GB) use true **S3 multipart upload**; code/text files are capped at a tighter 500 MB regardless of the general large-file ceiling.
- Direct browser-to-S3 multipart uploads (initiate / per-part presigned URLs / complete / abort) so large files never pass through the Node process, with per-part retry.
- SHA-256 content hashes and hash-based S3 object keys for basic deduplication.
- Centralized file locks stored in MongoDB with atomic acquisition and expiration.
- Server-side rejection with HTTP 409 when another user owns an active lock.
- Repository collaboration: owners can add/remove collaborators by username; collaborators get push/commit/lock access without repository-management rights.
- Public profile pages (`/:username`) showing a user's public repositories and collaborations, with no private or sensitive data exposed.
- Account deletion from your own profile: removes repositories you own (and everything under them), detaches you from repositories you only collaborate on, and logs you out.
- Dashboard workspace statistics (repository/commit/push/staged-change counts) computed from backend data.
- Basic security hardening: safe response headers and a rate limit on authentication endpoints.
- Dockerized frontend, backend and MongoDB with a persistent MongoDB volume.

## Architecture

```text
                         NexusVCS
                            |
                       React / Nginx
                            |
                         REST API
                            |
                    Node.js / Express
                      /            \
                     /              \
                MongoDB             Amazon S3
          users/repos/files/       large objects
          versions/commits/       presigned URLs
          locks
```

## Requirements

- Docker Desktop with Docker Compose.
- An AWS account and S3 bucket for large-file storage.
- No AWS credentials are required for the small-file-only local workflow, but S3 variables are required to exercise large-file features.

## Installation

1. Copy `.env.example` to `.env`.
2. Set a strong `JWT_SECRET`.
3. Set AWS variables for S3 support:
   - `AWS_REGION`
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_S3_BUCKET`
4. Start everything:

```bash
docker compose up --build
```

5. Open `http://localhost:3000`.

MongoDB data is stored in the `mongodb_data` Docker volume and survives `docker compose down` followed by `docker compose up` as long as the volume is retained.

## Environment variables

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string; Docker uses `mongodb://mongodb:27017/nexusvcs`. |
| `JWT_SECRET` | Server-only signing secret. |
| `FRONTEND_URL` | Allowed browser origin. |
| `AWS_REGION` | S3 region. |
| `AWS_ACCESS_KEY_ID` | Server-side AWS credential. Never put this in frontend source. |
| `AWS_SECRET_ACCESS_KEY` | Server-side AWS credential. Never put this in frontend source. |
| `AWS_S3_BUCKET` | S3 bucket name. |
| `LARGE_FILE_THRESHOLD_MB` | Default: `50`. Files at or below this use the small (base64/MongoDB) path; above it, S3 multipart upload is required. |
| `LOCK_DURATION_MINUTES` | Default: `60`. |
| `S3_PRESIGNED_EXPIRES_SECONDS` | Lifetime of each presigned part URL (fetched fresh per part, so this only needs to cover one part's upload, not the whole file). |
| `MAX_FILE_SIZE_MB` | Default: `8192` (8 GB). Hard ceiling for any file. |
| `MAX_CODE_FILE_SIZE_MB` | Default: `500`. Tighter ceiling that applies specifically to code/text files (by extension or `text/*` MIME type), even though other files may go up to `MAX_FILE_SIZE_MB`. |
| `MULTIPART_PART_SIZE_MB` | Default: `64`. Size of each S3 multipart upload part. |

## AWS S3 setup

Create a bucket in the configured region and allow the browser origin used by the app (`http://localhost:3000`) to perform the required `PUT` requests. The backend should have least-privilege access to the bucket for multipart upload (`CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `AbortMultipartUpload`), `GetObject`, `HeadObject`, `DeleteObject`, and `ListBucket`/`DeleteObjects` (for repository/version cleanup) on the NexusVCS object prefix.

**Required CORS configuration for multipart uploads to work at all:** the browser uploads each part directly to S3 via `fetch`/`XHR`, and the app reads the `ETag` response header from each part PUT to complete the multipart upload. S3's default CORS response does **not** expose `ETag` to browser JavaScript, so the bucket's CORS configuration must include `ExposeHeaders: ["ETag"]` alongside allowing `PUT` from the frontend origin, e.g.:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"]
  }
]
```

Without `ExposeHeaders: ["ETag"]`, every large-file upload will fail at the last step with an explicit "no ETag was returned" error (the app surfaces this rather than hanging or silently failing).

NexusVCS uses the AWS SDK for JavaScript v3 and the v3 S3 request presigner for presigned browser uploads/downloads. AWS's current v3 examples use `S3Client` + `PutObjectCommand`/`CreateMultipartUploadCommand`/`UploadPartCommand` + `getSignedUrl`, and AWS documents the v3 presigner package as the replacement for the older SDK v2 presigning helpers.

## Staged changes and Push

Uploading, editing, deleting, or restoring a file **never** creates a commit by itself. Each of those actions writes a `StagedChange` — scoped to the current user and repository, like a personal git index — that is only turned into a real `FileVersion`/`Commit` when the user explicitly **Push**es:

```text
Upload/Edit/Delete/Restore  →  StagedChange (per user, per repo)  →  commit message  →  Push  →  Commit + FileVersion(s)
```

- Staging the same path again (re-uploading, re-editing) replaces the pending entry for that path, the same way `git add` updates the index.
- Discarding a staged change removes it with no effect on the repository.
- Push validates every staged change (locks, staleness) *before* writing anything, and only then applies all of them and creates one commit — so a push either fully succeeds or leaves the repository exactly as it was; there are no partial commits.
- `Pull` (reloading repository state) never touches staged changes; they live in their own collection.
- A staged **delete** soft-deletes the file on push (hidden from listings, history preserved) rather than destroying anything immediately.
- A staged **restore** copies a historical version's content into the staging area; pushing it creates a brand-new version/commit carrying that content forward — history is never rewritten.

## Upload behavior

### Small files

Files at or below `LARGE_FILE_THRESHOLD_MB` are sent to the backend as base64 JSON and staged with their content stored in MongoDB. The implementation avoids routing these files through S3.

### Large files (S3 multipart upload)

Files above the threshold, up to `MAX_FILE_SIZE_MB` (code/text files are capped at the lower `MAX_CODE_FILE_SIZE_MB` instead):

1. The browser computes SHA-256 incrementally.
2. The backend authenticates the user, checks repository access, validates the path/size (including the code-file cap), and checks the lock state.
3. If an object with that SHA-256 already exists in S3 (deduplication), the upload is skipped entirely.
4. Otherwise the backend initiates an S3 multipart upload and returns an `uploadId`, the object key, and the part size/count.
5. The browser uploads each part directly to S3 via a freshly-requested presigned URL per part (so a failed part can be retried in isolation, with a fresh URL, without restarting the whole transfer).
6. Once every part succeeds, the backend completes the multipart upload (or aborts it, best-effort, on unrecoverable failure).
7. The browser then registers the result as a staged add/modify via the staged-changes endpoint below — it only becomes a real file/version once pushed.

The backend never buffers the large asset itself in Express memory — only small JSON metadata and presigned URLs pass through it.

## Deduplication

Large objects are stored using:

```text
repositories/{repositoryId}/objects/{sha256}
```

A repeated SHA-256 in the same repository can reuse the existing S3 object instead of creating another copy.

## Locking

Locks are stored in MongoDB with a unique `(repositoryId, filePath)` index. Acquisition uses an atomic `findOneAndUpdate(..., { upsert: true })` pattern that reuses expired locks. If two users race for the same active lock, the unique index prevents duplicate lock records and the losing request receives HTTP `409` with the current lock information.

Locks expire based on `LOCK_DURATION_MINUTES`. No background cleanup process is required; expired locks are treated as inactive during reads/acquisition.

## Version control

NexusVCS intentionally implements a small Git-inspired model rather than reimplementing Git internals:

- one default branch: `main`
- a staged-changes area (per user, per repository) that Upload/Edit/Delete/Restore write to, and that Push promotes into history
- commit message
- commit author/time
- parent commit pointer
- list of changed file IDs, split into content changes (`fileVersions`, with the exact version snapshot) and deletions (`deletedFiles`)
- file versions with incrementing version numbers; the current version plus the latest 10 previous versions are retained, older ones pruned (version numbers are never reused or renumbered)
- previous-version downloads and restore-to-a-version (staged, then pushed)
- revert: creates a *new* commit that restores the file states from right after a chosen commit (and un-deletes anything that commit soft-deleted) — history is never rewritten

Advanced merge/rebase/cherry-pick/pull-request/branching functionality is intentionally excluded.

## Access control

Each repository has one owner plus an optional set of collaborators:

- **Owner** — full control: settings, delete, manage collaborators, push, pull, commit, lock/unlock.
- **Collaborator** — added by the owner by username; can push, commit, upload (including large files via S3), and lock/unlock, but cannot manage collaborators or delete the repository.
- **Public visitor** — for public repositories: can browse files, view commits/history, and download files, but cannot write.
- **Unauthorized user** — private repositories return `404 NOT_FOUND` (not `403`) to anyone who is not the owner or a collaborator, so private repository existence is not leaked.

All of this is enforced server-side (`getRepoAccess` in `backend/src/middleware/repoAccess.js`); the frontend only hides buttons for convenience.

## Public profiles

`GET /api/users/:username` and the `/:username` frontend route show: username, join date, public repositories, public repositories the user collaborates on, and a public commit count. They never expose email, password data, auth tokens, or private repositories/files.

## Security notes

- Passwords are hashed with bcrypt.
- Authentication uses an HTTP-only cookie rather than exposing tokens to frontend JavaScript.
- AWS secret keys stay on the backend.
- File paths reject absolute paths, `..`, null bytes and URL-like values.
- Private repositories are not returned to unauthorized readers (owner/collaborator only), and return a generic 404 rather than leaking existence via 403.
- File modifications check server-side lock ownership; only the lock holder or the repository owner may release a lock.
- Large downloads are returned as temporary S3 URLs rather than proxied through Node.js.
- Response headers set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a same-site `Cross-Origin-Resource-Policy`.
- `/api/auth/*` is rate-limited (30 requests / 15 minutes per client) to blunt credential-stuffing attempts.
- The application does not look up, store, display, or transmit user IP addresses as application data. A client IP is used only transiently, in memory, as a rate-limit bucket key, and is never written to the database, logs, or API responses.
- No analytics, telemetry, tracking scripts, or third-party network calls beyond AWS S3 are present.

## API overview

```text
POST /api/auth/signup
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me

GET  /api/repositories
POST /api/repositories
GET  /api/repositories/stats
GET  /api/repositories/limits
GET  /api/repositories/:owner/:repo
DELETE /api/repositories/:id
GET  /api/repositories/:id/files
POST /api/repositories/:id/files              # stages an add/modify (small path) -- no commit
GET  /api/repositories/:id/commits
POST /api/repositories/:id/commits            # alias for Push (see below)
POST /api/repositories/:id/commits/:commitId/revert
GET  /api/repositories/:id/files/:fileId
GET  /api/repositories/:id/files/:fileId/download
GET  /api/repositories/:id/files/:fileId/content
PUT  /api/repositories/:id/files/:fileId/content   # editor save -- stages a modify, no commit
GET  /api/repositories/:id/files/:fileId/versions
GET  /api/repositories/:id/files/:fileId/versions/:version/download
POST /api/repositories/:id/files/:fileId/versions/:version/restore  # stages a restore
POST /api/repositories/:id/files/:fileId/delete     # stages a delete

# Staged changes ("index") -- personal to the current user, per repository
GET    /api/repositories/:id/changes
POST   /api/repositories/:id/changes
DELETE /api/repositories/:id/changes/:changeId

# Push -- promotes all of the current user's staged changes into one commit
POST /api/repositories/:id/push

POST /api/repositories/:id/locks
GET  /api/repositories/:id/locks
DELETE /api/repositories/:id/locks/:lockId

POST /api/s3/presigned-upload   # initiates S3 multipart upload (or reports dedup skip)
POST /api/s3/part-url           # presigned URL for one part (repeatable, for retries)
POST /api/s3/complete-upload    # completes the multipart upload on S3
POST /api/s3/abort-upload
GET  /api/repositories/public

GET  /api/repositories/:id/collaborators
POST /api/repositories/:id/collaborators
DELETE /api/repositories/:id/collaborators/:collaboratorId

GET  /api/users/:username
DELETE /api/users/me   # delete account
```

## Testing checklist

Before a college demo, test:

- Signup, login, logout and a wrong password.
- Public repository browsing without login.
- Private repository rejection for another user.
- Upload a small file, edit it, delete a file, and restore an older version: confirm **none** of these create a commit by themselves, and that they all show up in "Staged changes".
- Discard a staged change and confirm it has no effect on the repository.
- Push a batch of several staged changes with one commit message and confirm exactly one commit is created, with the correct changed/deleted file list, and staging is cleared.
- Click Push twice quickly and confirm only one commit is created (button disables; backend also rejects the second concurrent push for the same user+repo).
- Delete a file, push it, confirm it disappears from the file list but its commit/version history still exists; revert that commit and confirm the file reappears.
- Confirm dashboard repository/commit/push/staged-change counts match reality and update after a push.
- Small file upload (<= 50 MB), stage, push, and download.
- Large-file (> 50 MB) multipart upload: initiate, per-part upload with a simulated failed part (confirm retry works), complete, and confirm the staged change registers and pushes correctly.
- Same SHA-256 producing the same S3 object key and skipping re-upload (dedup).
- Upload a code/text file (e.g. `.js`, `.md`) just above 500 MB and confirm it is rejected; a non-code file of the same size is accepted (up to 8 GB).
- Create more than 11 versions of one file and confirm only the current + latest 10 previous versions remain.
- User A locks a file; User B sees it and receives `409` when attempting to modify or stage a change for it.
- User A unlocks; User B can then acquire the lock.
- Concurrent lock attempts against the same file produce one successful lock and conflicting responses for the others.
- Owner adds a collaborator by username; the collaborator can upload/edit/delete/restore/push/lock but cannot manage collaborators or delete the repository.
- Owner removes a collaborator; that user immediately loses write access (and read access, if the repository is private).
- A non-collaborator requesting a private repository receives a `404`, not a `403`.
- Visiting `/:username` shows only that user's public repositories and public collaborations.
- Delete a repository as its owner (with confirmation); confirm it, its files/commits/staged changes, and its S3 objects are gone, and that unrelated repositories' S3 objects are untouched.
- Delete your account (with confirmation); confirm repositories you owned are gone, repositories you only collaborated on are untouched (minus your collaborator entry), and you are logged out.

### How this patch was verified in the delivery environment

The sandbox this patch was produced in has **no network egress** (`npm install` is rejected with HTTP 403 by the environment's egress proxy) and no Docker/`mongod` available, so `npm install`, `npm run build`, and a full `npm test` against the real dependency tree (as this checklist and `package.json` expect) could not be executed here. What *was* done instead:

- Every changed file was syntax-validated (`node --check` for backend ESM files; a TypeScript-parser-based check for JSX/frontend files) after every edit.
- The two backend test files that need no external dependencies (`test/path.test.js`, `test/fileType.test.js`) were actually run with `node --test` and pass (6/6).
- Every frontend API call was cross-referenced against the backend route table by hand to confirm paths, methods, and request/response shapes line up.
- The full checklist above still needs to be run against a real `docker compose up --build` (or `npm install && npm run build && npm test`) before treating this as demo-ready.

## Cloud deployment

The app is containerized so the frontend and backend can be deployed to container-capable hosts while MongoDB and S3 remain managed services. Always re-check current pricing/free-tier rules before choosing a host. For example, Render currently advertises a $0 Hobby workspace with free deployment options, while MongoDB Atlas currently documents a Free cluster tier with 0.5 GB storage and rolling 10 GB inbound/outbound data-transfer limits. These limits are suitable for a small college demonstration but are not a promise of unlimited free production capacity.

## Known limitations

- Collaboration is intentionally simple (owner vs. collaborator; no per-file or per-branch permission tiers).
- Small-file content is stored in MongoDB, so the configured threshold (default 50 MB) must remain comfortably below MongoDB's BSON document limit.
- Large browser uploads depend on correct S3 bucket CORS and IAM configuration -- in particular `ExposeHeaders: ["ETag"]`, without which multipart uploads cannot complete (see the AWS S3 setup section).
- Push validates staged changes and applies them without a real multi-document database transaction (MongoDB transactions require a replica set, which the bundled single-node `docker-compose.yml` does not configure). The validate-everything-first, then-apply-everything approach avoids partial commits in the realistic failure cases (stale/locked files) but is not a substitute for a true ACID transaction under arbitrary mid-write failures.
- Reverting a commit that changed a file's *content*, when that file has since been deleted by a later commit, revives the file with the reverted content rather than erroring out as a "conflict" the way real Git might. Reverting a commit that only *deleted* a file simply un-deletes it at its last known content/version -- a revert of a revert of a delete does not re-delete the file (there is no multi-level undo/redo stack).
- The in-memory "push in progress" guard and the in-memory rate limiter on `/api/auth/*` are per-process; both would need a shared store (e.g. Redis) to work correctly behind multiple backend replicas.
- This is a lightweight educational system, not a full Git replacement (no branches beyond `main`, no merge/rebase).
