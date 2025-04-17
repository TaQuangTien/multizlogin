import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { zaloAccounts, loginZaloAccount } from './api/zalo/zalo.js';
import { proxyService } from './proxyService.js';
import { broadcastLoginSuccess, wss, server } from './server.js';
import { basicAuth } from './middleware.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'webhook-config.json');
const proxiesPath = path.join(__dirname, 'proxies.json');
const cookiesDir = path.join(__dirname, 'cookies');

// Áp dụng middleware basicAuth cho tất cả các route giao diện
router.use(basicAuth);

router.get('/', (req, res) => {
  res.redirect('/home');
});

router.get('/home', (req, res) => {
  let accountsHtml = '<p class="text-muted">Chưa có tài khoản nào đăng nhập</p>';
  if (zaloAccounts.length > 0) {
    accountsHtml = `
      <table class="table table-bordered table-hover">
        <thead class="table-light">
          <tr>
            <th>Own ID</th>
            <th>Số điện thoại</th>
            <th>Proxy</th>
            <th>Hành động</th>
          </tr>
        </thead>
        <tbody>
    `;
    zaloAccounts.forEach((account) => {
      accountsHtml += `
        <tr>
          <td>${account.ownId}</td>
          <td>${account.phoneNumber || 'N/A'}</td>
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

  let webhookConfigHtml = '<p class="text-muted">Chưa có cấu hình webhook</p>';
  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);
    webhookConfigHtml = `
      <ul class="list-group">
        <li class="list-group-item">Message Webhook: ${config.messageWebhookUrl || 'N/A'}</li>
        <li class="list-group-item">Group Event Webhook: ${config.groupEventWebhookUrl || 'N/A'}</li>
        <li class="list-group-item">Reaction Webhook: ${config.reactionWebhookUrl || 'N/A'}</li>
      </ul>
    `;
  } catch (error) {
    console.error('Lỗi khi đọc cấu hình webhook:', error);
  }

  // Lấy danh sách file tài khoản trong thư mục cookies
  let accountFilesHtml = '<p class="text-muted">Chưa có file tài khoản nào</p>';
  try {
    const cookieFiles = fs.readdirSync(cookiesDir).filter((file) => file.startsWith('cred_') && file.endsWith('.json'));
    if (cookieFiles.length > 0) {
      accountFilesHtml = `
        <ul class="list-group">
          ${cookieFiles
            .map(
              (file) => `
                <li class="list-group-item d-flex justify-content-between align-items-center">
                  ${file}
                  <a href="/export/account/${file}" class="btn btn-primary btn-sm">Tải xuống</a>
                </li>`
            )
            .join('')}
        </ul>
      `;
    }
  } catch (error) {
    console.error('Lỗi khi đọc thư mục cookies:', error);
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Zalo Bot - Trang Quản Lý</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        body { background-color: #f8f9fa; }
        .card { margin-bottom: 20px; }
        .btn-custom { margin: 5px; }
      </style>
    </head>
    <body>
      <div class="container mt-4">
        <h1 class="mb-4 text-center">Zalo Bot - Trang Quản Lý</h1>        
        <!-- Tabs -->
        <ul class="nav nav-tabs mb-4" id="mainTab" role="tablist">
          <li class="nav-item" role="presentation">
            <button class="nav-link active" id="accounts-tab" data-bs-toggle="tab" data-bs-target="#accounts" type="button" role="tab">Tài khoản</button>
          </li>
          <li class="nav-item" role="presentation">
            <button class="nav-link" id="proxies-tab" data-bs-toggle="tab" data-bs-target="#proxies" type="button" role="tab">Proxy</button>
          </li>
          <li class="nav-item" role="presentation">
            <button class="nav-link" id="webhook-tab" data-bs-toggle="tab" data-bs-target="#webhook" type="button" role="tab">Webhook</button>
          </li>
          <li class="nav-item" role="presentation">
            <button class="nav-link" id="export-import-tab" data-bs-toggle="tab" data-bs-target="#export-import" type="button" role="tab">Export/Import</button>
          </li>
          <li class="nav-item" role="presentation">
            <button class="nav-link" id="guides-tab" data-bs-toggle="tab" data-bs-target="#guides" type="button" role="tab">Hướng dẫn</button>
          </li>
          <li class="nav-item">
          <a class="nav-link" href="/logout">Đăng xuất</a>
          </li>
        </ul>

        <!-- Tab Content -->
        <div class="tab-content" id="mainTabContent">
          <!-- Tài khoản -->
          <div class="tab-pane fade show active" id="accounts" role="tabpanel">
            <div class="card">
              <div class="card-header">
                <h5 class="card-title mb-0">Danh sách tài khoản</h5>
              </div>
              <div class="card-body">
                ${accountsHtml}
                <div class="mt-3">
                  <a href="/login" class="btn btn-primary btn-custom">Đăng nhập qua QR Code</a>
                  <form action="/restartApp" method="POST" class="d-inline">
                    <button type="submit" class="btn btn-warning btn-custom" onclick="return confirm('Bạn có chắc muốn khởi động lại ứng dụng? Trang sẽ không phản hồi trong vài giây.');">Khởi động lại ứng dụng</button>
                  </form>
                </div>
              </div>
            </div>
          </div>

          <!-- Proxy -->
          <div class="tab-pane fade" id="proxies" role="tabpanel">
            <div class="card">
              <div class="card-header">
                <h5 class="card-title mb-0">Danh sách Proxy</h5>
              </div>
              <div class="card-body">
                ${proxiesHtml}
                <div class="mt-3">
                  <form action="/proxies" method="POST" class="row g-3 align-items-center">
                    <div class="col-auto">
                      <input type="text" name="proxyUrl" class="form-control" placeholder="Nhập proxy URL" required>
                    </div>
                    <div class="col-auto">
                      <button type="submit" class="btn btn-success btn-custom">Thêm Proxy</button>
                    </div>
                  </form>
                  <form action="/proxies" method="POST" class="row g-3 align-items-center mt-2">
                    <input type="hidden" name="_method" value="DELETE">
                    <div class="col-auto">
                      <input type="text" name="proxyUrl" class="form-control" placeholder="Nhập proxy URL để xóa" required>
                    </div>
                    <div class="col-auto">
                      <button type="submit" class="btn btn-danger btn-custom">Xóa Proxy</button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>

          <!-- Webhook -->
          <div class="tab-pane fade" id="webhook" role="tabpanel">
            <div class="card">
              <div class="card-header">
                <h5 class="card-title mb-0">Cấu hình Webhook</h5>
              </div>
              <div class="card-body">
                ${webhookConfigHtml}
                <div class="mt-3">
                  <a href="/updateWebhookForm" class="btn btn-primary btn-custom">Cập nhật Webhook</a>
                </div>
              </div>
            </div>
          </div>

          <!-- Export/Import -->
          <div class="tab-pane fade" id="export-import" role="tabpanel">
            <div class="card">
              <div class="card-header">
                <h5 class="card-title mb-0">Export/Import dữ liệu</h5>
              </div>
              <div class="card-body">
                <h6>Danh sách tài khoản (Cookies)</h6>
                ${accountFilesHtml}
                <h6 class="mt-4">Proxies</h6>
                <a href="/export/proxies" class="btn btn-primary btn-sm mb-2">Tải proxies.json</a>
                <h6 class="mt-4">Webhook Config</h6>
                <a href="/export/webhook-config" class="btn btn-primary btn-sm mb-2">Tải webhook-config.json</a>
                <h6 class="mt-4">Import dữ liệu</h6>
                <form action="/import" method="POST" enctype="multipart/form-data" class="row g-3">
                  <div class="col-auto">
                    <input type="file" name="file" class="form-control" accept=".json" required>
                  </div>
                  <div class="col-auto">
                    <button type="submit" class="btn btn-success btn-custom">Tải lên</button>
                  </div>
                </form>
              </div>
            </div>
          </div>

          <!-- Hướng dẫn -->
          <div class="tab-pane fade" id="guides" role="tabpanel">
            <div class="card">
              <div class="card-header">
                <h5 class="card-title mb-0">Hướng dẫn giới hạn Zalo</h5>
              </div>
              <div class="card-body">
                <ul class="list-group">
                  <li class="list-group-item"><strong>Thời gian nghỉ</strong> giữa 2 lần gửi tin nhắn: <em>60 - 150 giây</em></li>
                  <li class="list-group-item"><strong>Giới hạn gửi tin nhắn/ngày</strong>:
                    <ul>
                      <li>TK lâu năm (>1 năm, chưa bị hạn chế): Bắt đầu <strong>30</strong>, tăng dần +20 mỗi 3 ngày, tối đa 150.</li>
                      <li>TK mới: <strong>10 - 30</strong> tin nhắn/ngày.</li>
                    </ul>
                  </li>
                  <li class="list-group-item"><strong>Giới hạn tìm số điện thoại/giờ</strong>:
                    <ul>
                      <li>TK cá nhân: 15 tin nhắn/60 phút.</li>
                      <li>TK business: 30 tin nhắn/60 phút.</li>
                    </ul>
                  </li>
                  <li class="list-group-item"><strong>Kết bạn</strong>: Không vượt quá <strong>30 - 35 người/ngày</strong> (tách riêng nếu gửi tin nhắn nhiều).</li>
                </ul>
                <div class="mt-3">
                  <a href="/list" class="btn btn-primary btn-custom" target="_blank">Tài liệu API</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
    </body>
    </html>
  `);
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

// Export webhook-config.json
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
  } else if (filename === 'webhook-config.json') {
    targetPath = configPath;
  } else if (filename.startsWith('cred_') && filename.endsWith('.json')) {
    targetPath = path.join(cookiesDir, filename);
  } else {
    return res.status(400).json({ success: false, error: 'File không hợp lệ. Chỉ hỗ trợ proxies.json, webhook-config.json hoặc file tài khoản (cred_*.json)' });
  }

  file.mv(targetPath, (err) => {
    if (err) {
      console.error('Lỗi khi lưu file:', err);
      return res.status(500).json({ success: false, error: 'Lỗi khi lưu file' });
    }

    // Nếu là file tài khoản, thử đăng nhập lại
    if (filename.startsWith('cred_') && filename.endsWith('.json')) {
      const ownId = filename.substring(5, filename.length - 5);
      try {
        const cookie = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
        loginZaloAccount(null, cookie)
          .then(() => {
            console.log(`Đã đăng nhập lại tài khoản ${ownId} từ file import`);
          })
          .catch((error) => {
            console.error(`Lỗi khi đăng nhập tài khoản ${ownId}:`, error);
          });
      } catch (error) {
        console.error(`Lỗi khi đọc file ${filename}:`, error);
      }
    }

    // Gửi phản hồi với alert và chuyển hướng sau 10 giây
    res.send(`
      <html>
        <body>
          <script>
            alert('Đang upload file, refresh trang sau 10 giây');
            setTimeout(function() {
              window.location.href = '/home';
            }, 10000);
          </script>
        </body>
      </html>
    `);

    // Perform application restart after 10 seconds
    setTimeout(() => {
      console.log('Bắt đầu khởi động lại ứng dụng sau khi import...');

      // Đóng các tài khoản Zalo hiện tại
      zaloAccounts.forEach((account) => {
        if (account.api && account.api.listener) {
          account.api.listener.stop();
        }
      });

      // Đóng tất cả các kết nối WebSocket
      wss.clients.forEach((client) => {
        if (client.readyState === client.OPEN) {
          client.close();
        }
      });

      wss.close(() => {
        console.log('WebSocket server đã đóng');
      });

      server.close(async (err) => {
        if (err) {
          console.error('Lỗi khi đóng HTTP server:', err);
          return;
        }
        console.log('HTTP server đã đóng');

        // Xóa danh sách tài khoản
        while (zaloAccounts.length > 0) {
          zaloAccounts.pop();
        }

        // Tải lại các tài khoản từ cookies
        const cookiesDir = path.join(__dirname, 'cookies');
        if (fs.existsSync(cookiesDir)) {
          const cookieFiles = fs.readdirSync(cookiesDir);
          for (const file of cookieFiles) {
            if (file.startsWith('cred_') && file.endsWith('.json')) {
              const ownId = file.substring(5, file.length - 5);
              try {
                const cookie = JSON.parse(fs.readFileSync(`${cookiesDir}/${file}`, 'utf-8'));
                await loginZaloAccount(null, cookie);
                console.log(`Đã đăng nhập lại tài khoản ${ownId} từ cookie`);
              } catch (error) {
                console.error(`Lỗi khi đăng nhập lại tài khoản ${ownId}:`, error);
              }
            }
          }
        }

        // Khởi động lại server
        server.listen(3000, '0.0.0.0', () => {
          console.log('HTTP server đã khởi động lại');
        });
      });
    }, 10000);
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

router.get('/login', (req, res) => {
  const loginFile = path.join(__dirname, 'login.html');
  fs.readFile(loginFile, 'utf8', (err, data) => {
    if (err) {
      console.error('Lỗi khi đọc file login.html:', err);
      return res.status(500).send('Không thể tải trang đăng nhập.');
    }
    res.send(data);
  });
});

router.post('/login', async (req, res) => {
  const MAX_RETRIES = 3;
  let retryCount = 0;

  while (retryCount < MAX_RETRIES) {
    try {
      const { proxy } = req.body;
      const qrCodeImage = await loginZaloAccount(proxy || null, null);
      res.send(`
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Quét mã QR</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
          </head>
          <body class="container mt-4">
            <h2>Quét mã QR để đăng nhập</h2>
            <img id="qrCode" src="${qrCodeImage}" alt="QR Code" class="img-fluid"/>
            <button id="retryButton" class="btn btn-primary mt-3" style="display: none;" onclick="location.reload();">Thử lại</button>
            <script>
              const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
              const host = window.location.host;
              const socket = new WebSocket(protocol + '//' + host);
              socket.onmessage = function(event) {
                console.log('Received:', event.data);
                if (event.data === 'login_success') {
                  alert('Đăng nhập thành công. Tự động chuyển về Home sau 5 giây');
                  setTimeout(function() {
                    window.location.href = '/home';
                  }, 5000);
                } else if (event.data === 'qr_expired') {
                  alert('Mã QR đã hết hạn.');
                  document.getElementById('retryButton').style.display = 'block';
                }
              };
            </script>
          </body>
        </html>
      `);
      return;
    } catch (error) {
      if (error.message.includes('QR code đã hết hạn') && retryCount < MAX_RETRIES - 1) {
        console.log(`QR code hết hạn, thử lại lần ${retryCount + 1}/${MAX_RETRIES}`);
        retryCount++;
        continue;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }
  }
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
    res.send(data);
  });
});

router.post('/updateWebhook', (req, res) => {
  const { messageWebhookUrl, groupEventWebhookUrl, reactionWebhookUrl } = req.body;
  if (!messageWebhookUrl || !messageWebhookUrl.startsWith('http')) {
    return res.status(400).json({ success: false, error: 'messageWebhookUrl không hợp lệ' });
  }
  if (!groupEventWebhookUrl || !groupEventWebhookUrl.startsWith('http')) {
    return res.status(400).json({ success: false, error: 'groupEventWebhookUrl không hợp lệ' });
  }
  if (!reactionWebhookUrl || !reactionWebhookUrl.startsWith('http')) {
    return res.status(400).json({ success: false, error: 'reactionWebhookUrl không hợp lệ' });
  }
  const config = { messageWebhookUrl, groupEventWebhookUrl, reactionWebhookUrl };
  fs.writeFile(configPath, JSON.stringify(config, null, 2), (err) => {
    if (err) {
      console.error('Lỗi khi ghi file cấu hình:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
    res.redirect('/home');
  });
});

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

  const cookieFile = path.join(__dirname, 'cookies', `cred_${ownId}.json`);
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

  server.close(async (err) => {
    if (err) {
      console.error('Lỗi khi đóng HTTP server:', err);
      res.status(500).send('Lỗi khi khởi động lại ứng dụng');
      return;
    }
    console.log('HTTP server đã đóng');

    while (zaloAccounts.length > 0) {
      zaloAccounts.pop();
    }

    const cookiesDir = path.join(__dirname, 'cookies');
    if (fs.existsSync(cookiesDir)) {
      const cookieFiles = fs.readdirSync(cookiesDir);
      for (const file of cookieFiles) {
        if (file.startsWith('cred_') && file.endsWith('.json')) {
          const ownId = file.substring(5, file.length - 5);
          try {
            const cookie = JSON.parse(fs.readFileSync(`${cookiesDir}/${file}`, 'utf-8'));
            await loginZaloAccount(null, cookie);
            console.log(`Đã đăng nhập lại tài khoản ${ownId} từ cookie`);
          } catch (error) {
            console.error(`Lỗi khi đăng nhập lại tài khoản ${ownId}:`, error);
          }
        }
      }
    }

    server.listen(3000, '0.0.0.0', () => {
      console.log('HTTP server đã khởi động lại');
      res.send(`
        <html>
          <body>
            <script>
              alert('Ứng dụng đã được khởi động lại thành công!');
              window.location.href = '/home';
            </script>
          </body>
        </html>
      `);
    });
  });
});

export default router;