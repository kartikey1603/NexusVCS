import mongoose from 'mongoose';

const repositorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  visibility: { type: String, enum: ['public', 'private'], default: 'public', index: true },
  defaultBranch: { type: String, default: 'main' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

repositorySchema.index({ ownerId: 1, slug: 1 }, { unique: true });
repositorySchema.pre('save', function(next) { this.updatedAt = new Date(); next(); });

export default mongoose.model('Repository', repositorySchema);
