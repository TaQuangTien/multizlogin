// api/zalo/zalo.js
import { Zalo, ThreadType } from 'zca-js';
import { proxyService } from '../../proxyService.js';
import { setupEventListeners } from '../../eventListeners.js';
import { HttpsProxyAgent } from 'https-proxy-agent';
import nodefetch from 'node-fetch';
import fs from 'fs';

export const zaloAccounts = [];

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
      return res.status(400).json({ error: 'Dữ PROGRESS liệu không hợp lệ' });
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

// Hàm gửi một hình ảnh đến người dùng
export async function sendImageToUser(req, res) {
    try {
        const { imagePath: imageUrl, threadId, ownId } = req.body;
        if (!imageUrl || !threadId || !ownId) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ: imagePath và threadId là bắt buộc' });
        }

       
        const imagePath = await saveImage(imageUrl);
        if (!imagePath) return res.status(500).json({ success: false, error: 'Failed to save image' });

        const account = zaloAccounts.find(acc => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }

        const result = await account.api.sendMessage(
            {
                msg: "",
                attachments: [imagePath]
            },
            threadId,
            ThreadType.User
        ).catch(console.error);

        removeImage(imagePath);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Hàm gửi nhiều hình ảnh đến người dùng
export async function sendImagesToUser(req, res) {
    try {
        const { imagePaths: imageUrls, threadId, ownId } = req.body;
        if (!imageUrls || !threadId || !ownId || !Array.isArray(imageUrls) || imageUrls.length === 0) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ: imagePaths phải là mảng không rỗng và threadId là bắt buộc' });
        }

      
        const imagePaths = [];
        for (const imageUrl of imageUrls) {
            const imagePath = await saveImage(imageUrl);
            if (!imagePath) {
                // Clean up any saved images
                for (const path of imagePaths) {
                    removeImage(path);
                }
                return res.status(500).json({ success: false, error: 'Failed to save one or more images' });
            }
            imagePaths.push(imagePath);
        }

        const account = zaloAccounts.find(acc => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }

        const result = await account.api.sendMessage(
            {
                msg: "",
                attachments: imagePaths
            },
            threadId,
            ThreadType.User
        ).catch(console.error);

        for (const imagePath of imagePaths) {
            removeImage(imagePath);
        }
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Hàm gửi một hình ảnh đến nhóm
export async function sendImageToGroup(req, res) {
    try {
        const { imagePath: imageUrl, threadId, ownId } = req.body;
        if (!imageUrl || !threadId || !ownId) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ: imagePath và threadId là bắt buộc' });
        }

       
        const imagePath = await saveImage(imageUrl);
        if (!imagePath) return res.status(500).json({ success: false, error: 'Failed to save image' });

        const account = zaloAccounts.find(acc => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }

        const result = await account.api.sendMessage(
            {
                msg: "",
                attachments: [imagePath]
            },
            threadId,
            ThreadType.Group
        ).catch(console.error);

        removeImage(imagePath);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Hàm gửi nhiều hình ảnh đến nhóm
export async function sendImagesToGroup(req, res) {
    try {
        const { imagePaths: imageUrls, threadId, ownId } = req.body;
        if (!imageUrls || !threadId || !ownId || !Array.isArray(imageUrls) || imageUrls.length === 0) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ: imagePaths phải là mảng không rỗng và threadId là bắt buộc' });
        }

      
        const imagePaths = [];
        for (const imageUrl of imageUrls) {
            const imagePath = await saveImage(imageUrl);
            if (!imagePath) {
                // Clean up any saved images
                for (const path of imagePaths) {
                    removeImage(path);
                }
                return res.status(500).json({ success: false, error: 'Failed to save one or more images' });
            }
            imagePaths.push(imagePath);
        }

        const account = zaloAccounts.find(acc => acc.ownId === ownId);
        if (!account) {
            return res.status(400).json({ error: 'Không tìm thấy tài khoản Zalo với OwnId này' });
        }

        const result = await account.api.sendMessage(
            {
                msg: "",
                attachments: imagePaths
            },
            threadId,
            ThreadType.Group
        ).catch(console.error);

        for (const imagePath of imagePaths) {
            removeImage(imagePath);
        }
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
      api = await zalo.loginQR(null, (qrData) => {
        if (qrData?.data?.image) {
          resolve(`data:image/png;base64,${qrData.data.image}`);
        } else {
          reject(new Error('Không thể lấy mã QR'));
        }
      });
    }

    setupEventListeners(api, loginResolve);
    api.listener.start();

    if (!useCustomProxy && proxyUsed) {
      proxyUsed.usedCount++;
      proxyUsed.accounts.push({ api, phoneNumber: null }); // Sẽ cập nhật phoneNumber sau
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
