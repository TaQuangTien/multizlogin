import express from 'express';
import fs from 'fs';
import { apiKeyAuth } from './middleware.js';
import {
    findUser,
    getUserInfo,
    sendFriendRequest,
    undoFriendRequest,
    sendMessage,
    createGroup,
    getGroupInfo,
    addUserToGroup,
    removeUserFromGroup,
    sendImageToUser,
    sendImagesToUser,
    sendImageToGroup,
    sendImagesToGroup,
    sendFileToUser,
    sendFileToGroup,
    changeFriendAlias,
    sendVideoToUser,
    sendVideoToGroup,
    getAliasList,
    getAllFriends,
    getAllGroups,
    getSentFriendRequest,
    getGroupMembersInfo,
    getMultiUsersByPhones,
    getFriendRequestStatus
} from './zaloService.js';
import { zaloAccounts } from './api/zalo/zalo.js';
import { getFullWebhookConfig } from './helpers.js';

const router = express.Router();

// Áp dụng middleware apiKeyAuth cho tất cả các route API
router.use(apiKeyAuth);

// Lấy danh sách tài khoản đã đăng nhập
router.get('/accounts', (req, res) => {
  if (zaloAccounts.length === 0) {
    return res.json({ success: true, message: 'Chưa có tài khoản nào đăng nhập' });
  }
  const data = zaloAccounts.map((acc) => ({
    ownId: acc.ownId,
    proxy: acc.proxy,
    phoneNumber: acc.phoneNumber || 'N/A',
    online: acc.online || false,
    lastCheck: acc.lastCheck || null,
  }));
  res.json(data);
});

router.post('/findUser', findUser);
router.post('/getUserInfo', getUserInfo);
router.post('/sendFriendRequest', sendFriendRequest);
router.post('/sendmessage', sendMessage);
router.post('/createGroup', createGroup);
router.post('/getGroupInfo', getGroupInfo);
router.post('/addUserToGroup', addUserToGroup);
router.post('/removeUserFromGroup', removeUserFromGroup);
router.post('/sendImageToUser', sendImageToUser);
router.post('/sendImagesToUser', sendImagesToUser);
router.post('/sendImageToGroup', sendImageToGroup);
router.post('/sendImagesToGroup', sendImagesToGroup);
router.post('/sendFileToUser', sendFileToUser);
router.post('/sendFileToGroup', sendFileToGroup);
router.post('/undoFriendRequest', undoFriendRequest);
router.post('/changeFriendAlias', changeFriendAlias);
router.post('/sendVideoToUser', sendVideoToUser);
router.post('/sendVideoToGroup', sendVideoToGroup);
router.post('/getAliasList', getAliasList);
router.post('/getAllFriends', getAllFriends);
router.post('/getAllGroups', getAllGroups);
router.post('/getSentFriendRequest', getSentFriendRequest);
router.post('/getGroupMembersInfo', getGroupMembersInfo);
router.post('/getMultiUsersByPhones', getMultiUsersByPhones);
router.post('/getFriendRequestStatus', getFriendRequestStatus);

router.get('/health', (req, res) => {
  const data = zaloAccounts.map((acc) => ({
    ownId: acc.ownId,
    status: acc.api ? 'ONLINE' : 'LOGOUT',
    phoneNumber: acc.phoneNumber || 'N/A',
  }));
  res.json({ success: true, accounts: data });
});

router.post('/updateWebhookByAccount', (req, res) => {
  const { ownId, url, settings, pullMode } = req.body;
  if (!ownId || !url) {
    return res.status(400).json({ error: 'ownId và url là bắt buộc' });
  }
  const multiWebhookPath = '/app/zalo_data/webhooks.json';
  try {
    const config = getFullWebhookConfig();
    if (!config[ownId] || !Array.isArray(config[ownId])) {
      config[ownId] = [];
    }
    const targetUrl = url.trim();
    const existingIndex = config[ownId].findIndex(w => w && w.url === targetUrl);
    const updatedWebhook = {
      url: targetUrl,
      settings: settings || { receiveReaction: true, receiveGroupEvent: true },
      pullMode: pullMode || false
    };
    if (existingIndex !== -1) {
      config[ownId][existingIndex] = updatedWebhook;
    } else {
      config[ownId].push(updatedWebhook);
    }
    fs.writeFileSync(multiWebhookPath, JSON.stringify(config, null, 4), 'utf8');
    res.json({ success: true, message: `Webhook cho ${ownId} đã được cập nhật` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API schema for Playground
const apiDocs = [
  {
    method: 'GET',
    path: '/accounts',
    description: 'Lấy danh sách tài khoản đã đăng nhập',
    params: [],
    responseExample: JSON.stringify([{ ownId: '0000000000000000001', proxy: null, phoneNumber: '0123456789' }], null, 2)
  },
  {
    method: 'GET',
    path: '/health',
    description: 'Kiểm tra trạng thái hoạt động của hệ thống',
    params: [],
    responseExample: JSON.stringify({ success: true, accounts: [{ ownId: '0000000000000000001', status: 'ONLINE', phoneNumber: '0123456789' }] }, null, 2)
  },
  {
    method: 'POST',
    path: '/findUser',
    description: 'Tìm kiếm người dùng theo số điện thoại',
    params: [
      { name: 'phone', type: 'text', required: true, placeholder: '0901234567', description: 'Số điện thoại cần tìm' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { phone: '0901234567', ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/getUserInfo',
    description: 'Lấy thông tin chi tiết của một người dùng',
    params: [
      { name: 'userId', type: 'text', required: true, placeholder: '0000000000000000001', description: 'ID người dùng cần lấy thông tin' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { userId: '0000000000000000001', ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/sendFriendRequest',
    description: 'Gửi lời mời kết bạn',
    params: [
      { name: 'userId', type: 'text', required: true, placeholder: '0000000000000000002', description: 'ID người dùng nhận lời mời' },
      { name: 'message', type: 'text', required: false, placeholder: 'Chào bạn...', description: 'Lời nhắn kèm theo' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { userId: '0000000000000000002', message: 'Chào bạn, mình kết bạn nhé!', ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/undoFriendRequest',
    description: 'Thu hồi lời mời kết bạn đã gửi',
    params: [
      { name: 'userId', type: 'text', required: true, placeholder: '0000000000000000002', description: 'ID người dùng đã gửi lời mời' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { userId: '0000000000000000002', ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/sendmessage',
    description: 'Gửi tin nhắn văn bản đến người dùng hoặc nhóm',
    params: [
      { name: 'message', type: 'textarea', required: true, placeholder: 'Nội dung tin nhắn', description: 'Nội dung tin nhắn' },
      { name: 'threadId', type: 'text', required: true, placeholder: 'USER_OR_GROUP_ID', description: 'ID người dùng hoặc nhóm' },
      { name: 'type', type: 'select', required: false, description: 'Loại thread', options: [
        { value: '0', label: 'User (0)' },
        { value: '1', label: 'Group (1)' }
      ]},
      { name: 'imagePath', type: 'text', required: false, placeholder: 'https://example.com/image.jpg', description: 'Đường dẫn ảnh đính kèm' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { message: 'Xin chào!', threadId: 'USER_OR_GROUP_ID', type: '0', ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/sendImageToUser',
    description: 'Gửi ảnh đến một người dùng',
    params: [
      { name: 'imagePath', type: 'text', required: false, placeholder: 'https://example.com/image.jpg', description: 'Đường dẫn ảnh (URL)' },
      { name: 'imageData', type: 'textarea', required: false, placeholder: 'data:image/jpeg;base64,...', description: 'Dữ liệu ảnh base64 (ưu tiên hơn imagePath)' },
      { name: 'threadId', type: 'text', required: true, placeholder: 'USER_ID', description: 'ID người dùng nhận' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { imagePath: 'https://example.com/image.jpg', threadId: 'USER_ID', ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/sendImageToGroup',
    description: 'Gửi ảnh vào một nhóm',
    params: [
      { name: 'imagePath', type: 'text', required: false, placeholder: 'https://example.com/image.jpg', description: 'Đường dẫn ảnh (URL)' },
      { name: 'imageData', type: 'textarea', required: false, placeholder: 'data:image/jpeg;base64,...', description: 'Dữ liệu ảnh base64' },
      { name: 'threadId', type: 'text', required: true, placeholder: 'GROUP_ID', description: 'ID nhóm nhận' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { imagePath: 'https://example.com/group-image.jpg', threadId: 'GROUP_ID', ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/sendFileToUser',
    description: 'Gửi file đến người dùng',
    params: [
      { name: 'filePath', type: 'text', required: false, placeholder: 'https://example.com/doc.pdf', description: 'Đường dẫn file (URL)' },
      { name: 'fileData', type: 'textarea', required: false, placeholder: 'base64_encoded_data', description: 'Dữ liệu file base64' },
      { name: 'mimeType', type: 'text', required: false, placeholder: 'application/pdf', description: 'MIME type của file' },
      { name: 'threadId', type: 'text', required: true, placeholder: 'USER_ID', description: 'ID người dùng nhận' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { filePath: 'https://example.com/doc.pdf', threadId: 'USER_ID', ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/sendFileToGroup',
    description: 'Gửi file vào nhóm',
    params: [
      { name: 'filePath', type: 'text', required: false, placeholder: 'https://example.com/doc.pdf', description: 'Đường dẫn file (URL)' },
      { name: 'fileData', type: 'textarea', required: false, placeholder: 'base64_encoded_data', description: 'Dữ liệu file base64' },
      { name: 'mimeType', type: 'text', required: false, placeholder: 'application/pdf', description: 'MIME type của file' },
      { name: 'threadId', type: 'text', required: true, placeholder: 'GROUP_ID', description: 'ID nhóm nhận' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { filePath: 'https://example.com/doc.pdf', threadId: 'GROUP_ID', ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/createGroup',
    description: 'Tạo nhóm mới',
    params: [
      { name: 'members', type: 'text', required: true, placeholder: '[\"ID1\", \"ID2\"]', description: 'Mảng JSON các ID thành viên' },
      { name: 'name', type: 'text', required: false, placeholder: 'Tên nhóm mới', description: 'Tên nhóm' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { members: ['0000000000000000002', '0000000000000000003'], name: 'Nhóm Mới', ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/getGroupInfo',
    description: 'Lấy thông tin chi tiết của nhóm',
    params: [
      { name: 'groupId', type: 'text', required: true, placeholder: 'GROUP_ID', description: 'ID nhóm (hoặc mảng JSON các ID)' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { groupId: '0000000000000000000', ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/addUserToGroup',
    description: 'Thêm thành viên vào nhóm',
    params: [
      { name: 'groupId', type: 'text', required: true, placeholder: 'GROUP_ID', description: 'ID nhóm' },
      { name: 'memberId', type: 'text', required: true, placeholder: '[\"USER_ID\"]', description: 'ID thành viên hoặc mảng JSON' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { groupId: '0000000000000000000', memberId: ['0000000000000000001'], ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/removeUserFromGroup',
    description: 'Xóa thành viên khỏi nhóm',
    params: [
      { name: 'groupId', type: 'text', required: true, placeholder: 'GROUP_ID', description: 'ID nhóm' },
      { name: 'memberId', type: 'text', required: true, placeholder: '[\"USER_ID\"]', description: 'ID thành viên hoặc mảng JSON' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { groupId: '0000000000000000000', memberId: ['0000000000000000001'], ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/changeFriendAlias',
    description: 'Đổi tên gợi nhớ của bạn bè',
    params: [
      { name: 'userId', type: 'text', required: true, placeholder: 'FRIEND_ID', description: 'ID người dùng' },
      { name: 'alias', type: 'text', required: true, placeholder: 'Tên mới', description: 'Tên gợi nhớ mới' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { userId: '0000000000000000001', alias: 'Bạn thân', ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/sendVideoToUser',
    description: 'Gửi video đến người dùng',
    params: [
      { name: 'videoUrl', type: 'text', required: true, placeholder: 'https://example.com/video.mp4', description: 'Đường dẫn hoặc URL của video (mp4 hoặc file local)' },
      { name: 'thumbnailUrl', type: 'text', required: true, placeholder: 'https://example.com/thumb.jpg', description: 'Đường dẫn hoặc URL của ảnh thumbnail (bắt buộc)' },
      { name: 'message', type: 'text', required: false, placeholder: 'Nội dung tin nhắn', description: 'Nội dung tin nhắn đi kèm' },
      { name: 'threadId', type: 'text', required: true, placeholder: 'USER_ID', description: 'ID người dùng nhận video' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { videoUrl: 'https://example.com/video.mp4', thumbnailUrl: 'https://example.com/thumb.jpg', threadId: 'USER_ID', ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/sendVideoToGroup',
    description: 'Gửi video vào nhóm',
    params: [
      { name: 'videoUrl', type: 'text', required: true, placeholder: 'https://example.com/video.mp4', description: 'Đường dẫn hoặc URL của video (mp4 hoặc file local)' },
      { name: 'thumbnailUrl', type: 'text', required: true, placeholder: 'https://example.com/thumb.jpg', description: 'Đường dẫn hoặc URL của ảnh thumbnail (bắt buộc)' },
      { name: 'message', type: 'text', required: false, placeholder: 'Nội dung tin nhắn', description: 'Nội dung tin nhắn đi kèm' },
      { name: 'threadId', type: 'text', required: true, placeholder: 'GROUP_ID', description: 'ID nhóm nhận video' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { videoUrl: 'https://example.com/video.mp4', thumbnailUrl: 'https://example.com/thumb.jpg', threadId: 'GROUP_ID', ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/getAliasList',
    description: 'Lấy danh sách tên gợi nhớ (alias) đã cài đặt',
    params: [
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/getAllFriends',
    description: 'Lấy danh sách tất cả bạn bè',
    params: [
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/getAllGroups',
    description: 'Lấy danh sách tất cả các nhóm tham gia',
    params: [
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/getSentFriendRequest',
    description: 'Lấy danh sách các lời mời kết bạn đã gửi',
    params: [
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/getGroupMembersInfo',
    description: 'Lấy thông tin chi tiết các thành viên trong nhóm',
    params: [
      { name: 'groupId', type: 'text', required: false, placeholder: 'GROUP_ID', description: 'ID nhóm cần lấy thông tin thành viên (hoặc truyền memberId)' },
      { name: 'memberId', type: 'text', required: false, placeholder: '[\"MEMBER_ID\"]', description: 'Mảng JSON hoặc chuỗi ID thành viên cụ thể' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { groupId: 'YOUR_GROUP_ID', ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/getMultiUsersByPhones',
    description: 'Tra cứu thông tin Zalo của nhiều số điện thoại cùng lúc',
    params: [
      { name: 'phones', type: 'text', required: true, placeholder: '[\"0901234567\"]', description: 'Mảng JSON hoặc chuỗi các số điện thoại cần tra cứu (hoặc phân tách bằng dấu phẩy)' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { phones: ['0901234567', '0907654321'], ownId: 'YOUR_OWN_ID' }
  },
  {
    method: 'POST',
    path: '/getFriendRequestStatus',
    description: 'Kiểm tra trạng thái yêu cầu kết bạn với người dùng',
    params: [
      { name: 'userId', type: 'text', required: true, placeholder: 'USER_ID', description: 'ID người dùng cần kiểm tra (hoặc friendId)' },
      { name: 'ownId', type: 'account', required: true, description: 'ID tài khoản Zalo thực hiện' }
    ],
    exampleBody: { userId: 'USER_ID', ownId: 'YOUR_OWN_ID' }
  }
];

router.get('/api-docs', (req, res) => {
  res.json({ success: true, apiKey: process.env.X_API_KEY || '', endpoints: apiDocs });
});

export default router;