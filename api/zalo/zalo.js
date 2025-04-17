import { Zalo, ThreadType } from 'zca-js';
import { proxyService } from '../../proxyService.js';
import { setupEventListeners } from '../../eventListeners.js';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { saveImage, removeImage } from '../../helpers.js';
import nodefetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

export const zaloAccounts = [];

// Ánh xạ MIME type sang phần mở rộng file
const mimeToExtension = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif'
};

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
    const { userId, ownId } = req.body;
    if (!userId || !ownId) {
      return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    }
    const account = zaloAccounts.find((acc) => acc.ownId === ownId);
    if (!account) {
      return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
    }
    const result = await account.api.sendFriendRequest('Xin chào, hãy kết bạn với tôi!', userId);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function sendMessage(req, res) {
  try {
    const { message, threadId, type, ownId } = req.body;
    if (!message || !threadId || !ownId) {
      return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    }
    const account = zaloAccounts.find((acc) => acc.ownId === ownId);
    if (!account) {
      return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
    }
    const msgType = type || ThreadType.User;
    const result = await account.api.sendMessage(message, threadId, msgType);
    res.json({ success: true, data: result });
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

export async function loginZaloAccount(customProxy, cred) {
    let loginResolve;
    return new Promise(async (resolve, reject) => {
        loginResolve = resolve;
        let agent = null;
        let proxyUsed = null;
        let useCustomProxy = false;
        let proxies = [];

        try {
            const proxiesJson = fs.readFileSync('proxies.json', 'utf8');
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
                    fs.writeFileSync('proxies.json', JSON.stringify(proxies, null, 4), 'utf8');
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

        const zalo = agent
            ? new Zalo({ agent, polyfill: nodefetch })
            : new Zalo({ polyfill: nodefetch });

        let api;
        if (cred) {
            try {
                api = await zalo.login(cred);
            } catch (error) {
                console.error('Lỗi đăng nhập bằng cookie:', error);
                api = await zalo.loginQR(null, (qrData) => {
                    if (qrData?.data?.image) {
                        resolve(`data:image/png;base64,${qrData.data.image}`);
                    } else {
                        reject(new Error('Không thể lấy mã QR'));
                    }
                });
            }
        } else {
            const QR_TIMEOUT = 120000; // 2 phút
            const loginPromise = zalo.loginQR(null, (qrData) => {
                if (qrData?.data?.image) {
                    resolve(`data:image/png;base64,${qrData.data.image}`);
                } else {
                    reject(new Error('Không thể lấy mã QR'));
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
                reject(error);
                return;
            }
        }

        setupEventListeners(api, loginResolve);
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
        const ownId = profile.userId;
        const displayName = profile.displayName;

        const existingAccountIndex = zaloAccounts.findIndex((acc) => acc.ownId === api.getOwnId());
        if (existingAccountIndex !== -1) {
            zaloAccounts[existingAccountIndex] = {
                api,
                ownId: api.getOwnId(),
                proxy: useCustomProxy ? customProxy : proxyUsed?.url || null,
                phoneNumber,
            };
        } else {
            zaloAccounts.push({
                api,
                ownId: api.getOwnId(),
                proxy: useCustomProxy ? customProxy : proxyUsed?.url || null,
                phoneNumber,
            });
        }

        if (!useCustomProxy && proxyUsed) {
            const proxyAccount = proxyUsed.accounts.find((acc) => acc.api === api);
            if (proxyAccount) proxyAccount.phoneNumber = phoneNumber;
        }

        const context = await api.getContext();
        const { imei, cookie, userAgent } = context;
        const data = { imei, cookie, userAgent };
        const cookiesDir = './cookies';
        if (!fs.existsSync(cookiesDir)) {
            fs.mkdirSync(cookiesDir);
        }
        fs.writeFile(`${cookiesDir}/cred_${ownId}.json`, JSON.stringify(data, null, 4), (err) => {
            if (err) console.error('Lỗi ghi file:', err);
        });

        console.log(
            `Đã đăng nhập ${ownId} (${displayName}) - ${phoneNumber} qua proxy ${
                useCustomProxy ? customProxy : proxyUsed?.url || 'không có proxy'
            }`
        );
    });
}