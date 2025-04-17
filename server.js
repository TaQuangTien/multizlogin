import dotenv from 'dotenv';
import express from 'express';
import routes from './routes.js';
import fs from 'fs';
import { zaloAccounts, loginZaloAccount } from './api/zalo/zalo.js';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fileUpload from 'express-fileupload';
import session from 'express-session';



// Load biến môi trường từ file .env
dotenv.config();

const app = express();
const LISTEN_IP = '0.0.0.0';
const INTERNAL_PORT = 3000;

export const server = createServer(app); // Export server
export const wss = new WebSocketServer({ server }); // Export wss

wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket');
  ws.on('close', () => console.log('Client disconnected'));
});

wss.on('error', (error) => {
  console.error('WebSocket error:', error);
});

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(fileUpload());
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

// Async wrapper for cookie loading
async function loadCookies() {
  try {
    const cookiesDir = './cookies';
    if (!fs.existsSync(cookiesDir)) {
      console.log('Cookies directory not found, skipping cookie loading');
      return;
    }

    const cookieFiles = fs.readdirSync(cookiesDir);
    if (zaloAccounts.length >= cookieFiles.length) {
      console.log('No new cookies to load');
      return;
    }

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
  } catch (error) {
    console.error('Error in loadCookies:', error);
  }
}

// Start server after loading cookies
async function startServer() {
  try {
    await loadCookies();
    
    server.listen(INTERNAL_PORT, LISTEN_IP, () => {
      console.log(`Actually listening on port ${INTERNAL_PORT}`);
    });

    server.on('error', (error) => {
      console.error('Server error:', error);
    });
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

startServer();

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});