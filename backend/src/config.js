import 'dotenv/config';

const numberEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: numberEnv('PORT', 5000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/nexusvcs',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  // Centralized file-size configuration (bytes derived from *_MB env vars).
  // - LARGE_FILE_THRESHOLD_MB: files at or below this use the normal (small) upload path;
  //   anything above must go through the S3 multipart flow.
  // - MAX_FILE_SIZE_MB: hard ceiling for any file, of any type.
  // - MAX_CODE_FILE_SIZE_MB: a tighter ceiling that applies specifically to code/text files,
  //   even though other (binary/asset) files are allowed up to MAX_FILE_SIZE_MB.
  largeFileThresholdBytes: numberEnv('LARGE_FILE_THRESHOLD_MB', 50) * 1024 * 1024,
  maxFileSizeBytes: numberEnv('MAX_FILE_SIZE_MB', 8192) * 1024 * 1024,
  maxCodeFileSizeBytes: numberEnv('MAX_CODE_FILE_SIZE_MB', 500) * 1024 * 1024,
  lockDurationMs: numberEnv('LOCK_DURATION_MINUTES', 60) * 60 * 1000,
  presignedExpiresSeconds: Math.min(numberEnv('S3_PRESIGNED_EXPIRES_SECONDS', 600), 604800),
  // Size of each S3 multipart upload part. S3 requires every part except the last to be at
  // least 5MB; 64MB keeps part counts (and therefore presign/round-trip overhead) reasonable
  // even for an 8GB upload (~128 parts) while staying well clear of that floor.
  multipartPartSizeBytes: numberEnv('MULTIPART_PART_SIZE_MB', 64) * 1024 * 1024,
  awsRegion: process.env.AWS_REGION,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  awsBucket: process.env.AWS_S3_BUCKET,
};
