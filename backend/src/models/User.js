import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true, minlength: 3, maxlength: 30 },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('User', userSchema);
