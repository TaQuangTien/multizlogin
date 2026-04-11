import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { zaloAccounts, loginZaloAccount } from './api/zalo/zalo.js';
import { proxyService } from './proxyService.js';
import { broadcastLoginSuccess, broadcastEvent, wss, server } from './server.js';
import { basicAuth } from './middleware.js';
import { startSeleniumLogin, pollLoginStatus, stopSelenium } from './seleniumService.js';


const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'zalo_data', 'webhook-config.json');
const multiWebhookPath = '/app/zalo_data/webhooks.json';
const proxiesPath = path.join(__dirname, 'zalo_data', 'proxies.json');
const cookiesDir = '/app/cookies';

// In-memory log system
export let eventLogs = [];
export function addLog(action, details, ownId = 'System', extraData = null) {
  const logEntry = {
    timestamp: new Date().toLocaleString('vi-VN'),
    action,
    details,
    ownId,
    data: extraData ? JSON.stringify(extraData) : ''
  };
  eventLogs.push(logEntry);
  if (eventLogs.length > 1000000) {
    eventLogs = eventLogs.slice(-900000);
  }
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
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify({
    messageWebhookUrl: '',
    groupEventWebhookUrl: '',
    reactionWebhookUrl: '',
    connectionWebhookUrl: ''
  }, null, 2));
}

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

  // Per-account webhook config table
  let perAccountWebhooks = {};
  try {
    if (fs.existsSync(multiWebhookPath)) {
      perAccountWebhooks = JSON.parse(fs.readFileSync(multiWebhookPath, 'utf8'));
    }
  } catch (e) {}

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
      const cfg = perAccountWebhooks[account.ownId] || { url: '', settings: { receiveReaction: true, receiveGroupEvent: true }, pullMode: false };
      webhooksHtml += `
        <tr>
          <form action="/updateAccountWebhook" method="POST">
            <input type="hidden" name="ownId" value="${account.ownId}">
            <td><span class="fw-bold">${account.ownId}</span><div class="small text-muted">${account.phoneNumber || ''}</div></td>
            <td><input type="url" name="url" class="form-control form-control-sm" value="${cfg.url || ''}" placeholder="https://script.google.com/..."></td>
            <td>
              <div class="form-check form-check-inline mb-0">
                <input class="form-check-input" type="checkbox" name="receiveReaction" id="reac_${account.ownId}" ${cfg.settings?.receiveReaction !== false ? 'checked' : ''}>
                <label class="form-check-label small" for="reac_${account.ownId}">Reaction</label>
              </div>
              <div class="form-check form-check-inline mb-0">
                <input class="form-check-input" type="checkbox" name="receiveGroupEvent" id="group_${account.ownId}" ${cfg.settings?.receiveGroupEvent !== false ? 'checked' : ''}>
                <label class="form-check-label small" for="group_${account.ownId}">Group</label>
              </div>
            </td>
            <td>
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" name="pullMode" id="pull_${account.ownId}" ${cfg.pullMode ? 'checked' : ''}>
                <label class="form-check-label small" for="pull_${account.ownId}">Kích hoạt</label>
              </div>
            </td>
            <td class="text-end"><button type="submit" class="btn btn-primary btn-sm px-3">Lưu</button></td>
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

  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Zalo Tools v4 — Tiến Tạ</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css">
      <style>
        body { background-color: #f8f9fa; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        .card { border-radius: 12px; border: none; box-shadow: 0 4px 12px rgba(0,0,0,0.05); margin-bottom: 24px; }
        .card-header { background-color: #fff; border-bottom: 1px solid #eee; border-radius: 12px 12px 0 0 !important; }
        .btn-custom { border-radius: 8px; padding: 8px 16px; font-weight: 500; transition: all 0.2s; }
        .btn-custom:hover { transform: translateY(-1px); box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
        .nav-tabs { border-bottom: none; }
        .nav-link { border: none !important; color: #666; font-weight: 500; padding: 12px 20px; border-radius: 8px !important; margin-right: 5px; }
        .nav-link.active { background-color: #0d6efd !important; color: #fff !important; }
      </style>
    </head>
    <body>
      <div class="container mt-4">
        <h1 class="mb-2 text-center">Zalo Tools v4 — Tiến Tạ</h1>
        <p class="text-center text-muted mb-4" style="font-size: 0.9rem;">Phiên bản v4.20260410 &nbsp;|&nbsp; Liên hệ: <strong>0387 553 113</strong></p>
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
          <li class="nav-item" role="presentation">
            <button class="nav-link" id="logs-tab" data-bs-toggle="tab" data-bs-target="#logs" type="button" role="tab">Logs</button>
          </li>
          <li class="nav-item" role="presentation">
            <button class="nav-link" id="n8n-tab" data-bs-toggle="tab" data-bs-target="#n8n-template" type="button" role="tab">n8n Template</button>
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
                  <button class="btn btn-primary btn-custom px-4" onclick="startZaloLogin()">
                    <i class="bi bi-plus-circle me-2"></i>Thêm tài khoản Zalo mới
                  </button>
                  <form action="/restartApp" method="POST" class="d-inline">
                    <button type="submit" class="btn btn-warning btn-custom" onclick="return confirm('Bạn có chắc muốn khởi động lại ứng dụng? Trang sẽ không phản hồi trong vài giây.');">Khởi động lại ứng dụng</button>
                  </form>
                </div>
                <!-- Selenium Modal -->
                <div class="modal fade" id="seleniumModal" data-bs-backdrop="static" tabindex="-1" aria-hidden="true">
                  <div class="modal-dialog modal-xl modal-dialog-centered">
                    <div class="modal-content shadow-lg border-0">
                      <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title"><i class="bi bi-qr-code-scan me-2"></i>Đăng nhập Zalo</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close" onclick="stopZaloLoginSession()"></button>
                      </div>
                      <div class="modal-body p-0 position-relative d-flex align-items-center justify-content-center" style="height: 75vh; background: #f0f2f5;">
                        <!-- Loading State -->
                        <div id="zaloLoginLoading" class="text-center" style="z-index: 10;">
                          <div class="spinner-border text-primary mb-3" role="status" style="width: 3.5rem; height: 3.5rem; border-width: 0.3em;">
                            <span class="visually-hidden">Loading...</span>
                          </div>
                          <h5 class="fw-bold text-primary mb-1">Đang chuẩn bị môi trường đăng nhập...</h5>
                          <p class="text-muted small">Quá trình này có thể mất vài giây, vui lòng không đóng cửa sổ.</p>
                        </div>
                        <!-- Iframe -->
                        <iframe id="zaloLoginFrame" src="" style="width: 100%; height: 100%; border: none; display: none;"></iframe>
                      </div>
                      <div class="modal-footer bg-light py-2 shadow-sm">
                        <div class="container-fluid text-center">
                           <small class="text-muted"><i class="bi bi-shield-check me-1"></i>Vui lòng quét mã QR hoặc đăng nhập bằng SĐT. Hệ thống tự động đóng khi hoàn tất.</small>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>

          <!-- Proxy -->
          <div class="tab-pane fade" id="proxies" role="tabpanel">
            <div class="card shadow-sm border-0">
              <div class="card-header bg-white p-3">
                <h5 class="card-title mb-0 fw-bold"><i class="bi bi-shield-shaded me-2 text-primary"></i>Quản lý Proxy</h5>
              </div>
              <div class="card-body p-4">
                <div class="table-responsive border rounded-3 mb-4">
                   ${proxiesHtml}
                </div>
                
                <div class="row g-3">
                  <div class="col-md-6">
                    <div class="p-3 border rounded-3 bg-light">
                      <h6 class="fw-bold mb-3"><i class="bi bi-plus-lg me-2 text-success"></i>Thêm Proxy mới</h6>
                      <form action="/proxies" method="POST" class="input-group">
                        <input type="text" name="proxyUrl" class="form-control" placeholder="http://user:pass@ip:port" required>
                        <button type="submit" class="btn btn-success px-3">Thêm</button>
                      </form>
                    </div>
                  </div>
                  <div class="col-md-6">
                    <div class="p-3 border rounded-3 bg-light">
                      <h6 class="fw-bold mb-3"><i class="bi bi-trash me-2 text-danger"></i>Xóa Proxy</h6>
                      <form action="/proxies" method="POST" class="input-group">
                        <input type="hidden" name="_method" value="DELETE">
                        <input type="text" name="proxyUrl" class="form-control" placeholder="Dán URL proxy cần xóa" required>
                        <button type="submit" class="btn btn-danger px-3">Xóa</button>
                      </form>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Webhook -->
          <div class="tab-pane fade" id="webhook" role="tabpanel">
            <div class="card shadow-sm border-0">
              <div class="card-header bg-white p-3">
                <h5 class="card-title mb-0 fw-bold"><i class="bi bi-link-45deg me-2 text-primary"></i>Cấu hình Webhook theo tài khoản</h5>
              </div>
              <div class="card-body p-4">
                ${webhooksHtml}
                <div class="mt-4 border-top pt-3">
                  <small class="text-muted"><i class="bi bi-info-circle me-1"></i>Cấu hình global (legacy): <a href="/updateWebhookForm">Cập nhật webhook toàn cục</a></small>
                </div>
              </div>
            </div>
          </div>

          <!-- Export/Import -->
          <div class="tab-pane fade" id="export-import" role="tabpanel">
            <div class="card shadow-sm border-0">
              <div class="card-header bg-white p-3">
                <h5 class="card-title mb-0 fw-bold"><i class="bi bi-box-arrow-in-down me-2 text-primary"></i>Dữ liệu hệ thống</h5>
              </div>
              <div class="card-body p-4">
                <div class="row g-4">
                  <div class="col-md-6">
                    <h6 class="fw-bold mb-3"><i class="bi bi-key me-2 text-warning"></i>Phiên làm việc (Sessions)</h6>
                    <div class="border rounded-3 bg-light overflow-hidden">
                      ${accountFilesHtml}
                    </div>
                  </div>
                  <div class="col-md-6">
                    <h6 class="fw-bold mb-3"><i class="bi bi-gear-wide-connected me-2 text-info"></i>Cấu hình chung</h6>
                    <div class="list-group list-group-flush border rounded-3 border-bottom-0 mb-4">
                      <a href="/export/proxies" class="list-group-item list-group-item-action d-flex justify-content-between p-3">
                        <span><i class="bi bi-shield-lock me-2"></i>Tải xuống proxies.json</span>
                        <i class="bi bi-chevron-right text-muted"></i>
                      </a>
                      <a href="/export/webhook-config" class="list-group-item list-group-item-action d-flex justify-content-between p-3 border-bottom">
                         <span><i class="bi bi-braces me-2"></i>Tải xuống webhook-config.json</span>
                         <i class="bi bi-chevron-right text-muted"></i>
                      </a>
                    </div>
                    
                    <h6 class="fw-bold mb-3"><i class="bi bi-cloud-upload me-2 text-primary"></i>Import dữ liệu</h6>
                    <form action="/import" method="POST" enctype="multipart/form-data" class="bg-light p-3 border rounded-3">
                      <div class="input-group">
                        <input type="file" name="file" class="form-control" accept=".json" required>
                        <button type="submit" class="btn btn-success"><i class="bi bi-upload"></i></button>
                      </div>
                      <small class="text-muted d-block mt-2">Hỗ trợ: proxies.json, webhook-config.json, cred_*.json</small>
                    </form>
                  </div>
                </div>
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
          <!-- n8n Template -->
          <div class="tab-pane fade" id="n8n-template" role="tabpanel">
            <div class="card shadow-sm border-0">
              <div class="card-header bg-white p-3">
                <h5 class="card-title mb-0 fw-bold"><i class="bi bi-diagram-3 me-2 text-primary"></i>Tạo n8n Template</h5>
              </div>
              <div class="card-body p-4">
                <!-- Wizard Steps Indicator -->
                <div class="d-flex justify-content-center mb-4">
                  <div class="d-flex align-items-center gap-2">
                    <span class="badge rounded-pill bg-primary px-3 py-2 n8n-step-badge" id="n8nStepBadge1">1. Endpoint</span>
                    <i class="bi bi-chevron-right text-muted"></i>
                    <span class="badge rounded-pill bg-secondary px-3 py-2 n8n-step-badge" id="n8nStepBadge2">2. Xác thực</span>
                    <i class="bi bi-chevron-right text-muted"></i>
                    <span class="badge rounded-pill bg-secondary px-3 py-2 n8n-step-badge" id="n8nStepBadge3">3. Chọn Node</span>
                    <i class="bi bi-chevron-right text-muted"></i>
                    <span class="badge rounded-pill bg-secondary px-3 py-2 n8n-step-badge" id="n8nStepBadge4">4. Tải về</span>
                  </div>
                </div>

                <!-- Step 1: Endpoint URL -->
                <div id="n8nStep1">
                  <div class="border rounded-3 p-4 bg-light">
                    <h6 class="fw-bold mb-3"><i class="bi bi-globe me-2 text-success"></i>Cấu hình Endpoint</h6>
                    <p class="text-muted small">Nhập URL endpoint của container Zalo Tools (bao gồm cả port). Đây là địa chỉ mà n8n sẽ gửi HTTP Request đến.</p>
                    <div class="mb-3">
                      <label class="form-label fw-semibold">Base URL</label>
                      <input type="text" id="n8nBaseUrl" class="form-control" placeholder="http://zalo-tools:3000">
                      <div class="form-text">Ví dụ: http://localhost:3000, http://zalo-tools:3000 (Docker network), hoặc domain public.</div>
                    </div>
                    <div class="text-end">
                      <button class="btn btn-primary btn-custom" onclick="n8nGoToStep(2)">Tiếp theo <i class="bi bi-arrow-right ms-1"></i></button>
                    </div>
                  </div>
                </div>

                <!-- Step 2: Authentication -->
                <div id="n8nStep2" style="display:none;">
                  <div class="border rounded-3 p-4 bg-light">
                    <h6 class="fw-bold mb-3"><i class="bi bi-shield-lock me-2 text-warning"></i>Thông tin xác thực</h6>
                    <p class="text-muted small">Thông tin được tự động điền từ cấu hình Docker. Bạn có thể chỉnh sửa nếu cần.</p>
                    <div class="row g-3">
                      <div class="col-md-6">
                        <label class="form-label fw-semibold">API Key (X-API-Key)</label>
                        <div class="input-group">
                          <input type="password" id="n8nApiKey" class="form-control" value="${process.env.X_API_KEY || ''}">
                          <button class="btn btn-outline-secondary" type="button" onclick="toggleN8nPassword('n8nApiKey')"><i class="bi bi-eye"></i></button>
                        </div>
                        <div class="form-text">Dùng cho các API endpoint (sendmessage, findUser, v.v.)</div>
                      </div>
                      <div class="col-md-6">
                        <label class="form-label fw-semibold">Basic Auth Username</label>
                        <input type="text" id="n8nBasicUser" class="form-control" value="${process.env.ADMIN_USERNAME || ''}">
                      </div>
                      <div class="col-md-6">
                        <label class="form-label fw-semibold">Basic Auth Password</label>
                        <div class="input-group">
                          <input type="password" id="n8nBasicPass" class="form-control" value="${process.env.ADMIN_PASSWORD || ''}">
                          <button class="btn btn-outline-secondary" type="button" onclick="toggleN8nPassword('n8nBasicPass')"><i class="bi bi-eye"></i></button>
                        </div>
                        <div class="form-text">Dùng cho Web UI endpoints</div>
                      </div>
                    </div>
                    <div class="row g-3 mt-1">
                      <div class="col-md-6">
                        <label class="form-label fw-semibold">Tài khoản Zalo (OwnId)</label>
                        <select id="n8nOwnId" class="form-select">
                          ${n8nOwnIdOptions}
                        </select>
                        <div class="form-text">Chọn tài khoản để tự động điền OwnId vào các node mẫu.</div>
                      </div>
                    </div>

                    <div class="text-end mt-3">
                      <button class="btn btn-outline-secondary btn-custom me-2" onclick="n8nGoToStep(1)"><i class="bi bi-arrow-left me-1"></i> Quay lại</button>
                      <button class="btn btn-primary btn-custom" onclick="n8nGoToStep(3)">Tiếp theo <i class="bi bi-arrow-right ms-1"></i></button>
                    </div>
                  </div>
                </div>

                <!-- Step 3: Select Nodes -->
                <div id="n8nStep3" style="display:none;">
                  <div class="border rounded-3 p-4 bg-light">
                    <h6 class="fw-bold mb-3"><i class="bi bi-check2-square me-2 text-info"></i>Chọn các node mẫu</h6>
                    <p class="text-muted small">Chọn các node HTTP Request và Webhook mẫu để đưa vào template. Bạn có thể copy các node này sang workflow khác trong n8n.</p>

                    <div class="row g-3">
                      <div class="col-md-6">
                        <div class="border rounded-3 bg-white p-3">
                          <h6 class="fw-semibold mb-2"><i class="bi bi-arrow-down-circle me-1 text-success"></i> Webhook (Nhận event)</h6>
                          <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="n8nNodeWebhook" checked>
                            <label class="form-check-label" for="n8nNodeWebhook">Webhook Receiver — Nhận tin nhắn/event từ Zalo</label>
                          </div>
                        </div>
                      </div>
                      <div class="col-md-6">
                        <div class="border rounded-3 bg-white p-3">
                          <h6 class="fw-semibold mb-2"><i class="bi bi-list-check me-1 text-primary"></i> Quản lý tài khoản</h6>
                          <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="n8nNodeAccounts" checked>
                            <label class="form-check-label" for="n8nNodeAccounts">GET /accounts — Danh sách tài khoản</label>
                          </div>
                          <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="n8nNodeHealth" checked>
                            <label class="form-check-label" for="n8nNodeHealth">GET /health — Kiểm tra trạng thái</label>
                          </div>
                        </div>
                      </div>
                      <div class="col-md-6">
                        <div class="border rounded-3 bg-white p-3">
                          <h6 class="fw-semibold mb-2"><i class="bi bi-chat-dots me-1 text-warning"></i> Nhắn tin</h6>
                          <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="n8nNodeSendMsg" checked>
                            <label class="form-check-label" for="n8nNodeSendMsg">POST /sendmessage — Gửi tin nhắn</label>
                          </div>
                          <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="n8nNodeSendImgUser">
                            <label class="form-check-label" for="n8nNodeSendImgUser">POST /sendImageToUser — Gửi ảnh cho user</label>
                          </div>
                          <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="n8nNodeSendImgGroup">
                            <label class="form-check-label" for="n8nNodeSendImgGroup">POST /sendImageToGroup — Gửi ảnh vào nhóm</label>
                          </div>
                          <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="n8nNodeSendFile">
                            <label class="form-check-label" for="n8nNodeSendFile">POST /sendFileToUser — Gửi file</label>
                          </div>
                        </div>
                      </div>
                      <div class="col-md-6">
                        <div class="border rounded-3 bg-white p-3">
                          <h6 class="fw-semibold mb-2"><i class="bi bi-people me-1 text-danger"></i> Liên hệ & Nhóm</h6>
                          <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="n8nNodeFindUser" checked>
                            <label class="form-check-label" for="n8nNodeFindUser">POST /findUser — Tìm user theo SĐT</label>
                          </div>
                          <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="n8nNodeGetUserInfo">
                            <label class="form-check-label" for="n8nNodeGetUserInfo">POST /getUserInfo — Thông tin user</label>
                          </div>
                          <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="n8nNodeGetGroupInfo">
                            <label class="form-check-label" for="n8nNodeGetGroupInfo">POST /getGroupInfo — Thông tin nhóm</label>
                          </div>
                          <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="n8nNodeCreateGroup">
                            <label class="form-check-label" for="n8nNodeCreateGroup">POST /createGroup — Tạo nhóm</label>
                          </div>
                          <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="n8nNodeAddUser">
                            <label class="form-check-label" for="n8nNodeAddUser">POST /addUserToGroup — Thêm vào nhóm</label>
                          </div>
                          <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="n8nNodeRemoveUser">
                            <label class="form-check-label" for="n8nNodeRemoveUser">POST /removeUserFromGroup — Xóa khỏi nhóm</label>
                          </div>
                          <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" id="n8nNodeFriendReq">
                            <label class="form-check-label" for="n8nNodeFriendReq">POST /sendFriendRequest — Kết bạn</label>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div class="text-end mt-3">
                      <button class="btn btn-outline-secondary btn-custom me-2" onclick="n8nGoToStep(2)"><i class="bi bi-arrow-left me-1"></i> Quay lại</button>
                      <button class="btn btn-success btn-custom" onclick="n8nGenerate()"><i class="bi bi-lightning me-1"></i> Tạo Template</button>
                    </div>
                  </div>
                </div>

                <!-- Step 4: Download -->
                <div id="n8nStep4" style="display:none;">
                  <div class="border rounded-3 p-4 bg-light">
                    <h6 class="fw-bold mb-3"><i class="bi bi-download me-2 text-success"></i>Template đã sẵn sàng!</h6>
                    <p class="text-muted small">File template.json đã được tạo. Bạn có thể tải về và import vào n8n.</p>
                    <div class="alert alert-info small">
                      <i class="bi bi-info-circle me-1"></i>
                      <strong>Cách import:</strong> Mở n8n &rarr; Menu &rarr; Import from File &rarr; Chọn file template.json vừa tải.<br>
                      <strong>Copy node:</strong> Trong n8n, chọn node mẫu &rarr; Ctrl+C &rarr; Mở workflow khác &rarr; Ctrl+V.<br>
                      <strong>Cấu hình Credential:</strong> Sau khi import, mở 1 node HTTP Request &rarr; mục Credential &rarr; tạo mới "Basic Auth" với Username/Password ở bước 2.
                    </div>
                    <div class="mb-3">
                      <label class="form-label fw-semibold">Xem trước JSON</label>
                      <textarea id="n8nPreview" class="form-control font-monospace" rows="12" readonly style="font-size: 12px; background: #1e1e1e; color: #d4d4d4;"></textarea>
                    </div>
                    <div class="d-flex gap-2">
                      <button class="btn btn-success btn-custom" onclick="n8nDownload()"><i class="bi bi-download me-1"></i> Tải template.json</button>
                      <button class="btn btn-outline-primary btn-custom" onclick="n8nCopyJson()"><i class="bi bi-clipboard me-1"></i> Copy JSON</button>
                      <button class="btn btn-outline-secondary btn-custom" onclick="n8nGoToStep(3)"><i class="bi bi-arrow-left me-1"></i> Quay lại chỉnh sửa</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Logs -->
          <div class="tab-pane fade" id="logs" role="tabpanel">
            <div class="card shadow-sm border-0">
              <div class="card-header bg-white p-3 d-flex justify-content-between align-items-center">
                <h5 class="card-title mb-0 fw-bold"><i class="bi bi-journal-text me-2 text-primary"></i>Activity Logs</h5>
                <button class="btn btn-outline-secondary btn-sm" onclick="loadLogs()"><i class="bi bi-arrow-clockwise me-1"></i>Làm mới</button>
              </div>
              <div class="card-body p-0">
                <div class="table-responsive" style="max-height: 600px; overflow-y: auto;">
                  <table class="table table-sm table-hover mb-0" id="logsTable">
                    <thead class="bg-light sticky-top">
                      <tr>
                        <th style="width: 160px">Thời gian</th>
                        <th style="width: 120px">Action</th>
                        <th style="width: 120px">Tài khoản</th>
                        <th>Chi tiết</th>
                      </tr>
                    </thead>
                    <tbody id="logsBody">
                      <tr><td colspan="4" class="text-center py-4 text-muted">Nhấn "Làm mới" để tải logs</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
      <script>
        let zaloLoginPollInterval;
        const zaloLoginModal = new bootstrap.Modal(document.getElementById('seleniumModal'));

        async function startZaloLogin() {
          const loadingDiv = document.getElementById('zaloLoginLoading');
          const iframe = document.getElementById('zaloLoginFrame');
          
          iframe.style.display = 'none';
          loadingDiv.style.display = 'block';
          zaloLoginModal.show();

          try {
            const res = await fetch('/api/selenium/start', { method: 'POST' });
            const data = await res.json();
            
            if (data.success) {
              // resize=remote giúp phía server Selenium tự điều chỉnh kích thước trình duyệt khớp với Iframe
              const vncUrl = location.protocol + '//' + location.hostname + ':7900/?autoconnect=1&resize=remote&password=secret&reconnect=1';
              
              iframe.src = vncUrl;
              iframe.onload = () => {
                loadingDiv.style.display = 'none';
                iframe.style.display = 'block';
              };
              
              startZaloStatusPolling();
            } else {
              zaloLoginModal.hide();
              alert('Lỗi khởi động hệ thống đăng nhập: ' + data.error);
            }
          } catch (err) {
            zaloLoginModal.hide();
            alert('Lỗi kết nối server: ' + err.message);
          }
        }

        function startZaloStatusPolling() {
          if (zaloLoginPollInterval) clearInterval(zaloLoginPollInterval);
          zaloLoginPollInterval = setInterval(async () => {
            const res = await fetch('/api/selenium/status');
            const data = await res.json();
            if (data.status === 'success') {
               clearInterval(zaloLoginPollInterval);
               alert('Đăng nhập thành công! Hệ thống đang khởi động bot...');
               await fetch('/api/selenium/finish', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify(data.data)
               });
               location.reload();
            }
          }, 3000);
        }

        async function stopZaloLoginSession() {
          clearInterval(zaloLoginPollInterval);
          await fetch('/api/selenium/stop', { method: 'POST' });
        }

        // === n8n Template Wizard ===
        // Auto-fill base URL from current address
        document.getElementById('n8nBaseUrl').value = location.origin;

        // UUID fallback for non-HTTPS contexts
        function generateUUID() {
          if (typeof crypto !== 'undefined' && crypto.randomUUID) return generateUUID();
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
        }

        function toggleN8nPassword(id) {
          const el = document.getElementById(id);
          el.type = el.type === 'password' ? 'text' : 'password';
        }

        function n8nGoToStep(step) {
          for (let i = 1; i <= 4; i++) {
            document.getElementById('n8nStep' + i).style.display = i === step ? 'block' : 'none';
            const badge = document.getElementById('n8nStepBadge' + i);
            badge.className = 'badge rounded-pill px-3 py-2 n8n-step-badge ' + (i === step ? 'bg-primary' : (i < step ? 'bg-success' : 'bg-secondary'));
          }
        }

        let n8nTemplateJson = '';

        function n8nGenerate() {
          const baseUrl = document.getElementById('n8nBaseUrl').value.replace(/\\/+$/, '');
          const apiKey = document.getElementById('n8nApiKey').value;
          const basicUser = document.getElementById('n8nBasicUser').value;
          const basicPass = document.getElementById('n8nBasicPass').value;
          const selectedOwnId = document.getElementById('n8nOwnId').value || 'YOUR_OWN_ID';

          if (!baseUrl) { alert('Vui lòng nhập Base URL'); return; }

          const nodes = [];
          const connections = {};
          let posX = 250, posY = 300;
          const nodeSpacingX = 300;

          // Helper: tạo n8n HTTP Request node với Basic Auth
          function makeHttpNode(name, method, urlPath, bodyParams, notes) {
            const id = generateUUID();
            const node = {
              parameters: {
                method: method,
                url: baseUrl + urlPath,
                authentication: 'genericCredentialType',
                genericAuthType: 'httpBasicAuth',
                sendHeaders: true,
                headerParameters: {
                  parameters: [
                    { name: 'X-API-Key', value: apiKey }
                  ]
                },
                sendBody: method === 'POST',
                specifyBody: method === 'POST' ? 'json' : undefined,
                jsonBody: method === 'POST' ? JSON.stringify(bodyParams || {}, null, 2) : undefined,
                options: {}
              },
              id: id,
              name: name,
              type: 'n8n-nodes-base.httpRequest',
              typeVersion: 4.2,
              position: [posX, posY],
              notesInFlow: !!notes,
              notes: notes || '',
              credentials: {
                httpBasicAuth: {
                  id: generateUUID(),
                  name: 'Zalo Tools Basic Auth'
                }
              }
            };
            // Clean up undefined fields
            if (method !== 'POST') {
              delete node.parameters.specifyBody;
              delete node.parameters.jsonBody;
              delete node.parameters.sendBody;
            }
            posX += nodeSpacingX;
            return node;
          }

          // Webhook Receiver Node
          if (document.getElementById('n8nNodeWebhook').checked) {
            const webhookId = generateUUID();
            nodes.push({
              parameters: {
                httpMethod: 'POST',
                path: 'zalo-events',
                responseMode: 'onReceived',
                responseData: 'allEntries',
                options: {}
              },
              id: webhookId,
              name: 'Zalo Webhook Receiver',
              type: 'n8n-nodes-base.webhook',
              typeVersion: 2,
              position: [posX, posY],
              webhookId: generateUUID().split('-')[0],
              notesInFlow: true,
              notes: 'Nhận event từ Zalo Tools.\\nCopy URL webhook này và cấu hình trong tab Webhook của Zalo Tools.'
            });
            posX += nodeSpacingX;
          }

          // Row 2 - API Nodes
          posY += 200;
          posX = 250;

          // Manual trigger as starting point for API nodes
          const triggerId = generateUUID();
          nodes.push({
            parameters: {},
            id: triggerId,
            name: 'Test Trigger',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [posX, posY],
            notesInFlow: true,
            notes: 'Click "Test workflow" de thu cac node mau'
          });
          const triggerNodeName = 'Test Trigger';
          posX += nodeSpacingX;

          let prevNodeName = triggerNodeName;
          let firstApiNode = null;

          // Accounts
          if (document.getElementById('n8nNodeAccounts').checked) {
            const n = makeHttpNode('Danh sach tai khoan', 'GET', '/accounts', null, 'GET /accounts');
            nodes.push(n);
            if (!firstApiNode) firstApiNode = n.name;
            connections[prevNodeName] = { main: [[{ node: n.name, type: 'main', index: 0 }]] };
            prevNodeName = n.name;
          }

          // Health
          if (document.getElementById('n8nNodeHealth').checked) {
            const n = makeHttpNode('Kiem tra trang thai', 'GET', '/health', null, 'GET /health');
            nodes.push(n);
            if (!firstApiNode) firstApiNode = n.name;
            if (prevNodeName !== triggerNodeName || !firstApiNode) {
              connections[prevNodeName] = connections[prevNodeName] || { main: [[]] };
            }
          }

          // Send Message
          if (document.getElementById('n8nNodeSendMsg').checked) {
            posY += 200; posX = 550;
            const n = makeHttpNode('Gui tin nhan', 'POST', '/sendmessage', {
              message: 'Hello from n8n!',
              threadId: 'USER_OR_GROUP_ID',
              type: '0',
              ownId: selectedOwnId
            }, 'POST /sendmessage\\ntype: 0=User, 1=Group');
            nodes.push(n);
          }

          // Send Image to User
          if (document.getElementById('n8nNodeSendImgUser').checked) {
            posY += 200; posX = 550;
            const n = makeHttpNode('Gui anh cho user', 'POST', '/sendImageToUser', {
              imagePath: 'https://example.com/image.jpg',
              threadId: 'USER_ID',
              ownId: selectedOwnId
            }, 'POST /sendImageToUser\\nimagePath hoac imageData (base64)');
            nodes.push(n);
          }

          // Send Image to Group
          if (document.getElementById('n8nNodeSendImgGroup').checked) {
            posY += 200; posX = 550;
            const n = makeHttpNode('Gui anh vao nhom', 'POST', '/sendImageToGroup', {
              imagePath: 'https://example.com/image.jpg',
              threadId: 'GROUP_ID',
              ownId: selectedOwnId
            }, 'POST /sendImageToGroup\\nimagePath hoac imageData (base64)');
            nodes.push(n);
          }

          // Send File
          if (document.getElementById('n8nNodeSendFile').checked) {
            posY += 200; posX = 550;
            const n = makeHttpNode('Gui file', 'POST', '/sendFileToUser', {
              filePath: 'https://example.com/file.pdf',
              threadId: 'USER_ID',
              ownId: selectedOwnId
            }, 'POST /sendFileToUser\\nfilePath hoac fileData (base64)');
            nodes.push(n);
          }

          // Find User
          if (document.getElementById('n8nNodeFindUser').checked) {
            posY += 200; posX = 550;
            const n = makeHttpNode('Tim user theo SDT', 'POST', '/findUser', {
              phone: '0901234567',
              ownId: selectedOwnId
            }, 'POST /findUser');
            nodes.push(n);
          }

          // Get User Info
          if (document.getElementById('n8nNodeGetUserInfo').checked) {
            posY += 200; posX = 550;
            const n = makeHttpNode('Thong tin user', 'POST', '/getUserInfo', {
              userId: 'USER_ID',
              ownId: selectedOwnId
            }, 'POST /getUserInfo');
            nodes.push(n);
          }

          // Get Group Info
          if (document.getElementById('n8nNodeGetGroupInfo').checked) {
            posY += 200; posX = 550;
            const n = makeHttpNode('Thong tin nhom', 'POST', '/getGroupInfo', {
              groupId: 'GROUP_ID',
              ownId: selectedOwnId
            }, 'POST /getGroupInfo');
            nodes.push(n);
          }

          // Create Group
          if (document.getElementById('n8nNodeCreateGroup').checked) {
            posY += 200; posX = 550;
            const n = makeHttpNode('Tao nhom', 'POST', '/createGroup', {
              members: ['USER_ID_1', 'USER_ID_2'],
              name: 'Ten nhom moi',
              ownId: selectedOwnId
            }, 'POST /createGroup');
            nodes.push(n);
          }

          // Add User to Group
          if (document.getElementById('n8nNodeAddUser').checked) {
            posY += 200; posX = 550;
            const n = makeHttpNode('Them vao nhom', 'POST', '/addUserToGroup', {
              groupId: 'GROUP_ID',
              memberId: ['USER_ID'],
              ownId: selectedOwnId
            }, 'POST /addUserToGroup\\nmemberId co the la mang');
            nodes.push(n);
          }

          // Remove User from Group
          if (document.getElementById('n8nNodeRemoveUser').checked) {
            posY += 200; posX = 550;
            const n = makeHttpNode('Xoa khoi nhom', 'POST', '/removeUserFromGroup', {
              groupId: 'GROUP_ID',
              memberId: ['USER_ID'],
              ownId: selectedOwnId
            }, 'POST /removeUserFromGroup\\nmemberId co the la mang');
            nodes.push(n);
          }

          // Send Friend Request
          if (document.getElementById('n8nNodeFriendReq').checked) {
            posY += 200; posX = 550;
            const n = makeHttpNode('Ket ban', 'POST', '/sendFriendRequest', {
              userId: 'USER_ID',
              ownId: selectedOwnId
            }, 'POST /sendFriendRequest');
            nodes.push(n);
          }

          // Sticky Note - Lưu ý
          var stickyContent = '## Luu y quan trong\\n\\n';
          stickyContent += '1. **Tao Basic Auth Credential:**\\n';
          stickyContent += '   Mo bat ky node HTTP Request > Credential > Tao moi "Basic Auth"\\n';
          stickyContent += '   - Username: ' + basicUser + '\\n';
          stickyContent += '   - Password: ' + basicPass + '\\n\\n';
          stickyContent += '2. **Kiem tra X-API-Key:**\\n';
          stickyContent += '   Header X-API-Key da duoc dien san trong moi node.\\n\\n';
          stickyContent += '3. **OwnId:**\\n';
          stickyContent += '   ' + (selectedOwnId !== 'YOUR_OWN_ID' ? 'Da dien san: ' + selectedOwnId : 'Thay YOUR_OWN_ID bang ID tu GET /accounts') + '\\n\\n';
          stickyContent += '4. **Copy node:**\\n';
          stickyContent += '   Chon node > Ctrl+C > Mo workflow khac > Ctrl+V';
          nodes.push({
            parameters: {
              width: 450,
              height: 320,
              content: stickyContent
            },
            id: generateUUID(),
            name: 'Luu y',
            type: 'n8n-nodes-base.stickyNote',
            typeVersion: 1,
            position: [0, 100]
          });

          const template = {
            name: 'Zalo Tools v4 - Template',
            nodes: nodes,
            connections: connections,
            active: false,
            settings: {
              executionOrder: 'v1'
            },
            tags: [{ name: 'zalo' }, { name: 'template' }],
            meta: {
              templateCredsSetupCompleted: true,
              instanceId: ''
            }
          };

          n8nTemplateJson = JSON.stringify(template, null, 2);
          document.getElementById('n8nPreview').value = n8nTemplateJson;
          n8nGoToStep(4);
        }

        function n8nDownload() {
          const blob = new Blob([n8nTemplateJson], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'zalo-tools-n8n-template.json';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }

        function n8nCopyJson() {
          navigator.clipboard.writeText(n8nTemplateJson).then(() => {
            alert('Da copy JSON vao clipboard!');
          });
        }

        async function loadLogs() {
          try {
            const res = await fetch('/logs');
            const data = await res.json();
            const tbody = document.getElementById('logsBody');
            if (!data.logs || data.logs.length === 0) {
              tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">Chưa có log nào</td></tr>';
              return;
            }
            tbody.innerHTML = data.logs.slice().reverse().slice(0, 500).map(log => \`
              <tr>
                <td class="small text-muted">\${log.timestamp}</td>
                <td><span class="badge bg-secondary">\${log.action}</span></td>
                <td class="small font-monospace">\${log.ownId}</td>
                <td class="small">\${log.details}</td>
              </tr>
            \`).join('');
          } catch (e) {
            console.error('Error loading logs:', e);
          }
        }
      </script>
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


    // Gửi phản hồi với alert và chuyển hướng sau 10 giây
    res.send(`
      <html>
        <body>
          <script>
            setTimeout(function() {
              window.location.href = '/home';
            }, 10000);
            alert('Đang upload file, vui lòng chờ 10 giây và bấm ok');            
          </script>
          <a>Đang tải lại container </a><strong><a href='/home'> Về trang chủ </a></strong>
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

      setTimeout(() => {
        console.log("Tự khởi động lại container...");
        process.exit(1); // Thoát với mã lỗi khác 0 để kích hoạt restart
      }, 1000);
    }, 1000);
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
    res.send(data);
  });
});

router.post('/updateAccountWebhook', (req, res) => {
  const { ownId, url, receiveReaction, receiveGroupEvent, pullMode } = req.body;
  if (!ownId || !url) {
    return res.status(400).json({ error: 'ownId và url là bắt buộc' });
  }
  try {
    let config = {};
    if (fs.existsSync(multiWebhookPath)) {
      config = JSON.parse(fs.readFileSync(multiWebhookPath, 'utf8'));
    }
    config[ownId] = {
      url,
      settings: {
        receiveReaction: receiveReaction === 'on',
        receiveGroupEvent: receiveGroupEvent === 'on'
      },
      pullMode: pullMode === 'on'
    };
    fs.writeFileSync(multiWebhookPath, JSON.stringify(config, null, 4), 'utf8');
    res.redirect('/home');
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/logs', (req, res) => {
  res.json({ success: true, logs: eventLogs });
});

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
    await stopSelenium();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

