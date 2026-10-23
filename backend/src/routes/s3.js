import express from 'express';
import Repository from '../models/Repository.js';
import File from '../models/File.js';
import Lock from '../models/Lock.js';
import { requireAuth } from '../middleware/auth.js';
import { getRepoAccess } from '../middleware/repoAccess.js';
import { config } from '../config.js';
import { normalizePath, fileNameFromPath } from '../utils/path.js';
import { isCodeOrTextFile } from '../utils/fileType.js';
import {
  isS3Enabled, objectExists,
  createMultipartUpload, getUploadPartUrl, completeMultipartUpload, abortMultipartUpload,
} from '../services/s3.js';

const router = express.Router();

// Large-file support: direct browser -> S3, via S3 multipart upload, so an 8GB file never
// passes through Express memory and a failed part can be retried on its own instead of
// restarting the whole transfer. This route only prepares the upload -- it does NOT create a
// File/FileVersion. Once every part is uploaded and /complete-upload finalizes the object on
// S3, the frontend registers the result as a staged change via POST /:id/changes, which is
// only turned into real history by a subsequent Push.
router.post('/presigned-upload', requireAuth, async (req, res) => {
  if (!isS3Enabled()) return res.status(503).json({ error: 'S3_NOT_CONFIGURED', message: 'AWS S3 is not configured on the backend.' });
  const { repositoryId, fileName, fileSize, contentType = 'application/octet-stream', sha256, path = fileName } = req.body || {};
  const repo = await Repository.findById(repositoryId);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canWrite) return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have write access to this repository.' });
  let safePath;
  try { safePath = normalizePath(path || fileName); } catch (error) { return res.status(400).json({ error: 'INVALID_PATH', message: error.message }); }
  const name = fileNameFromPath(safePath);
  const size = Number(fileSize);
  if (!Number.isSafeInteger(size) || size <= config.largeFileThresholdBytes || size > config.maxFileSizeBytes) return res.status(400).json({ error: 'INVALID_SIZE', message: 'File size must be above the large-file threshold and below the configured maximum.' });
  if (isCodeOrTextFile(name, contentType) && size > config.maxCodeFileSizeBytes) return res.status(413).json({ error: 'CODE_FILE_TOO_LARGE', message: `Code/text files may not exceed ${Math.round(config.maxCodeFileSizeBytes / (1024 * 1024))} MB.` });
  if (!/^[a-f0-9]{64}$/i.test(String(sha256 || ''))) return res.status(400).json({ error: 'INVALID_HASH', message: 'A SHA-256 hash is required.' });
  const existingFile = await File.findOne({ repositoryId: repo._id, path: safePath });
  if (existingFile) {
    const lock = await Lock.findOne({ repositoryId: repo._id, filePath: safePath, expiresAt: { $gt: new Date() } });
    if (lock && String(lock.userId) !== String(req.user._id)) return res.status(409).json({ error: 'FILE_LOCKED', message: `This file is currently locked by ${lock.username}.` });
  }
  const key = `repositories/${repo._id}/objects/${sha256}`;
  // Content-addressed dedup: identical bytes already sitting in S3 (e.g. a prior version, or
  // another file with the same content) need no re-upload at all.
  if (await objectExists(key)) return res.json({ uploadRequired: false, key, path: safePath });
  const partSize = config.multipartPartSizeBytes;
  const totalParts = Math.max(1, Math.ceil(size / partSize));
  const uploadId = await createMultipartUpload(key, contentType);
  res.json({ uploadRequired: true, uploadId, key, path: safePath, partSize, totalParts, expiresIn: config.presignedExpiresSeconds });
});

// Presigned URL for one part of an in-progress multipart upload. Called lazily, per part, so a
// failed/expired part can simply be re-requested and retried without restarting the upload.
router.post('/part-url', requireAuth, async (req, res) => {
  if (!isS3Enabled()) return res.status(503).json({ error: 'S3_NOT_CONFIGURED', message: 'AWS S3 is not configured on the backend.' });
  const { repositoryId, key, uploadId, partNumber } = req.body || {};
  const repo = await Repository.findById(repositoryId);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canWrite) return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have write access to this repository.' });
  if (!key || !key.startsWith(`repositories/${repo._id}/objects/`)) return res.status(400).json({ error: 'INVALID_KEY', message: 'Invalid S3 object key for this repository.' });
  const part = Number(partNumber);
  if (!uploadId || !Number.isInteger(part) || part < 1 || part > 10000) return res.status(400).json({ error: 'INVALID_INPUT', message: 'A valid uploadId and partNumber are required.' });
  const url = await getUploadPartUrl(key, uploadId, part);
  res.json({ url, partNumber: part, expiresIn: config.presignedExpiresSeconds });
});

// Finalizes the S3-side object assembly only. Registering the result as a staged change
// (add/modify) happens separately via POST /:id/changes.
router.post('/complete-upload', requireAuth, async (req, res) => {
  if (!isS3Enabled()) return res.status(503).json({ error: 'S3_NOT_CONFIGURED', message: 'AWS S3 is not configured on the backend.' });
  const { repositoryId, key, uploadId, parts } = req.body || {};
  const repo = await Repository.findById(repositoryId);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canWrite) return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have write access to this repository.' });
  if (!key || !key.startsWith(`repositories/${repo._id}/objects/`)) return res.status(400).json({ error: 'INVALID_KEY', message: 'Invalid S3 object key for this repository.' });
  if (!uploadId || !Array.isArray(parts) || !parts.length) return res.status(400).json({ error: 'INVALID_INPUT', message: 'uploadId and a non-empty parts list are required.' });
  const normalizedParts = parts.map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag || '') }));
  if (normalizedParts.some((p) => !Number.isInteger(p.partNumber) || !p.etag)) return res.status(400).json({ error: 'INVALID_INPUT', message: 'Each part needs a partNumber and etag.' });
  try {
    await completeMultipartUpload(key, uploadId, normalizedParts);
  } catch (error) {
    return res.status(400).json({ error: 'COMPLETE_FAILED', message: 'Could not assemble the uploaded parts. You can retry or abort this upload.' });
  }
  res.json({ ok: true, key });
});

// Best-effort cleanup for an upload the frontend gave up on (cancelled, or failed after
// retries) so S3 doesn't accumulate incomplete multipart uploads.
router.post('/abort-upload', requireAuth, async (req, res) => {
  if (!isS3Enabled()) return res.status(503).json({ error: 'S3_NOT_CONFIGURED', message: 'AWS S3 is not configured on the backend.' });
  const { repositoryId, key, uploadId } = req.body || {};
  const repo = await Repository.findById(repositoryId);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canWrite) return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have write access to this repository.' });
  if (!key || !key.startsWith(`repositories/${repo._id}/objects/`)) return res.status(400).json({ error: 'INVALID_KEY', message: 'Invalid S3 object key for this repository.' });
  if (!uploadId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'uploadId is required.' });
  await abortMultipartUpload(key, uploadId).catch(() => {});
  res.json({ ok: true });
});

export default router;
