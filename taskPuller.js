import axios from 'axios';
import { zaloAccounts } from './api/zalo/zalo.js';
import { getWebhookConfigs } from './helpers.js';
import * as zaloService from './zaloService.js';
import { addLog } from './routes-ui.js';

// const PULL_INTERVAL = 30000; // 30 seconds
const PULL_INTERVAL = (parseInt(process.env.PULL_INTERVAL, 10) || 60) * 1000;


async function pullTasks() {
    for (const account of zaloAccounts) {
        const configs = getWebhookConfigs(account.ownId);
        for (const config of configs) {
            if (config && config.pullMode && config.url) {
                try {
                    console.log(`Pulling tasks for account ${account.ownId} from ${config.url}...`);
                    const response = await axios.post(config.url, {
                        action: 'pull_tasks',
                        ownId: account.ownId
                    });

                    const tasks = response.data.tasks || [];
                    if (tasks.length > 0) {
                        console.log(`Received ${tasks.length} tasks for account ${account.ownId} from ${config.url}`);
                        addLog('Task Pull', `Nhận ${tasks.length} nhiệm vụ từ GAS`, account.ownId, { count: tasks.length });
                        for (const task of tasks) {
                            await executeTask(account, task, config.url);
                        }
                    }
                } catch (error) {
                    console.error(`Error pulling tasks for ${account.ownId} from ${config.url}:`, error.message);
                }
            }
        }
    }
}

async function executeTask(account, task, webhookUrl) {
    const { type, rowIndex } = task;
    const action = type;

    console.log(`Executing task ${action} (Row: ${rowIndex}) for ${account.ownId}`);

    let taskResult = { success: false, error: 'Unknown execution error' };
    const resMock = {
        status: function () { return this; },
        json: function (d) { taskResult = d; return d; }
    };

    try {
        // Map common actions to zaloService functions
        switch (action) {
            case '1':
            case 1:
            case 'sendGroupMessage':
            case 'sendMessage':
                await zaloService.sendMessage({
                    body: {
                        message: task.message,
                        threadId: task.uid,
                        imagePath: task.imagePath,
                        videoUrl: task.videoUrl,
                        videoThumbnailUrl: task.videoThumbnailUrl,
                        type: (action === 1 || action === '1' || action === 'sendGroupMessage') ? 1 : 0,
                        ownId: account.ownId
                    }
                }, resMock);
                break;
            case 'findUser':
                await zaloService.findUser({ body: { ...task, ownId: account.ownId } }, resMock);
                break;
            case 'sendFriendRequest':
                await zaloService.sendFriendRequest({ body: { ...task, ownId: account.ownId } }, resMock);
                break;
            case 'getUserInfo':
                await zaloService.getUserInfo({ body: { ...task, ownId: account.ownId } }, resMock);
                break;
            case 'undoFriendRequest':
                await zaloService.undoFriendRequest({ body: { userId: task.userId || task.uid, ownId: account.ownId } }, resMock);
                break;
            case 'sendImage':
                await zaloService.sendImageToUser({ body: { ...task, ownId: account.ownId } }, resMock);
                break;
            case 'changeFriendAlias':
                await zaloService.changeFriendAlias({ body: { uid: task.uid || task.userId, alias: task.alias, ownId: account.ownId } }, resMock);
                break;
            case 'getAliasList':
            case 'getAlias':
                await zaloService.getAliasList({ body: { ownId: account.ownId } }, resMock);
                break;
            case 'sentFriendRequest':
            case 'getSentFriendRequest':
                await zaloService.getSentFriendRequest({ body: { ...task, ownId: account.ownId } }, resMock);
                break;
            case 'getAllFriend':
            case 'getAllFriends':
                await zaloService.getAllFriends({ body: { ...task, ownId: account.ownId } }, resMock);
                break;
            case 'getAllGroup':
            case 'getAllGroups':
                await zaloService.getAllGroups({ body: { ...task, ownId: account.ownId } }, resMock);
                break;
            case 'getGroupMembersInfo':
                await zaloService.getGroupMembersInfo({
                    body: {
                        groupId: task.groupId || task.threadId || task.uid,
                        memberId: task.memberId || task.userId,
                        ownId: account.ownId
                    }
                }, resMock);
                break;
            case 'getMultiUsersByPhones': {
                let phones = task.phones || task.phone || task.phoneNumbers;
                if (typeof phones === 'string') {
                    if (phones.startsWith('[') && phones.endsWith(']')) {
                        try {
                            phones = JSON.parse(phones);
                        } catch (e) {
                            phones = phones.replace(/[\[\]"]/g, '').split(',').map(s => s.trim());
                        }
                    } else if (phones.includes(',')) {
                        phones = phones.split(',').map(s => s.trim());
                    } else {
                        phones = [phones];
                    }
                }
                await zaloService.getMultiUsersByPhones({
                    body: {
                        phones: phones,
                        ownId: account.ownId
                    }
                }, resMock);
                break;
            }
            case 'getFriendRequestStatus':
                await zaloService.getFriendRequestStatus({
                    body: {
                        userId: task.userId || task.friendId || task.uid,
                        ownId: account.ownId
                    }
                }, resMock);
                break;
            case 'sendVideo':
            case 'sendVideoToUser':
            case 'sendVideoToGroup': {
                const isGroup = task.isGroup === true || task.isGroup === 'true' ||
                    task.threadType === 1 || task.threadType === '1' || task.threadType === 'Group' ||
                    action === 'sendVideoToGroup';
                const videoServiceFunc = isGroup ? zaloService.sendVideoToGroup : zaloService.sendVideoToUser;
                await videoServiceFunc({
                    body: {
                        videoUrl: task.videoUrl || task.videoPath || task.video || task.message,
                        thumbnailUrl: task.thumbnailUrl || task.thumbnail || task.imagePath || task.image,
                        message: task.message || task.msg || '',
                        threadId: task.threadId || task.uid,
                        ownId: account.ownId
                    }
                }, resMock);
                break;
            }
            default:
                console.warn(`Unknown action: ${action}`);
                taskResult = { success: false, error: 'Unknown action: ' + action };
        }

        // Gửi kết quả về GAS - Làm phẳng cấu trúc để GAS dễ đọc
        await axios.post(webhookUrl, {
            action: 'task_result',
            ownId: account.ownId,
            taskId: task.taskId, // Crucial for GAS logs
            type: action,
            rowIndex: rowIndex,
            name: task.name,
            phone: task.phone,
            ...taskResult
        });

        if (taskResult.success) {
            addLog('Task Success', `Hoàn thành ${action} (Row: ${rowIndex})`, account.ownId, task);
        } else {
            addLog('Task Error', `Lỗi ${action} (Row: ${rowIndex}): ${taskResult.error}`, account.ownId, task);
        }
    } catch (error) {
        console.error(`Error executing task (Row: ${rowIndex}):`, error);
        await axios.post(webhookUrl, {
            action: 'task_result',
            ownId: account.ownId,
            type: action,
            rowIndex: rowIndex,
            success: false,
            error: error.message
        });
    }
}

export function startTaskPuller() {
    console.log('Task Puller started');
    setInterval(pullTasks, PULL_INTERVAL);
}
