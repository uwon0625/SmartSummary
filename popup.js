document.addEventListener('DOMContentLoaded', async function() {
    const browserAPI = window.browser || window.chrome;
    
    // Re-enable the tooltip when popup is opened
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) return;  // Exit if no active tab
        
        // Try to send message, catch any connection errors
        chrome.tabs.sendMessage(tabs[0].id, {
            action: 'reEnable'
        }).catch(error => {
            console.log('Tab not ready yet:', error);
        });
    });
    
    // Load saved settings
    const result = await chrome.storage.local.get([
        'languageLevel',
        'voiceOption',
        'siteScope',
        'enabledSites'
    ]);
    
    // Set language level
    const languageLevel = result.languageLevel || 'intermediate';
    document.querySelector(`input[name="languageLevel"][value="${languageLevel}"]`).checked = true;

    // Set voice option
    const voiceOption = result.voiceOption || 'none';
    document.querySelector(`input[name="voiceOption"][value="${voiceOption}"]`).checked = true;

    // Get current tab's hostname
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    const hostname = url.hostname;

    // Set site scope
    const enabledSites = result.enabledSites || {};
    const siteScope = result.siteScope || 'current';
    document.querySelector(`input[name="siteScope"][value="${siteScope}"]`).checked = true;

    // Handle site scope change
    document.querySelectorAll('input[name="siteScope"]').forEach(radio => {
        radio.addEventListener('change', async (e) => {
            const newScope = e.target.value;
            const enabledSites = await chrome.storage.local.get(['enabledSites']) || {};
            
            if (newScope === 'current') {
                // Enable only for current site
                enabledSites[hostname] = true;
            } else {
                // Enable for all sites
                enabledSites.allSites = true;
            }
            
            await chrome.storage.local.set({ 
                siteScope: newScope,
                enabledSites: enabledSites 
            });
            
            // Notify content script of the change
            try {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'setSiteScope',
                    siteScope: newScope,
                    hostname: hostname
                }).catch(error => {
                    console.log('Could not send message to tab:', error);
                });
            } catch (error) {
                console.log('Error sending message:', error);
            }
        });
    });

    // Handle voice option change
    document.querySelectorAll('input[name="voiceOption"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const voiceOption = e.target.value;
            chrome.storage.local.set({ voiceOption });
            
            // Notify content script of the change
            try {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (!tabs || !tabs[0]) return;
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'setVoiceOption',
                        voiceOption: voiceOption
                    }).catch(error => {
                        console.log('Could not send message to tab:', error);
                    });
                });
            } catch (error) {
                console.log('Error sending message:', error);
            }
        });
    });

    // Handle close button
    document.getElementById('closeButton').addEventListener('click', () => {
        window.close();
    });
}); 