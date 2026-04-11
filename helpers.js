// helpers.js
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'zalo_data', 'webhook-config.json');
const multiWebhookPath = '/app/zalo_data/webhooks.json';

export function getWebhookConfig(ownId) {
    try {
        if (fs.existsSync(multiWebhookPath)) {
            const content = fs.readFileSync(multiWebhookPath, 'utf8');
            const config = JSON.parse(content);
            return config[ownId] || null;
        }
    } catch (error) {
        console.error("Error reading multi-webhook config:", error);
    }
    return null;
}

export function getWebhookUrl(key) {
    try {
        if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(content);
            return config[key] || "";
        } else {
            return "";
        }
    } catch (error) {
        console.error("Error reading webhook config:", error);
        return "";
    }
}

export async function triggerN8nWebhook(msg, webhookUrl) {
    if (!webhookUrl) {
      console.warn("Webhook URL is empty, skipping webhook trigger");
      return false;
    }
    try {
      console.log(`Gửi webhook đến ${webhookUrl} với dữ liệu:`, msg); // Thêm log
      await axios.post(webhookUrl, msg, { headers: { 'Content-Type': 'application/json' } });
      console.log(`Webhook ${webhookUrl} gọi thành công`);
      return true;
    } catch (error) {
      console.error(`Lỗi khi gửi webhook đến ${webhookUrl}:`, error.message, error.response?.data); // Log chi tiết
      return false;
    }
  }

export async function saveImage(url) {
    try {
        const tmpDir = path.resolve('./tmp_images');
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }

        const timestamp = Date.now();
        let ext = '.png';
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            if (pathname.includes('.')) {
                const parts = pathname.split('.');
                const possibleExt = '.' + parts[parts.length - 1];
                if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(possibleExt.toLowerCase())) {
                    ext = possibleExt;
                }
            }
        } catch (_) {}

        const imgPath = path.join(tmpDir, `${timestamp}${ext}`);
        const { data } = await axios.get(url, { responseType: "arraybuffer", timeout: 10000 });
        fs.writeFileSync(imgPath, Buffer.from(data));
        return imgPath;
    } catch (error) {
        console.error(`[saveImage] Error:`, error.message);
        return null;
    }
}

export function removeImage(imgPath) {
    try {
        fs.unlinkSync(imgPath);
    } catch (error) {
        console.error(error);
    }
}
