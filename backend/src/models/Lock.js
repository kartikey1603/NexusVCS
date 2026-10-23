import mongoose from 'mongoose';

const lockSchema = new mongoose.Schema({
  repositoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true, index: true },
  filePath: { type: String, required: true, trim: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: true },
});

// One logical active lock exists per repository/file. Expired locks are reused by the atomic acquisition route.
lockSchema.index({ repositoryId: 1, filePath: 1 }, { unique: true });

export default mongoose.model('Lock', lockSchema);
