// attachment.js
// Handles file reading, encoding, and building Anthropic message content blocks.

// ── State ─────────────────────────────────────────────────────
let _attachment = null; // { name, type, mediaType, content, displaySize, isBase64 }

export function getAttachment() { return _attachment; }
export function clearAttachment() {
  _attachment = null;
  renderPreview(null);
}

// ── File ingestion ────────────────────────────────────────────
export async function ingestFile(file) {
  const name = file.name;
  const ext  = name.split('.').pop().toLowerCase();
  const size = formatSize(file.size);

  // Hard limit — keep context windows sane
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('File too large (max 10 MB). Trim it down first.');
  }

  if (ext === 'pdf') {
    const base64 = await toBase64(file);
    _attachment = {
      name, ext, displaySize: size,
      mediaType: 'application/pdf',
      content: base64,
      isBase64: true,
      kind: 'document',
      summary: `PDF document (${size})`,
    };

  } else if (['png','jpg','jpeg','webp','gif'].includes(ext)) {
    const base64 = await toBase64(file);
    const mediaType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    _attachment = {
      name, ext, displaySize: size,
      mediaType,
      content: base64,
      isBase64: true,
      kind: 'image',
      summary: `Image file (${size})`,
    };

  } else {
    // Text-based: JSON, CSV, TXT, MD
    const text = await file.text();
    // Truncate very large text files
    const truncated = text.length > 80000;
    _attachment = {
      name, ext, displaySize: size,
      content: truncated ? text.slice(0, 80000) + '\n\n[truncated]' : text,
      isBase64: false,
      kind: 'text',
      summary: `${ext.toUpperCase()} file (${size}${truncated ? ', truncated to 80k chars' : ''})`,
    };
  }

  renderPreview(_attachment);
  return _attachment;
}

// ── Build API message content ─────────────────────────────────
// Returns the `content` array for the user message in /v1/messages.
// Injects the attachment alongside the text prompt.
export function buildUserContent(textPrompt, attachment) {
  if (!attachment) {
    return textPrompt; // plain string — backwards compatible
  }

  const blocks = [];

  if (attachment.kind === 'document') {
    blocks.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: attachment.mediaType,
        data: attachment.content,
      },
    });
  } else if (attachment.kind === 'image') {
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: attachment.mediaType,
        data: attachment.content,
      },
    });
  } else {
    // Text file — inline as a text block with a label
    blocks.push({
      type: 'text',
      text: `<attachment name="${attachment.name}">\n${attachment.content}\n</attachment>`,
    });
  }

  // The user's prompt text goes after the attachment
  blocks.push({ type: 'text', text: textPrompt });

  return blocks;
}

// ── UI ────────────────────────────────────────────────────────
function renderPreview(att) {
  const el = document.getElementById('attach-preview');
  const area = document.getElementById('attach-area');
  if (!el) return;

  if (!att) {
    el.style.display = 'none';
    el.innerHTML = '';
    if (area) area.classList.remove('has-file');
    return;
  }

  const icon = att.kind === 'image' ? '🖼' : att.kind === 'document' ? '📄' : '📎';
  el.style.display = 'flex';
  el.innerHTML = `
    <div class="attach-file-info">
      <span class="attach-file-icon">${icon}</span>
      <div class="attach-file-details">
        <div class="attach-file-name">${att.name}</div>
        <div class="attach-file-meta">${att.summary}</div>
      </div>
      <button class="attach-remove" onclick="window.removeAttachment()" title="Remove">✕</button>
    </div>
  `;
  if (area) area.classList.add('has-file');
}

// ── Helpers ───────────────────────────────────────────────────
function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]); // strip data:...;base64,
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes) {
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
