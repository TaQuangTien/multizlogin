import { zaloAccounts } from './api/zalo/zalo.js';
import { getWebhookConfig, triggerN8nWebhook } from './helpers.js';

const HEALTH_CHECK_INTERVAL = 30 * 60 * 1000; // 30 minutes

async function checkSessions() {
    console.log('Running health check for all accounts...');
    for (const account of zaloAccounts) {
        try {
            const info = await account.api.fetchAccountInfo();
            if (!info || !info.profile) {
                throw new Error('Session lost');
            }
        } catch (error) {
            console.error(`Account ${account.ownId} is LOGOUT or encountered error:`, error.message);
            await reportLogout(account.ownId);
        }
    }
}

async function reportLogout(ownId) {
    const config = getWebhookConfig(ownId);
    if (config && config.url) {
        await triggerN8nWebhook({
            action: 'session_logout',
            ownId: ownId,
            status: 'LOGOUT',
            timestamp: new Date().toISOString()
        }, config.url);
    }
}

export function startHealthCheck() {
    console.log('Health Check worker started');
    setInterval(checkSessions, HEALTH_CHECK_INTERVAL);
    // Run once on start after 5 seconds
    setTimeout(checkSessions, 5000);
}
