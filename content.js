// Constants
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
//const MODEL = 'mixtral-8x7b-32768';
const MODEL = "llama3-70b-8192";
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
        this.speechSynthesis = window.speechSynthesis;
        this.currentUtterance = null;
        this.voices = [];
        this.setupListeners();
        this.loadSettings();
        this.loadVoices();
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
        if (!text || text.length < 50) return;

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
            summary = await this.summarizeWithGroq(text);
            this.summaryCache.set(text, summary);
        }

        // Show tooltip with HTML content
        this.tooltip.innerHTML = summary;
        this.tooltip.style.display = 'block';
        this.updateTooltipPosition(event);
        this.speakSummary(summary);
    }

    hideTooltipAndOverlay() {
        this.tooltip.style.display = 'none';
        this.overlay.style.display = 'none';
        this.stopSpeech();
        this.currentElement = null;
    }

    findMeaningfulContainer(element) {
        const meaningfulTags = ['p', 'article', 'div', 'section', 'main', 'span'];
        let current = element;

        while (current && current !== document.body) {
            // Check if element has enough text content
            const text = current.textContent?.trim();
            if (text && text.length > 50 && 
                (meaningfulTags.includes(current.tagName.toLowerCase()) ||
                 current.className.includes('text') ||
                 current.className.includes('content'))) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    async summarizeWithGroq(text) {
        try {
            const response = await new Promise((resolve) => {
                chrome.storage.local.get(['GROQ_API_KEY', 'apiOption', 'languageLevel'], resolve);
            });

            let apiKey;
            if (response.apiOption === 'subscription') {
                // Use subscription endpoint
                const subscriptionResponse = await fetch('https://your-api.com/summarize', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ text })
                });
                
                if (!subscriptionResponse.ok) {
                    throw new Error('Subscription API error');
                }
                
                const data = await subscriptionResponse.json();
                return data.summary;
            } else {
                // Use direct Groq API with user's key
                apiKey = response.GROQ_API_KEY;
                if (!apiKey) {
                    throw new Error('API key not set');
                }
                
                const languageLevelPrompts = {
                    beginner: "You are a helpful assistant that explains text in very simple terms, avoiding complex vocabulary and using basic sentence structures. Always start your summary with 'It'.",
                    intermediate: "You are a helpful assistant that summarizes text concisely with moderate vocabulary. Always start your summary with 'It'.",
                    advanced: "You are a helpful assistant that provides sophisticated summaries using advanced vocabulary and complex concepts. Always start your summary with 'It'."
                };

                const requestBody = {
                    model: MODEL,
                    messages: [
                        {
                            role: "system",
                            content: languageLevelPrompts[this.languageLevel] + 
                               " Additionally, mark warning words with [WARNING]word[/WARNING] and high-risk words with [RISK]word[/RISK]."
                        },
                        {
                            role: "user",
                            content: `Please summarize in 1-2 sentences, using ${this.languageLevel}-level language, starting with 'It'. Mark any warning or cautionary words with [WARNING]...[/WARNING] and high-risk or dangerous concepts with [RISK]...[/RISK]: ${text}`
                        }
                    ],
                    temperature: 0.3,
                    max_tokens: 100
                };

                console.log('Request URL:', GROQ_API_URL);
                console.log('Request body:', requestBody);

                const subscriptionResponse = await fetch(GROQ_API_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                });

                if (!subscriptionResponse.ok) {
                    const errorText = await subscriptionResponse.text();
                    console.error('Response error:', errorText);
                    throw new Error(`HTTP error! status: ${subscriptionResponse.status}`);
                }

                const data = await subscriptionResponse.json();
                let summary = data.choices[0].message.content.trim();
                
                // Replace warning and risk tags with HTML spans
                summary = summary
                    .replace(/\[WARNING\](.*?)\[\/WARNING\]/g, '<span class="warning-text">$1</span>')
                    .replace(/\[RISK\](.*?)\[\/RISK\]/g, '<span class="risk-text">$1</span>');
                
                return summary;
            }
        } catch (error) {
            console.error('Error summarizing:', error);
            return error.message === 'API key not set' 
                ? 'Please set your Groq API key in the extension popup'
                : 'Error generating summary';
        }
    }

    async loadSettings() {
        const settings = await new Promise((resolve) => {
            chrome.storage.local.get(['languageLevel', 'voiceOption'], resolve);
        });
        this.languageLevel = settings.languageLevel || 'intermediate';
        this.voiceOption = settings.voiceOption || 'none';
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
        
        // Remove HTML tags for clean text-to-speech
        const cleanText = text.replace(/<[^>]*>/g, '');
        
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
}

// Initialize the summarizer
const summarizer = new ContentSummarizer(); 