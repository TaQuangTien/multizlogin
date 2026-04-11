import { Zalo, ThreadType } from 'zca-js';
import { proxyService } from '../../proxyService.js';
import { setupEventListeners } from '../../eventListeners.js';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { saveImage, removeImage } from '../../helpers.js';
import nodefetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Đọc biến môi trường SELF_LISTEN, mặc định là false nếu không được định nghĩa
const selfListen = process.env.SELF_LISTEN === 'true';
const DISCONNECT_THRESHOLD = 5;
const DISCONNECT_WINDOW_MS = 5 * 60_000; // 5 minutes

export const zaloAccounts = [];
const disconnectHistory = new Map();

// Ánh xạ MIME type sang phần mở rộng file
const mimeToExtension = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif'
};

// Ánh xạ MIME type sang phần mở rộng file cho các loại file phổ biến
const fileTypeToExtension = {
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

// Hàm lưu dữ liệu base64 thành file (hỗ trợ mọi loại file)
async function saveBase64File(base64Data, fileName, mimeType = null) {
    try {
        const tmpDir = './tmp';
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }

        let base64String = base64Data;
        let extension = '.bin';

        const dataUrlMatch = base64Data.match(/^data:([^;]+);base64,/);
        if (dataUrlMatch) {
            const detectedMimeType = dataUrlMatch[1];
            if (fileTypeToExtension[detectedMimeType]) {
                extension = fileTypeToExtension[detectedMimeType];
            }
            base64String = base64Data.replace(/^data:[^;]+;base64,/, '');
        } else if (mimeType && fileTypeToExtension[mimeType]) {
            extension = fileTypeToExtension[mimeType];
        }

        const buffer = Buffer.from(base64String, 'base64');
        const filePath = path.join(tmpDir, `${fileName}${extension}`);
        fs.writeFileSync(filePath, buffer);
        return filePath;
    } catch (error) {
        console.error('Lỗi khi lưu file từ base64:', error);
        return null;
    }
}

// Hàm lưu dữ liệu base64 thành file hình ảnh tạm
async function saveBase64Image(base64Data, fileName) {
    try {
        // Tạo thư mục tmp nếu chưa tồn tại
        const tmpDir = './tmp';
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }

        // Phân tích prefix để lấy MIME type
        let base64String = base64Data;
        let extension = '.png'; // Mặc định là PNG
        const mimeMatch = base64Data.match(/^data:(image\/[a-z]+);base64,/);
        if (mimeMatch) {
            const mimeType = mimeMatch[1];
            if (!mimeToExtension[mimeType]) {
                throw new Error(`Định dạng hình ảnh không được hỗ trợ: ${mimeType}`);
            }
            extension = mimeToExtension[mimeType];
            base64String = base64Data.replace(/^data:image\/\w+;base64,/, '');
        } else {
            console.warn('Không tìm thấy prefix MIME, sử dụng mặc định PNG');
        }

        const buffer = Buffer.from(base64String, 'base64');
        const filePath = path.join(tmpDir, `${fileName}${extension}`);
        fs.writeFileSync(filePath, buffer);
        return filePath;
    } catch (error) {
        console.error('Lỗi khi lưu hình ảnh từ base64:', error);
        return null;
    }
}

// Hàm gửi một hình ảnh đến người dùng
export async function sendImageToUser(req, res) {
    try {
        const { imagePath, imageData, threadId, ownId } = req.body;
        if ((!imagePath && !imageData) || !threadId || !ownId) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ: imagePath hoặc imageData và threadId là bắt buộc' });
        }

        let imageFilePath;
        const timestamp = Date.now();
        if (imagePath) {
            imageFilePath = await saveImage(imagePath);
        } else if (imageData) {
            imageFilePath = await saveBase64Image(imageData, `${timestamp}`);
        }
        if (!imageFilePath) {
            return res.status(500).json({ success: false, error: 'Không thể lưu hình ảnh' });
        }

        const account = zaloAccounts.find(acc => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }

        const result = await account.api.sendMessage(
            {
                msg: "",
                attachments: [imageFilePath]
            },
            threadId,
            ThreadType.User
        ).catch(console.error);

        removeImage(imageFilePath);

        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Hàm gửi nhiều hình ảnh đến người dùng
export async function sendImagesToUser(req, res) {
    try {
        const { imagePaths, imagesData, threadId, ownId } = req.body;
        if ((!imagePaths && !imagesData) || !threadId || !ownId ||
            (imagePaths && (!Array.isArray(imagePaths) || imagePaths.length === 0)) ||
            (imagesData && (!Array.isArray(imagesData) || imagesData.length === 0))) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ: imagePaths hoặc imagesData phải là mảng không rỗng và threadId là bắt buộc' });
        }

        const imageFiles = [];
        const timestamp = Date.now();
        if (imagePaths && Array.isArray(imagePaths)) {
            for (const imagePath of imagePaths) {
                const imageFilePath = await saveImage(imagePath);
                if (!imageFilePath) {
                    for (const path of imageFiles) {
                        removeImage(path);
                    }
                    return res.status(500).json({ success: false, error: 'Không thể lưu một hoặc nhiều hình ảnh từ imagePaths' });
                }
                imageFiles.push(imageFilePath);
            }
        }
        if (imagesData && Array.isArray(imagesData)) {
            for (let i = 0; i < imagesData.length; i++) {
                const imageFilePath = await saveBase64Image(imagesData[i], `${timestamp}_${i}`);
                if (!imageFilePath) {
                    for (const path of imageFiles) {
                        removeImage(path);
                    }
                    return res.status(500).json({ success: false, error: 'Không thể lưu một hoặc nhiều hình ảnh từ imagesData' });
                }
                imageFiles.push(imageFilePath);
            }
        }

        const account = zaloAccounts.find(acc => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }

        const result = await account.api.sendMessage(
            {
                msg: "",
                attachments: imageFiles
            },
            threadId,
            ThreadType.User
        ).catch(console.error);

        for (const imageFile of imageFiles) {
            removeImage(imageFile);
        }

        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Hàm gửi một hình ảnh đến nhóm
export async function sendImageToGroup(req, res) {
    try {
        const { imagePath, imageData, threadId, ownId } = req.body;
        if ((!imagePath && !imageData) || !threadId || !ownId) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ: imagePath hoặc imageData và threadId là bắt buộc' });
        }

        let imageFilePath;
        const timestamp = Date.now();
        if (imagePath) {
            imageFilePath = await saveImage(imagePath);
        } else if (imageData) {
            imageFilePath = await saveBase64Image(imageData, `${timestamp}`);
        }
        if (!imageFilePath) {
            return res.status(500).json({ success: false, error: 'Không thể lưu hình ảnh' });
        }

        const account = zaloAccounts.find(acc => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }

        const result = await account.api.sendMessage(
            {
                msg: "",
                attachments: [imageFilePath]
            },
            threadId,
            ThreadType.Group
        ).catch(console.error);

        removeImage(imageFilePath);

        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Hàm gửi nhiều hình ảnh đến nhóm
export async function sendImagesToGroup(req, res) {
    try {
        const { imagePaths, imagesData, threadId, ownId } = req.body;
        if ((!imagePaths && !imagesData) || !threadId || !ownId ||
            (imagePaths && (!Array.isArray(imagePaths) || imagePaths.length === 0)) ||
            (imagesData && (!Array.isArray(imagesData) || imagesData.length === 0))) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ: imagePaths hoặc imagesData phải là mảng không rỗng và threadId là bắt buộc' });
        }

        const imageFiles = [];
        const timestamp = Date.now();
        if (imagePaths && Array.isArray(imagePaths)) {
            for (const imagePath of imagePaths) {
                const imageFilePath = await saveImage(imagePath);
                if (!imageFilePath) {
                    for (const path of imageFiles) {
                        removeImage(path);
                    }
                    return res.status(500).json({ success: false, error: 'Không thể lưu một hoặc nhiều hình ảnh từ imagePaths' });
                }
                imageFiles.push(imageFilePath);
            }
        }
        if (imagesData && Array.isArray(imagesData)) {
            for (let i = 0; i < imagesData.length; i++) {
                const imageFilePath = await saveBase64Image(imagesData[i], `${timestamp}_${i}`);
                if (!imageFilePath) {
                    for (const path of imageFiles) {
                        removeImage(path);
                    }
                    return res.status(500).json({ success: false, error: 'Không thể lưu một hoặc nhiều hình ảnh từ imagesData' });
                }
                imageFiles.push(imageFilePath);
            }
        }

        const account = zaloAccounts.find(acc => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }

        const result = await account.api.sendMessage(
            {
                msg: "",
                attachments: imageFiles
            },
            threadId,
            ThreadType.Group
        ).catch(console.error);

        for (const imageFile of imageFiles) {
            removeImage(imageFile);
        }

        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Các hàm khác giữ nguyên từ phiên bản trước
export async function findUser(req, res) {
    try {
        const { phone, ownId } = req.body;
        if (!phone || !ownId) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
        }
        const account = zaloAccounts.find((acc) => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }
        const userData = await account.api.findUser(phone);
        res.json({ success: true, data: userData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function getUserInfo(req, res) {
    try {
        const { userId, ownId } = req.body;
        if (!userId || !ownId) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
        }
        const account = zaloAccounts.find((acc) => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }
        const info = await account.api.getUserInfo(userId);
        res.json({ success: true, data: info });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function sendFriendRequest(req, res) {
    try {
        const { userId, ownId, message } = req.body;
        if (!userId || !ownId) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
        }
        const account = zaloAccounts.find((acc) => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }
        const frMsg = message || 'Xin chào, hãy kết bạn với tôi!';
        const result = await account.api.sendFriendRequest(frMsg, userId);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function undoFriendRequest(req, res) {
    try {
        const { userId, ownId } = req.body;
        if (!userId || !ownId) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
        }
        const account = zaloAccounts.find((acc) => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }
        const result = await account.api.undoFriendRequest(userId);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function sendFileToUser(req, res) {
    try {
        const { filePath, fileData, mimeType, threadId, ownId } = req.body;
        if ((!filePath && !fileData) || !threadId || !ownId) {
            return res.status(400).json({
                error: 'Dữ liệu không hợp lệ: filePath hoặc fileData và threadId là bắt buộc'
            });
        }

        let actualFilePath;
        const timestamp = Date.now();

        if (filePath) {
            actualFilePath = await saveImage(filePath);
        } else if (fileData) {
            actualFilePath = await saveBase64File(fileData, `file_${timestamp}`, mimeType);
        }

        if (!actualFilePath) {
            return res.status(500).json({ success: false, error: 'Không thể lưu file' });
        }

        const account = zaloAccounts.find(acc => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }

        const result = await account.api.sendMessage(
            { msg: "", attachments: [actualFilePath] },
            threadId,
            ThreadType.User
        ).catch(console.error);

        removeImage(actualFilePath);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function sendMessage(req, res) {
    try {
        const { message, threadId, type, ownId, imagePath } = req.body;
        if ((!message && !imagePath) || !threadId || !ownId) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ: message hoặc imagePath và threadId là bắt buộc' });
        }
        const account = zaloAccounts.find((acc) => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }
        const msgType = type || ThreadType.User;

        let imageResult;
        if (imagePath) {
            const subResMock = {
                status: function () { return this; },
                json: function (d) { imageResult = d; return d; }
            };
            await sendImageToUser({ body: { imagePath, threadId, ownId } }, subResMock);
        }

        let textResult;
        if (message) {
            textResult = await account.api.sendMessage(message, threadId, msgType).catch(e => ({ error: e.message }));
            account.lastAPIMessage = message;
            console.log('SetLastMessage: ' + account.lastAPIMessage);
        }

        const combinedData = { textResult: textResult || null, imageResult: imageResult || null };
        const isSuccess = (textResult && !textResult.error) || (imageResult && imageResult.success);
        res.json({ success: isSuccess !== false, data: combinedData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function createGroup(req, res) {
    try {
        const { members, name, avatarPath, ownId } = req.body;
        if (!members || !Array.isArray(members) || members.length === 0 || !ownId) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
        }
        const account = zaloAccounts.find((acc) => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }
        const result = await account.api.createGroup({ members, name, avatarPath });
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function getGroupInfo(req, res) {
    try {
        const { groupId, ownId } = req.body;
        if (!groupId || (Array.isArray(groupId) && groupId.length === 0)) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
        }
        const account = zaloAccounts.find((acc) => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }
        const result = await account.api.getGroupInfo(groupId);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function addUserToGroup(req, res) {
    try {
        const { groupId, memberId, ownId } = req.body;
        if (!groupId || !memberId || (Array.isArray(memberId) && memberId.length === 0)) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
        }
        const account = zaloAccounts.find((acc) => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }
        const result = await account.api.addUserToGroup(memberId, groupId);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function removeUserFromGroup(req, res) {
    try {
        const { memberId, groupId, ownId } = req.body;
        if (!groupId || !memberId || (Array.isArray(memberId) && memberId.length === 0)) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
        }
        const account = zaloAccounts.find((acc) => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }
        const result = await account.api.removeUserFromGroup(memberId, groupId);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Hàm gửi webhook thông báo trạng thái kết nối
async function notifyConnectionStatus(ownId, status, error = null) {
    try {
        const configPath = '/app/zalo_data/webhook-config.json';
        if (!fs.existsSync(configPath)) return;
        
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const webhookUrl = config.connectionWebhookUrl || config.messageWebhookUrl; // Fallback to message webhook if connection one isn't set
        
        if (!webhookUrl) return;

        const payload = {
            event: status === 'connected' ? 'zalo.connected' : 'zalo.disconnected',
            ownId,
            timestamp: new Date().toISOString(),
            status
        };
        if (error) payload.error = error;

        await nodefetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log(`[Webhook] Sent ${status} for ${ownId}`);
    } catch (err) {
        console.error('[Webhook] Error sending connection status:', err.message);
    }
}

export async function loginZaloAccount(customProxy, cred, onEvent = null) {
    let loginResolve;
    return new Promise(async (resolve, reject) => {
        loginResolve = resolve;
        let agent = null;
        let proxyUsed = null;
        let useCustomProxy = false;
        let proxies = [];

        try {
            const proxiesJson = fs.readFileSync('/app/zalo_data/proxies.json', 'utf8');
            proxies = JSON.parse(proxiesJson);
        } catch (error) {
            console.error('Không thể đọc proxies.json:', error);
        }

        if (customProxy && customProxy.trim() !== '') {
            try {
                new URL(customProxy);
                useCustomProxy = true;
                agent = new HttpsProxyAgent(customProxy);

                if (!proxies.includes(customProxy)) {
                    proxies.push(customProxy);
                    fs.writeFileSync('/app/zalo_data/proxies.json', JSON.stringify(proxies, null, 4), 'utf8');
                    console.log(`Đã thêm proxy mới: ${customProxy}`);
                }
            } catch (err) {
                console.log(`Proxy không hợp lệ: ${customProxy}. Sẽ không dùng proxy.`);
                useCustomProxy = false;
                agent = null;
            }
        } else {
            if (proxies.length > 0) {
                const proxyIndex = proxyService.getAvailableProxyIndex();
                if (proxyIndex !== -1) {
                    proxyUsed = proxyService.getPROXIES()[proxyIndex];
                    agent = new HttpsProxyAgent(proxyUsed.url);
                }
            }
        }

        // Nhận sự kiện tin nhắn tới từ chính tài khoản này
        console.log('SELF_LISTEN:', selfListen);

        const zaloOptions = {
            polyfill: nodefetch,
            selfListen,
            imageMetadataGetter: async (imagePath) => {
                try {
                    const metadata = await sharp(imagePath).metadata();
                    const stats = fs.statSync(imagePath);
                    return {
                        width: metadata.width || 0,
                        height: metadata.height || 0,
                        size: stats.size || 0
                    };
                } catch (e) {
                    console.error('[imageMetadataGetter] Error:', e);
                    return null;
                }
            }
        };
        if (agent) zaloOptions.agent = agent;

        const zalo = new Zalo(zaloOptions);


        let api;
        if (cred) {
            try {
                api = await zalo.login(cred);
            } catch (error) {
                console.error('Lỗi đăng nhập bằng cookie:', error);
                if (onEvent) onEvent({ type: 'error', data: { message: 'Cookie expired, falling back to QR' } });
                api = await zalo.loginQR(null, (qrData) => {
                    if (qrData?.data?.image) {
                        if (onEvent) onEvent({ type: 'qr', data: { image: qrData.data.image } });
                        resolve(`data:image/png;base64,${qrData.data.image}`);
                    } else if (qrData.type === 2) { // Scanned
                         if (onEvent) onEvent({ type: 'scanned', data: qrData.data });
                    } else {
                        reject(new Error('Không thể lấy mã QR'));
                    }
                });
            }
        } else {
            const QR_TIMEOUT = 120000; // 2 phút
            const loginPromise = zalo.loginQR(null, (qrData) => {
                if (qrData?.type === 0) { // QR Generated
                    if (onEvent) onEvent({ type: 'qr', data: { image: qrData.data.image } });
                    resolve(`data:image/png;base64,${qrData.data.image}`);
                } else if (qrData.type === 1) { // QR Expired
                    if (onEvent) onEvent({ type: 'qr-expired' });
                } else if (qrData.type === 2) { // Scanned
                    if (onEvent) onEvent({ type: 'scanned', data: qrData.data });
                } else if (qrData.type === 4) { // Got Login info
                    // This is handled by the SDK internal resolve but we can log it
                }
            });

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error('QR code đã hết hạn, vui lòng thử lại'));
                }, QR_TIMEOUT);
            });

            try {
                api = await Promise.race([loginPromise, timeoutPromise]);
            } catch (error) {
                console.error('Lỗi đăng nhập QR:', error.message);
                if (onEvent) onEvent({ type: 'error', data: { message: error.message } });
                reject(error);
                return;
            }
        }

        setupEventListeners(api, loginResolve);
        
        const ownId = api.getOwnId();
        
        api.listener.on('connected', () => {
             console.log(`[Zalo:${ownId}] Connected`);
             notifyConnectionStatus(ownId, 'connected');
             if (onEvent) onEvent({ type: 'connected', data: { ownId } });
        });

        api.listener.on('disconnected', () => {
            console.log(`[Zalo:${ownId}] Disconnected`);
            notifyConnectionStatus(ownId, 'disconnected');
            if (onEvent) onEvent({ type: 'disconnected', data: { ownId } });
            
            // Circuit Breaker logic
            const now = Date.now();
            const history = (disconnectHistory.get(ownId) || []).filter(t => now - t < DISCONNECT_WINDOW_MS);
            history.push(now);
            disconnectHistory.set(ownId, history);

            if (history.length >= DISCONNECT_THRESHOLD) {
                console.error(`[Zalo:${ownId}] Circuit breaker triggered: ${history.length} disconnects in ${DISCONNECT_WINDOW_MS/60000}m. Auto-reconnect disabled.`);
                if (onEvent) onEvent({ type: 'error', data: { message: 'Session không ổn định, cần đăng nhập lại qua QR' } });
                // We could also delete cookies here to force QR next time
                return;
            }

            // Simple auto-reconnect fallback (SDK usually does this, but we track it)
        });

        api.listener.start();

        if (!useCustomProxy && proxyUsed) {
            proxyUsed.usedCount++;
            proxyUsed.accounts.push({ api, phoneNumber: null });
        }

        const accountInfo = await api.fetchAccountInfo();
        if (!accountInfo?.profile) {
            throw new Error('Không tìm thấy thông tin profile');
        }
        const { profile } = accountInfo;
        const phoneNumber = profile.phoneNumber;
        const displayName = profile.displayName;

        const existingAccountIndex = zaloAccounts.findIndex((acc) => acc.ownId === api.getOwnId());
        if (existingAccountIndex !== -1) {
            zaloAccounts[existingAccountIndex] = {
                api,
                ownId: api.getOwnId(),
                proxy: useCustomProxy ? customProxy : proxyUsed?.url || null,
                phoneNumber,
                lastAPIMessage: ""
            };
        } else {
            zaloAccounts.push({
                api,
                ownId: api.getOwnId(),
                proxy: useCustomProxy ? customProxy : proxyUsed?.url || null,
                phoneNumber,
                lastAPIMessage: ""
            });
        }

        if (!useCustomProxy && proxyUsed) {
            const proxyAccount = proxyUsed.accounts.find((acc) => acc.api === api);
            if (proxyAccount) proxyAccount.phoneNumber = phoneNumber;
        }

        // Lưu phiên đăng nhập
        let cookieData;
        try {
            const context = await api.getContext();
            cookieData = { imei: context.imei, cookie: context.cookie, userAgent: context.userAgent };
        } catch (e) {
            console.warn(`[Cookie] getContext() thất bại, dùng credential đầu vào: ${e.message}`);
            if (cred) {
                cookieData = { imei: cred.imei, cookie: cred.cookie, userAgent: cred.userAgent };
            }
        }

        if (cookieData) {
            const cookiesDir = '/app/cookies';
            if (!fs.existsSync(cookiesDir)) {
                fs.mkdirSync(cookiesDir, { recursive: true });
            }
            fs.writeFileSync(`${cookiesDir}/cred_${ownId}.json`, JSON.stringify(cookieData, null, 4));
            console.log(`[Cookie] Đã lưu phiên cho tài khoản ${ownId}`);
        } else {
            console.error(`[Cookie] Không thể lưu phiên cho tài khoản ${ownId}: không có dữ liệu`);
        }

        console.log(
            `Đã đăng nhập ${ownId} (${displayName}) - ${phoneNumber} qua proxy ${useCustomProxy ? customProxy : proxyUsed?.url || 'không có proxy'
            }`
        );
    });
}
