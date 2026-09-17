// Shared by the browser, offline queue and Notes API. Images remain in body TEXT.
export const MAX_NOTE_BYTES = 900000;
export const MAX_NOTE_TEXT = 20000;
export const MAX_NOTE_PHOTOS = 4;
export const MAX_PHOTO_BYTES = 150000;
export const imageTokens = () => /!\[([^\]\n]*)\]\((data:[^\s)]*)\)/g;

export function validPhoto(url) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!match || match[2].length % 4 || match[2].length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4) return false;
  try {
    const bytes = atob(match[2]);
    if (bytes.length > MAX_PHOTO_BYTES) return false;
    if (match[1] === 'jpeg') return bytes.startsWith('\xff\xd8\xff');
    if (match[1] === 'png') return bytes.startsWith('\x89PNG\r\n\x1a\n');
    return bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  } catch { return false; }
}

export function validateNoteBody(value) {
  const body = String(value ?? '');
  if (new TextEncoder().encode(body).length > MAX_NOTE_BYTES) throw new Error('Note is too large (900 KB maximum including photos).');
  const images = [...body.matchAll(imageTokens())];
  if (images.length > MAX_NOTE_PHOTOS) throw new Error('Use at most 4 photos per note.');
  if (images.some((m) => !validPhoto(m[2]))) throw new Error('Photos must be valid JPEG, PNG or WebP data, at most 150 KB each.');
  if (body.replace(imageTokens(), '').length > MAX_NOTE_TEXT) throw new Error('Note text must be at most 20,000 characters.');
  return body;
}

export function notePlainText(value) {
  return String(value ?? '').replace(imageTokens(), (_, alt) => `[Photo: ${alt || 'photo'}]`);
}

// Keep encoded data out of the editable text, without changing the saved format.
export function unpackNote(value) {
  const photos = new Map();
  let index = 0;
  const text = String(value ?? '').replace(imageTokens(), (token, alt, url) => {
    if (!validPhoto(url)) return token;
    const key = `![${alt || 'Photo'}](note-photo:${++index})`;
    photos.set(key, token);
    return key;
  });
  return { text, photos };
}

export function packNote(text, photos) {
  return String(text).replace(/!\[[^\]\n]*\]\(note-photo:[^)]+\)/g, (key) => photos.get(key) || key);
}
