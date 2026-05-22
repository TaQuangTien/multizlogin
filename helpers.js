import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Ánh xạ MIME type sang phần mở rộng file cho các loại file phổ biến
export const fileTypeToExtension = {
    // Documents
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/json': '.json',
    'application/xml': '.xml',
    'text/xml': '.xml',
    // Archives
    'application/zip': '.zip',
    'application/x-rar-compressed': '.rar',
    'application/x-7z-compressed': '.7z',
    // Audio
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/mp4': '.m4a',
    // Video
    'video/mp4': '.mp4',
    'video/avi': '.avi',
    'video/quicktime': '.mov',
    'video/x-msvideo': '.avi',
    // Images
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg'
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// const configPath = path.join(__dirname, 'zalo_data', 'webhook-config.json');
const multiWebhookPath = '/app/zalo_data/webhooks.json';

// Lấy toàn bộ cấu hình webhook, tự động nâng cấp cấu trúc nếu là phiên bản cũ
export function getFullWebhookConfig() {
    try {
        if (fs.existsSync(multiWebhookPath)) {
            const content = fs.readFileSync(multiWebhookPath, 'utf8');
            const config = JSON.parse(content);
            let upgraded = false;
            for (const id in config) {
                if (config[id] && !Array.isArray(config[id])) {
                    if (typeof config[id] === 'object' && (config[id].url || config[id].pullMode !== undefined)) {
                        config[id] = [config[id]];
                        upgraded = true;
                    }
                }
            }
            if (upgraded) {
                fs.writeFileSync(multiWebhookPath, JSON.stringify(config, null, 4), 'utf8');
            }
            return config;
        }
    } catch (error) {
        console.error("Error reading/migrating full webhook config:", error);
    }
    return {};
}

// Lấy danh sách webhook cho một tài khoản, tự động nâng cấp cấu trúc nếu là phiên bản cũ
export function getWebhookConfigs(ownId) {
    const config = getFullWebhookConfig();
    const accountWebhooks = config[ownId];
    if (Array.isArray(accountWebhooks)) {
        return accountWebhooks;
    } else if (accountWebhooks && typeof accountWebhooks === 'object') {
        return [accountWebhooks];
    }
    return [];
}

/* Legacy webhook-config functions
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
*/

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
    return saveFileFromUrl(url, './tmp_images');
}

export async function saveFileFromUrl(url, targetDir = './tmp') {
    try {
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const response = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
        const contentType = response.headers['content-type'];
        const timestamp = Date.now();
        let ext = '.bin';

        // Ưu tiên lấy đuôi file từ Content-Type header
        if (contentType && fileTypeToExtension[contentType.split(';')[0]]) {
            ext = fileTypeToExtension[contentType.split(';')[0]];
        } else {
            // Nếu không có header, thử lấy từ URL
            try {
                const urlObj = new URL(url);
                const pathname = urlObj.pathname;
                if (pathname.includes('.')) {
                    const parts = pathname.split('.');
                    const possibleExt = '.' + parts[parts.length - 1].toLowerCase();
                    ext = possibleExt.split('?')[0]; // Loại bỏ query params nếu có
                }
            } catch (_) {}
        }

        const filePath = path.join(targetDir, `${timestamp}${ext}`);
        fs.writeFileSync(filePath, Buffer.from(response.data));
        return filePath;
    } catch (error) {
        console.error(`[saveFileFromUrl] Error downloading ${url}:`, error.message);
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

// Dọn dẹp file tạm cũ hơn maxAgeMs (mặc định 10 phút)
const TMP_DIRS = ['./tmp', './tmp_images'];
const CLEANUP_INTERVAL_MS = 30 * 60_000; // 30 phút
const MAX_FILE_AGE_MS = 10 * 60_000;     // 10 phút

export function cleanupTempFiles() {
    let totalDeleted = 0;
    for (const dir of TMP_DIRS) {
        try {
            if (!fs.existsSync(dir)) continue;
            const files = fs.readdirSync(dir);
            const now = Date.now();
            for (const file of files) {
                const filePath = path.join(dir, file);
                try {
                    const stat = fs.statSync(filePath);
                    if (stat.isFile() && (now - stat.mtimeMs > MAX_FILE_AGE_MS)) {
                        fs.unlinkSync(filePath);
                        totalDeleted++;
                    }
                } catch (_) {}
            }
        } catch (error) {
            console.error(`[cleanupTempFiles] Lỗi khi quét ${dir}:`, error.message);
        }
    }
    if (totalDeleted > 0) {
        console.log(`[cleanupTempFiles] Đã xóa ${totalDeleted} file tạm.`);
    }
}

// Tự động chạy dọn dẹp định kỳ
cleanupTempFiles(); // Dọn ngay khi khởi động
setInterval(cleanupTempFiles, CLEANUP_INTERVAL_MS);
