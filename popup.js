// Popup — Queue / Processed tabs, selection, transcribe, process, download.

// ── Icons ──────────────────────────────────────────────────────────────────

function iconMic(extraStyle = '') {
  return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="${extraStyle}">
    <path d="M7 8C7 5.23858 9.23858 3 12 3C14.7614 3 17 5.23858 17 8V11C17 13.7614 14.7614 16 12 16C9.23858 16 7 13.7614 7 11V8Z" stroke="currentColor" stroke-width="1.5"></path>
    <path d="M13.5 8L17 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
    <path d="M13.5 11L17 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
    <path d="M7 8L9 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
    <path d="M7 11L9 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
    <path d="M12 19V22" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
    <path d="M20.75 10C20.75 9.58579 20.4142 9.25 20 9.25C19.5858 9.25 19.25 9.58579 19.25 10H20.75ZM4.75 10C4.75 9.58579 4.41421 9.25 4 9.25C3.58579 9.25 3.25 9.58579 3.25 10H4.75ZM15.5121 17.3442C15.1499 17.5452 15.0192 18.0017 15.2202 18.3639C15.4212 18.7261 15.8777 18.8568 16.2399 18.6558L15.5121 17.3442ZM19.25 10V11H20.75V10H19.25ZM4.75 11V10H3.25V11H4.75ZM12 18.25C7.99594 18.25 4.75 15.0041 4.75 11H3.25C3.25 15.8325 7.16751 19.75 12 19.75V18.25ZM19.25 11C19.25 13.7287 17.7429 16.1063 15.5121 17.3442L16.2399 18.6558C18.928 17.1642 20.75 14.2954 20.75 11H19.25Z" fill="currentColor"></path>
  </svg>`;
}

// ── DOM refs ───────────────────────────────────────────────────────────────

const el = {
  settingsBtn:      document.getElementById('settings-btn'),
  queueCount:       document.getElementById('queue-count'),
  processedCount:   document.getElementById('processed-count'),
  queueList:        document.getElementById('queue-list'),
  processedList:    document.getElementById('processed-list'),
  processBtn:       document.getElementById('process-btn'),
  transcribeBtn:    document.getElementById('transcribe-btn'),
  bulkImportBtn:    document.getElementById('bulk-import-btn'),
  downloadAllBtn:   document.getElementById('download-all-btn'),
  clearBtn:         document.getElementById('clear-btn'),
  status:           document.getElementById('status'),
  previewSection:   document.getElementById('preview-section'),
  markdownPreview:  document.getElementById('markdown-preview'),
  copyBtn:          document.getElementById('copy-btn'),
  downloadBtn:      document.getElementById('download-btn'),
  tabSlider:        document.getElementById('tab-slider'),
  transcribeIcon:   document.getElementById('transcribe-icon'),
  transcribeLabel:  document.getElementById('transcribe-label')
};

el.transcribeIcon.innerHTML = iconMic('width:13px;height:13px;');

// ── State ──────────────────────────────────────────────────────────────────

let selectedQueueIds = new Set();
let selectedProcessedIds = new Set();

// ── Tabs ───────────────────────────────────────────────────────────────────

const tabBtns = document.querySelectorAll('.tab-btn');
tabBtns.forEach((btn, idx) => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    el.tabSlider.style.transform = `translateX(${idx * 100}%)`;
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function formatLocalTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  } catch { return ''; }
}

// Safe DOM text — avoids XSS from AI-sourced or user-supplied strings.
function setText(el, text) { el.textContent = text; }
function setAttr(el, attr, val) { el.setAttribute(attr, val); }

// ── Render queue ───────────────────────────────────────────────────────────

async function loadQueue() {
  const queue = await Storage.getQueue();
  setText(el.queueCount, queue.length);

  const currentIds = new Set(queue.map(p => p.id));
  selectedQueueIds.forEach(id => { if (!currentIds.has(id)) selectedQueueIds.delete(id); });

  el.queueList.innerHTML = '';

  if (queue.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No posts queued.';
    el.queueList.appendChild(p);
  } else {
    for (const post of queue) {
      el.queueList.appendChild(buildQueueItem(post));
    }
  }
  updateQueueButtons();
}

function buildQueueItem(post) {
  const div = document.createElement('div');
  div.className = 'list-item';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'checkbox';
  checkbox.dataset.selectId = post.id;
  checkbox.checked = selectedQueueIds.has(post.id);

  const body = document.createElement('div');
  body.className = 'item-body';

  const titleRow = document.createElement('div');
  titleRow.className = 'item-title';

  if (post.instagramUrl) {
    const a = document.createElement('a');
    a.href = post.instagramUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'item-link';
    a.textContent = post.instagramUrl;
    titleRow.appendChild(a);
  }

  if (post.hasVideo) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    if (post.transcribed) {
      badge.style.color = 'var(--accent)';
      badge.title = 'Transcribed';
      badge.innerHTML = iconMic() + '✓';
    } else {
      badge.style.color = '#8e8e93';
      badge.title = 'Video — not yet transcribed';
      badge.textContent = '🎬';
    }
    titleRow.appendChild(badge);
  }

  const sub = document.createElement('div');
  sub.className = 'item-sub';
  sub.textContent = formatLocalTime(post.timestamp);

  body.appendChild(titleRow);
  body.appendChild(sub);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-btn';
  removeBtn.title = 'Remove';
  removeBtn.textContent = '✕';
  removeBtn.dataset.removeQueueId = post.id;

  div.appendChild(checkbox);
  div.appendChild(body);
  div.appendChild(removeBtn);
  return div;
}

// ── Render processed ───────────────────────────────────────────────────────

async function loadProcessed() {
  const processed = await Storage.getProcessed();
  setText(el.processedCount, processed.length);

  const currentIds = new Set(processed.map(p => p.id));
  selectedProcessedIds.forEach(id => { if (!currentIds.has(id)) selectedProcessedIds.delete(id); });

  el.processedList.innerHTML = '';

  if (processed.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No posts processed yet.';
    el.processedList.appendChild(p);
  } else {
    for (const post of processed) {
      el.processedList.appendChild(buildProcessedItem(post));
    }
  }
  updateProcessedButtons();
}

function buildProcessedItem(post) {
  const div = document.createElement('div');
  div.className = 'list-item';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'checkbox';
  checkbox.dataset.selectProcessedId = post.id;
  checkbox.checked = selectedProcessedIds.has(post.id);

  const body = document.createElement('div');
  body.className = 'item-body';
  body.dataset.viewId = post.id;
  body.style.cursor = 'pointer';

  const titleRow = document.createElement('div');
  titleRow.className = 'item-title';
  titleRow.textContent = post.name || post.topic || 'Post';

  const badge = document.createElement('span');
  badge.className = 'badge';
  if (post.transcribed && post.transcript) {
    badge.innerHTML = iconMic('color:var(--accent)') + '✨';
    badge.title = 'Whisper transcript used';
  } else if (post.audioNotes) {
    badge.innerHTML = iconMic('color:var(--accent)');
    badge.title = 'Manual audio notes used';
  } else {
    badge.textContent = '📝';
    badge.title = 'Caption only';
  }
  titleRow.appendChild(badge);

  const sub = document.createElement('div');
  sub.className = 'item-sub';
  sub.textContent = post.summary || 'No summary';

  body.appendChild(titleRow);
  body.appendChild(sub);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-btn';
  removeBtn.title = 'Remove';
  removeBtn.textContent = '✕';
  removeBtn.dataset.removeProcessedId = post.id;

  div.appendChild(checkbox);
  div.appendChild(body);
  div.appendChild(removeBtn);
  return div;
}

// ── Button state ───────────────────────────────────────────────────────────

function updateQueueButtons() {
  const n = selectedQueueIds.size;
  el.processBtn.textContent = n > 0 ? `Process Selected (${n})` : 'Process Selected';
  el.processBtn.disabled = n === 0;
  setText(el.transcribeLabel, n > 0 ? `Transcribe (${n})` : 'Transcribe');
  el.transcribeBtn.disabled = n === 0;
}

function updateProcessedButtons() {
  const n = selectedProcessedIds.size;
  el.downloadAllBtn.textContent = n > 0 ? `Download Selected (${n})` : 'Download All';
  el.clearBtn.textContent = n > 0 ? `Delete Selected (${n})` : 'Clear All';
  Storage.getProcessed().then(p => {
    el.downloadAllBtn.disabled = p.length === 0;
    el.clearBtn.disabled = p.length === 0;
  });
}

// ── Event wiring ───────────────────────────────────────────────────────────

function setupListeners() {
  el.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
  el.processBtn.addEventListener('click', processSelected);
  el.transcribeBtn.addEventListener('click', transcribeSelected);
  el.bulkImportBtn?.addEventListener('click', bulkImport);
  el.downloadAllBtn.addEventListener('click', downloadAllMarkdown);
  el.clearBtn.addEventListener('click', clearStorage);
  el.copyBtn.addEventListener('click', copyMarkdown);
  el.downloadBtn.addEventListener('click', downloadMarkdown);

  el.queueList.addEventListener('click', (e) => {
    const cb = e.target.closest('[data-select-id]');
    if (cb) {
      if (cb.checked) selectedQueueIds.add(cb.dataset.selectId);
      else selectedQueueIds.delete(cb.dataset.selectId);
      updateQueueButtons();
      return;
    }
    const rb = e.target.closest('[data-remove-queue-id]');
    if (rb) removeQueueItem(rb.dataset.removeQueueId);
  });

  el.processedList.addEventListener('click', (e) => {
    const cb = e.target.closest('[data-select-processed-id]');
    if (cb) {
      if (cb.checked) selectedProcessedIds.add(cb.dataset.selectProcessedId);
      else selectedProcessedIds.delete(cb.dataset.selectProcessedId);
      updateProcessedButtons();
      return;
    }
    const rb = e.target.closest('[data-remove-processed-id]');
    if (rb) { removeProcessedItem(rb.dataset.removeProcessedId); return; }
    const body = e.target.closest('[data-view-id]');
    if (body) viewPost(body.dataset.viewId);
  });
}

// ── Queue actions ──────────────────────────────────────────────────────────

async function removeQueueItem(postId) {
  const queue = await Storage.getQueue();
  await Storage.setQueue(queue.filter(p => p.id !== postId));
  selectedQueueIds.delete(postId);
  await loadQueue();
}

async function viewPost(postId) {
  const processed = await Storage.getProcessed();
  const post = processed.find(p => p.id === postId);
  if (!post) return;

  const name = post.name || post.topic || 'Post';
  const summary = post.summary || '';
  const tags = (post.tags || []).map(t => '#' + t).join(' ');
  const url = post.instagramUrl || '';
  const md = [`# ${name}`, '', summary, tags, '', url ? `[View on Instagram](${url})` : ''].filter(l => l !== undefined).join('\n');
  el.markdownPreview.value = md;
  el.previewSection.style.display = 'block';
}

// ── Transcription ──────────────────────────────────────────────────────────

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 8000);
  });
}

async function transcribePosts(targets, labelPrefix = '🎙️ Transcribing') {
  if (targets.length === 0) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('instagram.com')) {
    setStatus('✗ Open Instagram tab to transcribe (falling back to caption on process)');
    return;
  }

  const originalUrl = tab.url;

  for (let i = 0; i < targets.length; i++) {
    const post = targets[i];
    setStatus(`${labelPrefix} ${i + 1}/${targets.length}…`);
    try {
      if (tab.url !== post.instagramUrl) {
        await chrome.tabs.update(tab.id, { url: post.instagramUrl });
        await waitForTabLoad(tab.id);
        await new Promise(r => setTimeout(r, 1200));
      }
      const resp = await chrome.runtime.sendMessage({
        action: 'transcribeAudio',
        postId: post.id,
        tabId: tab.id
      });
      if (!resp?.success) {
        console.log(`[Instagram MD] Transcribe skipped for ${post.id}: ${resp?.error}`);
      }
    } catch (err) {
      console.log(`[Instagram MD] Transcribe error for ${post.id}:`, err.message);
    }
  }

  if (tab.url !== originalUrl) {
    await chrome.tabs.update(tab.id, { url: originalUrl }).catch(() => {});
  }
}

async function transcribeSelected() {
  const queue = await Storage.getQueue();
  const targets = queue.filter(p =>
    selectedQueueIds.has(p.id) && p.hasVideo && !p.transcribed && p.instagramUrl
  );
  if (targets.length === 0) {
    setStatus('✗ No untranscribed video posts in selection', 2500);
    return;
  }
  el.transcribeBtn.disabled = true;
  await transcribePosts(targets);
  setStatus(`✓ Transcribed ${targets.length} item(s)`, 2500);
  await loadQueue();
  updateQueueButtons();
}

// ── Bulk import ────────────────────────────────────────────────────────────

async function bulkImport() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('instagram.com')) {
    setStatus('✗ Open Instagram to use bulk import', 2500);
    return;
  }
  if (el.bulkImportBtn) el.bulkImportBtn.disabled = true;
  setStatus('📥 Bulk importing…');
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'startBulkImport' });
    if (resp?.success) {
      setStatus(`✓ Imported ${resp.count} posts`, 2500);
      await loadQueue();
    } else {
      setStatus(`✗ Bulk import failed: ${resp?.error}`, 3000);
    }
  } catch (err) {
    setStatus(`✗ ${err.message}`, 3000);
  } finally {
    if (el.bulkImportBtn) el.bulkImportBtn.disabled = false;
  }
}

// ── Process ────────────────────────────────────────────────────────────────

async function processSelected() {
  if (selectedQueueIds.size === 0) {
    setStatus('Select at least one item');
    return;
  }
  el.processBtn.disabled = true;

  const queue = await Storage.getQueue();
  const needsTranscription = queue.filter(
    p => selectedQueueIds.has(p.id) && p.hasVideo && !p.transcribed && p.instagramUrl
  );
  if (needsTranscription.length > 0) {
    await transcribePosts(needsTranscription, '🎙️ Auto-transcribing');
  }

  setStatus('Processing…');
  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'processBatch',
      postIds: Array.from(selectedQueueIds)
    });
    if (resp.success) {
      setStatus('✓ Processed!', 2500);
      el.markdownPreview.value = resp.markdown;
      el.previewSection.style.display = 'block';
      selectedQueueIds.clear();
      await loadQueue();
      await loadProcessed();
    } else {
      setStatus(`✗ Error: ${resp.error}`, 4000);
    }
  } catch (err) {
    setStatus(`✗ Error: ${err.message}`, 4000);
  } finally {
    el.processBtn.disabled = false;
    updateQueueButtons();
  }
}

// ── Download all ───────────────────────────────────────────────────────────

async function downloadAllMarkdown() {
  const all = await Storage.getProcessed();
  const posts = selectedProcessedIds.size > 0
    ? all.filter(p => selectedProcessedIds.has(p.id))
    : all;

  if (posts.length === 0) { setStatus('No posts to download', 2000); return; }

  const md = generateMasterNote(posts);
  const filename = selectedProcessedIds.size > 0
    ? 'instagram-posts-selected.md'
    : 'instagram-posts.md';
  triggerDownload(md, filename);
  setStatus('✓ Downloaded!', 2000);
}

// Single-post card view download
function downloadMarkdown() {
  triggerDownload(el.markdownPreview.value, 'post.md');
}

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

// ── Markdown generation (single source of truth) ──────────────────────────

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
      if (meta) lines.push(`> 📅 ${meta}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Remove processed (ID-based, not index) ─────────────────────────────────

async function removeProcessedItem(postId) {
  const processed = await Storage.getProcessed();
  await Storage.setProcessed(processed.filter(p => p.id !== postId));
  selectedProcessedIds.delete(postId);
  await loadProcessed();
}

// ── Clear ──────────────────────────────────────────────────────────────────

async function clearStorage() {
  const hasSelection = selectedProcessedIds.size > 0;
  const msg = hasSelection
    ? `Delete ${selectedProcessedIds.size} selected post(s)? This cannot be undone.`
    : 'Clear all processed posts? This cannot be undone.';
  if (!confirm(msg)) return;

  if (hasSelection) {
    const all = await Storage.getProcessed();
    await Storage.setProcessed(all.filter(p => !selectedProcessedIds.has(p.id)));
    selectedProcessedIds.clear();
  } else {
    await Storage.clearProcessed();
  }
  setStatus('✓ Cleared', 2000);
  await loadProcessed();
}

// ── Copy ───────────────────────────────────────────────────────────────────

function copyMarkdown() {
  navigator.clipboard.writeText(el.markdownPreview.value).then(() => setStatus('✓ Copied!', 2000));
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
  await loadQueue();
  await loadProcessed();
  setupListeners();
}

setInterval(async () => {
  await loadQueue();
  await loadProcessed();
}, 3000);

init();
