// Groq AI — post categorization and summarization.
// Whisper transcription is separate (background.js).

class GroqProvider {
  static BASE_URL = 'https://api.groq.com/openai/v1';
  static TIMEOUT = 45000;
  // Fallback when no model is configured in settings
  static DEFAULT_MODEL = 'llama-3.3-70b-versatile';

  // Returns chat-capable models, sorted by ID.
  // Filters out audio (whisper), embedding, and safety-classifier models.
  static async listModels(apiKey) {
    const resp = await fetch(`${this.BASE_URL}/models`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return (data.data || [])
      .filter(m => !/(whisper|embed|guard|tts)/i.test(m.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  static async testConnection(apiKey) {
    try {
      const models = await this.listModels(apiKey);
      if (models.length === 0) throw new Error('No chat models found on this account');
      return { ok: true, models };
    } catch (err) {
      throw new Error(`Groq connection failed: ${err.message}`);
    }
  }

  // All posts go into ONE user message as a plain string.
  // Instagram CDN image URLs require session cookies — Groq's servers can't
  // fetch them, so vision arrays don't work here. Text content only.
  static buildUserMessage(posts) {
    const text = posts.map(post => {
      let block = `POST ID: ${post.id}\n`;
      if (post.transcript)        block += `TRANSCRIPT (Whisper): ${post.transcript}\n`;
      else if (post.audioNotes)   block += `AUDIO NOTES: ${post.audioNotes}\n`;
      if (post.imageDescription)  block += `IMAGE CONTENT (OCR): ${post.imageDescription}\n`;
      if (post.caption)           block += `CAPTION: ${post.caption}\n`;
      if (!post.transcript && !post.audioNotes && !post.imageDescription && !post.caption) {
        block += '(No text content available)\n';
      }
      return block.trim();
    }).join('\n---\n');

    return { role: 'user', content: text };
  }

  static buildSystemPrompt(postCount) {
    return `You are an Instagram content analyst. Summarize each post into a concise Obsidian note entry.

SOURCE PRIORITY (use in this order):
1. TRANSCRIPT — most accurate, use if present
2. AUDIO NOTES — user-typed notes, use if no transcript
3. IMAGE CONTENT (OCR) — extracted from the image, prefer over caption alone
4. CAPTION — fallback

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

  static async categorizePosts(posts, apiKey, model) {
    if (!apiKey) throw new Error('API key not configured');
    if (!posts || posts.length === 0) return [];

    const useModel = model || this.DEFAULT_MODEL;
    const messages = [
      { role: 'system', content: this.buildSystemPrompt(posts.length) },
      this.buildUserMessage(posts)
    ];

    try {
      const response = await fetch(`${this.BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: useModel,
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
        let cat = categorized.find(c => c.id === post.id);
        if (!cat && categorized[index]) {
          console.log(`[Instagram MD] ID mismatch at index ${index}, using positional fallback`);
          cat = categorized[index];
        }
        return {
          ...post,
          topic:     cat?.topic     || 'Uncategorized',
          name:      cat?.name      || cat?.topic || 'Post',
          summary:   cat?.summary   || '',
          tags:      cat?.tags      || [],
          mediaType: cat?.media_type || 'unknown'
        };
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Request timed out — Groq API is slow');
      throw new Error(`Groq API error: ${err.message}`);
    }
  }
}
