import mongoose from 'mongoose';

const collaboratorSchema = new mongoose.Schema({
  repositoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
});

// A user can only be added as a collaborator once per repository.
collaboratorSchema.index({ repositoryId: 1, userId: 1 }, { unique: true });

export default mongoose.model('Collaborator', collaboratorSchema);
