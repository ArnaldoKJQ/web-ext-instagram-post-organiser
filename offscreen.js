// Offscreen document — audio capture only.
// Two paths:
//   fetchAndEncodeAudio: fetch video from CDN → Web Audio decode → WAV (fast)
//   startTabRecording / stopTabRecording: real-time tabCapture fallback (slow)

let activeRecorder = null;
let activeChunks = [];
let activeStream = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return false;

  switch (msg.action) {
    case 'fetchAndEncodeAudio':
      fetchAndEncodeAudio(msg.url).then(sendResponse).catch(err => {
        console.error('[Instagram MD] fetchAndEncodeAudio error:', err);
        sendResponse({ success: false, error: err.message });
      });
      return true;

    case 'startTabRecording':
      startTabRecording(msg.streamId, sendResponse);
      return true;

    case 'stopTabRecording':
      stopTabRecording(sendResponse);
      return true;
  }
  return false;
});

// ── CDN fetch path ─────────────────────────────────────────────────────────
//
// Fetch the video as an ArrayBuffer, decode audio with Web Audio API, then
// re-encode the raw PCM samples as a WAV file. No real-time playback needed —
// AudioContext.decodeAudioData runs at full CPU speed, typically <2 seconds
// for a typical Instagram Reel. Only the mono mix is sent to Whisper.

async function fetchAndEncodeAudio(url) {
  if (!url) throw new Error('No URL provided');

  const response = await fetch(url);
  if (!response.ok) throw new Error(`CDN fetch failed: HTTP ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength < 1000) throw new Error('CDN response too small — likely expired URL');

  const audioCtx = new AudioContext();
  let audioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    audioCtx.close();
  }

  const wavBytes = audioBufferToWav(audioBuffer);
  if (wavBytes.length < 1000) throw new Error('WAV encoding produced empty output');

  return { success: true, audio: Array.from(wavBytes) };
}

// Encode an AudioBuffer as 16-bit mono WAV.
// WAV format: 44-byte header + int16 PCM samples (little-endian).
function audioBufferToWav(audioBuffer) {
  const numChannels = 1; // mono for Whisper
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;
  const bytesPerSample = 2; // int16
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // Mix all channels down to mono
  const mono = new Float32Array(numSamples);
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < numSamples; i++) mono[i] += channelData[i];
  }
  if (audioBuffer.numberOfChannels > 1) {
    for (let i = 0; i < numSamples; i++) mono[i] /= audioBuffer.numberOfChannels;
  }

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);           // PCM chunk size
  view.setUint16(20, 1, true);            // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true); // block align
  view.setUint16(34, 16, true);           // bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples — clamp float to [-1, 1] then scale to int16
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

// ── Real-time tabCapture fallback ──────────────────────────────────────────

async function startTabRecording(streamId, sendResponse) {
  try {
    activeStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId }
      }
    });
    activeChunks = [];
    activeRecorder = new MediaRecorder(activeStream, { mimeType: 'audio/webm' });
    activeRecorder.ondataavailable = (e) => { if (e.data.size > 0) activeChunks.push(e.data); };
    activeRecorder.start();
    console.log('[Instagram MD] Real-time recording started');
    sendResponse({ success: true });
  } catch (err) {
    console.error('[Instagram MD] startTabRecording error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

async function stopTabRecording(sendResponse) {
  try {
    if (!activeRecorder) {
      sendResponse({ success: false, error: 'No active recording' });
      return;
    }
    const stopped = new Promise(resolve => { activeRecorder.onstop = resolve; });
    activeRecorder.stop();
    activeStream.getTracks().forEach(t => t.stop());
    await stopped;

    const blob = new Blob(activeChunks, { type: 'audio/webm' });
    if (blob.size < 1000) {
      sendResponse({ success: false, error: 'No audio captured' });
      return;
    }

    const arrayBuffer = await blob.arrayBuffer();
    sendResponse({ success: true, audio: Array.from(new Uint8Array(arrayBuffer)) });
  } catch (err) {
    console.error('[Instagram MD] stopTabRecording error:', err);
    sendResponse({ success: false, error: err.message });
  } finally {
    activeRecorder = null;
    activeChunks = [];
    activeStream = null;
  }
}
