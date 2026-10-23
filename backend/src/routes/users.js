import express from 'express';
import User from '../models/User.js';
import Repository from '../models/Repository.js';
import Collaborator from '../models/Collaborator.js';
import Commit from '../models/Commit.js';
import Lock from '../models/Lock.js';
import StagedChange from '../models/StagedChange.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { deleteRepositoryCascade } from './repositories.js';

const router = express.Router();

// Delete Account: removes everything this user owns outright (their repositories, cascading
// through the same cleanup used by repository delete, S3 objects included), then detaches them
// from anything they only collaborate on -- collaborations/locks/staged changes are theirs to
// clean up, but the repositories themselves belong to their owners and are left untouched.
router.delete('/me', requireAuth, async (req, res) => {
  const ownedRepos = await Repository.find({ ownerId: req.user._id });
  for (const repo of ownedRepos) {
    await deleteRepositoryCascade(repo);
  }
  await Promise.all([
    Collaborator.deleteMany({ userId: req.user._id }),
    Lock.deleteMany({ userId: req.user._id }),
    StagedChange.deleteMany({ userId: req.user._id }),
  ]);
  await User.deleteOne({ _id: req.user._id });
  res.clearCookie('nexusvcs_token', { httpOnly: true, sameSite: 'lax', secure: config.nodeEnv === 'production' });
  res.json({ ok: true });
});

// Profile page: the profile owner sees their own public AND private repositories.
// Everyone else only ever sees public repositories/activity — private data never leaks.
router.get('/:username', optionalAuth, async (req, res) => {
  const user = await User.findOne({ username: req.params.username.toLowerCase() });
  if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
  const isSelf = Boolean(req.user) && String(req.user._id) === String(user._id);

  const ownRepoFilter = isSelf ? { ownerId: user._id } : { ownerId: user._id, visibility: 'public' };
  const ownRepos = await Repository.find(ownRepoFilter).sort({ updatedAt: -1 });
  const collabMatch = isSelf ? {} : { visibility: 'public' };
  const collaborations = await Collaborator.find({ userId: user._id })
    .populate({ path: 'repositoryId', match: collabMatch, populate: { path: 'ownerId', select: 'username' } });
  const collaboratingRepos = collaborations.map((c) => c.repositoryId).filter(Boolean);

  const publicRepoIds = ownRepos.filter((r) => r.visibility === 'public').map((r) => r._id);
  const recentCommitCount = await Commit.countDocuments({ repositoryId: { $in: publicRepoIds }, authorId: user._id });

  res.json({
    user: { username: user.username, createdAt: user.createdAt },
    isSelf,
    repositories: ownRepos,
    collaboratingRepositories: collaboratingRepos,
    stats: { publicRepositoryCount: publicRepoIds.length, recentCommitCount },
  });
});

export default router;
