// Content script — runs on instagram.com
// Captures post data on save-button click and exposes bulk scroll for popup trigger.

(function () {
  console.log('[Instagram MD] Content script loaded on', document.domain);

  // ── Helpers ──────────────────────────────────────────────────────────────

  // Return the largest visible video element (avoids grabbing suggested-reel previews).
  function getMainVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;
    if (videos.length === 1) return videos[0];
    let best = null, bestArea = 0;
    for (const v of videos) {
      const { width, height } = v.getBoundingClientRect();
      const area = width * height;
      if (area > bestArea) { bestArea = area; best = v; }
    }
    return best;
  }

  // Collect up to `max` visible <img> src URLs from an article (carousel-aware).
  function extractImageUrls(article, max = 3) {
    const imgs = Array.from(article.querySelectorAll('img[src]'));
    // Exclude tiny icons (avatars, UI chrome) by requiring meaningful dimensions.
    return imgs
      .filter(img => img.naturalWidth > 100 && img.naturalHeight > 100)
      .slice(0, max)
      .map(img => img.src);
  }

  function extractCaption(article) {
    try {
      // Prefer the longest span[dir=auto] — that's almost always the caption.
      const spans = Array.from(article.querySelectorAll('span[dir="auto"]'));
      if (spans.length > 0) {
        return spans.reduce((a, b) =>
          a.textContent.length >= b.textContent.length ? a : b
        ).textContent.trim();
      }
      return article.innerText.substring(0, 500).trim();
    } catch { return ''; }
  }

  // Extract author from profile-style links (/username/) — never from /p/ or /reel/ paths.
  function extractAuthor(scope) {
    const skip = new Set([
      'p', 'reel', 'reels', 'explore', 'accounts', 'direct',
      'stories', 'about', 'legal', 'privacy', 'developer', 'tv'
    ]);
    try {
      for (const link of (scope || document).querySelectorAll('a[href^="/"]')) {
        const m = (link.getAttribute('href') || '').match(/^\/([a-zA-Z0-9_.]+)\/?$/);
        if (m && !skip.has(m[1].toLowerCase())) return '@' + m[1];
      }
    } catch (err) {
      console.log('[Instagram MD] Author extraction failed:', err.message);
    }
    return 'Unknown';
  }

  function extractPostUrl(article) {
    try {
      return article.querySelector('a[href*="/p/"], a[href*="/reel/"]')?.href || '';
    } catch { return ''; }
  }

  function buildPostId() {
    return 'post_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // ── Post extraction ───────────────────────────────────────────────────────

  function extractFromArticle(article) {
    try {
      const imageUrls = extractImageUrls(article);
      return {
        id: buildPostId(),
        caption: extractCaption(article),
        author: extractAuthor(article),
        imageUrls,
        instagramUrl: extractPostUrl(article) || window.location.href,
        timestamp: new Date().toISOString(),
        queued: true
      };
    } catch (err) {
      console.error('[Instagram MD] extractFromArticle error:', err);
      return null;
    }
  }

  function extractCurrentPost() {
    try {
      const article = document.querySelector('article');
      if (article) return extractFromArticle(article);

      // Fallback: OG meta tags
      const caption = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
      const imageUrl = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
      const url = document.querySelector('meta[property="og:url"]')?.getAttribute('content') || window.location.href;
      if (caption || imageUrl) {
        return {
          id: buildPostId(),
          caption,
          author: extractAuthor(document),
          imageUrls: imageUrl ? [imageUrl] : [],
          instagramUrl: url,
          timestamp: new Date().toISOString(),
          queued: true
        };
      }
      return null;
    } catch (err) {
      console.error('[Instagram MD] extractCurrentPost error:', err);
      return null;
    }
  }

  // ── Save-button hook ──────────────────────────────────────────────────────

  let lastCaptureTime = 0;
  const CAPTURE_DEBOUNCE = 1000;

  document.addEventListener('click', async (e) => {
    const now = Date.now();
    if (now - lastCaptureTime < CAPTURE_DEBOUNCE) return;

    const saveBtn = e.target.closest(
      '[aria-label*="Save"], [aria-label*="save"], button[aria-label*="Save"], button[aria-label*="save"]'
    );
    if (!saveBtn) return;

    lastCaptureTime = now;

    setTimeout(() => {
      try {
        const postData = extractCurrentPost();
        if (!postData) return;

        // Attach video CDN URL if present (used later for fast transcription).
        const video = getMainVideo();
        if (video?.currentSrc) {
          postData.videoSrc = video.currentSrc;
          postData.hasVideo = true;
        }

        console.log('[Instagram MD] Captured post:', postData.id);
        // Guard against orphaned content scripts after extension reload.
        if (!chrome.runtime?.id) return;
        chrome.runtime.sendMessage({ action: 'addToQueue', post: postData }, (resp) => {
          if (chrome.runtime.lastError) return; // context invalidated mid-send
          if (resp?.success) console.log('[Instagram MD] Post queued, queue size:', resp.count);
        });
      } catch (err) {
        // "Extension context invalidated" is expected when the extension reloads
        // while the old content script is still alive — not a real error.
        if (!err.message?.includes('context invalidated')) {
          console.error('[Instagram MD] Save hook error:', err);
        }
      }
    }, 300);
  }, true);

  // ── Bulk import (triggered by popup via chrome.scripting.executeScript) ──

  window.instagramMDBulkImport = async function () {
    console.log('[Instagram MD] Starting bulk import…');
    const posts = [];
    const seenUrls = new Set();
    const MAX_SCROLLS = 80;

    // Extract from both grid links (/p/ /reel/) AND any open article elements.
    function extractVisible() {
      let found = 0;

      // Grid view — saved posts page uses <a href="/p/…"> thumbnails, not <article>.
      for (const link of document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')) {
        const url = (link.href || '').split('?')[0];
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);

        const img = link.querySelector('img');
        // Instagram marks reels/videos with an SVG overlay on the thumbnail.
        const hasVideo = !!(
          link.querySelector('svg[aria-label]') ||
          link.querySelector('[aria-label*="eel"], [aria-label*="ideo"], [aria-label*="lip"]')
        );

        posts.push({
          id: buildPostId(),
          instagramUrl: url,
          caption: img?.alt || '',
          imageUrls: img?.src ? [img.src] : [],
          hasVideo,
          timestamp: new Date().toISOString(),
          queued: true
        });
        found++;
      }

      // Feed / modal view — pick up any <article> elements too.
      for (const article of document.querySelectorAll('article')) {
        const url = (extractPostUrl(article) || '').split('?')[0];
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        const data = extractFromArticle(article);
        if (data) { posts.push(data); found++; }
      }

      if (found > 0) {
        console.log(`[Instagram MD] Extracted ${found} new posts (total: ${posts.length})`);
      }
    }

    // Instagram often scrolls document.documentElement, not body.
    // Find whichever root element actually has scrollable height.
    function scrollDown() {
      const html = document.documentElement;
      const body = document.body;
      if (html.scrollHeight > html.clientHeight) {
        html.scrollTop = html.scrollHeight;
      }
      window.scrollTo(0, Math.max(body.scrollHeight, html.scrollHeight));
    }

    function currentScrollHeight() {
      return Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      );
    }

    extractVisible();

    for (let i = 0; i < MAX_SCROLLS; i++) {
      const before = currentScrollHeight();
      scrollDown();
      // Give Instagram time to lazy-load the next batch of thumbnails.
      await new Promise(r => setTimeout(r, 1500));
      const after = currentScrollHeight();

      if (after === before) {
        console.log('[Instagram MD] Reached end of saved posts');
        break;
      }
      extractVisible();
    }

    // Final sweep after content settles.
    await new Promise(r => setTimeout(r, 600));
    extractVisible();

    console.log(`[Instagram MD] Bulk imported ${posts.length} posts`);
    chrome.runtime.sendMessage({ action: 'bulkAddToQueue', posts }, (resp) => {
      if (chrome.runtime.lastError) {
        console.error('[Instagram MD] Bulk import error:', chrome.runtime.lastError);
      }
    });

    return posts.length;
  };

  // ── Message listener (video duration + playback for real-time fallback) ──

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'getVideoDuration') {
      const video = getMainVideo();
      sendResponse({ duration: video ? video.duration : 0, found: !!video });
      return true;
    }
    if (msg.action === 'playVideoFromStart') {
      const video = getMainVideo();
      if (video) {
        video.currentTime = 0;
        video.muted = false;
        video.preservesPitch = true;
        video.playbackRate = msg.rate || 1;
        video.play().catch(err => console.error('[Instagram MD] Play failed:', err));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'No video found' });
      }
      return true;
    }
  });

  console.log('[Instagram MD] Ready');
})();
