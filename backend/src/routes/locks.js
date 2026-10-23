import express from 'express';
import Lock from '../models/Lock.js';
import Repository from '../models/Repository.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { getRepoAccess } from '../middleware/repoAccess.js';
import { config } from '../config.js';
import { normalizePath } from '../utils/path.js';

const router = express.Router();

router.get('/:id/locks', optionalAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canRead) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const locks = await Lock.find({ repositoryId: req.params.id, expiresAt: { $gt: new Date() } }).sort({ expiresAt: 1 });
  res.json({ locks });
});

router.post('/:id/locks', requireAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const access = await getRepoAccess(repo, req.user);
  if (!access.canWrite) return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have write access to this repository.' });
  let filePath;
  try { filePath = normalizePath(req.body?.filePath); } catch (error) { return res.status(400).json({ error: 'INVALID_PATH', message: error.message }); }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.lockDurationMs);
  try {
    const lock = await Lock.findOneAndUpdate(
      { repositoryId: repo._id, filePath, $or: [{ expiresAt: { $lte: now } }, { expiresAt: { $exists: false } }] },
      { $set: { userId: req.user._id, username: req.user.username, createdAt: now, expiresAt } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(201).json({ lock, acquired: true });
  } catch (error) {
    if (error?.code === 11000) {
      const current = await Lock.findOne({ repositoryId: repo._id, filePath });
      return res.status(409).json({ error: 'FILE_ALREADY_LOCKED', message: current ? `File is locked by ${current.username}.` : 'File is already locked.', lock: current });
    }
    throw error;
  }
});

router.delete('/:id/locks/:lockId', requireAuth, async (req, res) => {
  const repo = await Repository.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  const lock = await Lock.findOne({ _id: req.params.lockId, repositoryId: req.params.id });
  if (!lock) return res.status(404).json({ error: 'NOT_FOUND', message: 'Lock not found.' });
  const isLockOwner = String(lock.userId) === String(req.user._id);
  const isRepoOwner = String(repo.ownerId) === String(req.user._id);
  if (!isLockOwner && !isRepoOwner) return res.status(403).json({ error: 'FORBIDDEN', message: 'Only the lock owner or the repository owner can release this lock.' });
  await lock.deleteOne();
  res.json({ ok: true });
});

export default router;
