// Popup — unified post list with per-post status, select-all, background processing.

// ── Icons ──────────────────────────────────────────────────────────────────

function iconVideo(s = 'width:13px;height:13px;flex-shrink:0') {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="${s}"><rect x="1" y="4.5" width="9" height="7" rx="1.5"/><path d="M10 6.8l4-2v6.4l-4-2"/></svg>`;
}

function iconX(s = 'width:10px;height:10px;flex-shrink:0') {
  return `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" style="${s}"><path d="M2 2l8 8M10 2l-8 8"/></svg>`;
}

// ── DOM refs ───────────────────────────────────────────────────────────────

const el = {
  settingsBtn:    document.getElementById('settings-btn'),
  postsList:      document.getElementById('posts-list'),
  selectAll:      document.getElementById('select-all'),
  selectAllLabel: document.getElementById('select-all-label'),
  postsCount:     document.getElementById('posts-count'),
  processBtn:     document.getElementById('process-btn'),
  downloadBtn:    document.getElementById('download-btn'),
  clearBtn:       document.getElementById('clear-btn'),
  bulkImportBtn:  document.getElementById('bulk-import-btn'),
  status:         document.getElementById('status'),
  previewSection: document.getElementById('preview-section'),
  markdownPreview:document.getElementById('markdown-preview'),
  copyBtn:        document.getElementById('copy-btn'),
  downloadMdBtn:  document.getElementById('download-md-btn')
};

// ── State ──────────────────────────────────────────────────────────────────

let selectedIds = new Set();
let allPosts = [];

// ── Load + Render ──────────────────────────────────────────────────────────

async function loadPosts() {
  const [queue, processed] = await Promise.all([
    Storage.getQueue(),
    Storage.getProcessed()
  ]);

  // Ensure statuses are set
  for (const p of queue)     { if (!p.status || p.status === 'done') p.status = 'queued'; }
  for (const p of processed) { p.status = 'done'; }

  // Sort: processing → queued/failed → done
  const order = { processing: 0, queued: 1, failed: 2, done: 3 };
  allPosts = [...queue, ...processed].sort((a, b) =>
    (order[a.status] ?? 4) - (order[b.status] ?? 4)
  );

  // Prune stale selections
  const currentIds = new Set(allPosts.map(p => p.id));
  selectedIds.forEach(id => { if (!currentIds.has(id)) selectedIds.delete(id); });

  renderPosts();
  updateToolbar();
  updateActionButtons();
}

function renderPosts() {
  el.postsList.innerHTML = '';
  if (allPosts.length === 0) {
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.innerHTML = '<p>Save a post on Instagram<br>and it appears here</p>';
    el.postsList.appendChild(div);
    return;
  }
  for (const post of allPosts) {
    el.postsList.appendChild(buildPostItem(post));
  }
}

function buildPostItem(post) {
  const status = post.status || 'queued';

  const div = document.createElement('div');
  div.className = 'list-item' + (selectedIds.has(post.id) ? ' selected' : '');
  div.dataset.postId = post.id;
  div.dataset.status = status;

  // Checkbox
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'checkbox';
  checkbox.checked = selectedIds.has(post.id);

  // Status dot
  const dot = document.createElement('span');
  dot.className = `status-dot s-${status}`;
  dot.title = { queued: 'Queued', processing: 'Processing…', done: 'Done', failed: 'Failed' }[status] || status;

  // Body
  const body = document.createElement('div');
  body.className = 'item-body';

  const titleRow = document.createElement('div');
  titleRow.className = 'item-title';

  if (status === 'done') {
    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = post.name || post.topic || 'Post';
    titleRow.appendChild(name);
  } else {
    if (post.instagramUrl) {
      const a = document.createElement('a');
      a.href = post.instagramUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.className = 'item-link';
      // Strip domain for brevity
      a.textContent = post.instagramUrl.replace(/^https?:\/\/(www\.)?instagram\.com/, '');
      titleRow.appendChild(a);
    }
    if (post.hasVideo) {
      const vb = document.createElement('span');
      vb.className = 'badge';
      vb.innerHTML = iconVideo();
      titleRow.appendChild(vb);
    }
  }

  const sub = document.createElement('div');
  sub.className = 'item-sub';
  if (status === 'done') {
    sub.textContent = post.summary || post.topic || '';
  } else if (status === 'processing') {
    const pct = post.progress ?? 5;
    div.style.setProperty('--item-progress', pct + '%');
    if (pct < 35)      sub.textContent = `${pct}% — preparing…`;
    else if (pct < 65) sub.textContent = `${pct}% — transcribing…`;
    else if (pct < 85) sub.textContent = `${pct}% — analyzing image…`;
    else               sub.textContent = `${pct}% — categorizing…`;
    sub.style.color = 'var(--accent)';
  } else if (status === 'failed') {
    sub.textContent = 'Failed — select to retry';
    sub.style.color = 'var(--danger)';
  } else {
    sub.textContent = formatLocalTime(post.timestamp);
  }

  body.appendChild(titleRow);
  body.appendChild(sub);

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-btn';
  removeBtn.title = 'Remove';
  removeBtn.innerHTML = iconX();
  removeBtn.dataset.removeId = post.id;
  removeBtn.dataset.removeStatus = status;

  div.appendChild(checkbox);
  div.appendChild(dot);
  div.appendChild(body);
  div.appendChild(removeBtn);
  return div;
}

// ── Toolbar + button state ─────────────────────────────────────────────────

function updateToolbar() {
  const total = allPosts.length;
  const selCount = selectedIds.size;

  el.postsCount.textContent = total > 0 ? `${total} post${total !== 1 ? 's' : ''}` : '';

  if (selCount > 0) {
    el.selectAllLabel.textContent = `${selCount} selected`;
  } else {
    el.selectAllLabel.textContent = 'Select all';
  }

  const allSelected = total > 0 && selCount === total;
  el.selectAll.checked = allSelected;
  el.selectAll.indeterminate = selCount > 0 && !allSelected;
}

function updateActionButtons() {
  const selected = allPosts.filter(p => selectedIds.has(p.id));
  const processable = selected.filter(p => p.status === 'queued' || p.status === 'failed');
  const downloadable = selected.filter(p => p.status === 'done');

  el.processBtn.disabled = processable.length === 0;
  el.processBtn.textContent = processable.length > 0 ? `Process (${processable.length})` : 'Process';

  el.downloadBtn.disabled = downloadable.length === 0;
  el.downloadBtn.textContent = downloadable.length > 0 ? `Download (${downloadable.length})` : 'Download';

  el.clearBtn.style.display = downloadable.length > 0 ? '' : 'none';
  el.clearBtn.textContent = downloadable.length > 0 ? `Clear (${downloadable.length})` : 'Clear';
}

// ── Event wiring ───────────────────────────────────────────────────────────

function setupListeners() {
  el.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
  el.processBtn.addEventListener('click', processSelected);
  el.downloadBtn.addEventListener('click', downloadSelected);
  el.clearBtn.addEventListener('click', clearSelected);
  el.bulkImportBtn?.addEventListener('click', bulkImport);
  el.copyBtn?.addEventListener('click', copyMarkdown);
  el.downloadMdBtn?.addEventListener('click', downloadMarkdown);

  // Auto-save edits so they survive popup close/reopen
  let _previewSaveTimer;
  el.markdownPreview?.addEventListener('input', () => {
    clearTimeout(_previewSaveTimer);
    _previewSaveTimer = setTimeout(() => {
      chrome.storage.local.set({ insta_last_preview: el.markdownPreview.value });
    }, 400);
  });

  // Select-all checkbox
  el.selectAll.addEventListener('change', (e) => {
    if (e.target.checked) {
      allPosts.forEach(p => selectedIds.add(p.id));
    } else {
      selectedIds.clear();
    }
    renderPosts();
    updateToolbar();
    updateActionButtons();
  });

  // List item interactions
  el.postsList.addEventListener('click', (e) => {
    // Remove button
    const rb = e.target.closest('[data-remove-id]');
    if (rb) {
      e.stopPropagation();
      removePost(rb.dataset.removeId, rb.dataset.removeStatus);
      return;
    }
    // Links open in tab — don't intercept
    if (e.target.closest('a')) return;

    // Row click → toggle selection
    const item = e.target.closest('[data-post-id]');
    if (item) {
      const id = item.dataset.postId;
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
        item.classList.remove('selected');
      } else {
        selectedIds.add(id);
        item.classList.add('selected');
      }
      const cb = item.querySelector('.checkbox');
      if (cb) cb.checked = selectedIds.has(id);
      updateToolbar();
      updateActionButtons();
    }
  });

  // Checkbox change (when directly clicking the checkbox input)
  el.postsList.addEventListener('change', (e) => {
    if (e.target.classList.contains('checkbox')) {
      const item = e.target.closest('[data-post-id]');
      if (!item) return;
      const id = item.dataset.postId;
      if (e.target.checked) {
        selectedIds.add(id);
        item.classList.add('selected');
      } else {
        selectedIds.delete(id);
        item.classList.remove('selected');
      }
      updateToolbar();
      updateActionButtons();
    }
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatLocalTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  } catch { return ''; }
}

// ── Post removal ───────────────────────────────────────────────────────────

async function removePost(postId, status) {
  if (status === 'done') {
    const processed = await Storage.getProcessed();
    await Storage.setProcessed(processed.filter(p => p.id !== postId));
  } else {
    const queue = await Storage.getQueue();
    await Storage.setQueue(queue.filter(p => p.id !== postId));
  }
  selectedIds.delete(postId);
  await loadPosts();
}

// ── Process ────────────────────────────────────────────────────────────────

async function processSelected() {
  const toProcess = allPosts.filter(
    p => selectedIds.has(p.id) && (p.status === 'queued' || p.status === 'failed')
  );
  if (toProcess.length === 0) return;

  el.processBtn.disabled = true;

  // Optimistically update UI to processing state; background updates storage as it goes
  for (const p of toProcess) p.status = 'processing';
  renderPosts();
  updateToolbar();
  updateActionButtons();
  setStatus('Processing…');

  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'processBatch',
      postIds: toProcess.map(p => p.id)
    });

    if (resp?.success) {
      setStatus(`✓ ${resp.processedCount} post${resp.processedCount !== 1 ? 's' : ''} processed`, 3000);
      if (resp.markdown) {
        showPreview(resp.markdown);
      }
      selectedIds.clear();
    } else {
      setStatus(`✗ ${resp?.error || 'Processing failed'}`, 4000);
    }
  } catch (err) {
    setStatus(`✗ ${err.message}`, 4000);
  } finally {
    el.processBtn.disabled = false;
    await loadPosts();
  }
}

// ── Download ───────────────────────────────────────────────────────────────

async function downloadSelected() {
  const toDownload = allPosts.filter(p => selectedIds.has(p.id) && p.status === 'done');
  if (toDownload.length === 0) {
    // Fallback: download all processed
    const all = await Storage.getProcessed();
    if (all.length === 0) { setStatus('No posts to download', 2000); return; }
    triggerDownload(generateMasterNote(all), 'instagram-posts.md');
    setStatus('✓ Downloaded all', 2000);
    return;
  }
  triggerDownload(generateMasterNote(toDownload), `instagram-posts-${Date.now()}.md`);
  setStatus('✓ Downloaded!', 2000);
}

// ── Clear selected done posts ──────────────────────────────────────────────

async function clearSelected() {
  const toClear = allPosts.filter(p => selectedIds.has(p.id) && p.status === 'done');
  if (toClear.length === 0) return;
  if (!confirm(`Remove ${toClear.length} processed post${toClear.length !== 1 ? 's' : ''}? Cannot be undone.`)) return;

  const clearIds = new Set(toClear.map(p => p.id));
  const processed = await Storage.getProcessed();
  const remaining = processed.filter(p => !clearIds.has(p.id));
  await Storage.setProcessed(remaining);
  clearIds.forEach(id => selectedIds.delete(id));

  // Rebuild preview from whatever processed posts remain
  if (remaining.length > 0) {
    showPreview(generateMasterNote(remaining));
  } else {
    el.previewSection.style.display = 'none';
    el.markdownPreview.value = '';
    chrome.storage.local.remove('insta_last_preview');
  }

  setStatus('✓ Cleared', 2000);
  await loadPosts();
}

// ── Bulk import ────────────────────────────────────────────────────────────

async function bulkImport() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('instagram.com')) {
    setStatus('✗ Open Instagram to use bulk import', 2500);
    return;
  }
  if (el.bulkImportBtn) el.bulkImportBtn.disabled = true;
  setStatus('Importing saved posts…');
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'startBulkImport', tabId: tab.id });
    if (resp?.success) {
      setStatus(`✓ Imported ${resp.count} posts`, 2500);
      await loadPosts();
    } else {
      setStatus(`✗ Bulk import failed: ${resp?.error}`, 3000);
    }
  } catch (err) {
    setStatus(`✗ ${err.message}`, 3000);
  } finally {
    if (el.bulkImportBtn) el.bulkImportBtn.disabled = false;
  }
}

// ── Preview persistence ────────────────────────────────────────────────────

function showPreview(md) {
  el.markdownPreview.value = md;
  el.previewSection.style.display = 'block';
  chrome.storage.local.set({ insta_last_preview: md });
}

async function restorePreview() {
  const data = await chrome.storage.local.get('insta_last_preview');
  if (data.insta_last_preview) {
    el.markdownPreview.value = data.insta_last_preview;
    el.previewSection.style.display = 'block';
  }
}

// ── Copy / Download single preview ────────────────────────────────────────

function copyMarkdown() {
  navigator.clipboard.writeText(el.markdownPreview.value)
    .then(() => setStatus('✓ Copied!', 2000));
}

function downloadMarkdown() {
  triggerDownload(el.markdownPreview.value, 'instagram-posts.md');
  setStatus('✓ Downloaded!', 2000);
}

// ── Download helper ────────────────────────────────────────────────────────

function triggerDownload(text, filename) {
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Markdown generation ────────────────────────────────────────────────────

function generateMasterNote(posts) {
  if (posts.length === 0) return '# No posts processed yet.';

  const byTopic = {};
  for (const post of posts) {
    const topic = post.topic || 'Uncategorized';
    if (!byTopic[topic]) byTopic[topic] = [];
    byTopic[topic].push(post);
  }

  const lines = ['# Instagram Saved Posts', '', `Generated: ${new Date().toISOString()}`, ''];
  lines.push('## Topics');
  for (const [topic, tPosts] of Object.entries(byTopic)) {
    lines.push(`- [[#${topic}]] (${tPosts.length})`);
  }
  lines.push('', '---', '');

  for (const [topic, tPosts] of Object.entries(byTopic)) {
    lines.push(`## ${topic}`, '');
    for (const post of tPosts) {
      const name = post.name || post.topic || 'Post';
      const summary = (post.summary || '').replace(/\n/g, ' ');
      const tags = (post.tags || []).map(t => '#' + t.replace(/\s+/g, '-')).join(' ');
      const date = post.timestamp
        ? new Date(post.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
      const author = post.author || '';
      const url = post.instagramUrl || '';

      lines.push(`### ${name}`);
      if (summary) lines.push(`> ${summary}`);
      if (tags) lines.push(`> ${tags}`);
      const meta = [date, author, url ? `[View post →](${url})` : ''].filter(Boolean).join(' · ');
      if (meta) lines.push(`> ${meta}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ── Status helper ──────────────────────────────────────────────────────────

let statusTimer;
function setStatus(text, clearAfterMs) {
  el.status.textContent = text;
  clearTimeout(statusTimer);
  if (clearAfterMs) statusTimer = setTimeout(() => { el.status.textContent = ''; }, clearAfterMs);
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  await loadPosts();
  await restorePreview();
  setupListeners();
}

// Poll every 3s to pick up background processing updates
setInterval(loadPosts, 3000);

init();
