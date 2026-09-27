// Groq AI — post categorization and summarization.
// Uses llama-4-scout (vision-capable) so image content is understood alongside captions.
// Whisper transcription is separate (background.js).

class GroqProvider {
  static BASE_URL = 'https://api.groq.com/openai/v1';
  static MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
  static TIMEOUT = 45000;

  static async testConnection(apiKey) {
    try {
      const response = await fetch(`${this.BASE_URL}/models`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch (err) {
      throw new Error(`Groq connection failed: ${err.message}`);
    }
  }

  // Build a multimodal message for one post.
  // Content priority: transcript > audioNotes > caption. Images passed alongside text.
  static buildPostMessage(post) {
    const content = [];

    // Attach images (carousel-aware — up to 3 slides)
    const imageUrls = post.imageUrls || (post.imageUrl ? [post.imageUrl] : []);
    for (const url of imageUrls.slice(0, 3)) {
      content.push({ type: 'image_url', image_url: { url } });
    }

    // Build text portion — prioritise transcript, then audio notes, then caption
    let text = `POST ID: ${post.id}\n`;
    if (post.transcript) {
      text += `TRANSCRIPT (Whisper audio-to-text): ${post.transcript}\n`;
    } else if (post.audioNotes) {
      text += `AUDIO NOTES (user): ${post.audioNotes}\n`;
    }
    if (post.caption) {
      text += `CAPTION: ${post.caption}\n`;
    }
    if (!post.transcript && !post.audioNotes && !post.caption && imageUrls.length > 0) {
      text += '(No caption — please describe what you see in the image(s))\n';
    }

    content.push({ type: 'text', text: text.trim() });
    return { role: 'user', content };
  }

  static buildSystemPrompt(postCount) {
    return `You are an Instagram content analyst. Summarize each post into a concise Obsidian note entry.

SOURCE PRIORITY (use in this order):
1. TRANSCRIPT — most accurate, use if present
2. AUDIO NOTES — user-typed notes, use if no transcript
3. CAPTION + images — fallback

FOR EACH POST extract:
- topic: 1-3 word category (e.g. "Design Tools", "Productivity", "Typography")
- name: the specific tool, concept, or item (e.g. "Originkit", "Obsidian", "Variable Fonts")
  If no specific named thing, derive a short name from the content (e.g. "Calm Morning Ritual")
- summary: one sentence describing what it is or what the post shows (max 150 chars)
- tags: 2-4 lowercase single-word or hyphenated tags (no # prefix)
- media_type: "image" | "video" | "carousel" | "unknown"

RULES:
- No sentences starting with "The post shows" or "This post"
- No filler phrases ("check out", "shares", "invites")
- Be specific — prefer "Framer Motion" over "animation library"
- If images show a UI, tool, or product, name it

Return ONLY valid JSON — no markdown fences, no explanation.
Return EXACTLY ${postCount} objects in the SAME ORDER as the posts, with "id" copied character-for-character:
[
  {
    "id": "post_id",
    "topic": "Category",
    "name": "Specific Name",
    "summary": "One sentence description",
    "tags": ["tag1", "tag2"],
    "media_type": "image"
  }
]`;
  }

  static async categorizePosts(posts, apiKey) {
    if (!apiKey) throw new Error('API key not configured');
    if (!posts || posts.length === 0) return [];

    const messages = [
      { role: 'system', content: this.buildSystemPrompt(posts.length) },
      ...posts.map(p => this.buildPostMessage(p))
    ];

    try {
      const response = await fetch(`${this.BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.MODEL,
          messages,
          temperature: 0.2,
          max_tokens: Math.min(8192, 500 * posts.length + 800)
        }),
        signal: AbortSignal.timeout(this.TIMEOUT)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const responseText = data.choices[0].message.content;

      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found in Groq response');

      const categorized = JSON.parse(jsonMatch[0]);

      return posts.map((post, index) => {
        // Match by ID, fall back to position if model mangled the ID.
        let cat = categorized.find(c => c.id === post.id);
        if (!cat && categorized[index]) {
          console.log(`[Instagram MD] ID mismatch at index ${index}, using positional fallback`);
          cat = categorized[index];
        }
        return {
          ...post,
          topic: cat?.topic || 'Uncategorized',
          name: cat?.name || cat?.topic || 'Post',
          summary: cat?.summary || '',
          tags: cat?.tags || [],
          mediaType: cat?.media_type || 'unknown'
        };
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Request timed out — Groq API is slow');
      throw new Error(`Groq API error: ${err.message}`);
    }
  }
}
