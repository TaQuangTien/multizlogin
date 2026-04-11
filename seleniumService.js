import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

let activeDriver = null;
let extractionData = { imei: null, cookies: null, userAgent: null };

// Hàm hỗ trợ chờ (sleep)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function startSeleniumLogin() {
    if (activeDriver) {
        try { await activeDriver.quit(); } catch (e) {}
    }

    extractionData = { imei: null, cookies: null, userAgent: null };

    const chromeOptions = new chrome.Options();
    chromeOptions.addArguments('--no-sandbox');
    chromeOptions.addArguments('--disable-dev-shm-usage');
    chromeOptions.addArguments('--start-maximized');
    chromeOptions.addArguments('--window-size=1280,800');
    // Chạy trực tiếp tại localhost (vì gộp chung 1 container)
    const serverUrl = 'http://localhost:4444/wd/hub';


    // Thử kết nối tối đa 10 lần (đợi tối đa 30s cho Selenium khởi động)
    let lastError = null;
    let connected = false;
    for (let i = 0; i < 10; i++) {
        try {
            activeDriver = await new Builder()
                .forBrowser('chrome')
                .usingServer(serverUrl)
                .setChromeOptions(chromeOptions)
                .build();
            
            connected = true;
            break;
        } catch (error) {
            lastError = error;
            console.warn(`Selenium chưa sẵn sàng (Lần thử ${i + 1}/10), đang đợi 3 giây...`);
            await sleep(3000);
        }
    }

    if (!connected) {
        console.error('Lỗi khởi động Selenium sau 10 lần thử:', lastError);
        return { success: false, error: 'Selenium không phản hồi: ' + lastError.message };
    }

    try {
        // Bật Network tracking (tùy chọn)
        try {
            await activeDriver.sendDevToolsCommand('Network.enable');
        } catch (e) {
            console.warn('Could not enable Network auditing via CDP:', e.message);
        }
        
        // Điều hướng thẳng tới Zalo Web
        await activeDriver.get('https://chat.zalo.me');
        
        return { success: true, message: 'Selenium started. Access noVNC at port 7900' };
    } catch (error) {
        console.error('Lỗi điều hướng Selenium:', error);
        return { success: false, error: error.message };
    }
}

export async function pollLoginStatus() {
    if (!activeDriver) return { status: 'idle' };

    try {
        const currentUrl = await activeDriver.getCurrentUrl();
        
        // Kiểm tra xem đã vào được màn hình chat chưa hoặc các URL hậu đăng nhập
        if (currentUrl.includes('chat.zalo.me')) {
            // Lấy Cookies
            const cookies = await activeDriver.manage().getCookies();
            
            // Lấy IMEI (z_uuid) từ localStorage - đây là nơi Zalo Web lưu IMEI
            let imei = await activeDriver.executeScript('return localStorage.getItem("z_uuid")');
            
            // Dự phòng: Nếu không có trong localStorage, tìm trong Cookie
            if (!imei) {
                const zUuidCookie = cookies.find(c => c.name === 'z_uuid');
                if (zUuidCookie) imei = zUuidCookie.value;
            }

            // Kiểm tra xem đã có đủ cookies cần thiết chưa (thường là > 5 cookies sau khi login)
            if (cookies.length > 5 && imei) {
                const userAgent = await activeDriver.executeScript('return navigator.userAgent');
                
                // Return cookies as-is (array of objects) which zca-js expects
                extractionData = { 
                    imei: imei, 
                    cookie: cookies, 
                    userAgent: userAgent 
                };

                return { status: 'success', data: extractionData };
            }

        }
        
        return { status: 'logging_in', url: currentUrl };
    } catch (error) {
        // Ignorable error during polling if session is closed or unstable
        // console.error('Error polling login status:', error.message);
        return { status: 'error', error: error.message };
    }
}

export async function stopSelenium() {
    if (activeDriver) {
        try {
            await activeDriver.quit();
        } catch (e) {}
        activeDriver = null;
    }
}
