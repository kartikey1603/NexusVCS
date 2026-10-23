import Repository from '../models/Repository.js';
import Collaborator from '../models/Collaborator.js';

export async function getRepository(req, res, next) {
  const id = req.params.id;
  const repo = await Repository.findById(id).populate('ownerId', 'username email');
  if (!repo) return res.status(404).json({ error: 'NOT_FOUND', message: 'Repository not found.' });
  req.repository = repo;
  next();
}

export function ensureRepoOwner(req, res, next) {
  if (!req.user || String(req.repository.ownerId._id ?? req.repository.ownerId) !== String(req.user._id)) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Repository owner access required.' });
  }
  next();
}

// Determines what a (possibly anonymous) user may do with a repository, accounting for
// ownership, collaborator status, and public/private visibility. This is the single source
// of truth for repository authorization -- every route should go through this rather than
// re-deriving ownership checks inline.
export async function getRepoAccess(repo, user) {
  const isOwner = Boolean(user) && String(repo.ownerId._id ?? repo.ownerId) === String(user._id);
  if (isOwner) return { canRead: true, canWrite: true, isOwner: true, isCollaborator: false, role: 'owner' };

  let isCollaborator = false;
  if (user) {
    const collaborator = await Collaborator.findOne({ repositoryId: repo._id, userId: user._id });
    isCollaborator = Boolean(collaborator);
  }
  if (isCollaborator) return { canRead: true, canWrite: true, isOwner: false, isCollaborator: true, role: 'collaborator' };

  const isPublic = repo.visibility === 'public';
  return { canRead: isPublic, canWrite: false, isOwner: false, isCollaborator: false, role: isPublic ? 'visitor' : 'none' };
}

// Backwards-compatible synchronous read check for public repositories. Kept for call sites
// that only need to know "is this repo visible at all", but prefer getRepoAccess for
// anything involving a private repository, since it also accounts for collaborators.
export function canReadRepository(repo, user) {
  return repo.visibility === 'public' || (user && String(repo.ownerId._id ?? repo.ownerId) === String(user._id));
}
