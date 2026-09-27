# groq-model-check

Use this skill whenever you are about to read, write, or suggest a Groq model ID
in this project (e.g. touching `ai-providers.js`, writing a new provider, or
recommending a model in chat).

Groq rotates and renames models frequently. A hardcoded model ID that worked last
week may return 404 today. Always verify before using.

## Process

### 1. Fetch the live model list

Call the Groq models endpoint using the user's API key from `Storage.getConfig()`
(available in browser context) or ask the user to run:

```bash
curl -s https://api.groq.com/openai/v1/models \
  -H "Authorization: Bearer $GROQ_API_KEY" | jq '[.data[].id]'
```

Or fetch it directly if you have network access:

```
GET https://api.groq.com/openai/v1/models
Authorization: Bearer <key>
```

### 2. Pick the right model for the task

| Need | Prefer |
|------|--------|
| Vision (images + text) | Largest `openai/gpt-oss-*` model available |
| Fast text-only chat | `llama-3.3-70b-versatile` or `llama-3.1-8b-instant` |
| Speech-to-text | `whisper-large-v3-turbo` (stable, rarely changes) |

- Prefer **production** models over **preview** models for shipping code.
- If the model you planned to use is missing from the list, pick the next
  best fit and tell the user which model you chose and why.

### 3. Update the code

In `ai-providers.js`, the model ID lives at:

```js
static MODEL = 'openai/gpt-oss-120b'; // line ~7
```

Update it to the verified ID. Add a comment with today's date so future
sessions know when it was last confirmed:

```js
// Verified: YYYY-MM-DD — check https://console.groq.com/docs/models
static MODEL = '<verified-id>';
```

### 4. Note the fallback

`GroqProvider.testConnection()` in `ai-providers.js` calls `GET /models`
and can be used to verify connectivity at runtime. If the model check
fails at runtime, surface a clear error message to the user pointing to
`https://console.groq.com/docs/models`.
