// Constants
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
let GEMINI_API_KEY = '';

// Wait for config to be loaded
window.addEventListener('load', () => {
    GEMINI_API_KEY = window.CONFIG?.GEMINI_API_KEY;
});

const browserAPI = window.browser || window.chrome;

class ContentSummarizer {
    constructor() {
        this.tooltip = this.createTooltip();
        this.overlay = this.createOverlay();
        this.summaryCache = new Map();
        this.currentElement = null;
        this.isEnabled = true;
        this.languageLevel = 'intermediate';
        this.voiceOption = 'none';
        this.siteScope = 'current';
        this.hostname = window.location.hostname;
        this.speechSynthesis = window.speechSynthesis;
        this.currentUtterance = null;
        this.voices = [];
        this.rateLimitedUntil = 0;  // Timestamp when rate limit expires
        this.setupListeners();
        this.loadSettings();
        this.loadVoices();
    }

    getRateLimitMessage() {
        const waitTime = Math.ceil((this.rateLimitedUntil - Date.now()) / 1000);
        return `Gemini API rate limit reached. Please wait ${waitTime} seconds before trying again.`;
    }

    createTooltip() {
        const tooltip = document.createElement('div');
        tooltip.className = 'ai-summary-tooltip';
        tooltip.style.cssText = `
            position: fixed;
            max-width: 300px;
            padding: 10px;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            z-index: 10001;
            display: none;
            font-family: Arial, sans-serif;
            font-size: 14px;
            line-height: 1.4;
        `;
        const style = document.createElement('style');
        style.textContent = `
            .warning-text {
                background-color: #fff3cd;
                padding: 0 2px;
            }
            .risk-text {
                background-color: #f8d7da;
                color: #721c24;
                padding: 0 2px;
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(tooltip);
        return tooltip;
    }

    createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'ai-summary-overlay';
        overlay.style.cssText = `
            position: fixed;
            background: rgba(76, 175, 80, 0.1);
            border: 2px solid #4CAF50;
            pointer-events: none;
            z-index: 10000;
            display: none;
        `;
        document.body.appendChild(overlay);
        return overlay;
    }

    setupListeners() {
        let debounceTimer;

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.isEnabled = false;
                this.hideTooltipAndOverlay();
                this.stopSpeech();
                chrome.runtime.sendMessage({ 
                    action: 'updateState', 
                    isEnabled: false 
                });
            }
        });

        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'setState') {
                this.isEnabled = request.isEnabled;
                if (!this.isEnabled) {
                    this.hideTooltipAndOverlay();
                    this.stopSpeech();
                }
            } else if (request.action === 'setLanguageLevel') {
                this.languageLevel = request.languageLevel;
                this.summaryCache.clear();
            } else if (request.action === 'reEnable') {
                this.isEnabled = true;
            } else if (request.action === 'setVoiceOption') {
                this.voiceOption = request.voiceOption;
                if (this.voiceOption === 'none') {
                    this.stopSpeech();
                }
            } else if (request.action === 'setSiteScope') {
                this.siteScope = request.siteScope;
                // Enable for current site if scope is 'current' and this is the current site
                this.isEnabled = this.siteScope === 'all' || 
                    (this.siteScope === 'current' && request.hostname === this.hostname);
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isEnabled) return;
            
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                this.handleMouseMove(e);
            }, 100);
        });

        document.addEventListener('mouseout', (e) => {
            if (this.currentElement && !this.currentElement.contains(e.relatedTarget)) {
                this.hideTooltipAndOverlay();
            }
        });

        window.addEventListener('blur', () => {
            this.hideTooltipAndOverlay();
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.hideTooltipAndOverlay();
            }
        });
    }

    async handleMouseMove(e) {
        const element = document.elementFromPoint(e.clientX, e.clientY);
        if (!element) return;

        const container = this.findMeaningfulContainer(element);
        if (!container) {
            this.hideTooltipAndOverlay();
            return;
        }

        // If it's the same element, just update position
        if (this.currentElement === container) {
            this.updateTooltipPosition(e);
            return;
        }

        // If it's a new element, hide previous and show new
        this.currentElement = container;
        await this.showSummaryWithOverlay(container, e);
    }

    updateTooltipPosition(event) {
        if (!this.tooltip.style.display === 'none') return;

        const tooltipRect = this.tooltip.getBoundingClientRect();
        let left = event.clientX + 10;
        let top = event.clientY;

        // Adjust position if tooltip would go off screen
        if (left + tooltipRect.width > window.innerWidth) {
            left = window.innerWidth - tooltipRect.width - 10;
        }
        if (top + tooltipRect.height > window.innerHeight) {
            top = window.innerHeight - tooltipRect.height - 10;
        }

        this.tooltip.style.left = `${left}px`;
        this.tooltip.style.top = `${top}px`;
    }

    async showSummaryWithOverlay(element, event) {
        const text = element.textContent.trim();
        const wordCount = text ? text.split(/\s+/).length : 0;
        if (!text || wordCount < 100 || !this.canSummarize()) return;

        // Update overlay
        const rect = element.getBoundingClientRect();
        this.overlay.style.left = `${rect.left + window.scrollX}px`;
        this.overlay.style.top = `${rect.top + window.scrollY}px`;
        this.overlay.style.width = `${rect.width}px`;
        this.overlay.style.height = `${rect.height}px`;
        this.overlay.style.display = 'block';

        // Get or generate summary
        let summary;
        if (this.summaryCache.has(text)) {
            summary = this.summaryCache.get(text);
        } else {
            summary = await this.summarizeText(text);
            this.summaryCache.set(text, summary);
        }

        // Show tooltip with HTML content
        this.tooltip.innerHTML = summary;
        this.tooltip.style.display = 'block';
        this.updateTooltipPosition(event);
        if (!summary.includes('Error') && !summary.includes('Please set your Groq API key')) {
            this.speakSummary(summary);
        }
    }

    hideTooltipAndOverlay() {
        this.tooltip.style.display = 'none';
        this.overlay.style.display = 'none';
        this.stopSpeech();
        this.currentElement = null;
    }

    findMeaningfulContainer(element) {
        // Tags that we want to exclude completely
        const excludedTags = ['button', 'nav', 'header', 'footer', 'menu'];
        // Tags that might contain meaningful content despite being headers
        const headerTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
        // Tags that are likely to contain meaningful content
        const meaningfulTags = ['p', 'article', 'div', 'section', 'main'];
        let current = element;

        while (current && current !== document.body) {
            // Skip if element is or is within excluded tags
            if (excludedTags.includes(current.tagName.toLowerCase())) {
                return null;
            }
            
            // Skip if the element is just a link with no substantial content
            if (current.tagName.toLowerCase() === 'a') {
                const hasOnlyLink = Array.from(current.childNodes).every(node => 
                    node.nodeType === Node.TEXT_NODE || 
                    node.tagName?.toLowerCase() === 'img' ||
                    node.tagName?.toLowerCase() === 'svg'
                );
                if (hasOnlyLink) {
                    return null;
                }
            }
            
            // Check if element has enough text content
            const text = current.textContent?.trim();
            const wordCount = text ? text.split(/\s+/).length : 0;
            
            // Different word count thresholds for different types of content
            let minWordCount = 100;  // Default minimum word count
            
            // Adjust threshold for headers with following content
            if (headerTags.includes(current.tagName.toLowerCase())) {
                const nextElement = current.nextElementSibling;
                if (nextElement) {
                    const combinedText = text + ' ' + nextElement.textContent.trim();
                    const combinedWordCount = combinedText.split(/\s+/).length;
                    if (combinedWordCount >= minWordCount) {
                        return nextElement;  // Return the content following the header
                    }
                }
                return null;  // Skip standalone headers
            }
            
            if (text && text.length > 50 && wordCount >= minWordCount &&
                (meaningfulTags.includes(current.tagName.toLowerCase()) ||
                 current.className.includes('text') ||
                 current.className.includes('content') ||
                 // Additional checks for content containers
                 current.className.includes('paragraph') ||
                 current.className.includes('body') ||
                 current.getAttribute('role') === 'article' ||
                 current.getAttribute('role') === 'main')) {
               
                // If this is a large container, try to find a more specific content block
                if (wordCount > 500) {
                    const betterContainer = Array.from(current.children)
                        .find(child => {
                            const childText = child.textContent.trim();
                            const childWordCount = childText.split(/\s+/).length;
                            return childWordCount >= minWordCount && 
                                   meaningfulTags.includes(child.tagName.toLowerCase());
                        });
                    if (betterContainer) {
                        return betterContainer;
                    }
                }
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    async summarizeText(text) {
        try {
            // Wait for API key to be loaded if necessary
            if (!GEMINI_API_KEY) {
                GEMINI_API_KEY = window.CONFIG?.GEMINI_API_KEY;
                if (!GEMINI_API_KEY) {
                    throw new Error('API key not loaded');
                }
            }
            if (Date.now() < this.rateLimitedUntil) {
                return this.getRateLimitMessage();
            }

            const response = await new Promise((resolve) => {
                chrome.storage.local.get(['languageLevel'], resolve);
            });

            return await this.summarizeChunk(text, GEMINI_API_KEY);
        } catch (error) {
            console.error('Error summarizing:', error);
            return 'Error generating summary';
        }
    }

    async summarizeChunk(text, apiKey) {
        const languageLevelPrompts = {
            beginner: "You are a helpful assistant that explains text in very simple terms, avoiding complex vocabulary and using basic sentence structures. Always start your summary with 'It'.",
            intermediate: "You are a helpful assistant that summarizes text concisely with moderate vocabulary. Always start your summary with 'It'.",
            advanced: "You are a helpful assistant that provides sophisticated summaries using advanced vocabulary and complex concepts. Always start your summary with 'It'."
        };

        const requestBody = {
            contents: [{
                parts: [{
                    text: `${languageLevelPrompts[this.languageLevel]}\n\nPlease summarize in 1-2 sentences, using ${this.languageLevel}-level language, starting with 'It'. Mark any warning or cautionary words with <<WARNING>>...<</WARNING>> and high-risk or dangerous concepts with <<RISK>>...<</RISK>>: ${text}`
                }]
            }],
            generationConfig: {
                temperature: 0.3,
                candidateCount: 1,
                stopSequences: ["\n"]  // Stop at first newline to keep response concise
            }
        };

        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            if (errorText.includes('rate_limit_exceeded')) {
                this.rateLimitedUntil = Date.now() + 60000;
                return this.getRateLimitMessage();
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        let summary = data.candidates[0].content.parts[0].text.trim();
        summary = this.formatHighlightTags(summary);
        return summary;
    }

    formatHighlightTags(text) {
        // First check if the text contains any of our special tags
        const hasWarningTags = text.includes('<<WARNING>>') || text.includes('[WARNING]');
        const hasRiskTags = text.includes('<<RISK>>') || text.includes('[RISK]');
        
        if (!hasWarningTags && !hasRiskTags) {
            // If no tags, return text as is
            return text;
        }
        
        // Replace both old and new style tags with HTML spans
        let formattedText = text
            .replace(/\[WARNING\](.*?)\[\/WARNING\]/g, '<span class="warning-text">$1</span>')
            .replace(/\[RISK\](.*?)\[\/RISK\]/g, '<span class="risk-text">$1</span>')
            .replace(/<<WARNING>>(.*?)<<\/WARNING>>/g, '<span class="warning-text">$1</span>')
            .replace(/<<RISK>>(.*?)<<\/RISK>>/g, '<span class="risk-text">$1</span>');
        
        // If formatting failed for some reason, remove all tag remnants
        if (formattedText.includes('[WARNING]') || formattedText.includes('[RISK]') ||
            formattedText.includes('<<WARNING>>') || formattedText.includes('<<RISK>>')) {
            formattedText = text
                .replace(/\[WARNING\]|\[\/WARNING\]|<<WARNING>>|<<\/WARNING>>/g, '')
                .replace(/\[RISK\]|\[\/RISK\]|<<RISK>>|<<\/RISK>>/g, '');
        }
        
        return formattedText;
    }

    async combineSummaries(summaries) {
        // Remove the "It" prefix from subsequent summaries for better flow
        const cleanedSummaries = summaries.map((summary, index) => 
            index === 0 ? summary : summary.replace(/^It\s+/i, '')
        );
        
        // Join with proper spacing and formatting
        let combinedSummary = cleanedSummaries.join(' ');
        
        // Format or remove warning/risk tags
        combinedSummary = this.formatHighlightTags(combinedSummary);
        
        return combinedSummary;
    }

    async loadSettings() {
        const settings = await new Promise((resolve) => {
            chrome.storage.local.get([
                'languageLevel', 
                'voiceOption',
                'siteScope',
                'enabledSites'
            ], resolve);
        });
        this.languageLevel = settings.languageLevel || 'intermediate';
        this.voiceOption = settings.voiceOption || 'none';
        this.siteScope = settings.siteScope || 'current';
        
        // Check if extension should be enabled for this site
        const enabledSites = settings.enabledSites || {};
        this.isEnabled = enabledSites.allSites || enabledSites[this.hostname] || false;
    }

    stopSpeech() {
        if (this.currentUtterance) {
            this.speechSynthesis.cancel();
            this.currentUtterance = null;
        }
    }

    speakSummary(text) {
        if (this.voiceOption === 'none') return;
        
        // Stop any current speech
        this.stopSpeech();
        
        // Remove HTML tags and any error messages
        let cleanText = text.replace(/<[^>]*>/g, '');
        if (cleanText.includes('Error') || cleanText.includes('Please set your Groq API key')) {
            return;
        }
        
        const utterance = new SpeechSynthesisUtterance(cleanText);
        
        // Select voice based on preference
        let voices = this.voices.filter(voice => voice.lang.startsWith('en'));
        // Log all available voices with their properties
        voices.forEach(voice => {
            console.log('Voice details:', {
                name: voice.name,
                lang: voice.lang,
                voiceURI: voice.voiceURI,
                localService: voice.localService,
                default: voice.default
            });
        });
        
        if (voices.length > 0) {
            if (this.voiceOption === 'male') {
                // Try to find a male voice using common male voice indicators
                const maleVoice = voices.find(voice => 
                    voice.name.toLowerCase().includes('male') ||
                    voice.name.toLowerCase().includes('david') ||
                    voice.name.toLowerCase().includes('james') ||
                    voice.name.toLowerCase().includes('john') ||
                    voice.name.toLowerCase().includes('guy')
                ) || voices.find(voice => !voice.name.toLowerCase().includes('female'));
                
                console.log('Selected male voice:', maleVoice?.name);
                utterance.voice = maleVoice;
                utterance.pitch = 0.9;
                utterance.rate = 0.95;
            } else if (this.voiceOption === 'female') {
                // Try different approaches to find a female voice
                let femaleVoice = null;
                
                // First try: Check for specific female voice names
                femaleVoice = voices.find(voice => {
                    const name = voice.name.toLowerCase();
                    return name.includes('female') || 
                           name.includes('samantha') || 
                           name.includes('microsoft zira');
                });
                
                // Second try: Check for Microsoft voices that are typically female
                if (!femaleVoice) {
                    femaleVoice = voices.find(voice => {
                        const name = voice.name.toLowerCase();
                        return name.includes('microsoft eva') || 
                               name.includes('microsoft zira') ||
                               name.includes('microsoft hazel');
                    });
                }
                
                // Third try: Check for Google female voices
                if (!femaleVoice) {
                    femaleVoice = voices.find(voice => {
                        const name = voice.name.toLowerCase();
                        return name.includes('google') && !name.includes('male');
                    });
                }
                
                // Fourth try: Use any available voice and modify pitch
                if (!femaleVoice) {
                    femaleVoice = voices[0]; // Use first available voice
                }
                
                console.log('Selected female voice:', femaleVoice?.name);
                utterance.voice = femaleVoice;
                utterance.pitch = 1.5;  // Higher pitch for female voice
                utterance.rate = 1.1;   // Slightly faster rate
            }
        }
        
        utterance.volume = 1;
        this.currentUtterance = utterance;
        // Log final voice selection
        console.log('Final voice selection:', {
            name: utterance.voice?.name || 'default',
            pitch: utterance.pitch,
            rate: utterance.rate,
            gender: this.voiceOption
        });
        
        this.speechSynthesis.speak(utterance);
    }

    loadVoices() {
        // Load available voices
        const loadVoicesWhenAvailable = () => {
            this.voices = this.speechSynthesis.getVoices();
            if (this.voices.length > 0) {
                // Voices loaded successfully
                console.log('Voices loaded:', this.voices.length);
                console.log('Available voices:', this.voices.map(v => ({
                    name: v.name,
                    lang: v.lang,
                    gender: v.name.toLowerCase().includes('female') ? 'female' : 
                            v.name.toLowerCase().includes('male') ? 'male' : 'unknown'
                })));
            } else {
                // Wait for voices to be loaded
                window.speechSynthesis.addEventListener('voiceschanged', () => {
                    this.voices = this.speechSynthesis.getVoices();
                    console.log('Voices loaded after change:', this.voices.length);
                    console.log('Available voices:', this.voices.map(v => ({
                        name: v.name,
                        lang: v.lang,
                        gender: v.name.toLowerCase().includes('female') ? 'female' : 
                                v.name.toLowerCase().includes('male') ? 'male' : 'unknown'
                    })));
                });
            }
        };
        loadVoicesWhenAvailable();
    }

    // Add method to check if text can be summarized
    canSummarize() {
        return Date.now() >= this.rateLimitedUntil;
    }
}

// Initialize the summarizer
const summarizer = new ContentSummarizer(); 