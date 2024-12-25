// Add state management
let isEnabled = true;
let keepAliveInterval;

// Setup keep-alive when installed
chrome.runtime.onInstalled.addListener(() => {
    console.log('Extension installed/updated');
    setupKeepAlive();
});

// Keep service worker active using alarms
function setupKeepAlive() {
    // Clear any existing alarms
    chrome.alarms.clearAll();
    
    // Create an alarm that fires every 20 seconds
    chrome.alarms.create('keepAlive', {
        periodInMinutes: 1/3
    });
    
    // Listen for the alarm
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === 'keepAlive') {
            console.debug('Service worker keep-alive ping');
        }
    });
}

// Re-register keep-alive when service worker starts
setupKeepAlive();

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getApiKey") {
        chrome.storage.local.get(['GEMINI_API_KEY'], function(result) {
            sendResponse({ apiKey: result.GEMINI_API_KEY });
        });
        return true;
    }
    
    if (request.action === "updateState") {
        updateIcon(request.isEnabled);
    }
    
    if (request.action === "getState") {
        sendResponse({ isEnabled: isEnabled });
        return true;
    }
});

// Handle icon updates with error checking
async function updateIcon(isEnabled) {
    try {
        const iconPath = isEnabled ? 'icons/icon16.png' : 'icons/icon16-disabled.png';
        await chrome.action.setIcon({
            path: {
                '16': iconPath,
                '32': iconPath.replace('16', '32'),
                '48': iconPath.replace('16', '48'),
                '128': iconPath.replace('16', '128')
            }
        });
    } catch (error) {
        console.error('Failed to update icon:', error);
        // Fallback to default icon
        chrome.action.setIcon({
            path: {
                '16': 'icons/icon16.png',
                '32': 'icons/icon32.png',
                '48': 'icons/icon48.png',
                '128': 'icons/icon128.png'
            }
        });
    }
}

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.sendMessage(tab.id, { action: 'toggle' })
        .catch(error => console.error('Error sending message:', error));
});

// Keep service worker alive
chrome.runtime.onInstalled.addListener(() => {
    console.log('Extension installed/updated');
});

// Ping every 20 seconds to keep alive
setInterval(() => {
    console.debug('Service worker ping');
}, 20000); 