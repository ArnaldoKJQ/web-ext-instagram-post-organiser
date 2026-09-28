// Background service worker
// Owns queue management, transcription, and AI batch processing.
// NOTE: Service workers can terminate when idle — never store mutable state in globals.

importScripts('encryption.js', 'storage.js', 'ai-providers.js');

self.addEventListener('error', (e) => console.error('[Instagram MD] Worker error:', e.error));
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

// ── Keep-alive during long operations ─────────────────────────────────────
// MV3 service workers terminate after ~30s idle. Alarms re-wake the worker
// every 20s while processing so a closed popup can't kill an in-flight job.

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'processing-keepalive') {
    console.log('[Instagram MD] Keep-alive ping');
  }
});

async function keepAliveStart() {
  await chrome.alarms.create('processing-keepalive', { periodInMinutes: 0.33 });
}
async function keepAliveStop() {
  await chrome.alarms.clear('processing-keepalive');
}

// ── Message router ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    switch (request.action) {
      case 'addToQueue':
        handleAddToQueue(request.post, sendResponse); break;
      case 'bulkAddToQueue':
        handleBulkAddToQueue(request.posts, sendResponse); break;
      case 'processBatch':
        processBatch(request.postIds, sendResponse); break;
      case 'startBulkImport':
        handleStartBulkImport(request.tabId ?? sender.tab?.id, sendResponse); break;
      case 'transcribeAudio':
        handleTranscribe(request.postId, request.tabId, sendResponse); break;
      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
  } catch (err) {
    console.error('[Instagram MD] Message handler error:', err);
    sendResponse({ success: false, error: err.message });
  }
  return true;
});

// ── Queue handlers ─────────────────────────────────────────────────────────

async function handleAddToQueue(post, sendResponse) {
  const queue = await Storage.getQueue();
  queue.push(post);
  await Storage.setQueue(queue);
  sendResponse({ success: true, count: queue.length });
}

async function handleBulkAddToQueue(posts, sendResponse) {
  const queue = await Storage.getQueue();
  const deduped = deduplicatePosts([...queue, ...posts]);
  await Storage.setQueue(deduped);
  sendResponse({ success: true, count: deduped.length });
}

// Deduplicate by both ID and URL — bulk import creates unique IDs for the same post.
function deduplicatePosts(posts) {
  const seenIds  = new Set();
  const seenUrls = new Set();
  return posts.filter(p => {
    const url = p.instagramUrl?.split('?')[0];
    if (seenIds.has(p.id))           return false;
    if (url && seenUrls.has(url))    return false;
    seenIds.add(p.id);
    if (url) seenUrls.add(url);
    return true;
  });
}

// ── Bulk import (MV3) ──────────────────────────────────────────────────────

async function handleStartBulkImport(tabId, sendResponse) {
  if (!tabId) {
    sendResponse({ success: false, error: 'No active tab' });
    return;
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.instagramMDBulkImport?.()
    });
    sendResponse({ success: true, count: results[0]?.result ?? 0 });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ── Offscreen document ─────────────────────────────────────────────────────

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Record tab audio and fetch CDN audio for Groq Whisper transcription'
  });
}

// ── Transcription ──────────────────────────────────────────────────────────
//
// Primary path: fetch video from CDN → offscreen decodes to WAV → Groq Whisper.
// Fallback path: real-time tabCapture (slower; used when CDN URL has expired).

const REALTIME_PLAYBACK_RATE = 1.75;

async function handleTranscribe(postId, tabId, sendResponse) {
  try {
    const config = await Storage.getConfig();
    if (!config.apiKey) {
      sendResponse({ success: false, error: 'Groq API key not configured. Go to settings.' });
      return;
    }

    const queue = await Storage.getQueue();
    const post = queue.find(p => p.id === postId);
    if (!post) {
      sendResponse({ success: false, error: 'Post not found in queue' });
      return;
    }

    await ensureOffscreenDocument();

    let audioBytes;
    let usedCDN = false;

    // Primary: CDN fetch (fast — no real-time wait)
    if (post.videoSrc) {
      try {
        console.log(`[Instagram MD] Trying CDN fetch for ${postId.substring(0, 8)}…`);
        const resp = await chrome.runtime.sendMessage({
          target: 'offscreen',
          action: 'fetchAndEncodeAudio',
          url: post.videoSrc
        });
        if (resp?.success) {
          audioBytes = new Uint8Array(resp.audio);
          usedCDN = true;
          console.log('[Instagram MD] CDN fetch succeeded');
        } else {
          console.log('[Instagram MD] CDN fetch failed:', resp?.error, '— falling back to real-time');
        }
      } catch (err) {
        console.log('[Instagram MD] CDN fetch error:', err.message, '— falling back to real-time');
      }
    }

    // Fallback: real-time tabCapture
    if (!audioBytes) {
      audioBytes = await recordRealtime(postId, tabId, config.apiKey);
      if (!audioBytes) {
        sendResponse({ success: false, error: 'Transcription failed: no audio captured' });
        return;
      }
    }

    console.log(`[Instagram MD] Sending ${audioBytes.length} bytes to Groq Whisper (CDN=${usedCDN})…`);
    const text = await transcribeWithGroqWhisper(audioBytes, config.apiKey);
    console.log('[Instagram MD] Transcript:', text.substring(0, 100));

    // Update post in queue
    const freshQueue = await Storage.getQueue();
    const freshPost = freshQueue.find(p => p.id === postId);
    if (freshPost) {
      freshPost.transcript = text;
      freshPost.transcribed = true;
      await Storage.setQueue(freshQueue);
    }

    sendResponse({ success: true, text });
  } catch (err) {
    console.error('[Instagram MD] Transcribe error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

// Real-time tabCapture path (fallback when CDN URL has expired).
async function recordRealtime(postId, tabId, _apiKey) {
  try {
    const durationResp = await chrome.tabs.sendMessage(tabId, { action: 'getVideoDuration' });
    if (!durationResp?.found) return null;

    const duration = Math.min(durationResp.duration || 15, 60);
    const captureWait = duration / REALTIME_PLAYBACK_RATE;
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

    const startResp = await chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'startTabRecording',
      streamId
    });
    if (!startResp?.success) return null;

    await chrome.tabs.sendMessage(tabId, { action: 'playVideoFromStart', rate: REALTIME_PLAYBACK_RATE });
    await new Promise(r => setTimeout(r, captureWait * 1000 + 500));

    const stopResp = await chrome.runtime.sendMessage({ target: 'offscreen', action: 'stopTabRecording' });
    if (!stopResp?.success) return null;

    return new Uint8Array(stopResp.audio);
  } catch (err) {
    console.error('[Instagram MD] Real-time recording error:', err);
    return null;
  }
}

// ── Groq Whisper upload ────────────────────────────────────────────────────

async function transcribeWithGroqWhisper(audioBytes, apiKey) {
  const blob = new Blob([audioBytes], { type: 'audio/wav' });
  const formData = new FormData();
  formData.append('file', blob, 'audio.wav');
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('response_format', 'text');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Groq Whisper error: HTTP ${response.status} ${errText.substring(0, 200)}`);
  }

  return (await response.text()).trim();
}

// ── Image OCR via Groq vision ──────────────────────────────────────────────
// Fetches each image post's first image as base64 and asks llama-4-scout to
// describe it. Result stored in post.imageDescription, used by the prompt.

const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

async function fetchAsBase64(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const mimeType = resp.headers.get('content-type') || 'image/jpeg';
  const buffer = await resp.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return { base64: btoa(binary), mimeType };
}

async function describeImagePosts(posts, apiKey) {
  const targets = posts.filter(p => !p.hasVideo && !p.transcript && p.imageUrls?.length > 0);
  if (targets.length === 0) return;

  await Promise.all(targets.map(async (post) => {
    // Process up to 3 images (carousel-aware)
    const urls = (post.imageUrls || []).slice(0, 3);
    const descriptions = [];

    for (const imgUrl of urls) {
      try {
        const { base64, mimeType } = await fetchAsBase64(imgUrl);
        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: VISION_MODEL,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
                { type: 'text', text: 'Describe what you see. Focus on any visible text, product names, UI elements, or key visual content. Be concise (max 150 chars).' }
              ]
            }],
            max_tokens: 250,
            temperature: 0.1
          }),
          signal: AbortSignal.timeout(20000)
        });
        if (resp.ok) {
          const data = await resp.json();
          const desc = data.choices?.[0]?.message?.content?.trim();
          if (desc) descriptions.push(desc);
        }
      } catch (err) {
        console.log(`[Instagram MD] Image OCR skipped for ${post.id.substring(0, 8)}: ${err.message}`);
      }
    }

    if (descriptions.length > 0) {
      post.imageDescription = descriptions.join(' | ');
      console.log(`[Instagram MD] Image OCR for ${post.id.substring(0, 8)}: ${post.imageDescription.substring(0, 80)}…`);
    }
  }));
}

// ── Batch processing ───────────────────────────────────────────────────────

async function processBatch(postIds, sendResponse) {
  const idSet = new Set(postIds || []);
  try {
    const config = await Storage.getConfig();
    if (!config.apiKey) {
      sendResponse({ success: false, error: 'API key not configured. Go to settings.' });
      return;
    }

    const queue = await Storage.getQueue();
    if (queue.length === 0) {
      sendResponse({ success: false, error: 'Queue is empty' });
      return;
    }

    const batch = idSet.size > 0 ? queue.filter(p => idSet.has(p.id)) : queue;
    const remaining = idSet.size > 0 ? queue.filter(p => !idSet.has(p.id)) : [];

    if (batch.length === 0) {
      sendResponse({ success: false, error: 'No matching posts selected' });
      return;
    }

    // Mark as processing (5%) and start keep-alive so the service worker
    // survives even if the popup is closed mid-batch.
    for (const p of batch) { p.status = 'processing'; p.progress = 5; }
    await Storage.setQueue([...remaining, ...batch]);
    await keepAliveStart();

    try {
      console.log(`[Instagram MD] Processing ${batch.length} posts…`);

      // ── Stage 1: parallel CDN transcription for videos that have a CDN URL ──
      // No tab navigation needed — runs entirely in the background service worker.
      await ensureOffscreenDocument();
      const videoWithCDN = batch.filter(p => p.hasVideo && !p.transcribed && p.videoSrc);
      if (videoWithCDN.length > 0) {
        console.log(`[Instagram MD] Transcribing ${videoWithCDN.length} video(s) in parallel…`);
        await Promise.all(videoWithCDN.map(async (post) => {
          try {
            const resp = await chrome.runtime.sendMessage({
              target: 'offscreen',
              action: 'fetchAndEncodeAudio',
              url: post.videoSrc
            });
            if (resp?.success) {
              const audioBytes = new Uint8Array(resp.audio);
              post.transcript = await transcribeWithGroqWhisper(audioBytes, config.apiKey);
              post.transcribed = true;
              console.log(`[Instagram MD] Transcribed ${post.id.substring(0, 8)}`);
            }
          } catch (err) {
            console.log(`[Instagram MD] CDN transcribe skipped for ${post.id.substring(0, 8)}: ${err.message}`);
          }
        }));
      }
      // Progress 40% — transcription done, persist transcripts
      for (const p of batch) p.progress = 40;
      await Storage.setQueue([...remaining, ...batch]);

      // ── Stage 2: image OCR ────────────────────────────────────────────────
      await describeImagePosts(batch, config.apiKey);
      // Progress 80% — OCR done
      for (const p of batch) p.progress = 80;
      await Storage.setQueue([...remaining, ...batch]);

      // ── Stage 3: AI categorization ────────────────────────────────────────
      const categorized = await GroqProvider.categorizePosts(batch, config.apiKey, config.model);

      for (const p of categorized) p.status = 'done';

      const processed = await Storage.getProcessed();
      const existingIds = new Set(processed.map(p => p.id));
      const newProcessed = categorized.filter(p => !existingIds.has(p.id));
      await Storage.setProcessed([...processed, ...newProcessed]);
      await Storage.setQueue(remaining);

      // Append new batch to whatever is already in the preview (preserves user edits).
      // Background saves this so the popup can restore it even if it was closed.
      const newMd = generateMasterNote(newProcessed);
      const stored = await chrome.storage.local.get('insta_last_preview');
      const existing = stored.insta_last_preview?.trim() || '';
      const updatedMd = existing ? `${existing}\n\n---\n\n${newMd}` : newMd;
      await chrome.storage.local.set({ insta_last_preview: updatedMd });

      sendResponse({
        success: true,
        markdown: updatedMd,
        processedCount: newProcessed.length
      });
    } catch (innerErr) {
      throw innerErr;
    } finally {
      await keepAliveStop();
    }
  } catch (err) {
    console.error('[Instagram MD] processBatch error:', err);
    // Mark processing posts as failed so user can retry
    try {
      const freshQueue = await Storage.getQueue();
      for (const p of freshQueue) {
        if (idSet.has(p.id) && p.status === 'processing') p.status = 'failed';
      }
      await Storage.setQueue(freshQueue);
    } catch (e) {
      console.error('[Instagram MD] Failed to mark posts as failed:', e);
    }
    await keepAliveStop();
    sendResponse({ success: false, error: err.message });
  }
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
