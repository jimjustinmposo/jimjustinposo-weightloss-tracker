import { esc, qs } from './util.js';
import { imageTokens, validPhoto, MAX_PHOTO_BYTES, validateNoteBody, unpackNote, packNote } from './note-content.js';

export function renderNoteBody(value) {
  const body = String(value ?? '');
  let html = '', end = 0;
  for (const match of body.matchAll(imageTokens())) {
    html += esc(body.slice(end, match.index));
    html += validPhoto(match[2])
      ? `<img class="note-photo" src="${esc(match[2])}" alt="${esc(match[1] || 'Note photo')}" loading="lazy" />`
      : esc(match[0]);
    end = match.index + match[0].length;
  }
  return html + esc(body.slice(end));
}

export function autoGrowNote(input) {
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight + 3}px`;
}

export async function compressNotePhoto(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a photo smaller than 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Could not read this photo.'));
      image.src = url;
    });
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 40000000) throw new Error('Photo dimensions are too large.');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Photo processing is not available in this browser.');
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale * (0.8 ** attempt)));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale * (0.8 ** attempt)));
      // JPEG output: flatten transparent areas onto white, not black.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.72);
      if (data.length <= Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 23 && validPhoto(data)) return data;
    }
    throw new Error('Could not compress this photo enough. Try a smaller image.');
  } finally { URL.revokeObjectURL(url); }
}

export function wireNoteEditor(overlay) {
  const input = qs('#ne-body', overlay);
  const preview = qs('#ne-preview', overlay);
  const status = qs('#ne-status', overlay);
  const add = qs('#ne-photo-add', overlay);
  const picker = qs('#ne-photo-file', overlay);
  let photos = new Map(), busy = false;
  const refresh = () => {
    autoGrowNote(input);
    preview.innerHTML = renderNoteBody(packNote(input.value, photos));
    preview.hidden = photos.size === 0;
  };
  const load = (body) => {
    const draft = unpackNote(body);
    input.value = draft.text;
    photos = draft.photos;
    refresh();
  };
  const insertPhotos = async (files) => {
    if (busy || input.disabled || !files.length) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const original = input.value;
    busy = true;
    input.readOnly = true;
    add.disabled = true;
    status.textContent = 'Preparing photo…';
    try {
      if (files.length > 4) throw new Error('Use at most 4 photos per note.');
      const nextPhotos = new Map(photos);
      const markers = [];
      for (const file of files) {
        const url = await compressNotePhoto(file);
        const key = `![Photo](note-photo:${crypto.randomUUID()})`;
        nextPhotos.set(key, `![Photo](${url})`);
        markers.push(key);
      }
      const insertion = '\n' + markers.join('\n') + '\n';
      const nextText = original.slice(0, start) + insertion + original.slice(end);
      validateNoteBody(packNote(nextText, nextPhotos));
      input.value = nextText;
      photos = nextPhotos;
      input.setSelectionRange(start + insertion.length, start + insertion.length);
      refresh();
      status.textContent = 'Photo added. Remove its marker to delete it; save to keep your changes.';
    } catch (err) { status.textContent = err.message; }
    finally {
      busy = false;
      input.readOnly = false;
      add.disabled = false;
      input.focus();
    }
  };
  input.addEventListener('input', refresh);
  input.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.items || [])]
      .filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    return insertPhotos(files);
  });
  add.addEventListener('click', () => picker.click());
  picker.addEventListener('change', async () => {
    await insertPhotos([...picker.files]);
    picker.value = '';
  });
  return {
    load,
    getBody() {
      if (busy) throw new Error('Wait for the photo to finish processing.');
      return validateNoteBody(packNote(input.value, photos));
    },
  };
}
