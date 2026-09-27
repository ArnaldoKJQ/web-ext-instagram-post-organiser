// Options page - settings UI (Groq only)

const elements = {
  groqKey: document.getElementById('groq-key'),
  batchSize: document.getElementById('batch-size'),
  saveBtn: document.getElementById('save-btn'),
  testBtn: document.getElementById('test-btn'),
  status: document.getElementById('status')
};

async function loadSettings() {
  const config = await Storage.getConfig();
  elements.batchSize.value = config.batchSize || 30;
  elements.groqKey.value = ''; // never show decrypted key
}

elements.saveBtn.addEventListener('click', async () => {
  const apiKey = elements.groqKey.value.trim();
  const batchSize = parseInt(elements.batchSize.value, 10);

  if (!apiKey) {
    showStatus('Groq API key required', 'error');
    return;
  }

  if (batchSize < 5 || batchSize > 100) {
    showStatus('Batch size must be 5-100', 'error');
    return;
  }

  elements.saveBtn.disabled = true;
  showStatus('Encrypting...', 'success');

  try {
    await Storage.setConfig({ apiKey, batchSize });
    showStatus('✓ Settings saved (Groq key encrypted)', 'success');
    elements.groqKey.value = '';
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
  } finally {
    elements.saveBtn.disabled = false;
  }
});

elements.testBtn.addEventListener('click', async () => {
  const apiKey = elements.groqKey.value.trim();

  if (!apiKey) {
    showStatus('Enter API key to test', 'error');
    return;
  }

  elements.testBtn.disabled = true;
  showStatus('Testing...', 'success');

  try {
    await GroqProvider.testConnection(apiKey);
    showStatus('✓ Groq API key valid!', 'success');
  } catch (err) {
    showStatus(`✗ Connection failed: ${err.message}`, 'error');
  } finally {
    elements.testBtn.disabled = false;
  }
});

function showStatus(message, type) {
  elements.status.textContent = message;
  elements.status.className = `status-message ${type}`;
  if (type === 'success') {
    setTimeout(() => { elements.status.className = 'status-message'; }, 3000);
  }
}

loadSettings();