// helpers.js
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'webhook-config.json');

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
        const imgPath = "./temp.png";

        const { data } = await axios.get(url, { responseType: "arraybuffer" });
        fs.writeFileSync(imgPath, Buffer.from(data, "utf-8"));

        return imgPath;
    } catch (error) {
        console.error(error);
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