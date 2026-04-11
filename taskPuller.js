import axios from 'axios';
import { zaloAccounts } from './api/zalo/zalo.js';
import { getWebhookConfig } from './helpers.js';
import * as zaloService from './zaloService.js';
import { addLog } from './routes-ui.js';

const PULL_INTERVAL = 30000; // 30 seconds

async function pullTasks() {
    for (const account of zaloAccounts) {
        const config = getWebhookConfig(account.ownId);
        if (config && config.pullMode && config.url) {
            try {
                console.log(`Pulling tasks for account ${account.ownId}...`);
                const response = await axios.post(config.url, {
                    action: 'pull_tasks',
                    ownId: account.ownId
                });

                const tasks = response.data.tasks || [];
                if (tasks.length > 0) {
                    console.log(`Received ${tasks.length} tasks for account ${account.ownId}`);
                    addLog('Task Pull', `Nhận ${tasks.length} nhiệm vụ từ GAS`, account.ownId, { count: tasks.length });
                    for (const task of tasks) {
                        await executeTask(account, task, config.url);
                    }
                }
            } catch (error) {
                console.error(`Error pulling tasks for ${account.ownId}:`, error.message);
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
            case 'sendMessage':
                await zaloService.sendMessage({
                    body: {
                        message: task.message,
                        threadId: task.uid,
                        imagePath: task.imagePath,
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
