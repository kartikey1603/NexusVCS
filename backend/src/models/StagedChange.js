import mongoose from 'mongoose';

// A StagedChange is the "index" entry for one pending edit in one user's personal staging
// area for a repository -- mirrors git's index: uploading, editing, deleting or restoring a
// file only ever writes here. Nothing here becomes a FileVersion/Commit until Push explicitly
// promotes it. Staging is scoped per (repositoryId, userId): each collaborator has their own
// private staging area, matching how a local git working copy/index is personal to one user.
const stagedChangeSchema = new mongoose.Schema({
  repositoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // The file this change targets. Null for a brand-new path that has no File document yet
  // (a staged "add"); populated once the path resolves to an existing File.
  fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File', default: null },
  path: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  action: { type: String, enum: ['add', 'modify', 'delete', 'restore'], required: true },
  // Pending content metadata for add/modify/restore. Left empty for delete.
  size: { type: Number, default: null },
  mimeType: { type: String, default: 'application/octet-stream' },
  sha256: { type: String, default: null },
  storageType: { type: String, enum: ['mongo', 's3'], default: null },
  storageKey: { type: String, default: null },
  content: { type: Buffer, default: undefined },
  // For a staged "restore": which historical version this change will bring back on push.
  restoreFromVersion: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// One staged change per path per user per repository -- staging the same path again replaces
// the pending entry (like re-running `git add` on a file already in the index).
stagedChangeSchema.index({ repositoryId: 1, userId: 1, path: 1 }, { unique: true });
stagedChangeSchema.pre('save', function(next) { this.updatedAt = new Date(); next(); });

export default mongoose.model('StagedChange', stagedChangeSchema);
