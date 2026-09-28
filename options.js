// Options page

const elements = {
  groqKey:       document.getElementById('groq-key'),
  modelSelect:   document.getElementById('model-select'),
  refreshModels: document.getElementById('refresh-models-btn'),
  modelTag:      document.getElementById('model-tag'),
  batchSize:     document.getElementById('batch-size'),
  saveBtn:       document.getElementById('save-btn'),
  testBtn:       document.getElementById('test-btn'),
  status:        document.getElementById('status')
};

// ── Model list ─────────────────────────────────────────────────────────────

async function loadModels(apiKey, selectedModel) {
  elements.modelSelect.disabled = true;
  elements.refreshModels.disabled = true;
  elements.modelSelect.innerHTML = '<option value="">Loading models…</option>';
  elements.modelTag.innerHTML = '';

  try {
    const models = await GroqProvider.listModels(apiKey);
    if (models.length === 0) throw new Error('No chat models returned');

    elements.modelSelect.innerHTML = '';
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id + (m.context_window ? ` (${(m.context_window / 1000).toFixed(0)}k ctx)` : '');
      elements.modelSelect.appendChild(opt);
    }

    // Pick saved model, or first model as default
    const pick = selectedModel && models.find(m => m.id === selectedModel)
      ? selectedModel
      : models[0].id;
    elements.modelSelect.value = pick;
    updateModelTag(pick);

    elements.modelSelect.disabled = false;
    elements.refreshModels.disabled = false;
  } catch (err) {
    elements.modelSelect.innerHTML = '<option value="">Failed to load models</option>';
    showStatus(`Could not fetch models: ${err.message}`, 'error');
    elements.refreshModels.disabled = false;
  }
}

function updateModelTag(modelId) {
  if (!modelId) { elements.modelTag.innerHTML = ''; return; }
  const label = modelId.includes('llama') ? 'Llama'
    : modelId.includes('gemma')   ? 'Gemma'
    : modelId.includes('mixtral') ? 'Mixtral'
    : modelId.includes('qwen')    ? 'Qwen'
    : modelId.split('/').pop().split('-')[0];
  elements.modelTag.innerHTML = '';
  const tag = document.createElement('span');
  tag.className = 'model-tag';
  tag.textContent = label;
  elements.modelTag.appendChild(tag);
}

elements.modelSelect.addEventListener('change', () => {
  updateModelTag(elements.modelSelect.value);
});

elements.refreshModels.addEventListener('click', async () => {
  const key = elements.groqKey.value.trim();
  const config = await Storage.getConfig();
  const apiKey = key || config.apiKey;
  if (!apiKey) { showStatus('Enter or save an API key first', 'error'); return; }
  await loadModels(apiKey, elements.modelSelect.value);
});

// ── Load ───────────────────────────────────────────────────────────────────

async function loadSettings() {
  const config = await Storage.getConfig();
  elements.batchSize.value = config.batchSize || 30;
  elements.groqKey.value   = ''; // never show decrypted key

  if (config.apiKey) {
    await loadModels(config.apiKey, config.model);
  }
}

// ── Save ───────────────────────────────────────────────────────────────────

elements.saveBtn.addEventListener('click', async () => {
  const apiKeyInput = elements.groqKey.value.trim();
  const batchSize   = parseInt(elements.batchSize.value, 10);
  const model       = elements.modelSelect.value;

  if (batchSize < 5 || batchSize > 100) {
    showStatus('Batch size must be 5–100', 'error');
    return;
  }

  elements.saveBtn.disabled = true;
  showStatus('Saving…', 'success');

  try {
    // apiKey is optional — omitting it preserves the existing encrypted key
    const updates = { batchSize, model };
    if (apiKeyInput) updates.apiKey = apiKeyInput;
    await Storage.setConfig(updates);

    showStatus('✓ Settings saved' + (apiKeyInput ? ' (key encrypted)' : ''), 'success');
    elements.groqKey.value = '';

    // If a new key was entered, reload the model list
    if (apiKeyInput) {
      await loadModels(apiKeyInput, model);
    }
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
  } finally {
    elements.saveBtn.disabled = false;
  }
});

// ── Test connection ────────────────────────────────────────────────────────

elements.testBtn.addEventListener('click', async () => {
  const key = elements.groqKey.value.trim();
  const config = await Storage.getConfig();
  const apiKey = key || config.apiKey;

  if (!apiKey) {
    showStatus('Enter API key to test', 'error');
    return;
  }

  elements.testBtn.disabled = true;
  showStatus('Testing…', 'success');

  try {
    const { models } = await GroqProvider.testConnection(apiKey);
    showStatus(`✓ Connected — ${models.length} models available`, 'success');
    await loadModels(apiKey, elements.modelSelect.value || config.model);
  } catch (err) {
    showStatus(`✗ ${err.message}`, 'error');
  } finally {
    elements.testBtn.disabled = false;
  }
});

// ── Status helper ──────────────────────────────────────────────────────────

function showStatus(message, type) {
  elements.status.textContent = message;
  elements.status.className = `status-message ${type}`;
  if (type === 'success') {
    setTimeout(() => { elements.status.className = 'status-message'; }, 3500);
  }
}

loadSettings();
