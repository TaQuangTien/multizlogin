// proxyService.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const proxiesFilePath = path.join(__dirname, 'proxies.json');

const MAX_ACCOUNTS_PER_PROXY = 3;

class ProxyService {
  constructor() {
    this.RAW_PROXIES = [];
    try {
      const data = fs.readFileSync(proxiesFilePath, 'utf8');
      this.RAW_PROXIES = JSON.parse(data);
    } catch (err) {
      console.error('Không thể đọc file proxies.json:', err);
      this.RAW_PROXIES = [];
    }
    this.PROXIES = this.RAW_PROXIES.map((p) => ({ url: p, usedCount: 0, accounts: [] }));
  }

  getAvailableProxyIndex() {
    for (let i = 0; i < this.PROXIES.length; i++) {
      if (this.PROXIES[i].usedCount < MAX_ACCOUNTS_PER_PROXY) {
        return i;
      }
    }
    return -1;
  }

  addProxy(proxyUrl) {
    try {
      new URL(proxyUrl);
      const newProxy = { url: proxyUrl, usedCount: 0, accounts: [] };
      this.PROXIES.push(newProxy);
      this.RAW_PROXIES.push(proxyUrl);
      fs.writeFileSync(proxiesFilePath, JSON.stringify(this.RAW_PROXIES, null, 2));
      return newProxy;
    } catch (err) {
      throw new Error('Proxy URL không hợp lệ');
    }
  }

  removeProxy(proxyUrl) {
    const index = this.PROXIES.findIndex((p) => p.url === proxyUrl);
    if (index === -1) {
      throw new Error('Không tìm thấy proxy');
    }
    this.PROXIES.splice(index, 1);
    const rawIndex = this.RAW_PROXIES.indexOf(proxyUrl);
    if (rawIndex !== -1) {
      this.RAW_PROXIES.splice(rawIndex, 1);
    }
    fs.writeFileSync(proxiesFilePath, JSON.stringify(this.RAW_PROXIES, null, 2));
    return true;
  }

  getPROXIES() {
    return this.PROXIES;
  }
  
  removeAccountFromProxy(proxyUrl, ownId) {
    const proxy = this.PROXIES.find((p) => p.url === proxyUrl);
    if (proxy) {
      const accountIndex = proxy.accounts.findIndex((acc) => acc.ownId === ownId);
      if (accountIndex !== -1) {
        proxy.accounts.splice(accountIndex, 1);
        proxy.usedCount--;
        console.log(`Đã xóa tài khoản ${ownId} khỏi proxy ${proxyUrl}`);
      }
    }
  }
}

const proxyService = new ProxyService();

export { proxyService };
