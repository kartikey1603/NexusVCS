import mongoose from 'mongoose';

const fileVersionSchema = new mongoose.Schema({
  fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File', required: true, index: true },
  repositoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true, index: true },
  version: { type: Number, required: true },
  sha256: { type: String, required: true },
  size: { type: Number, required: true },
  mimeType: { type: String, default: 'application/octet-stream' },
  storageType: { type: String, enum: ['mongo', 's3'], required: true },
  storageKey: { type: String, default: null },
  content: { type: Buffer, default: undefined },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
});

fileVersionSchema.index({ fileId: 1, version: -1 }, { unique: true });

export default mongoose.model('FileVersion', fileVersionSchema);
