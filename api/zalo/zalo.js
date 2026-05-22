import { Zalo, ThreadType } from 'zca-js';
import { proxyService } from '../../proxyService.js';
import { setupEventListeners } from '../../eventListeners.js';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { saveImage, removeImage, saveFileFromUrl, fileTypeToExtension, getWebhookConfigs } from '../../helpers.js';
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

// MIME types mapping are now managed in helpers.js or locally for base64
const mimeToExtension = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif'
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

export async function changeFriendAlias(req, res) {
    try {
        const { uid, userId, alias, ownId } = req.body;
        const targetUid = uid || userId;

        if (!targetUid || !alias || !ownId) {
            return res.status(400).json({
                success: false,
                error: 'Thiếu dữ liệu: userId/uid, alias và ownId là bắt buộc'
            });
        }

        const account = zaloAccounts.find(acc => acc.ownId === ownId);

        if (!account) {
            return res.status(400).json({
                success: false,
                error: 'Không tìm thấy tài khoản Zalo với OwnId này'
            });
        }

        // Gọi API đổi tên gợi nhớ của zca-js
        const result = await account.api.changeFriendAlias(alias, targetUid);

        res.json({
            success: true,
            message: 'Đổi tên gợi nhớ thành công',
            data: {
                uid: targetUid,
                alias,
                result
            }
        });

    } catch (error) {
        console.error('Lỗi changeFriendAlias:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
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
            actualFilePath = await saveFileFromUrl(filePath);
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

export async function sendFileToGroup(req, res) {
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
            actualFilePath = await saveFileFromUrl(filePath);
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
            ThreadType.Group
        ).catch(console.error);

        removeImage(actualFilePath);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// =========================
// SEND VIDEO TO USER
// Required: ownId, threadId, videoUrl, thumbnailUrl
// Optional: message
// =========================
export async function sendVideoToUser(req, res) {
    try {
        const {
            ownId,
            threadId,
            videoUrl,
            thumbnailUrl,
            message
        } = req.body;

        if (!ownId || !threadId || !videoUrl || !thumbnailUrl) {
            return res.status(400).json({
                success: false,
                error: 'Thiếu dữ liệu: ownId, threadId, videoUrl và thumbnailUrl là bắt buộc'
            });
        }

        const account = zaloAccounts.find(acc => acc.ownId === ownId);

        if (!account) {
            return res.status(400).json({
                success: false,
                error: 'Không tìm thấy tài khoản Zalo với OwnId này'
            });
        }

        // Nếu videoUrl là remote URL hợp lệ (http/https), thử sử dụng trực tiếp api.sendVideo.
        const isWebUrl = videoUrl && (videoUrl.startsWith('http://') || videoUrl.startsWith('https://'));

        if (isWebUrl) {
            try {
                const result = await account.api.sendVideo(
                    {
                        videoUrl: videoUrl,
                        thumbnailUrl: thumbnailUrl || '',
                        msg: message || ''
                    },
                    threadId,
                    ThreadType.User
                );

                return res.json({
                    success: true,
                    data: result
                });
            } catch (err) {
                console.warn('Lỗi gửi video trực tiếp qua URL, chuyển sang tải về và gửi dưới dạng file đính kèm:', err.message);
            }
        }

        // Ngược lại (hoặc nếu gửi trực tiếp URL thất bại), tải video về local
        // và gửi dưới dạng file đính kèm (Zalo sẽ tự sinh thumbnail trên server).
        let actualVideoPath = videoUrl;
        let isTempVideo = false;

        if (isWebUrl) {
            actualVideoPath = await saveFileFromUrl(videoUrl);
            isTempVideo = true;
            if (!actualVideoPath) {
                return res.status(500).json({
                    success: false,
                    error: 'Không thể tải video từ URL'
                });
            }
        }

        if (!actualVideoPath) {
            return res.status(400).json({
                success: false,
                error: 'Không tìm thấy hoặc không thể xử lý video đầu vào'
            });
        }

        const result = await account.api.sendMessage(
            {
                msg: message || '',
                attachments: [actualVideoPath]
            },
            threadId,
            ThreadType.User
        );

        if (isTempVideo && actualVideoPath) {
            removeImage(actualVideoPath);
        }

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Lỗi sendVideoToUser:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

// =========================
// SEND VIDEO TO GROUP
// Required: ownId, threadId, videoUrl, thumbnailUrl
// Optional: message
// =========================
export async function sendVideoToGroup(req, res) {
    try {
        const {
            ownId,
            threadId,
            videoUrl,
            thumbnailUrl,
            message
        } = req.body;

        if (!ownId || !threadId || !videoUrl || !thumbnailUrl) {
            return res.status(400).json({
                success: false,
                error: 'Thiếu dữ liệu: ownId, threadId, videoUrl và thumbnailUrl là bắt buộc'
            });
        }

        const account = zaloAccounts.find(acc => acc.ownId === ownId);

        if (!account) {
            return res.status(400).json({
                success: false,
                error: 'Không tìm thấy tài khoản Zalo với OwnId này'
            });
        }

        // Nếu videoUrl là remote URL hợp lệ (http/https), thử sử dụng trực tiếp api.sendVideo.
        const isWebUrl = videoUrl && (videoUrl.startsWith('http://') || videoUrl.startsWith('https://'));

        if (isWebUrl) {
            try {
                const result = await account.api.sendVideo(
                    {
                        videoUrl: videoUrl,
                        thumbnailUrl: thumbnailUrl || '',
                        msg: message || ''
                    },
                    threadId,
                    ThreadType.Group
                );

                return res.json({
                    success: true,
                    data: result
                });
            } catch (err) {
                console.warn('Lỗi gửi video trực tiếp qua URL, chuyển sang tải về và gửi dưới dạng file đính kèm:', err.message);
            }
        }

        // Ngược lại (hoặc nếu gửi trực tiếp URL thất bại), tải video về local
        // và gửi dưới dạng file đính kèm (Zalo sẽ tự sinh thumbnail trên server).
        let actualVideoPath = videoUrl;
        let isTempVideo = false;

        if (isWebUrl) {
            actualVideoPath = await saveFileFromUrl(videoUrl);
            isTempVideo = true;
            if (!actualVideoPath) {
                return res.status(500).json({
                    success: false,
                    error: 'Không thể tải video từ URL'
                });
            }
        }

        if (!actualVideoPath) {
            return res.status(400).json({
                success: false,
                error: 'Không tìm thấy hoặc không thể xử lý video đầu vào'
            });
        }

        const result = await account.api.sendMessage(
            {
                msg: message || '',
                attachments: [actualVideoPath]
            },
            threadId,
            ThreadType.Group
        );

        if (isTempVideo && actualVideoPath) {
            removeImage(actualVideoPath);
        }

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Lỗi sendVideoToGroup:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

// =========================
// GET ALIAS LIST
// Required: ownId
// =========================
export async function getAliasList(req, res) {
    try {
        const { ownId } = req.body;

        if (!ownId) {
            return res.status(400).json({
                success: false,
                error: 'Thiếu ownId'
            });
        }

        const account = zaloAccounts.find(acc => acc.ownId === ownId);

        if (!account) {
            return res.status(400).json({
                success: false,
                error: 'Không tìm thấy tài khoản Zalo với OwnId này'
            });
        }

        const result = await account.api.getAliasList();

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Lỗi getAliasList:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

// =========================
// GET ALL FRIENDS
// Required: ownId
// =========================
export async function getAllFriends(req, res) {
    try {
        const { ownId } = req.body;

        if (!ownId) {
            return res.status(400).json({
                success: false,
                error: 'Thiếu ownId'
            });
        }

        const account = zaloAccounts.find(acc => acc.ownId === ownId);

        if (!account) {
            return res.status(400).json({
                success: false,
                error: 'Không tìm thấy tài khoản Zalo với OwnId này'
            });
        }

        const result = await account.api.getAllFriends();

        res.json({
            success: true,
            total: Array.isArray(result) ? result.length : 0,
            data: result
        });
    } catch (error) {
        console.error('Lỗi getAllFriends:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

// =========================
// GET ALL GROUPS
// Required: ownId
// =========================
export async function getAllGroups(req, res) {
    try {
        const { ownId } = req.body;

        if (!ownId) {
            return res.status(400).json({
                success: false,
                error: 'Thiếu ownId'
            });
        }

        const account = zaloAccounts.find(acc => acc.ownId === ownId);

        if (!account) {
            return res.status(400).json({
                success: false,
                error: 'Không tìm thấy tài khoản Zalo với OwnId này'
            });
        }

        const result = await account.api.getAllGroups();

        res.json({
            success: true,
            total: Array.isArray(result) ? result.length : 0,
            data: result
        });
    } catch (error) {
        console.error('Lỗi getAllGroups:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

// =========================
// GET SENT FRIEND REQUEST
// Required: ownId
// =========================
export async function getSentFriendRequest(req, res) {
    try {
        const { ownId } = req.body;

        if (!ownId) {
            return res.status(400).json({
                success: false,
                error: 'Thiếu ownId'
            });
        }

        const account = zaloAccounts.find(acc => acc.ownId === ownId);

        if (!account) {
            return res.status(400).json({
                success: false,
                error: 'Không tìm thấy tài khoản Zalo với OwnId này'
            });
        }

        const result = await account.api.getSentFriendRequest();

        res.json({
            success: true,
            total: Array.isArray(result) ? result.length : 0,
            data: result
        });
    } catch (error) {
        console.error('Lỗi getSentFriendRequest:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

export async function sendMessage(req, res) {
    try {
        const { message, threadId, type, ownId, imagePath, videoUrl, videoThumbnailUrl } = req.body;
        if ((!message && !imagePath && !videoUrl) || !threadId || !ownId) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ: message, imagePath hoặc videoUrl và threadId là bắt buộc' });
        }
        const account = zaloAccounts.find((acc) => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }
        const msgType = type || ThreadType.User;
        const isGroup = msgType === ThreadType.Group || type == 1 || type == '1';

        let videoResult = null;
        if (videoUrl && videoThumbnailUrl) {
            const subResMock = {
                status: function () { return this; },
                json: function (d) { videoResult = d; return d; }
            };
            const videoServiceFunc = isGroup ? sendVideoToGroup : sendVideoToUser;
            await videoServiceFunc({
                body: {
                    ownId,
                    threadId,
                    videoUrl,
                    thumbnailUrl: videoThumbnailUrl,
                    message: ''
                }
            }, subResMock);
        }

        let imageResult = null;
        if (imagePath) {
            const subResMock = {
                status: function () { return this; },
                json: function (d) { imageResult = d; return d; }
            };
            const imageServiceFunc = isGroup ? sendImageToGroup : sendImageToUser;
            await imageServiceFunc({ body: { imagePath, threadId, ownId } }, subResMock);
        }

        let textResult = null;
        if (message) {
            textResult = await account.api.sendMessage(message, threadId, msgType).catch(e => ({ error: e.message }));
            account.lastAPIMessage = message;
            console.log('SetLastMessage: ' + account.lastAPIMessage);
        }

        const combinedData = {
            textResult: textResult || null,
            imageResult: imageResult || null,
            videoResult: videoResult || null
        };
        const isSuccess = (textResult && !textResult.error) || 
                          (imageResult && imageResult.success) || 
                          (videoResult && videoResult.success);
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
        const configs = getWebhookConfigs(ownId);
        if (configs.length === 0) return;

        const payload = {
            event: status === 'connected' ? 'zalo.connected' : 'zalo.disconnected',
            ownId,
            timestamp: new Date().toISOString(),
            status
        };
        if (error) payload.error = error;

        for (const config of configs) {
            const webhookUrl = config.url;
            if (!webhookUrl) continue;

            await nodefetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            console.log(`[Webhook] Sent ${status} for ${ownId} to ${webhookUrl}`);
        }
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
             const acc = zaloAccounts.find(a => a.ownId === ownId);
             if (acc) { acc.online = true; acc.lastCheck = new Date().toISOString(); }
             if (onEvent) onEvent({ type: 'connected', data: { ownId } });
        });

        api.listener.on('disconnected', () => {
            console.log(`[Zalo:${ownId}] Disconnected`);
            notifyConnectionStatus(ownId, 'disconnected');
            const acc = zaloAccounts.find(a => a.ownId === ownId);
            if (acc) { acc.online = false; acc.lastCheck = new Date().toISOString(); }
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
        const now = new Date();
        if (existingAccountIndex !== -1) {
            zaloAccounts[existingAccountIndex] = {
                api,
                ownId: api.getOwnId(),
                proxy: useCustomProxy ? customProxy : proxyUsed?.url || null,
                phoneNumber,
                lastAPIMessage: "",
                online: true,
                lastCheck: now.toISOString()
            };
        } else {
            zaloAccounts.push({
                api,
                ownId: api.getOwnId(),
                proxy: useCustomProxy ? customProxy : proxyUsed?.url || null,
                phoneNumber,
                lastAPIMessage: "",
                online: true,
                lastCheck: now.toISOString()
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

// =========================
// GET GROUP MEMBERS INFO
// Required: ownId
// Optional: groupId, memberId
// =========================
export async function getGroupMembersInfo(req, res) {
    try {
        const { groupId, memberId, ownId } = req.body;
        if (!ownId) {
            return res.status(400).json({ success: false, error: 'Thiếu ownId' });
        }
        const account = zaloAccounts.find(acc => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ success: false, error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }

        let targetMemberIds = memberId;
        if (groupId) {
            const groupInfo = await account.api.getGroupInfo(groupId);
            if (groupInfo && groupInfo.gridInfoMap && groupInfo.gridInfoMap[groupId]) {
                targetMemberIds = groupInfo.gridInfoMap[groupId].memberIds;
            } else {
                return res.status(404).json({ success: false, error: 'Không tìm thấy thông tin nhóm hoặc nhóm không tồn tại' });
            }
        }

        if (!targetMemberIds || (Array.isArray(targetMemberIds) && targetMemberIds.length === 0)) {
            return res.status(400).json({ success: false, error: 'Dữ liệu không hợp lệ: Cần cung cấp groupId hoặc memberId' });
        }

        const result = await account.api.getGroupMembersInfo(targetMemberIds);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// =========================
// GET MULTI USERS BY PHONES
// Required: ownId, phones/phoneNumbers
// Optional: avatarSize
// =========================
export async function getMultiUsersByPhones(req, res) {
    try {
        const { phones, phoneNumbers, ownId, avatarSize } = req.body;
        if (!ownId) {
            return res.status(400).json({ success: false, error: 'Thiếu ownId' });
        }
        const targetPhones = phones || phoneNumbers;
        if (!targetPhones || (Array.isArray(targetPhones) && targetPhones.length === 0)) {
            return res.status(400).json({ success: false, error: 'Dữ liệu không hợp lệ: phones hoặc phoneNumbers là bắt buộc' });
        }
        const account = zaloAccounts.find(acc => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ success: false, error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }
        const result = await account.api.getMultiUsersByPhones(targetPhones, avatarSize);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// =========================
// GET FRIEND REQUEST STATUS
// Required: ownId, userId/friendId
// =========================
export async function getFriendRequestStatus(req, res) {
    try {
        const { userId, friendId, ownId } = req.body;
        const targetUserId = userId || friendId;
        if (!targetUserId || !ownId) {
            return res.status(400).json({ success: false, error: 'Dữ liệu không hợp lệ: userId/friendId và ownId là bắt buộc' });
        }
        const account = zaloAccounts.find(acc => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ success: false, error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }
        const result = await account.api.getFriendRequestStatus(targetUserId);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

