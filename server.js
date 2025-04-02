// server.js
import express from 'express';
import routes from './routes.js';
import fs from 'fs';
import { zaloAccounts, loginZaloAccount } from './api/zalo/zalo.js';
import { WebSocketServer } from 'ws';

const app = express();
const CONTAINER_IP = process.env.CONTAINER_IP || '0.0.0.0'; // Dùng để hiển thị hoặc cho client
const LISTEN_IP = '0.0.0.0'; // Luôn lắng nghe trên tất cả giao diện
const CONTAINER_PORT = process.env.CONTAINER_PORT || 3080;
const CONTAINER_PORT_WS = process.env.CONTAINER_PORT_WS || 3001; // Biến môi trường cho WebSocket

const wss = new WebSocketServer({ port: CONTAINER_PORT_WS, host: LISTEN_IP });

wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket');
  ws.on('close', () => console.log('Client disconnected'));
});

let webhookConfig = {};

function loadWebhookConfig() {
  const messageWebhookUrl = process.env.MESSAGE_WEBHOOK_URL;
  const groupEventWebhookUrl = process.env.GROUP_EVENT_WEBHOOK_URL;
  const reactionWebhookUrl = process.env.REACTION_WEBHOOK_URL;

  if (messageWebhookUrl && groupEventWebhookUrl && reactionWebhookUrl) {
    webhookConfig = {
      messageWebhookUrl,
      groupEventWebhookUrl,
      reactionWebhookUrl,
    };
  }
}

loadWebhookConfig();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/', routes);

export function broadcastLoginSuccess() {
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send('login_success');
    }
  });
}

const cookiesDir = './cookies';
if (fs.existsSync(cookiesDir)) {
  const cookieFiles = fs.readdirSync(cookiesDir);
  if (zaloAccounts.length < cookieFiles.length) {
    console.log('Đang đăng nhập lại từ cookie...');
    for (const file of cookieFiles) {
      if (file.startsWith('cred_') && file.endsWith('.json')) {
        const ownId = file.substring(5, file.length - 5);
        try {
          const cookie = JSON.parse(fs.readFileSync(`${cookiesDir}/${file}`, 'utf-8'));
          await loginZaloAccount(null, cookie);
          console.log(`Đã đăng nhập lại tài khoản ${ownId} từ cookie.`);
        } catch (error) {
          console.error(`Lỗi khi đăng nhập lại tài khoản ${ownId}:`, error);
        }
      }
    }
  }
}

app.listen(CONTAINER_PORT, LISTEN_IP, () => {
  console.log(`Server đang chạy tại http://${CONTAINER_IP}:${CONTAINER_PORT}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Có thể thêm logic để ghi log hoặc xử lý lỗi tại đây
});
