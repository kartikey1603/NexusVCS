import express from 'express';
import Repository from '../models/Repository.js';
import User from '../models/User.js';
import File from '../models/File.js';
import FileVersion from '../models/FileVersion.js';
import Commit from '../models/Commit.js';
import Lock from '../models/Lock.js';
import Collaborator from '../models/Collaborator.js';
import StagedChange from '../models/StagedChange.js';
import Push from '../models/Push.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { getRepoAccess } from '../middleware/repoAccess.js';
import { normalizePath, fileNameFromPath } from '../utils/path.js';
import { sha256Buffer } from '../utils/hash.js';
import { isCodeOrTextFile } from '../utils/fileType.js';
import { config } from '../config.js';
import { createDownloadUrl, objectExists, isS3Enabled, deleteObject, deleteObjectsWithPrefix } from '../services/s3.js';

const router = express.Router();
const isObjectId = (v) => /^[0-9a-f]{24}$/i.test(String(v || ''));

// "My Repositories": repositories the current user owns, plus ones they collaborate on.
router.get('/', requireAuth, async (req, res) => {
  const collabRepoIds = (await Collaborator.find({ userId: req.user._id }).select('repositoryId')).map((c) => c.repositoryId);
  const repos = await Repository.find({ $or: [{ ownerId: req.user._id }, { _id: { $in: collabRepoIds } }] })
    .populate('ownerId', 'username')
    .sort({ updatedAt: -1 });
  res.json({ repositories: repos.map((r) => ({ ...r.toObject(), isOwner: String(r.ownerId._id ?? r.ownerId) === String(req.user._id) })) });
});

router.get('/public', async (req, res) => {
  const repos = await Repository.find({ visibility: 'public' }).populate('ownerId', 'username').sort({ updatedAt: -1 }).limit(100);
  res.json({ repositories: repos });
});

// Dashboard workspace statistics -- repository count, commit count, push count, and the
// current user's own pending staged-change count, all scoped to repos they own or collaborate
// on. Kept as a single aggregate call so the Dashboard never has to N+1 across repositories.
router.get('/stats', requireAuth, async (req, res) => {
  const collabRepoIds = (await Collaborator.find({ userId: req.user._id }).select('repositoryId')).map((c) => c.repositoryId);
  const repoIds = (await Repository.find({ $or: [{ ownerId: req.user._id }, { _id: { $in: collabRepoIds } }] }).select('_id')).map((r) => r._id);
  const [commitCount, pushCount, stagedChangeCount] = await Promise.all([
    Commit.countDocuments({ repositoryId: { $in: repoIds } }),
    Push.countDocuments({ repositoryId: { $in: repoIds } }),
    StagedChange.countDocuments({ userId: req.user._id, repositoryId: { $in: repoIds } }),
  ]);
  res.json({ repositoryCount: repoIds.length, commitCount, pushCount, stagedChangeCount });
});

// Public, read-only size-limit configuration so the upload UI can enforce (and explain) the
// same limits the backend enforces, without hardcoding numbers on the frontend.
router.get('/limits', (_req, res) => {
  res.json({
    largeFileThresholdBytes: config.largeFileThresholdBytes,
    maxFileSizeBytes: config.maxFileSizeBytes,
    maxCodeFileSizeBytes: config.maxCodeFileSizeBytes,
    multipartPartSizeBytes: config.multipartPartSizeBytes,
  });
});

router.post('/', requireAuth, async (req, res) => {
  const { name, description = '', visibility = 'public' } = req.body || {};
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name)) return res.status(400).json({ error: 'INVALID_INPUT', message: 'Repository name contains unsupported characters.' });
  if (!['public', 'private'].includes(visibility)) return res.status(400).json({ error: 'INVALID_INPUT', message: 'Invalid visibility.' });
  const slug = name.toLowerCase();
  try {
    const repo = await Repository.create({ name, slug, description, visibility, ownerId: req.user._id });
    res.status(201).json({ repository: repo });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'ALREADY_EXISTS', message: 'You already have a repository with that name.' });
    throw error;
  }
});

// Full cleanup for a repository: every collection that references it, plus its S3 objects.
// Object keys are namespaced `repositories/{repositoryId}/objects/{sha256}`, so deleting by
// that prefix can never touch another repository's (or another upload's) objects. Exported so
// account deletion can reuse the exact same cascade for repositories the user owns.
async function deleteRepositoryCascade(repo) {
  await Promise.all([
    File.deleteMany({ repositoryId: repo._id }),
    FileVersion.deleteMany({ repositoryId: repo._id }),
    Commit.deleteMany({ repositoryId: repo._id }),
    Lock.deleteMany({ repositoryId: repo._id }),
    Collaborator.deleteMany({ repositoryId: repo._id }),
    StagedChange.deleteMany({ repositoryId: repo._id }),
    Push.deleteMany({ repositoryId: repo._id }),
  ]);
  if (isS3Enabled()) {
    await deleteObjectsWithPrefix(`repositories/${repo._id}/objects/`).catch((error) => console.error('S3 cleanup failed for repository', repo._id, error));
  }
  await repo.deleteOne();
}

router.delete('/:id', requireAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  if (String(repo.ownerId) !== String(req.user._id)) return res.status(403).json({ error: 'FORBIDDEN', message: 'Only the owner can delete this repository.' });
  await deleteRepositoryCascade(repo);
  res.json({ ok: true });
});

// NOTE ON ROUTE ORDER: '/:owner/:repo' and '/:id/files', '/:id/commits', '/:id/collaborators'
// are all two-segment GET paths, so Express would otherwise match whichever is registered
// first regardless of which one the caller actually meant ("<repoId>/commits" would be
// parsed as owner="<repoId>", repo="commits"). This was the root cause of commit history,
// file listing, and collaborator lookups intermittently failing with "repository not found".
// Fix: the specific-purpose routes are registered first and guard on the id actually being a
// Mongo ObjectId; anything else (a real "owner/repo" lookup) falls through via next().

router.get('/:id/files', optionalAuth, async (req, res, next) => {
  if (!isObjectId(req.params.id)) return next();
  const repo = await Repository.findById(req.params.id).populate('ownerId', 'username');
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canRead) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const files = await File.find({ repositoryId: repo._id, deleted: { $ne: true } }).sort({ path: 1 });
  res.json({ files });
});

// --- Staged changes ("index") -----------------------------------------------------------
// Every upload, edit, delete, or restore lands here first as a StagedChange, scoped to the
// requesting user's own personal staging area for this repository. Nothing here is visible
// history yet -- only Push (below) turns a batch of staged changes into a real commit.

// Resolves and validates one staging request against current repo/lock state, then creates or
// replaces the caller's pending StagedChange for that path. Shared by the generic POST
// /:id/changes route and by the thinner file-delete / version-restore routes, so all four
// staged action kinds (add, modify, delete, restore) go through one validated code path.
async function stageChange(repo, user, input) {
  const now = new Date();
  const err = (status, error, message) => ({ status, body: { error, message } });

  let file = null;
  let safePath;
  if (input.fileId) {
    file = await File.findOne({ _id: input.fileId, repositoryId: repo._id });
    if (!file) return err(404, 'NOT_FOUND', 'File not found.');
    safePath = file.path;
  } else {
    try { safePath = normalizePath(input.path || input.name); } catch (error) { return err(400, 'INVALID_PATH', error.message); }
    file = await File.findOne({ repositoryId: repo._id, path: safePath });
  }
  const activeFile = file && !file.deleted ? file : null;

  const lock = await Lock.findOne({ repositoryId: repo._id, filePath: safePath, expiresAt: { $gt: now } });
  if (lock && String(lock.userId) !== String(user._id)) return err(409, 'FILE_LOCKED', `This file is currently locked by ${lock.username}.`);

  async function saveChange(fields) {
    const change = await StagedChange.findOneAndUpdate(
      { repositoryId: repo._id, userId: user._id, path: safePath },
      { $set: { ...fields, path: safePath, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return { status: 201, body: { change } };
  }

  if (input.action === 'delete') {
    if (!activeFile) {
      if (file?.deleted) return err(400, 'ALREADY_DELETED', 'This file has already been deleted.');
      // Nothing real exists at this path yet -- if the only thing here is an unpushed "add",
      // there is nothing to soft-delete; just drop the pending add.
      const pendingAdd = await StagedChange.findOne({ repositoryId: repo._id, userId: user._id, path: safePath, action: 'add' });
      if (pendingAdd) { await pendingAdd.deleteOne(); return { status: 200, body: { discarded: true } }; }
      return err(404, 'NOT_FOUND', 'File not found.');
    }
    return saveChange({ fileId: activeFile._id, action: 'delete', name: activeFile.name, size: null, mimeType: activeFile.mimeType, sha256: null, storageType: null, storageKey: null, content: undefined, restoreFromVersion: null });
  }

  if (input.action === 'restore') {
    if (!activeFile) return file?.deleted ? err(400, 'ALREADY_DELETED', 'This file has already been deleted.') : err(404, 'NOT_FOUND', 'File not found.');
    const version = Number(input.version);
    if (!Number.isInteger(version) || version < 1) return err(400, 'INVALID_INPUT', 'A valid version number is required.');
    if (version === activeFile.currentVersion) return err(400, 'INVALID_INPUT', 'That is already the current version.');
    const historical = await FileVersion.findOne({ fileId: activeFile._id, version });
    if (!historical) return err(404, 'NOT_FOUND', 'File version not found.');
    return saveChange({
      fileId: activeFile._id, action: 'restore', name: activeFile.name,
      size: historical.size, mimeType: historical.mimeType, sha256: historical.sha256,
      storageType: historical.storageType, storageKey: historical.storageKey, content: historical.content,
      restoreFromVersion: version,
    });
  }

  // add / modify -- the label is derived from current state (does an active File already
  // exist here?) rather than trusted from the caller, mirroring how `git add` treats a new
  // path and a changed path identically. `file` (not `activeFile`) decides which File document
  // gets updated at Push time, so re-adding a soft-deleted path revives the same document
  // instead of colliding with its still-unique path index.
  const action = activeFile ? 'modify' : 'add';
  const name = input.name || file?.name || fileNameFromPath(safePath);
  const mimeType = input.mimeType || 'application/octet-stream';

  if (input.storageType === 's3') {
    if (!input.storageKey || !/^[a-f0-9]{64}$/i.test(String(input.sha256 || ''))) return err(400, 'INVALID_INPUT', 'A valid S3 object key and SHA-256 are required.');
    const expectedPrefix = `repositories/${repo._id}/objects/`;
    if (!input.storageKey.startsWith(expectedPrefix)) return err(400, 'INVALID_KEY', 'Invalid S3 object key for this repository.');
    if (!(await objectExists(input.storageKey))) return err(400, 'UPLOAD_NOT_FOUND', 'The uploaded object was not found in S3. Complete the multipart upload first.');
    const size = Number(input.size);
    if (!Number.isSafeInteger(size) || size <= config.largeFileThresholdBytes || size > config.maxFileSizeBytes) return err(400, 'INVALID_SIZE', 'Invalid large-file size.');
    if (isCodeOrTextFile(name, mimeType) && size > config.maxCodeFileSizeBytes) return err(413, 'CODE_FILE_TOO_LARGE', `Code/text files may not exceed ${Math.round(config.maxCodeFileSizeBytes / (1024 * 1024))} MB.`);
    return saveChange({ fileId: file?._id || null, action, name, size, mimeType, sha256: input.sha256, storageType: 's3', storageKey: input.storageKey, content: undefined, restoreFromVersion: null });
  }

  if (typeof input.contentBase64 !== 'string') return err(400, 'INVALID_INPUT', 'File content is required.');
  const content = Buffer.from(input.contentBase64, 'base64');
  const byteSize = Number(input.size);
  if (!Number.isSafeInteger(byteSize) || byteSize < 0 || content.byteLength !== byteSize) return err(400, 'INVALID_INPUT', 'File size does not match uploaded content.');
  if (byteSize > config.largeFileThresholdBytes) return err(413, 'LARGE_FILE', 'Use the S3 upload flow for files over the configured threshold.');
  if (isCodeOrTextFile(name, mimeType) && byteSize > config.maxCodeFileSizeBytes) return err(413, 'CODE_FILE_TOO_LARGE', `Code/text files may not exceed ${Math.round(config.maxCodeFileSizeBytes / (1024 * 1024))} MB.`);
  const sha256 = sha256Buffer(content);
  return saveChange({ fileId: file?._id || null, action, name, size: byteSize, mimeType, sha256, storageType: 'mongo', storageKey: null, content, restoreFromVersion: null });
}

router.get('/:id/changes', requireAuth, async (req, res, next) => {
  if (!isObjectId(req.params.id)) return next();
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canWrite) return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have write access to this repository.' });
  const changes = await StagedChange.find({ repositoryId: repo._id, userId: req.user._id }).select('-content').sort({ path: 1 });
  res.json({ changes });
});

router.post('/:id/changes', requireAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canWrite) return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have write access to this repository.' });
  const { action, path, fileId, name, size, mimeType, contentBase64, storageType, storageKey, sha256, version } = req.body || {};
  const result = await stageChange(repo, req.user, { action, path, fileId, name, size, mimeType, contentBase64, storageType, storageKey, sha256, version });
  res.status(result.status).json(result.body);
});

router.delete('/:id/changes/:changeId', requireAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const change = await StagedChange.findOne({ _id: req.params.changeId, repositoryId: repo._id, userId: req.user._id });
  if (!change) return res.status(404).json({ error: 'NOT_FOUND', message: 'Staged change not found.' });
  await change.deleteOne();
  res.json({ ok: true });
});

// --- Push ---------------------------------------------------------------------------------
// Promotes every one of the caller's staged changes into a single new commit. Validates
// everything up front (locks, staleness) before writing anything, so a Push either fully
// succeeds or leaves the repository exactly as it was -- never a partial commit.

const VERSIONS_TO_KEEP = 11; // current version + latest 10 previous, per retention policy

async function isStorageKeyStillReferenced(key, excludeVersionId) {
  const [otherVersion, pendingChange] = await Promise.all([
    FileVersion.exists({ _id: { $ne: excludeVersionId }, storageKey: key }),
    StagedChange.exists({ storageKey: key }),
  ]);
  return Boolean(otherVersion || pendingChange);
}

async function pruneOldFileVersions(file) {
  const versions = await FileVersion.find({ fileId: file._id }).sort({ version: -1 });
  if (versions.length <= VERSIONS_TO_KEEP) return;
  for (const version of versions.slice(VERSIONS_TO_KEEP)) {
    if (version.storageType === 's3' && version.storageKey && isS3Enabled()) {
      const stillReferenced = await isStorageKeyStillReferenced(version.storageKey, version._id);
      if (!stillReferenced) await deleteObject(version.storageKey).catch((error) => console.error('S3 version cleanup failed', version.storageKey, error));
    }
    await version.deleteOne();
  }
}

const pushInFlight = new Set(); // in-memory guard (per repo+user) against duplicate concurrent Push submissions

async function executePush(repo, user, message) {
  if (!message?.trim()) return { status: 400, body: { error: 'INVALID_INPUT', message: 'A commit message is required to push.' } };
  const key = `${repo._id}:${user._id}`;
  if (pushInFlight.has(key)) return { status: 409, body: { error: 'PUSH_IN_PROGRESS', message: 'A push for this repository is already in progress.' } };
  pushInFlight.add(key);
  try {
    const changes = await StagedChange.find({ repositoryId: repo._id, userId: user._id });
    if (!changes.length) return { status: 400, body: { error: 'NOTHING_TO_PUSH', message: 'There are no staged changes to push.' } };

    const now = new Date();

    // Pass 1: validate every staged change against current state. If anything fails, bail out
    // without having written a single document -- no partial commits.
    for (const change of changes) {
      const lock = await Lock.findOne({ repositoryId: repo._id, filePath: change.path, expiresAt: { $gt: now } });
      if (lock && String(lock.userId) !== String(user._id)) {
        return { status: 409, body: { error: 'FILE_LOCKED', message: `Cannot push: "${change.path}" is currently locked by ${lock.username}.` } };
      }
      if (change.action === 'delete' || change.action === 'restore') {
        const target = change.fileId ? await File.findById(change.fileId) : null;
        if (!target || target.deleted) {
          return { status: 409, body: { error: 'STALE_CHANGE', message: `Cannot push: "${change.path}" is no longer available. Discard this staged change and try again.` } };
        }
      }
    }

    // Pass 2: apply. Everything below is now guaranteed valid.
    const changedFileIds = [];
    const deletedFileIds = [];
    const fileVersions = [];

    for (const change of changes) {
      if (change.action === 'delete') {
        const target = await File.findById(change.fileId);
        target.deleted = true;
        target.deletedAt = now;
        target.updatedAt = now;
        await target.save();
        deletedFileIds.push(target._id);
        continue;
      }

      let target = change.fileId ? await File.findById(change.fileId) : null;
      if (target) {
        const nextVersion = target.currentVersion + 1;
        await FileVersion.create({
          fileId: target._id, repositoryId: repo._id, version: nextVersion,
          sha256: change.sha256, size: change.size, mimeType: change.mimeType,
          storageType: change.storageType, storageKey: change.storageKey, content: change.content,
          createdBy: user._id,
        });
        target.currentVersion = nextVersion;
        target.sha256 = change.sha256;
        target.size = change.size;
        target.mimeType = change.mimeType;
        target.storageType = change.storageType;
        target.storageKey = change.storageKey;
        target.deleted = false;
        target.deletedAt = null;
        target.updatedAt = now;
        await target.save();
        await pruneOldFileVersions(target);
      } else {
        target = await File.create({
          repositoryId: repo._id, path: change.path, name: change.name,
          size: change.size, mimeType: change.mimeType, sha256: change.sha256,
          storageType: change.storageType, storageKey: change.storageKey, currentVersion: 1,
        });
        await FileVersion.create({
          fileId: target._id, repositoryId: repo._id, version: 1,
          sha256: change.sha256, size: change.size, mimeType: change.mimeType,
          storageType: change.storageType, storageKey: change.storageKey, content: change.content,
          createdBy: user._id,
        });
      }
      changedFileIds.push(target._id);
      fileVersions.push({ fileId: target._id, version: target.currentVersion });
    }

    const previous = await Commit.findOne({ repositoryId: repo._id }).sort({ createdAt: -1 });
    const commit = await Commit.create({
      repositoryId: repo._id, authorId: user._id, message: message.trim(),
      parentCommitId: previous?._id || null,
      changedFiles: [...changedFileIds, ...deletedFileIds],
      fileVersions, deletedFiles: deletedFileIds,
    });
    const push = await Push.create({ repositoryId: repo._id, userId: user._id, commitId: commit._id });
    await StagedChange.deleteMany({ _id: { $in: changes.map((c) => c._id) } });

    return { status: 201, body: { commit, push } };
  } finally {
    pushInFlight.delete(key);
  }
}

router.post('/:id/push', requireAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canWrite) return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have write access to this repository.' });
  const result = await executePush(repo, req.user, req.body?.message);
  res.status(result.status).json(result.body);
});

// Small-file staging: content travels as base64 in the JSON body. This does NOT create a
// commit -- it only stages an add/modify pending Push (see stageChange above).
router.post('/:id/files', requireAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canWrite) return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have write access to this repository.' });
  const { path, name, size, mimeType, contentBase64 } = req.body || {};
  const result = await stageChange(repo, req.user, { path, name, size, mimeType, contentBase64 });
  res.status(result.status).json(result.body);
});

// File delete: stages a soft-deletion. The file (and its history) is only actually removed
// from listings once this staged change is Pushed -- see "Delete -> Stage deletion -> Push ->
// Commit deletion" in the workflow above.
router.post('/:id/files/:fileId/delete', requireAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canWrite) return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have write access to this repository.' });
  const result = await stageChange(repo, req.user, { action: 'delete', fileId: req.params.fileId });
  res.status(result.status).json(result.body);
});

router.get('/:id/commits', optionalAuth, async (req, res, next) => {
  if (!isObjectId(req.params.id)) return next();
  const repo = await Repository.findById(req.params.id).populate('ownerId', 'username');
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canRead) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const commits = await Commit.find({ repositoryId: repo._id }).populate('authorId', 'username').sort({ createdAt: -1 }).limit(100);
  res.json({ commits });
});

// POST .../commits is kept as a compatible alias for Push. The original endpoint recorded a
// commit against file versions that a prior upload had already created; that no longer applies
// now that uploads/edits only ever stage a pending change -- there is nothing to commit except
// whatever is currently staged, which is exactly what Push does.
router.post('/:id/commits', requireAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canWrite) return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have write access to this repository.' });
  const result = await executePush(repo, req.user, req.body?.message);
  res.status(result.status).json(result.body);
});

// Revert: restores the files touched by a past commit to the version snapshot they had right
// after that commit, and un-deletes any file that commit soft-deleted, then records this as a
// brand-new commit (parented on the current tip). Existing history is never rewritten.
router.post('/:id/commits/:commitId/revert', requireAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canWrite) return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have write access to this repository.' });
  const target = await Commit.findOne({ _id: req.params.commitId, repositoryId: repo._id });
  if (!target) return res.status(404).json({ error: 'NOT_FOUND', message: 'Commit not found.' });
  if (!target.fileVersions?.length && !target.deletedFiles?.length) return res.status(400).json({ error: 'NOTHING_TO_REVERT', message: 'This commit has no recorded file changes to revert.' });

  const now = new Date();
  const revertedFileIds = [];
  for (const entry of target.fileVersions || []) {
    const file = await File.findOne({ _id: entry.fileId, repositoryId: repo._id });
    if (!file) continue;
    const oldVersion = await FileVersion.findOne({ fileId: file._id, version: entry.version });
    if (!oldVersion) continue;
    const lock = await Lock.findOne({ repositoryId: repo._id, filePath: file.path, expiresAt: { $gt: now } });
    if (lock && String(lock.userId) !== String(req.user._id)) return res.status(409).json({ error: 'FILE_LOCKED', message: `Cannot revert: ${file.path} is currently locked by ${lock.username}.` });
    if (file.currentVersion === entry.version && !file.deleted) { revertedFileIds.push(file._id); continue; } // already at that state
    const nextVersion = file.currentVersion + 1;
    await FileVersion.create({
      fileId: file._id, repositoryId: repo._id, version: nextVersion,
      sha256: oldVersion.sha256, size: oldVersion.size, mimeType: oldVersion.mimeType,
      storageType: oldVersion.storageType, storageKey: oldVersion.storageKey, content: oldVersion.content,
      createdBy: req.user._id,
    });
    file.currentVersion = nextVersion;
    file.sha256 = oldVersion.sha256;
    file.size = oldVersion.size;
    file.mimeType = oldVersion.mimeType;
    file.storageType = oldVersion.storageType;
    file.storageKey = oldVersion.storageKey;
    // Reverting content that predates a later deletion revives the file with that content,
    // rather than leaving it hidden -- a simplification noted in the project summary.
    file.deleted = false;
    file.deletedAt = null;
    file.updatedAt = now;
    await file.save();
    await pruneOldFileVersions(file);
    revertedFileIds.push(file._id);
  }

  const revivedFileIds = [];
  for (const fileId of target.deletedFiles || []) {
    const file = await File.findOne({ _id: fileId, repositoryId: repo._id });
    if (!file) continue;
    if (file.deleted) {
      file.deleted = false;
      file.deletedAt = null;
      file.updatedAt = now;
      await file.save();
    }
    revivedFileIds.push(file._id);
  }

  const allChangedIds = [...revertedFileIds, ...revivedFileIds];
  if (!allChangedIds.length) return res.status(400).json({ error: 'NOTHING_TO_REVERT', message: 'Nothing to revert -- the affected files are unchanged or no longer exist.' });

  const previous = await Commit.findOne({ repositoryId: repo._id }).sort({ createdAt: -1 });
  const revertedFiles = await File.find({ _id: { $in: revertedFileIds } }).select('currentVersion');
  const fileVersions = revertedFiles.map((f) => ({ fileId: f._id, version: f.currentVersion }));
  const commit = await Commit.create({
    repositoryId: repo._id, authorId: req.user._id,
    message: `Revert "${target.message}"`.slice(0, 200),
    parentCommitId: previous?._id || null, changedFiles: allChangedIds, fileVersions, isRevert: true,
  });
  await Push.create({ repositoryId: repo._id, userId: req.user._id, commitId: commit._id });
  res.status(201).json({ commit });
});

router.get('/:id/files/:fileId', optionalAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id).populate('ownerId', 'username');
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canRead) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const file = await File.findOne({ _id: req.params.fileId, repositoryId: repo._id, deleted: { $ne: true } });
  if (!file) return res.status(404).json({ error: 'NOT_FOUND', message: 'File not found.' });
  const lock = await Lock.findOne({ repositoryId: repo._id, filePath: file.path, expiresAt: { $gt: new Date() } });
  res.json({ file, lock, canWrite: access.canWrite });
});

router.get('/:id/files/:fileId/download', optionalAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id).populate('ownerId', 'username');
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canRead) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const file = await File.findOne({ _id: req.params.fileId, repositoryId: repo._id, deleted: { $ne: true } });
  if (!file) return res.status(404).json({ error: 'NOT_FOUND', message: 'File not found.' });
  if (file.storageType === 's3') return res.redirect(await createDownloadUrl(file.storageKey));
  const version = await FileVersion.findOne({ fileId: file._id, version: file.currentVersion });
  res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
  res.send(version.content);
});

router.get('/:id/files/:fileId/versions', optionalAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id).populate('ownerId', 'username');
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canRead) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const file = await File.findOne({ _id: req.params.fileId, repositoryId: repo._id });
  if (!file) return res.status(404).json({ error: 'NOT_FOUND', message: 'File not found.' });
  const versions = await FileVersion.find({ fileId: file._id }).populate('createdBy', 'username').sort({ version: -1 });
  res.json({ versions });
});

// Restore version: stages the chosen historical version's content as a pending "restore".
// Nothing changes until this staged change is Pushed, and it never rewrites history -- the
// push creates a brand-new version/commit carrying the restored content forward.
router.post('/:id/files/:fileId/versions/:version/restore', requireAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canWrite) return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have write access to this repository.' });
  const result = await stageChange(repo, req.user, { action: 'restore', fileId: req.params.fileId, version: req.params.version });
  res.status(result.status).json(result.body);
});

router.get('/:id/files/:fileId/content', optionalAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id).populate('ownerId', 'username');
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canRead) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const file = await File.findOne({ _id: req.params.fileId, repositoryId: repo._id, deleted: { $ne: true } });
  if (!file) return res.status(404).json({ error: 'NOT_FOUND', message: 'File not found.' });
  if (file.storageType !== 'mongo' || file.size > config.largeFileThresholdBytes) return res.status(415).json({ error: 'PREVIEW_UNAVAILABLE', message: 'Preview is available for small files stored in MongoDB.' });
  const version = await FileVersion.findOne({ fileId: file._id, version: file.currentVersion });
  if (!version) return res.status(404).json({ error: 'NOT_FOUND', message: 'File version not found.' });
  if (!isCodeOrTextFile(file.name, file.mimeType)) return res.status(415).json({ error: 'PREVIEW_UNAVAILABLE', message: 'This binary file is not rendered.' });
  res.type('text/plain').send(version.content.toString('utf8'));
});

router.get('/:id/files/:fileId/versions/:version/download', optionalAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id).populate('ownerId', 'username');
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canRead) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const file = await File.findOne({ _id: req.params.fileId, repositoryId: repo._id });
  if (!file) return res.status(404).json({ error: 'NOT_FOUND', message: 'File not found.' });
  const version = await FileVersion.findOne({ fileId: file._id, version: Number(req.params.version) });
  if (!version) return res.status(404).json({ error: 'NOT_FOUND', message: 'File version not found.' });
  if (version.storageType === 's3') return res.redirect(await createDownloadUrl(version.storageKey));
  res.setHeader('Content-Type', version.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}.v${version.version}"`);
  res.send(version.content);
});

// PUT .../content is the code-editor save action. It now stages a "modify" instead of
// committing immediately -- no commit message here; that is supplied once, at Push time, for
// the whole batch of staged changes (see stageChange/executePush above).
router.put('/:id/files/:fileId/content', requireAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canWrite) return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have write access to this repository.' });
  const file = await File.findOne({ _id: req.params.fileId, repositoryId: repo._id, deleted: { $ne: true } });
  if (!file) return res.status(404).json({ error: 'NOT_FOUND', message: 'File not found.' });
  if (file.storageType !== 'mongo' || file.size > config.largeFileThresholdBytes) return res.status(415).json({ error: 'EDIT_UNAVAILABLE', message: 'In-browser editing is only available for small text files.' });
  const { content } = req.body || {};
  if (typeof content !== 'string') return res.status(400).json({ error: 'INVALID_INPUT', message: 'File content is required.' });
  const buffer = Buffer.from(content, 'utf8');
  const result = await stageChange(repo, req.user, { fileId: file._id, size: buffer.byteLength, mimeType: file.mimeType, contentBase64: buffer.toString('base64') });
  res.status(result.status).json(result.body);
});

// --- Collaboration -----------------------------------------------------------------------
// Simple owner/collaborator model: only the repository owner may add or remove collaborators.
// Collaborators gain read+write access to the repository (upload, commit, lock/unlock) but
// cannot manage collaborators, change repository settings, or delete the repository.

router.get('/:id/collaborators', optionalAuth, async (req, res, next) => {
  if (!isObjectId(req.params.id)) return next();
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canRead) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const collaborators = await Collaborator.find({ repositoryId: repo._id }).populate('userId', 'username').sort({ createdAt: 1 });
  res.json({ collaborators });
});

router.post('/:id/collaborators', requireAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  if (String(repo.ownerId) !== String(req.user._id)) return res.status(403).json({ error: 'FORBIDDEN', message: 'Only the repository owner can manage collaborators.' });
  const username = String(req.body?.username || '').trim().toLowerCase();
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'A username is required.' });
  const collaboratorUser = await User.findOne({ username });
  if (!collaboratorUser) return res.status(404).json({ error: 'NOT_FOUND', message: 'No user with that username was found.' });
  if (String(collaboratorUser._id) === String(repo.ownerId)) return res.status(400).json({ error: 'INVALID_INPUT', message: 'The repository owner already has full access.' });
  try {
    const collaborator = await Collaborator.create({ repositoryId: repo._id, userId: collaboratorUser._id, addedBy: req.user._id });
    await collaborator.populate('userId', 'username');
    res.status(201).json({ collaborator });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'ALREADY_EXISTS', message: 'That user is already a collaborator.' });
    throw error;
  }
});

router.delete('/:id/collaborators/:collaboratorId', requireAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  if (String(repo.ownerId) !== String(req.user._id)) return res.status(403).json({ error: 'FORBIDDEN', message: 'Only the repository owner can manage collaborators.' });
  const collaborator = await Collaborator.findOne({ _id: req.params.collaboratorId, repositoryId: repo._id });
  if (!collaborator) return res.status(404).json({ error: 'NOT_FOUND', message: 'Collaborator not found.' });
  await collaborator.deleteOne();
  res.json({ ok: true });
});

// Registered last: this is the fallback "owner/repo-slug" lookup used by the repository page.
// Everything above it that could otherwise collide on a two-segment GET path guards on the
// first segment being a Mongo ObjectId and calls next() when it isn't, so requests like
// "GET /api/repositories/alice/my-repo" correctly fall through to here.
router.get('/:owner/:repo', optionalAuth, async (req, res) => {
  const owner = await User.findOne({ username: req.params.owner.toLowerCase() });
  if (!owner) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const repo = await Repository.findOne({ ownerId: owner._id, slug: req.params.repo.toLowerCase() }).populate('ownerId', 'username');
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canRead) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const files = await File.find({ repositoryId: repo._id, deleted: { $ne: true } }).sort({ path: 1 }).lean();
  const locks = await Lock.find({ repositoryId: repo._id, expiresAt: { $gt: new Date() } }).lean();
  let collaborators = [];
  if (access.isOwner) {
    collaborators = await Collaborator.find({ repositoryId: repo._id }).populate('userId', 'username').sort({ createdAt: 1 });
  }
  res.json({ repository: repo, files, locks, canWrite: access.canWrite, isOwner: access.isOwner, role: access.role, collaborators });
});

export default router;
export { deleteRepositoryCascade };
