import mongoose from 'mongoose';

const commitSchema = new mongoose.Schema({
  repositoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true, index: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true, trim: true, maxlength: 200 },
  parentCommitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Commit', default: null },
  changedFiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'File' }],
  // Snapshot of the exact file version each changed file was at right after this commit.
  // This is what makes "Revert" precise instead of guessing from timestamps.
  fileVersions: [{
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File' },
    version: { type: Number },
    _id: false,
  }],
  // Files this commit soft-deleted (a staged "delete" that was pushed). Kept separate from
  // fileVersions because a delete has no new content snapshot -- reverting it means undeleting
  // the file rather than restoring an older version's bytes.
  deletedFiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'File' }],
  isRevert: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

commitSchema.index({ repositoryId: 1, createdAt: -1 });

export default mongoose.model('Commit', commitSchema);
