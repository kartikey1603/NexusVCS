import mongoose from 'mongoose';
import { config } from './config.js';

export async function connectDb() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  console.log('MongoDB connected');
}
