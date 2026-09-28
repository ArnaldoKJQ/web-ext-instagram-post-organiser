# Instagram MD

A Chrome extension that captures your saved Instagram posts and converts them into an Obsidian-ready markdown note — auto-summarized and categorized by Groq AI.

---

## What it does

1. **Capture** — click the save button on any Instagram post (photo, carousel, or Reel) and it's silently added to your queue. Or use **Bulk Import** to scrape your entire saved collection at once.
2. **Transcribe** (optional) — for Reels, fetch the audio directly from the CDN and transcribe it with Groq Whisper. ~2–4 seconds per video instead of waiting for it to play out in real time.
3. **Process** — send selected posts to Groq AI, which extracts the tool/concept name, writes a one-sentence summary, and assigns topic + tags.
4. **Download** — get a single Obsidian markdown file, grouped by topic, in card format ready to drop into your vault.

### Output format

```markdown
## Design Tools

### Originkit
> Free animated component library for Framer with 50+ ready-to-use components
> #framer #animation #components
> 📅 Sep 28, 2026 · @originkit · [View post →](https://instagram.com/...)

### Radix UI
> Unstyled accessible component primitives for React
> #react #accessibility #components
> 📅 Sep 27, 2026 · @radix_ui · [View post →](https://instagram.com/...)
```

---

## Requirements

- Chrome (or any Chromium browser)
- A [Groq API key](https://console.groq.com) — free tier is enough for personal use

---

## Installation

1. Clone or download this repo
2. Open `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the project folder
5. Click the extension icon → **Settings** (gear icon)
6. Paste your Groq API key and click **Save**
7. Click **Test** to confirm the key works

---

## Usage

### Saving posts as you browse

Navigate to any post or Reel on Instagram and click the **bookmark/save icon**. The extension captures the post silently in the background — no popup, no interruption.

### Bulk importing saved posts

1. Go to your Instagram profile → **Saved**
2. Open the extension popup
3. Click **📥 Bulk Import Saved**
4. The extension scrolls through your saved collection and queues everything it finds

### Transcribing Reels (optional)

Select one or more video posts in the Queue tab and click **Transcribe**. The extension fetches the audio from Instagram's CDN and sends it to Groq Whisper. The transcript is used instead of the caption when you process — much better summaries for talk-heavy Reels.

> If transcription fails (expired video URL, no audio), the extension falls back to the caption automatically.

### Processing and downloading

1. Check the posts you want in the **Queue** tab
2. Click **Process Selected** — Groq AI categorizes and summarizes each one
3. Switch to the **Processed** tab to review
4. Click **Download All** (or select specific posts and **Download Selected**) to get your `.md` file

---

## AI model

Uses `openai/gpt-oss-120b` on Groq for categorization and `whisper-large-v3-turbo` for transcription.

Groq updates their model roster regularly. If you see a "model not found" error:
1. Click **Test** in Settings — it will list the models currently available on your account
2. Update `static MODEL` in `ai-providers.js` to a model from that list

---

## Privacy

- Your posts and API key never leave your browser except for the Groq API calls you explicitly trigger.
- The API key is encrypted with a device-specific key using AES-GCM (Web Crypto API) before being stored. The raw key is never written to disk.
- No analytics, no external servers, no sync.

---

## Project structure

```
manifest.json       Extension config (MV3)
content.js          Runs on instagram.com — save hook + bulk scroll
background.js       Service worker — queue, transcription, AI batch
offscreen.js        CDN audio fetch → WAV encoding (no real-time recording)
ai-providers.js     Groq chat + Whisper API calls
popup.js / .html    Extension popup UI
options.js / .html  Settings page (API key, batch size)
storage.js          chrome.storage wrapper + AES-GCM encryption
encryption.js       Device key generation and AES-GCM encrypt/decrypt
```
