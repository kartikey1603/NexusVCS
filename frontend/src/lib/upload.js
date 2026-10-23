import { get, post } from './api.js';
import { sha256File, fileToBase64 } from './hash.js';
import { getLimits } from './limits.js';

const CODE_TEXT_EXTENSION_RE = /\.(md|txt|js|jsx|ts|tsx|css|html|json|xml|yml|yaml|py|java|c|cpp|h|hpp|sql|sh)$/i;
function isCodeOrTextFile(name, mimeType) {
  if (mimeType?.startsWith('text/')) return true;
  return CODE_TEXT_EXTENSION_RE.test(String(name || ''));
}

// Uploads one PUT request with progress reporting (fetch cannot report upload progress; XHR
// can). Resolves with the response's ETag header, needed to complete the multipart upload.
function putWithProgress(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag');
        if (!etag) {
          reject(new Error('Upload succeeded but no ETag was returned. The S3 bucket CORS policy must expose the ETag header for multipart uploads to complete.'));
          return;
        }
        resolve(etag);
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error while uploading.'));
    xhr.onabort = () => reject(new Error('Upload aborted.'));
    xhr.send(blob);
  });
}

async function uploadPartWithRetry(repositoryId, key, uploadId, partNumber, blob, onProgress, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { url } = await post('/api/s3/part-url', { repositoryId, key, uploadId, partNumber });
      const etag = await putWithProgress(url, blob, onProgress);
      return { partNumber, etag };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Uploads `file` to `path` in repository `repositoryId`, staging the result as a pending
 * add/modify (never committing directly). Returns the created StagedChange.
 * onProgress receives a fraction 0..1; onStatus receives short human-readable phase strings.
 */
export async function uploadFileToRepo({ repositoryId, file, path, onProgress, onStatus }) {
  const limits = await getLimits();
  if (file.size > limits.maxFileSizeBytes) {
    throw new Error(`Files may not exceed ${Math.round(limits.maxFileSizeBytes / (1024 * 1024 * 1024))} GB.`);
  }
  if (isCodeOrTextFile(file.name, file.type) && file.size > limits.maxCodeFileSizeBytes) {
    throw new Error(`Code/text files may not exceed ${Math.round(limits.maxCodeFileSizeBytes / (1024 * 1024))} MB.`);
  }

  if (file.size <= limits.largeFileThresholdBytes) {
    onStatus?.('Reading file…');
    const contentBase64 = await fileToBase64(file);
    onProgress?.(0.5);
    onStatus?.('Staging change…');
    const { change } = await post(`/api/repositories/${repositoryId}/changes`, {
      path, name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream', contentBase64,
    });
    onProgress?.(1);
    return change;
  }

  onStatus?.('Hashing file…');
  const sha256 = await sha256File(file);
  onProgress?.(0.02);

  onStatus?.('Preparing upload…');
  const initiate = await post('/api/s3/presigned-upload', {
    repositoryId, fileName: file.name, fileSize: file.size, contentType: file.type || 'application/octet-stream', sha256, path,
  });

  if (!initiate.uploadRequired) {
    // Identical content already exists in S3 -- nothing to upload, just register the change.
    onProgress?.(1);
    onStatus?.('Staging change…');
    const { change } = await post(`/api/repositories/${repositoryId}/changes`, {
      path: initiate.path, name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream',
      sha256, storageType: 's3', storageKey: initiate.key,
    });
    return change;
  }

  const { uploadId, key, partSize, totalParts } = initiate;
  const parts = [];
  try {
    for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
      const start = (partNumber - 1) * partSize;
      const end = Math.min(start + partSize, file.size);
      const blob = file.slice(start, end);
      onStatus?.(`Uploading part ${partNumber} of ${totalParts}…`);
      const partResult = await uploadPartWithRetry(repositoryId, key, uploadId, partNumber, blob, (fraction) => {
        const overall = (partNumber - 1 + fraction) / totalParts;
        onProgress?.(0.02 + overall * 0.9);
      });
      parts.push(partResult);
    }
  } catch (error) {
    onStatus?.('Upload failed, cleaning up…');
    await post('/api/s3/abort-upload', { repositoryId, key, uploadId }).catch(() => {});
    throw error;
  }

  onStatus?.('Finishing upload…');
  await post('/api/s3/complete-upload', { repositoryId, key, uploadId, parts });
  onProgress?.(0.95);

  onStatus?.('Staging change…');
  const { change } = await post(`/api/repositories/${repositoryId}/changes`, {
    path: initiate.path, name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream',
    sha256, storageType: 's3', storageKey: key,
  });
  onProgress?.(1);
  return change;
}

export async function fetchStagedChanges(repositoryId) {
  const { changes } = await get(`/api/repositories/${repositoryId}/changes`);
  return changes;
}
