import { upload } from '@vercel/blob/client';
import type { Attachment } from './types';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function formatBytes(size: number | null | undefined): string {
  if (size == null) return '—';
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 100 ? 1 : 0)} MB`;
}

/** Same checks as the original: empty files and anything over 10 MB are refused. */
export function fileProblem(file: File): string | null {
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > MAX_FILE_BYTES) return `"${file.name}" is too big (${formatBytes(file.size)}). The limit is 10 MB per file.`;
  return null;
}

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** task-files/YYYY-MM/<uuid><.ext> */
function attachmentPath(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot, dot + 12).toLowerCase().replace(/[^.a-z0-9]/g, '') : '';
  return `task-files/${new Date().toISOString().slice(0, 7)}/${randomId()}${ext.length > 1 ? ext : ''}`;
}

/** Uploads straight from the browser to the private Vercel Blob store. */
export async function uploadAttachment(file: File): Promise<Attachment> {
  const problem = fileProblem(file);
  if (problem) throw new Error(problem);
  try {
    const blob = await upload(attachmentPath(file.name), file, {
      access: 'private',
      handleUploadUrl: '/api/files/upload',
      contentType: file.type || 'application/octet-stream',
      multipart: file.size > 4 * 1024 * 1024,
    });
    return { path: blob.pathname, name: file.name.slice(0, 180), type: file.type || null, size: file.size };
  } catch (error) {
    throw new Error(`Could not upload "${file.name}". ${error instanceof Error ? error.message : ''}`.trim());
  }
}

/** Private files are streamed through the API. */
export function openAttachment(entryId: string): void {
  window.open(`/api/files?entry=${encodeURIComponent(entryId)}`, '_blank', 'noopener,noreferrer');
}
