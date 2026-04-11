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
    sendFileToUser
} from './zaloService.js';
import { zaloAccounts } from './api/zalo/zalo.js';

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
router.post('/undoFriendRequest', undoFriendRequest);

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
  let config = {};
  if (fs.existsSync(multiWebhookPath)) {
    config = JSON.parse(fs.readFileSync(multiWebhookPath, 'utf8'));
  }
  config[ownId] = {
    url,
    settings: settings || { receiveReaction: true, receiveGroupEvent: true },
    pullMode: pullMode || false
  };
  fs.writeFileSync(multiWebhookPath, JSON.stringify(config, null, 4), 'utf8');
  res.json({ success: true, message: `Webhook cho ${ownId} đã được cập nhật` });
});

export default router;