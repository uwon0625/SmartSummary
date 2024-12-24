document.addEventListener('DOMContentLoaded', async function() {
    const browserAPI = window.browser || window.chrome;
    
    // Re-enable the tooltip when popup is opened
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, {
            action: 'reEnable'
        });
    });
    
    // Load saved settings
    const result = await chrome.storage.local.get([
        'GROQ_API_KEY', 
        'apiOption', 
        'languageLevel',
        'voiceOption'
    ]);
    
    // Set API option
    const apiOption = result.apiOption || 'own';
    document.querySelector(`input[name="api-option"][value="${apiOption}"]`).checked = true;
    document.getElementById('apiKey').value = result.GROQ_API_KEY || '';
    updateVisibleSection(apiOption);

    // Set language level
    const languageLevel = result.languageLevel || 'intermediate';
    document.querySelector(`input[name="languageLevel"][value="${languageLevel}"]`).checked = true;

    // Set voice option
    const voiceOption = result.voiceOption || 'none';
    document.querySelector(`input[name="voiceOption"][value="${voiceOption}"]`).checked = true;

    // Handle option toggle
    document.querySelectorAll('input[name="api-option"]').forEach(radio => {
        radio.addEventListener('change', function(e) {
            const option = e.target.value;
            updateVisibleSection(option);
            browserAPI.storage.local.set({ apiOption: option });
        });
    });

    // Handle language level change
    document.querySelectorAll('input[name="languageLevel"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const newLevel = e.target.value;
            chrome.storage.local.set({ languageLevel: newLevel });
            
            // Notify content script of the change
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'setLanguageLevel',
                    languageLevel: newLevel
                });
            });
        });
    });

    // Save API key
    document.getElementById('saveKey').addEventListener('click', function() {
        const apiKey = document.getElementById('apiKey').value.trim();
        if (apiKey) {
            browserAPI.storage.local.set({ 
                GROQ_API_KEY: apiKey,
                apiOption: 'own'
            }, function() {
                window.close();
            });
        }
    });

    // Handle subscription button
    document.getElementById('subscribe').addEventListener('click', function() {
        // Open subscription page in new tab
        window.open('https://your-subscription-page.com', '_blank');
    });

    // Also save when Enter is pressed
    document.getElementById('apiKey').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            document.getElementById('saveKey').click();
        }
    });

    // Handle voice option change
    document.querySelectorAll('input[name="voiceOption"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const voiceOption = e.target.value;
            chrome.storage.local.set({ voiceOption });
            
            // Notify content script of the change
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'setVoiceOption',
                    voiceOption: voiceOption
                });
            });
        });
    });
});

function updateVisibleSection(option) {
    document.getElementById('ownKeySection').classList.toggle('active', option === 'own');
    document.getElementById('subscriptionSection').classList.toggle('active', option === 'subscription');
} 