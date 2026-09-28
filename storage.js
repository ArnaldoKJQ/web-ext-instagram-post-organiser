// Storage — MV3 chrome.storage.local wrapper with API key encryption.

const STORAGE_KEYS = {
  QUEUE:     'insta_queue',
  PROCESSED: 'insta_processed',
  CONFIG:    'insta_config',
  THEME:     'insta_theme'
};

class Storage {
  static KEYS = STORAGE_KEYS;

  static async getQueue() {
    const data = await chrome.storage.local.get(this.KEYS.QUEUE);
    return data[this.KEYS.QUEUE] || [];
  }

  static async setQueue(queue) {
    return chrome.storage.local.set({ [this.KEYS.QUEUE]: queue });
  }

  static async getProcessed() {
    const data = await chrome.storage.local.get(this.KEYS.PROCESSED);
    return data[this.KEYS.PROCESSED] || [];
  }

  static async setProcessed(processed) {
    return chrome.storage.local.set({ [this.KEYS.PROCESSED]: processed });
  }

  // Config — API key is stored encrypted with the device key; decrypted on read.
  static async getConfig() {
    const data = await chrome.storage.local.get(this.KEYS.CONFIG);
    const raw = data[this.KEYS.CONFIG] || {};
    const config = { apiKey: '', batchSize: raw.batchSize || 30, model: raw.model || '' };
    if (raw.apiKeyEncrypted) {
      try {
        config.apiKey = await Encryption.decrypt(raw.apiKeyEncrypted);
      } catch (err) {
        console.error('[Instagram MD] Failed to decrypt API key:', err);
      }
    }
    return config;
  }

  // Partial update — only fields present in `updates` are written.
  // Existing apiKeyEncrypted is preserved when updates.apiKey is absent.
  static async setConfig(updates) {
    const data = await chrome.storage.local.get(this.KEYS.CONFIG);
    const existing = data[this.KEYS.CONFIG] || {};
    const next = { ...existing };
    if (updates.apiKey) next.apiKeyEncrypted = await Encryption.encrypt(updates.apiKey);
    if (updates.batchSize !== undefined) next.batchSize = updates.batchSize;
    if (updates.model    !== undefined) next.model     = updates.model;
    await chrome.storage.local.set({ [this.KEYS.CONFIG]: next });
  }

  static async getTheme() {
    const data = await chrome.storage.local.get(this.KEYS.THEME);
    return data[this.KEYS.THEME] || 'light';
  }

  static async setTheme(theme) {
    return chrome.storage.local.set({ [this.KEYS.THEME]: theme });
  }

  static async clearAll() {
    return chrome.storage.local.clear();
  }

  static async clearProcessed() {
    return chrome.storage.local.set({ [this.KEYS.PROCESSED]: [] });
  }
}
