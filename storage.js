// Storage — MV3 chrome.storage.local wrapper with API key encryption.

const STORAGE_KEYS = {
  QUEUE:     'insta_queue',
  PROCESSED: 'insta_processed',
  CONFIG:    'insta_config'
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
    let config = data[this.KEYS.CONFIG] || { apiKey: '', batchSize: 30 };
    if (config.apiKeyEncrypted) {
      try {
        config.apiKey = await Encryption.decrypt(config.apiKeyEncrypted);
      } catch (err) {
        console.error('[Instagram MD] Failed to decrypt API key:', err);
      }
    }
    return config;
  }

  static async setConfig(config) {
    const encryptedKey = await Encryption.encrypt(config.apiKey);
    await chrome.storage.local.set({
      [this.KEYS.CONFIG]: { apiKeyEncrypted: encryptedKey, batchSize: config.batchSize }
    });
  }

  static async clearAll() {
    return chrome.storage.local.clear();
  }

  static async clearProcessed() {
    return chrome.storage.local.set({ [this.KEYS.PROCESSED]: [] });
  }
}
