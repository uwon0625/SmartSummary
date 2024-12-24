document.addEventListener('DOMContentLoaded', function() {
    // Load saved API key
    chrome.storage.local.get(['GROQ_API_KEY'], function(result) {
        document.getElementById('apiKey').value = result.GROQ_API_KEY || '';
    });

    // Save API key
    document.getElementById('saveKey').addEventListener('click', function() {
        const apiKey = document.getElementById('apiKey').value.trim();
        if (apiKey) {
            chrome.storage.local.set({ 
                GROQ_API_KEY: apiKey
            }, function() {
                // Show saved confirmation
                const button = document.getElementById('saveKey');
                button.textContent = 'Saved!';
                setTimeout(() => {
                    button.textContent = 'Save';
                }, 2000);
            });
        }
    });
}); 