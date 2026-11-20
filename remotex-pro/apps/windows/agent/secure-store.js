const fs = require('node:fs/promises');
const path = require('node:path');

// Electron safeStorage uses Windows DPAPI on Windows. Fail closed: never fall back
// to plaintext if OS-backed encryption is unavailable.
class SecureTokenStore {
  constructor({ safeStorage, filePath }) {
    this.safeStorage = safeStorage;
    this.filePath = filePath;
  }
  async save(record) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Windows secure credential encryption is unavailable.');
    const encrypted = this.safeStorage.encryptString(JSON.stringify(record));
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temp, encrypted, { mode: 0o600 });
    await fs.rename(temp, this.filePath);
  }
  async load() {
    try {
      if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Windows secure credential encryption is unavailable.');
      const bytes = await fs.readFile(this.filePath);
      const value = JSON.parse(this.safeStorage.decryptString(bytes));
      if (!value || typeof value.deviceId !== 'string' || typeof value.refreshToken !== 'string') throw new Error('Invalid credential record.');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async clear() { await fs.rm(this.filePath, { force: true }); }
}
module.exports = { SecureTokenStore };
