// Encryption utility - uses Web Crypto API
//
// AES-GCM key is generated once per device, marked non-extractable, and
// stored as a raw CryptoKey object in IndexedDB (Chrome supports this
// natively). Non-extractable means no code — not even this extension —
// can ever read the raw key bytes back out; it can only be *used* via
// crypto.subtle.encrypt/decrypt within this browser profile. That's what
// makes "no password" reasonable here: the key can't be exported, copied,
// or synced out, so a stolen storage blob is useless without this device.

class Encryption {
  static DB_NAME = 'insta_md_keystore';
  static STORE_NAME = 'keys';
  static KEY_ID = 'device-key';
  static _dbPromise = null;
  static _keyPromise = null;

  static _openDb() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(this.STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._dbPromise;
  }

  static async _getStoredKey() {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const req = tx.objectStore(this.STORE_NAME).get(this.KEY_ID);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  static async _storeKey(key) {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      tx.objectStore(this.STORE_NAME).put(key, this.KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Get this device's key, generating + persisting it the first time.
  // Cached in memory after first call within a given context (background,
  // popup, options each cache their own — cheap either way, IndexedDB is fast).
  static async getDeviceKey() {
    if (this._keyPromise) return this._keyPromise;

    this._keyPromise = (async () => {
      let key = await this._getStoredKey();
      if (key) return key;

      key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false, // non-extractable — raw bytes can never be read back out
        ['encrypt', 'decrypt']
      );
      await this._storeKey(key);
      return key;
    })();

    return this._keyPromise;
  }

  // Encrypt plaintext with the device key. No password needed.
  static async encrypt(plaintext) {
    try {
      const key = await this.getDeviceKey();
      const encoder = new TextEncoder();
      const data = encoder.encode(plaintext);

      const iv = crypto.getRandomValues(new Uint8Array(12));

      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        data
      );

      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encrypted), iv.length);

      return btoa(String.fromCharCode.apply(null, combined));
    } catch (err) {
      throw new Error(`Encryption failed: ${err.message}`);
    }
  }

  // Decrypt ciphertext with the device key. No password needed.
  static async decrypt(ciphertext) {
    try {
      const key = await this.getDeviceKey();

      const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encrypted
      );

      return new TextDecoder().decode(decrypted);
    } catch (err) {
      throw new Error(`Decryption failed: ${err.message}`);
    }
  }
}