// Add state management
let isEnabled = true;

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getApiKey") {
        chrome.storage.local.get(['GEMINI_API_KEY'], function(result) {
            sendResponse({ apiKey: result.GEMINI_API_KEY });
        });
        return true;
    }
    
    if (request.action === "updateState") {
        isEnabled = request.isEnabled;
        // Update extension icon
        updateIcon(isEnabled);
    }
    
    if (request.action === "getState") {
        sendResponse({ isEnabled: isEnabled });
        return true;
    }
});

// Add icon update function
function updateIcon(enabled) {
    chrome.action.setIcon({
        path: enabled ? {
            "16": "icons/icon16.png",
            "48": "icons/icon48.png",
            "128": "icons/icon128.png"
        } : {
            "16": "icons/icon16-disabled.png",
            "48": "icons/icon48-disabled.png",
            "128": "icons/icon128-disabled.png"
        }
    });
}

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
    isEnabled = !isEnabled;
    updateIcon(isEnabled);
    
    // Notify content script
    chrome.tabs.sendMessage(tab.id, {
        action: 'setState',
        isEnabled: isEnabled
    });
}); 