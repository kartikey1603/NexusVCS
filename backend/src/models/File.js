import mongoose from 'mongoose';

const fileSchema = new mongoose.Schema({
  repositoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true, index: true },
  path: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  size: { type: Number, required: true },
  mimeType: { type: String, default: 'application/octet-stream' },
  sha256: { type: String, required: true, index: true },
  storageType: { type: String, enum: ['mongo', 's3'], required: true },
  storageKey: { type: String, default: null },
  currentVersion: { type: Number, default: 1 },
  // Soft delete: a deleted file keeps its History/FileVersions (so it can be revert-restored)
  // but is hidden from normal listings. Only a Push that carries a staged "delete" sets this.
  deleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

fileSchema.index({ repositoryId: 1, path: 1 }, { unique: true });

export default mongoose.model('File', fileSchema);
