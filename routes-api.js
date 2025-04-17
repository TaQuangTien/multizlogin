import express from 'express';
import { apiKeyAuth } from './middleware.js';
import { 
    findUser, 
    getUserInfo, 
    sendFriendRequest, 
    sendMessage,
    createGroup, 
    getGroupInfo, 
    addUserToGroup, 
    removeUserFromGroup,
    sendImageToUser,
    sendImagesToUser,
    sendImageToGroup,
    sendImagesToGroup
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

export default router;