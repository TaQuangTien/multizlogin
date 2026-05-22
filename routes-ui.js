import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { zaloAccounts, loginZaloAccount } from './api/zalo/zalo.js';
import { proxyService } from './proxyService.js';
import { broadcastLoginSuccess, broadcastEvent, wss, server } from './server.js';
import { basicAuth } from './middleware.js';
import { startSeleniumLogin, pollLoginStatus, stopSelenium } from './seleniumService.js';
import { getWebhookConfigs, getFullWebhookConfig } from './helpers.js';


const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'zalo_data', 'webhook-config.json');
const multiWebhookPath = '/app/zalo_data/webhooks.json';
const proxiesPath = path.join(__dirname, 'zalo_data', 'proxies.json');
const cookiesDir = '/app/cookies';

// Load application version from environment variable, with fallback to package.json
let appVersion = process.env.APP_VERSION;
if (!appVersion) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    appVersion = pkg.version;
  } catch (e) {
    appVersion = '4.20260522';
  }
}

// Persistent per-account log system (JSON files, 1000 lines/account)
const LOGS_DIR = '/app/zalo_data/logs';

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function getLogFilePath(ownId) {
  ensureLogsDir();
  const safeName = ownId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(LOGS_DIR, `${safeName}.json`);
}

function loadLogs(ownId) {
  const filePath = getLogFilePath(ownId);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
}

function saveLogs(ownId, logs) {
  const filePath = getLogFilePath(ownId);
  fs.writeFileSync(filePath, JSON.stringify(logs, null, 2), 'utf8');
}

function getLastEvent(ownId) {
  const logs = loadLogs(ownId);
  if (logs.length === 0) return null;
  return logs[logs.length - 1];
}

export function addLog(action, details, ownId = 'System', extraData = null, threadId = '', senderId = '') {
  const logs = loadLogs(ownId);
  const logEntry = {
    timestamp: new Date().toLocaleString('vi-VN'),
    action,
    details,
    ownId,
    threadId: threadId || '',
    senderId: senderId || '',
    data: extraData ? JSON.stringify(extraData) : ''
  };
  logs.push(logEntry);
  if (logs.length > 1000) {
    logs.splice(0, logs.length - 1000);
  }
  saveLogs(ownId, logs);
}
addLog('System', 'Ứng dụng đã khởi động');

// Khởi tạo file cấu hình mặc định nếu chưa tồn tại
const zaloDataDir = path.join(__dirname, 'zalo_data');
if (!fs.existsSync(zaloDataDir)) {
  fs.mkdirSync(zaloDataDir, { recursive: true });
}
if (!fs.existsSync(proxiesPath)) {
  fs.writeFileSync(proxiesPath, JSON.stringify([], null, 2));
}
/* Legacy webhook-config.json initialization
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify({
    messageWebhookUrl: '',
    groupEventWebhookUrl: '',
    reactionWebhookUrl: '',
    connectionWebhookUrl: ''
  }, null, 2));
}
*/

// Áp dụng middleware basicAuth cho tất cả các route giao diện
router.use(basicAuth);

router.get('/', (req, res) => {
  res.redirect('/home');
});

router.get('/home', async (req, res) => {
  // Lấy tên tài khoản song song cho các tài khoản đang online
  if (zaloAccounts.length > 0) {
    await Promise.all(
      zaloAccounts.map(async (account) => {
        if (account.online && account.api) {
          try {
            const info = await account.api.getUserInfo(account.ownId);
            if (info) {
              const profile = info.changed_profiles?.[account.ownId] || info;
              const name = profile.zaloName || profile.displayName || profile.name;
              if (name) {
                account.accountName = name;
              }
            }
          } catch (error) {
            console.error(`Lỗi khi lấy tên tài khoản cho ${account.ownId}:`, error.message);
          }
        }
      })
    );
  }

  let accountsHtml = '<p class="text-muted">Chưa có tài khoản nào đăng nhập</p>';
  if (zaloAccounts.length > 0) {
    accountsHtml = `
      <table class="table table-bordered table-hover">
        <thead class="table-light">
          <tr>
            <th>Own ID</th>
            <th>Tên tài khoản</th>
            <th>Số điện thoại</th>
            <th>Online</th>
            <th>Sự kiện cuối</th>
            <th>Proxy</th>
            <th>Hành động</th>
          </tr>
        </thead>
        <tbody>
    `;
    zaloAccounts.forEach((account) => {
      const onlineBadge = account.online
        ? '<span class="badge bg-success">Online</span>'
        : '<span class="badge bg-danger">Offline</span>';
      const lastCheck = account.lastCheck
        ? new Date(account.lastCheck).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
        : 'N/A';
      const lastEvent = getLastEvent(account.ownId);
      let lastEventHtml = '<span class="text-muted" style="font-size:11px;">Chưa có</span>';
      if (lastEvent) {
        lastEventHtml = `<span class="badge bg-info" style="font-size:11px;">${lastEvent.action}</span> <small class="text-muted" style="font-size:11px;">${lastEvent.timestamp}</small>`;
      }

      accountsHtml += `
        <tr>
          <td>${account.ownId}</td>
          <td><strong class="text-primary">${account.accountName || 'N/A'}</strong></td>
          <td>${account.phoneNumber || 'N/A'}</td>
          <td>${onlineBadge}<br><small class="text-muted" style="font-size:11px;">${lastCheck}</small></td>
          <td style="max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${lastEventHtml}</td>
          <td>${account.proxy || 'Không có'}</td>
          <td>
            <form action="/deleteAccount" method="POST" class="d-inline">
              <input type="hidden" name="ownId" value="${account.ownId}">
              <button type="submit" class="btn btn-danger btn-sm" onclick="return confirm('Bạn có chắc muốn xóa tài khoản ${account.ownId}?');">Xóa</button>
            </form>
          </td>
        </tr>`;
    });
    accountsHtml += '</tbody></table>';
  }

  const proxies = proxyService.getPROXIES();
  let proxiesHtml = '<p class="text-muted">Chưa có proxy nào</p>';
  if (proxies.length > 0) {
    proxiesHtml = `
      <table class="table table-bordered table-hover">
        <thead class="table-light">
          <tr>
            <th>Proxy URL</th>
            <th>Số tài khoản</th>
            <th>Danh sách số điện thoại</th>
          </tr>
        </thead>
        <tbody>
    `;
    proxies.forEach((proxy) => {
      const accountsList =
        proxy.accounts.length > 0
          ? proxy.accounts.map((acc) => acc.phoneNumber || 'N/A').join(', ')
          : 'Chưa có';
      proxiesHtml += `
        <tr>
          <td>${proxy.url}</td>
          <td>${proxy.usedCount}</td>
          <td>${accountsList}</td>
        </tr>`;
    });
    proxiesHtml += '</tbody></table>';
  }

  // Per-account webhook config table
  let webhooksHtml = `
    <div class="table-responsive">
      <table class="table table-hover align-middle mb-0">
        <thead class="bg-light">
          <tr>
            <th>Tài khoản</th>
            <th>URL Webhook (GAS)</th>
            <th>Sự kiện</th>
            <th>Pull Tasks</th>
            <th class="text-end">Thao tác</th>
          </tr>
        </thead>
        <tbody>
  `;
  if (zaloAccounts.length > 0) {
    zaloAccounts.forEach((account) => {
      const configs = getWebhookConfigs(account.ownId);
      configs.forEach((cfg, idx) => {
        webhooksHtml += `
          <tr>
            <form action="/updateAccountWebhook" method="POST">
              <input type="hidden" name="ownId" value="${account.ownId}">
              <input type="hidden" name="index" value="${idx}">
              <td>
                <span class="fw-bold">${account.ownId}</span>
                <div class="small text-muted">${account.phoneNumber || ''}</div>
                <span class="badge bg-secondary">Webhook #${idx + 1}</span>
              </td>
              <td><input type="url" name="url" class="form-control form-control-sm" value="${cfg.url || ''}" placeholder="https://script.google.com/..." required></td>
              <td>
                <div class="form-check form-check-inline mb-0">
                  <input class="form-check-input" type="checkbox" name="receiveReaction" id="reac_${account.ownId}_${idx}" ${cfg.settings?.receiveReaction !== false ? 'checked' : ''}>
                  <label class="form-check-label small" for="reac_${account.ownId}_${idx}">Reaction</label>
                </div>
                <div class="form-check form-check-inline mb-0">
                  <input class="form-check-input" type="checkbox" name="receiveGroupEvent" id="group_${account.ownId}_${idx}" ${cfg.settings?.receiveGroupEvent !== false ? 'checked' : ''}>
                  <label class="form-check-label small" for="group_${account.ownId}_${idx}">Group</label>
                </div>
              </td>
              <td>
                <div class="form-check form-switch">
                  <input class="form-check-input" type="checkbox" name="pullMode" id="pull_${account.ownId}_${idx}" ${cfg.pullMode ? 'checked' : ''}>
                  <label class="form-check-label small" for="pull_${account.ownId}_${idx}">Kích hoạt</label>
                </div>
              </td>
              <td class="text-end">
                <button type="submit" name="action" value="save" class="btn btn-primary btn-sm px-2 me-1">Lưu</button>
                <button type="submit" name="action" value="delete" class="btn btn-danger btn-sm px-2" onclick="return confirm('Bạn có chắc muốn xóa webhook này?');">Xóa</button>
              </td>
            </form>
          </tr>
        `;
      });

      // Add new webhook row
      webhooksHtml += `
        <tr class="table-light border-bottom">
          <form action="/addAccountWebhook" method="POST">
            <input type="hidden" name="ownId" value="${account.ownId}">
            <td>
              <span class="fw-bold text-muted">${account.ownId}</span>
              <div class="small text-muted">${account.phoneNumber || ''}</div>
              <span class="badge bg-success">Thêm mới</span>
            </td>
            <td><input type="url" name="url" class="form-control form-control-sm" placeholder="https://script.google.com/... (Nhập URL mới)" required></td>
            <td>
              <div class="form-check form-check-inline mb-0">
                <input class="form-check-input" type="checkbox" name="receiveReaction" id="reac_add_${account.ownId}" checked>
                <label class="form-check-label small" for="reac_add_${account.ownId}">Reaction</label>
              </div>
              <div class="form-check form-check-inline mb-0">
                <input class="form-check-input" type="checkbox" name="receiveGroupEvent" id="group_add_${account.ownId}" checked>
                <label class="form-check-label small" for="group_add_${account.ownId}">Group</label>
              </div>
            </td>
            <td>
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" name="pullMode" id="pull_add_${account.ownId}">
                <label class="form-check-label small" for="pull_add_${account.ownId}">Kích hoạt</label>
              </div>
            </td>
            <td class="text-end"><button type="submit" class="btn btn-success btn-sm px-3">Thêm</button></td>
          </form>
        </tr>
      `;
    });
  } else {
    webhooksHtml += '<tr><td colspan="5" class="text-center py-4 text-muted">Chưa có tài khoản nào đăng nhập</td></tr>';
  }
  webhooksHtml += '</tbody></table></div>';

  // Lấy danh sách file tài khoản trong thư mục cookies
  let accountFilesHtml = '<div class="alert alert-info py-2"><i class="bi bi-info-circle me-2"></i>Hệ thống chưa có tệp phiên làm việc (session)</div>';
  try {
    if (!fs.existsSync(cookiesDir)) {
      fs.mkdirSync(cookiesDir, { recursive: true });
    }
    const cookieFiles = fs.readdirSync(cookiesDir).filter((file) => file.startsWith('cred_') && file.endsWith('.json'));
    if (cookieFiles.length > 0) {
      accountFilesHtml = `
        <div class="list-group">
          ${cookieFiles
            .map(
              (file) => `
                <div class="list-group-item d-flex justify-content-between align-items-center p-3">
                  <div>
                    <i class="bi bi-file-earmark-code me-2 text-primary"></i>
                    <span class="font-monospace small">${file}</span>
                  </div>
                  <a href="/export/account/${file}" class="btn btn-outline-primary btn-sm">
                    <i class="bi bi-download me-1"></i> Tải xuống
                  </a>
                </div>`
            )
            .join('')}
        </div>
      `;
    }
  } catch (error) {
    console.error('Lỗi khi đọc thư mục cookies:', error);
  }

  // Build ownId options for n8n template wizard
  let n8nOwnIdOptions = '<option value="">-- Không chọn (nhập thủ công) --</option>';
  zaloAccounts.forEach((acc) => {
    n8nOwnIdOptions += '<option value="' + acc.ownId + '">' + acc.ownId + ' (' + (acc.phoneNumber || 'N/A') + ')</option>';
  });

  try {
    const homeHtmlPath = path.join(__dirname, 'home.html');
    let html = fs.readFileSync(homeHtmlPath, 'utf8');
    html = html
      .replaceAll('{{ACCOUNTS_HTML}}', accountsHtml)
      .replaceAll('{{PROXIES_HTML}}', proxiesHtml)
      .replaceAll('{{WEBHOOKS_HTML}}', webhooksHtml)
      .replaceAll('{{ACCOUNT_FILES_HTML}}', accountFilesHtml)
      .replaceAll('{{N8N_OWN_ID_OPTIONS}}', n8nOwnIdOptions)
      .replaceAll('{{X_API_KEY}}', process.env.X_API_KEY || '')
      .replaceAll('{{ADMIN_USERNAME}}', process.env.ADMIN_USERNAME || '')
      .replaceAll('{{ADMIN_PASSWORD}}', process.env.ADMIN_PASSWORD || '')
      .replaceAll('{{APP_VERSION}}', appVersion);
    res.send(html);
  } catch (error) {
    console.error('Lỗi khi đọc file home.html:', error);
    res.status(500).send('Lỗi máy chủ nội bộ: Không thể tải giao diện.');
  }
});

// Export file tài khoản
router.get('/export/account/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(cookiesDir, filename);
  if (!filename.startsWith('cred_') || !filename.endsWith('.json') || !fs.existsSync(filePath)) {
    return res.status(404).send('File không tồn tại hoặc không hợp lệ');
  }
  res.download(filePath, filename, (err) => {
    if (err) {
      console.error('Lỗi khi tải file:', err);
      res.status(500).send('Lỗi khi tải file');
    }
  });
});

// Export proxies.json
router.get('/export/proxies', (req, res) => {
  if (!fs.existsSync(proxiesPath)) {
    return res.status(404).send('File proxies.json không tồn tại');
  }
  res.download(proxiesPath, 'proxies.json', (err) => {
    if (err) {
      console.error('Lỗi khi tải file:', err);
      res.status(500).send('Lỗi khi tải file');
    }
  });
});

// Export webhooks.json
router.get('/export/webhooks', (req, res) => {
  if (!fs.existsSync(multiWebhookPath)) {
    return res.status(404).send('File webhooks.json không tồn tại');
  }
  res.download(multiWebhookPath, 'webhooks.json', (err) => {
    if (err) {
      console.error('Lỗi khi tải file:', err);
      res.status(500).send('Lỗi khi tải file');
    }
  });
});

/* Legacy webhook-config export
router.get('/export/webhook-config', (req, res) => {
  if (!fs.existsSync(configPath)) {
    return res.status(404).send('File webhook-config.json không tồn tại');
  }
  res.download(configPath, 'webhook-config.json', (err) => {
    if (err) {
      console.error('Lỗi khi tải file:', err);
      res.status(500).send('Lỗi khi tải file');
    }
  });
});
*/

// Import file
router.post('/import', (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).json({ success: false, error: 'Vui lòng chọn file JSON để tải lên' });
  }

  const file = req.files.file;
  const filename = file.name;

  let targetPath;
  if (filename === 'proxies.json') {
    targetPath = proxiesPath;
  } else if (filename === 'webhooks.json') {
    targetPath = multiWebhookPath;
  } else if (filename.startsWith('cred_') && filename.endsWith('.json')) {
    targetPath = path.join(cookiesDir, filename);
  } else {
    return res.status(400).json({ success: false, error: 'File không hợp lệ. Chỉ hỗ trợ proxies.json, webhooks.json hoặc file tài khoản (cred_*.json)' });
  }

  file.mv(targetPath, async (err) => {
    if (err) {
      console.error('Lỗi khi lưu file:', err);
      return res.status(500).json({ success: false, error: 'Lỗi khi lưu file' });
    }

    // Nếu import cred_*.json — login ngay, không restart container
    if (filename.startsWith('cred_') && filename.endsWith('.json')) {
      const ownId = filename.substring(5, filename.length - 5);
      try {
        const cookie = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
        await loginZaloAccount(null, cookie, (event) => {
          broadcastEvent('zalo_status', { ownId, ...event });
        });
        addLog('Auth', `Tài khoản ${ownId} đã được import và đăng nhập`);
      } catch (loginError) {
        console.error(`Lỗi đăng nhập tài khoản ${ownId} sau import:`, loginError.message);
        addLog('Auth Error', `Lỗi đăng nhập tài khoản ${ownId} sau import: ${loginError.message}`);
      }
      // redirect luôn, không restart
      return res.redirect('/home');
    }

    // Import proxies.json hoặc webhook-config.json — redirect ngay (đọc từ disk real-time)
    return res.redirect('/home');
  });
});

router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    res.redirect('/home');
  });
});

router.get('/updateWebhookForm', (req, res) => {
  const docFile = path.join(__dirname, 'updateWebhookForm.html');
  fs.readFile(docFile, 'utf8', (err, data) => {
    if (err) {
      console.error('Lỗi khi đọc file tài liệu:', err);
      return res.status(500).send('Không thể tải tài liệu API.');
    }
    res.send(data);
  });
});

router.get('/list', (req, res) => {
  const docFile = path.join(__dirname, 'api-doc.html');
  fs.readFile(docFile, 'utf8', (err, data) => {
    if (err) {
      console.error('Lỗi khi đọc file tài liệu:', err);
      return res.status(500).send('Không thể tải tài liệu API.');
    }
    const html = data.replaceAll('{{APP_VERSION}}', appVersion);
    res.send(html);
  });
});

router.post('/updateAccountWebhook', (req, res) => {
  const { ownId, url, receiveReaction, receiveGroupEvent, pullMode, index, action } = req.body;
  if (!ownId || index === undefined) {
    return res.status(400).json({ error: 'ownId và index là bắt buộc' });
  }
  try {
    const config = getFullWebhookConfig();
    if (!config[ownId] || !Array.isArray(config[ownId])) {
      config[ownId] = [];
    }
    const idx = parseInt(index, 10);
    if (action === 'delete') {
      if (idx >= 0 && idx < config[ownId].length) {
        config[ownId].splice(idx, 1);
      }
    } else {
      if (!url) {
        return res.status(400).json({ error: 'url là bắt buộc' });
      }
      const updatedWebhook = {
        url,
        settings: {
          receiveReaction: receiveReaction === 'on',
          receiveGroupEvent: receiveGroupEvent === 'on'
        },
        pullMode: pullMode === 'on'
      };
      if (idx >= 0 && idx < config[ownId].length) {
        config[ownId][idx] = updatedWebhook;
      }
    }
    fs.writeFileSync(multiWebhookPath, JSON.stringify(config, null, 4), 'utf8');
    res.redirect('/home');
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/addAccountWebhook', (req, res) => {
  const { ownId, url, receiveReaction, receiveGroupEvent, pullMode } = req.body;
  if (!ownId || !url) {
    return res.status(400).json({ error: 'ownId và url là bắt buộc' });
  }
  try {
    const config = getFullWebhookConfig();
    if (!config[ownId] || !Array.isArray(config[ownId])) {
      config[ownId] = [];
    }
    const newWebhook = {
      url,
      settings: {
        receiveReaction: receiveReaction === 'on',
        receiveGroupEvent: receiveGroupEvent === 'on'
      },
      pullMode: pullMode === 'on'
    };
    config[ownId].push(newWebhook);
    fs.writeFileSync(multiWebhookPath, JSON.stringify(config, null, 4), 'utf8');
    res.redirect('/home');
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/logs', (req, res) => {
  try {
    ensureLogsDir();
    const files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.json'));
    const allLogs = [];
    for (const file of files) {
      try {
        const logs = JSON.parse(fs.readFileSync(path.join(LOGS_DIR, file), 'utf8'));
        allLogs.push(...logs);
      } catch {}
    }
    // Sort by timestamp descending (newest first)
    allLogs.sort((a, b) => {
      const ta = a.timestamp || '';
      const tb = b.timestamp || '';
      return ta.localeCompare(tb);
    });
    res.json({ success: true, logs: allLogs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /logs — clear all log files
router.delete('/logs', (req, res) => {
  try {
    ensureLogsDir();
    const files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      fs.unlinkSync(path.join(LOGS_DIR, file));
    }
    res.json({ success: true, message: 'Đã xoá tất cả logs' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/* Legacy updateWebhook route
router.post('/updateWebhook', (req, res) => {
  const { messageWebhookUrl, groupEventWebhookUrl, reactionWebhookUrl, connectionWebhookUrl } = req.body;
  const config = { 
      messageWebhookUrl, 
      groupEventWebhookUrl, 
      reactionWebhookUrl,
      connectionWebhookUrl
  };
  fs.writeFile(configPath, JSON.stringify(config, null, 2), (err) => {
    if (err) {
      console.error('Lỗi khi ghi file cấu hình:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
    res.redirect('/home');
  });
});
*/

router.get('/proxies', (req, res) => {
  res.json({ success: true, data: proxyService.getPROXIES() });
});

router.post('/proxies', (req, res) => {
  const { proxyUrl, _method } = req.body;
  if (_method === 'DELETE') {
    if (!proxyUrl || !proxyUrl.trim()) {
      return res.status(400).json({ success: false, error: 'proxyUrl không hợp lệ' });
    }
    try {
      proxyService.removeProxy(proxyUrl);
      res.redirect('/home');
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  } else {
    if (!proxyUrl || !proxyUrl.trim()) {
      return res.status(400).json({ success: false, error: 'proxyUrl không hợp lệ' });
    }
    try {
      proxyService.addProxy(proxyUrl);
      res.redirect('/home');
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

router.post('/deleteAccount', (req, res) => {
  const { ownId } = req.body;
  if (!ownId) {
    return res.status(400).json({ success: false, error: 'ownId không hợp lệ' });
  }

  const accountIndex = zaloAccounts.findIndex((acc) => acc.ownId === ownId);
  if (accountIndex === -1) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' });
  }

  const account = zaloAccounts[accountIndex];
  if (account.api && account.api.listener) {
    account.api.listener.stop();
  }

  const cookieFile = path.join(cookiesDir, `cred_${ownId}.json`);
  if (fs.existsSync(cookieFile)) {
    fs.unlinkSync(cookieFile);
    console.log(`Đã xóa file cookie cho tài khoản ${ownId}`);
  }

  zaloAccounts.splice(accountIndex, 1);
  console.log(`Đã xóa tài khoản ${ownId} khỏi hệ thống`);

  if (account.proxy) {
    proxyService.removeAccountFromProxy(account.proxy, ownId);
  }

  res.redirect('/home');
});

router.post('/restartApp', (req, res) => {
  console.log('Bắt đầu khởi động lại ứng dụng...');
  stopSelenium();

  zaloAccounts.forEach((account) => {
    if (account.api && account.api.listener) {
      account.api.listener.stop();
    }
  });

  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.close();
    }
  });
  wss.close(() => {
    console.log('WebSocket server đã đóng');
  });

  setTimeout(() => {
    console.log("Tự khởi động lại container...");
    process.exit(1);
  }, 10000);  
});

// Selenium API Routes
router.post('/api/selenium/start', async (req, res) => {
  const result = await startSeleniumLogin();
  res.json(result);
});

router.get('/api/selenium/status', async (req, res) => {
  const result = await pollLoginStatus();
  res.json(result);
});

router.post('/api/selenium/stop', async (req, res) => {
  await stopSelenium();
  res.json({ success: true });
});

router.post('/api/selenium/finish', async (req, res) => {
  try {
    const cred = req.body;
    // Sử dụng loginZaloAccount của zalo.js để tải profile và lưu file
    await loginZaloAccount(null, cred, (event) => {
        broadcastEvent('zalo_login_status', event);
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await stopSelenium();
  }
});

export default router;

