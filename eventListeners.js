// eventListeners.js
import { getWebhookConfigs, triggerN8nWebhook } from './helpers.js';
import fs from 'fs';
import { loginZaloAccount, zaloAccounts } from './api/zalo/zalo.js';
import { broadcastLoginSuccess } from './server.js';
import { addLog } from './routes-ui.js';

export const reloginAttempts = new Map();
const RELOGIN_COOLDOWN = 5 * 60 * 1000;

export function setupEventListeners(api, loginResolve) {
  const ownId = api.getOwnId();

  api.listener.on('message', (msg) => {
    // Log message
    if (msg.isSelf) {
      const content = msg.data?.content ? msg.data.content : (msg.data?.msgType === 'chat.photo' ? '[Hình ảnh]' : '[File/Khác]');
      addLog('Gửi tin nhắn', content, ownId, { type: msg.data?.msgType, msgId: msg.data?.msgId }, msg.threadId, ownId);
    } else {
      const content = msg.data?.content ? msg.data.content : (msg.data?.msgType === 'chat.photo' ? '[Hình ảnh]' : '[File/Khác]');
      const senderId = msg.data?.uidFrom || msg.data?.fromOaid || '';
      addLog('Nhận tin nhắn', content, ownId, { type: msg.data?.msgType, msgId: msg.data?.msgId }, msg.threadId, senderId || msg.threadId);
    }

    const configs = getWebhookConfigs(ownId);
    for (const config of configs) {
      const webhookUrl = config?.url;
      if (webhookUrl) {
        let isAPI = false;
        if (msg.isSelf && msg.data?.content) {
          const account = zaloAccounts.find((acc) => acc.ownId === ownId);
          const lastMsg = (account?.lastAPIMessage || "").toString();
          const currentContent = (msg.data?.content || "").toString();
          if (lastMsg && lastMsg === currentContent)
            isAPI = true;
        }
        triggerN8nWebhook({ ...msg, AccountID: ownId, isAPI, isself: msg.isSelf }, webhookUrl);
      }
    }
  });

  api.listener.on('group_event', (data) => {
    const configs = getWebhookConfigs(ownId);
    for (const config of configs) {
      const webhookUrl = config?.url;
      const receiveGroupEvent = config?.settings?.receiveGroupEvent ?? true;

      if (webhookUrl && receiveGroupEvent) {
        triggerN8nWebhook({ ...data, AccountID: ownId }, webhookUrl);
      }
    }
  });

  api.listener.on('reaction', (reaction) => {
    console.log(`Nhận reaction cho ${ownId}:`, reaction);
    const configs = getWebhookConfigs(ownId);
    for (const config of configs) {
      const webhookUrl = config?.url;
      const receiveReaction = config?.settings?.receiveReaction ?? true;

      if (webhookUrl && receiveReaction) {
        triggerN8nWebhook({ ...reaction, AccountID: ownId }, webhookUrl);
      }
    }
  });

  api.listener.onConnected(() => {
    console.log('Connected');
    loginResolve('login_success');
    broadcastLoginSuccess();
  });

  api.listener.onClosed((code, reason) => {
    console.log(`Closed - API listener đã ngắt kết nối. Code: ${code}, Reason: ${reason}`);

    // Nếu bị ngắt kết nối do trùng lặp (3000) hoặc bị đá (3003), báo cáo logout về webhook
    if (code === 3000 || code === 3003) {
      const configs = getWebhookConfigs(ownId);
      for (const config of configs) {
        if (config?.url) {
          triggerN8nWebhook({
            action: 'logout',
            ownId: ownId,
            reason: `Bị ngắt kết nối (Code: ${code}, Reason: ${reason})`
          }, config.url);
        }
      }
    }

    handleRelogin(api);
  });

  api.listener.onError((error) => {
    console.error('Error:', error);
    if (error.message.includes('QR expired')) {
      console.log('QR code đã hết hạn, thông báo cho client...');
      broadcastLoginSuccess('qr_expired');
    }
  });
}

async function handleRelogin(api) {
  try {
    console.log('Đang thử đăng nhập lại...');
    const ownId = api.getOwnId();
    if (!ownId) {
      console.error('Không thể xác định ownId, không thể đăng nhập lại');
      return;
    }

    const lastReloginTime = reloginAttempts.get(ownId);
    const now = Date.now();
    if (lastReloginTime && now - lastReloginTime < RELOGIN_COOLDOWN) {
      console.log(
        `Bỏ qua việc đăng nhập lại tài khoản ${ownId}, đã thử cách đây ${Math.floor(
          (now - lastReloginTime) / 1000
        )} giây`
      );
      return;
    }

    reloginAttempts.set(ownId, now);
    const accountInfo = zaloAccounts.find((acc) => acc.ownId === ownId);
    const customProxy = accountInfo?.proxy || null;
    const cookiesDir = '/app/cookies';
    const cookieFile = `${cookiesDir}/cred_${ownId}.json`;

    if (!fs.existsSync(cookieFile)) {
      console.error(`Không tìm thấy file cookie cho tài khoản ${ownId}`);
      return;
    }

    const cookie = JSON.parse(fs.readFileSync(cookieFile, 'utf-8'));
    console.log(`Đang đăng nhập lại tài khoản ${ownId} với proxy ${customProxy || 'không có'}...`);
    try {
      await loginZaloAccount(customProxy, cookie);
      console.log(`Đã đăng nhập lại thành công tài khoản ${ownId}`);
    } catch (loginError) {
      console.error(`Đăng nhập lại thất bại cho ${ownId}:`, loginError.message);
      const configs = getWebhookConfigs(ownId);
      for (const config of configs) {
        if (config?.url) {
          triggerN8nWebhook({
            action: 'logout',
            ownId: ownId,
            reason: `Đăng nhập lại thất bại: ${loginError.message}`
          }, config.url);
        }
      }
    }
  } catch (error) {
    console.error('Lỗi khi thử đăng nhập lại:', error);
  }
}
