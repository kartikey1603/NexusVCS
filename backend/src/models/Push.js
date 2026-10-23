import mongoose from 'mongoose';

// Lightweight record of a successful Push. A Commit is the content/history record; a Push is
// the event of publishing one -- kept separate (rather than piggy-backing on Commit) so the
// Dashboard can report a "Push count" distinct from raw commit history without guessing.
const pushSchema = new mongoose.Schema({
  repositoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  commitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Commit', required: true },
  createdAt: { type: Date, default: Date.now },
});

pushSchema.index({ repositoryId: 1, createdAt: -1 });

export default mongoose.model('Push', pushSchema);
