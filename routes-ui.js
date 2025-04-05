// routes-ui.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { zaloAccounts, loginZaloAccount } from './api/zalo/zalo.js';
import { proxyService } from './proxyService.js';
import { broadcastLoginSuccess, wss, server } from './server.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'webhook-config.json');

router.get('/', (req, res) => {
  res.send(`
        <html>
          <body>
            <script>window.location.href = '/home';</script>
          </body>
        </html>
      `);
});

router.get('/home', (req, res) => {
  let accountsHtml = '<p>Chưa có tài khoản nào đăng nhập</p>';
  if (zaloAccounts.length > 0) {
    accountsHtml = '<table border="1"><thead><tr><th>Own ID</th><th>Phone Number</th><th>Proxy</th><th>Hành động</th></tr></thead><tbody>';
    zaloAccounts.forEach((account) => {
      accountsHtml += `
        <tr>
          <td>${account.ownId}</td>
          <td>${account.phoneNumber || 'N/A'}</td>
          <td>${account.proxy || 'Không có'}</td>
          <td>
            <form action="/deleteAccount" method="POST" style="display:inline;">
              <input type="hidden" name="ownId" value="${account.ownId}">
              <button type="submit" class="button delete-btn" onclick="return confirm('Bạn có chắc muốn xóa tài khoản ${account.ownId}?');">Xóa</button>
            </form>
          </td>
        </tr>`;
    });
    accountsHtml += '</tbody></table>';
  }
  accountsHtml += `
    <br>
    <a href="/login" class="button">Đăng nhập qua QR Code</a>
    <form action="/restartApp" method="POST" style="display:inline;">
      <button type="submit" class="button restart-btn" onclick="return confirm('Bạn có chắc muốn khởi động lại ứng dụng? Trang sẽ không phản hồi trong vài giây.');">Khởi động lại ứng dụng</button>
    </form>
  `;

  const proxies = proxyService.getPROXIES();
  let proxiesHtml = '<p>Chưa có proxy nào</p>';
  if (proxies.length > 0) {
    proxiesHtml = '<table border="1"><thead><tr><th>Proxy URL</th><th>Số tài khoản</th><th>Danh sách số điện thoại</th></tr></thead><tbody>';
    proxies.forEach((proxy) => {
      const accountsList =
        proxy.accounts.length > 0
          ? proxy.accounts.map((acc) => acc.phoneNumber || 'N/A').join(', ')
          : 'Chưa có';
      proxiesHtml += `<tr><td>${proxy.url}</td><td>${proxy.usedCount}</td><td>${accountsList}</td></tr>`;
    });
    proxiesHtml += '</tbody></table>';
  }
  proxiesHtml += `
    <br>
    <form action="/proxies" method="POST" style="display: inline;">
      <input type="text" name="proxyUrl" placeholder="Nhập proxy URL" required>
      <button type="submit" class="button">Thêm Proxy</button>
    </form>
    <form action="/proxies" method="POST" style="display: inline;">
      <input type="hidden" name="_method" value="DELETE">
      <input type="text" name="proxyUrl" placeholder="Nhập proxy URL để xóa" required>
      <button type="submit" class="button">Xóa Proxy</button>
    </form>
  `;

  let webhookConfigHtml = '<p>Chưa có cấu hình webhook</p>';
  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);
    webhookConfigHtml = `
      <ul>
        <li>Message Webhook: ${config.messageWebhookUrl || 'N/A'}</li>
        <li>Group Event Webhook: ${config.groupEventWebhookUrl || 'N/A'}</li>
        <li>Reaction Webhook: ${config.reactionWebhookUrl || 'N/A'}</li>
      </ul>
    `;
  } catch (error) {
    console.error('Lỗi khi đọc cấu hình webhook:', error);
  }
  webhookConfigHtml += '<br><a href="/updateWebhookForm" class="button">Cập nhật Webhook</a>';

  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <title>Zalo Bot - Trang Quản Lý</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #2c3e50; }
        .section { margin-bottom: 20px; }
        .button { 
          display: inline-block; 
          padding: 10px 20px; 
          margin: 5px; 
          background-color: #3498db; 
          color: white; 
          text-decoration: none; 
          border-radius: 5px; 
        }
        .button:hover { background-color: #2980b9; }
        .delete-btn { background-color: #e74c3c; }
        .delete-btn:hover { background-color: #c0392b; }
        .restart-btn { background-color: #f39c12; }
        .restart-btn:hover { background-color: #e67e22; }
        ul { line-height: 1.6; }
        table { border-collapse: collapse; width: 100%; max-width: 800px; margin-top: 10px; }
        th, td { padding: 8px; text-align: left; border: 1px solid #ddd; }
        th { background-color: #f2f2f2; }
      </style>
    </head>
    <body>
      <h1>Zalo Bot - Trang Quản Lý</h1>
      <div class="section">
        <h2>Danh sách tài khoản</h2>
        ${accountsHtml}
      </div>
      <div class="section">
        <h2>Danh sách Proxy hiện tại</h2>
        ${proxiesHtml}
      </div>
      <div class="section">
        <h2>Cấu hình Webhook hiện tại</h2>
        ${webhookConfigHtml}
      </div>
      <div class="section">
        <a href="/list" class="button" target="_blank">Tài liệu API</a>
      </div>
      <div class="section">
        <h2>Hướng dẫn giới hạn Zalo</h2>
        <ul>
          <li><strong>Thời gian nghỉ</strong> giữa 2 lần gửi tin nhắn: <em>60 - 150 giây</em></li>
          <li><strong>Giới hạn gửi tin nhắn/ngày</strong>:
            <ul>
              <li>TK lâu năm (>1 năm, chưa bị hạn chế): Bắt đầu <strong>30</strong>, tăng dần +20 mỗi 3 ngày, tối đa 150.</li>
              <li>TK mới: <strong>10 - 30</strong> tin nhắn/ngày.</li>
            </ul>
          </li>
          <li><strong>Giới hạn tìm số điện thoại/giờ</strong>:
            <ul>
              <li>TK cá nhân: 15 tin nhắn/60 phút.</li>
              <li>TK business: 30 tin nhắn/60 phút.</li>
            </ul>
          </li>
          <li><strong>Kết bạn</strong>: Không vượt quá <strong>30 - 35 người/ngày</strong> (tách riêng nếu gửi tin nhắn nhiều).</li>
        </ul>
      </div>
    </body>
    </html>
  `);
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
    const MAX_RETRIES = 3; // Số lần thử lại tối đa
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
                        </head>
                        <body>
                            <h2>Quét mã QR để đăng nhập</h2>
                            <img id="qrCode" src="${qrCodeImage}" alt="QR Code"/>
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
            return; // Thoát nếu thành công
        } catch (error) {
            if (error.message.includes('QR code đã hết hạn') && retryCount < MAX_RETRIES - 1) {
                console.log(`QR code hết hạn,试 lại lần ${retryCount + 1}/${MAX_RETRIES}`);
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
    res.send(`
      <html>
        <body>
          <script>window.location.href = '/home';</script>
        </body>
      </html>
    `);
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
      res.send(`
        <html>
          <body>
            <script>window.location.href = '/home';</script>
          </body>
        </html>
      `);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  } else {
    if (!proxyUrl || !proxyUrl.trim()) {
      return res.status(400).json({ success: false, error: 'proxyUrl không hợp lệ' });
    }
    try {
      const newProxy = proxyService.addProxy(proxyUrl);
      res.send(`
        <html>
          <body>
            <script>window.location.href = '/home';</script>
          </body>
        </html>
      `);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Route xử lý xóa tài khoản
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

  res.send(`
    <html>
      <body>
        <script>window.location.href = '/home';</script>
      </body>
    </html>
  `);
});

// Route xử lý khởi động lại ứng dụng
router.post('/restartApp', (req, res) => {
  console.log('Bắt đầu khởi động lại ứng dụng...');

  // 1. Dừng tất cả listener của zca-js
  zaloAccounts.forEach((account) => {
    if (account.api && account.api.listener) {
      account.api.listener.stop();
    }
  });

  // 2. Đóng WebSocket server
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.close();
    }
  });
  wss.close(() => {
    console.log('WebSocket server đã đóng');
  });

  // 3. Đóng và khởi động lại HTTP server
  server.close(async (err) => {
    if (err) {
      console.error('Lỗi khi đóng HTTP server:', err);
      res.status(500).send('Lỗi khi khởi động lại ứng dụng');
      return;
    }
    console.log('HTTP server đã đóng');

    // 4. Xóa danh sách tài khoản hiện tại
    while (zaloAccounts.length > 0) {
      zaloAccounts.pop();
    }

    // 5. Tải lại tài khoản từ cookies
    const cookiesDir = path.join(__dirname, 'cookies');
    if (fs.existsSync(cookiesDir)) {
      const cookieFiles = fs.readdirSync(cookiesDir);
      for (const file of cookieFiles) {
        if (file.startsWith('cred_') && file.endsWith('.json')) {
          const ownId = file.substring(5, file.length - 5);
          try {
            const cookie = JSON.parse(fs.readFileSync(`${cookiesDir}/${file}`, 'utf-8'));
            await loginZaloAccount(null, cookie); // Sử dụng await trong async context
            console.log(`Đã đăng nhập lại tài khoản ${ownId} từ cookie`);
          } catch (error) {
            console.error(`Lỗi khi đăng nhập lại tài khoản ${ownId}:`, error);
          }
        }
      }
    }

    // 6. Khởi động lại HTTP server
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
