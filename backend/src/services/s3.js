import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
  DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

const enabled = Boolean(config.awsRegion && config.awsBucket);
const client = enabled ? new S3Client({
  region: config.awsRegion,
  ...(config.awsAccessKeyId && config.awsSecretAccessKey
    ? { credentials: { accessKeyId: config.awsAccessKeyId, secretAccessKey: config.awsSecretAccessKey } }
    : {}),
}) : null;

export function isS3Enabled() { return enabled; }

export async function createUploadUrl(key, contentType) {
  if (!client) throw new Error('S3 is not configured');
  const command = new PutObjectCommand({ Bucket: config.awsBucket, Key: key, ContentType: contentType });
  return getSignedUrl(client, command, { expiresIn: config.presignedExpiresSeconds });
}

export async function createDownloadUrl(key) {
  if (!client) throw new Error('S3 is not configured');
  const command = new GetObjectCommand({ Bucket: config.awsBucket, Key: key });
  return getSignedUrl(client, command, { expiresIn: config.presignedExpiresSeconds });
}

export async function objectExists(key) {
  if (!client) return false;
  try {
    await client.send(new HeadObjectCommand({ Bucket: config.awsBucket, Key: key }));
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return false;
    throw error;
  }
}

// --- Multipart upload (large files) -------------------------------------------------------
// Direct browser-to-S3, chunked, so an 8GB upload never passes through Express memory and a
// failed part can be retried in isolation instead of restarting the whole transfer.

export async function createMultipartUpload(key, contentType) {
  if (!client) throw new Error('S3 is not configured');
  const command = new CreateMultipartUploadCommand({ Bucket: config.awsBucket, Key: key, ContentType: contentType });
  const result = await client.send(command);
  return result.UploadId;
}

export async function getUploadPartUrl(key, uploadId, partNumber) {
  if (!client) throw new Error('S3 is not configured');
  const command = new UploadPartCommand({ Bucket: config.awsBucket, Key: key, UploadId: uploadId, PartNumber: partNumber });
  return getSignedUrl(client, command, { expiresIn: config.presignedExpiresSeconds });
}

export async function completeMultipartUpload(key, uploadId, parts) {
  if (!client) throw new Error('S3 is not configured');
  const command = new CompleteMultipartUploadCommand({
    Bucket: config.awsBucket,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts.map((p) => ({ ETag: p.etag, PartNumber: p.partNumber })) },
  });
  return client.send(command);
}

export async function abortMultipartUpload(key, uploadId) {
  if (!client) throw new Error('S3 is not configured');
  const command = new AbortMultipartUploadCommand({ Bucket: config.awsBucket, Key: key, UploadId: uploadId });
  return client.send(command);
}

// --- Deletion -------------------------------------------------------------------------------
// Object keys are always namespaced as `repositories/{repositoryId}/objects/{sha256}`, so a
// prefix delete for one repository can never reach another repository's (or an unrelated
// upload's) objects.

export async function deleteObject(key) {
  if (!client) return;
  try {
    await client.send(new DeleteObjectCommand({ Bucket: config.awsBucket, Key: key }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return;
    throw error;
  }
}

export async function deleteObjectsWithPrefix(prefix) {
  if (!client) return;
  let continuationToken;
  do {
    const listing = await client.send(new ListObjectsV2Command({ Bucket: config.awsBucket, Prefix: prefix, ContinuationToken: continuationToken }));
    const keys = (listing.Contents || []).map((o) => ({ Key: o.Key }));
    if (keys.length) {
      await client.send(new DeleteObjectsCommand({ Bucket: config.awsBucket, Delete: { Objects: keys, Quiet: true } }));
    }
    continuationToken = listing.IsTruncated ? listing.NextContinuationToken : undefined;
  } while (continuationToken);
}
