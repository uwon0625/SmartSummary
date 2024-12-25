// Constants
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
let GEMINI_API_KEY = null;

// Function to get API key
async function getApiKey() {
    if (GEMINI_API_KEY) return GEMINI_API_KEY;
    
    try {
        // Try to get from window.CONFIG first
        if (window.CONFIG?.GEMINI_API_KEY) {
            GEMINI_API_KEY = window.CONFIG.GEMINI_API_KEY;
            return GEMINI_API_KEY;
        }
        
        // If not found, try to get from storage
        return new Promise((resolve) => {
            chrome.storage.local.get(['GEMINI_API_KEY'], function(result) {
                GEMINI_API_KEY = result.GEMINI_API_KEY;
                resolve(GEMINI_API_KEY);
            });
        });
    } catch (error) {
        console.error('Error getting API key:', error);
        throw new Error('API key not available');
    }
}

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
        this.rateLimitedUntil = 0;
        this.languageCache = new Map();
        this.lastDetectionTime = 0;
        this.detectionCooldown = 1000;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.setupListeners();
        this.loadSettings();
        this.loadVoices();
    }

    async reconnectExtension() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('Max reconnection attempts reached, reloading page...');
            window.location.reload();
            return false;
        }

        this.reconnectAttempts++;
        console.log(`Attempting to reconnect (attempt ${this.reconnectAttempts})...`);

        // Wait a bit before trying to reconnect
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if extension context is restored
        if (chrome.runtime?.id) {
            console.log('Extension context restored');
            this.reconnectAttempts = 0;
            return true;
        }

        return false;
    }

    normalizeLanguageCode(lang) {
        if (!lang) return 'en';
        
        // Handle common variations
        const langMap = {
            // East Asian languages
            'zh': 'zh-TW',  // Default Chinese to Traditional
            'zh-CN': 'zh-CN',
            'zh-TW': 'zh-TW',
            'zh-HK': 'zh-TW',
            'zh-MO': 'zh-TW',
            'zh-SG': 'zh-CN',
            'ja': 'ja-JP',
            'ko': 'ko-KR',
            
            // European languages
            'fr': 'fr-FR',  // French
            'fr-CA': 'fr-FR',
            'fr-BE': 'fr-FR',
            'fr-CH': 'fr-FR',
            'es': 'es-ES',  // Spanish
            'es-MX': 'es-ES',
            'es-AR': 'es-ES',
            'es-CO': 'es-ES',
            'pt': 'pt-PT',  // Portuguese
            'pt-BR': 'pt-BR',
            'de': 'de-DE',  // German
            'de-AT': 'de-DE',
            'de-CH': 'de-DE',
            'it': 'it-IT',  // Italian
            'ru': 'ru-RU',  // Russian
            
            // Middle Eastern languages
            'ar': 'ar-SA',  // Arabic
            'ar-AE': 'ar-SA',
            'ar-BH': 'ar-SA',
            'ar-EG': 'ar-SA',
            'fa': 'fa-IR',  // Persian/Farsi
            'he': 'he-IL',  // Hebrew
            
            // South Asian languages
            'hi': 'hi-IN',  // Hindi
            'bn': 'bn-IN',  // Bengali
            'ta': 'ta-IN',  // Tamil
            'ur': 'ur-PK',  // Urdu
            
            // Southeast Asian languages
            'th': 'th-TH',  // Thai
            'vi': 'vi-VN',  // Vietnamese
            'id': 'id-ID',  // Indonesian
            'ms': 'ms-MY',  // Malay
            
            // Nordic languages
            'sv': 'sv-SE',  // Swedish
            'da': 'da-DK',  // Danish
            'no': 'nb-NO',  // Norwegian
            'fi': 'fi-FI',  // Finnish
            
            // Other European languages
            'nl': 'nl-NL',  // Dutch
            'pl': 'pl-PL',  // Polish
            'tr': 'tr-TR',  // Turkish
            'el': 'el-GR',  // Greek
            'cs': 'cs-CZ',  // Czech
            'hu': 'hu-HU',  // Hungarian
            'ro': 'ro-RO',  // Romanian
            'uk': 'uk-UA'   // Ukrainian
        };
        
        try {
            const baseLang = (lang || '').split('-')[0].toLowerCase();
            return langMap[baseLang] || langMap[lang] || 'en';  // Default to 'en' if no match
        } catch (error) {
            console.error('Language normalization error:', error);
            return 'en';  // Fallback to English on error
        }
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
        overlay.style.cssText = `
            position: absolute;
            background: rgba(255, 255, 0, 0.1);
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
    }

    hideTooltipAndOverlay() {
        this.tooltip.style.display = 'none';
        this.overlay.style.display = 'none';
        this.stopSpeech();
        this.currentElement = null;
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

    async handleMouseMove(e) {
        const element = document.elementFromPoint(e.clientX, e.clientY);
        if (!element) return;

        const container = this.findMeaningfulContainer(element);
        if (!container) {
            this.hideTooltipAndOverlay();
            this.stopSpeech();
            return;
        }

        // If it's the same element, just update position
        if (this.currentElement === container) {
            this.updateTooltipPosition(e);
            return;
        }

        // Stop previous speech before showing new summary
        this.stopSpeech();

        // If it's a new element, hide previous and show new
        this.currentElement = container;
        await this.showSummaryWithOverlay(container, e);
    }

    findMeaningfulContainer(element) {
        const meaningfulTags = ['p', 'article', 'section', 'div'];
        let current = element;
        
        while (current && current !== document.body) {
            if (meaningfulTags.includes(current.tagName.toLowerCase())) {
                const text = current.textContent.trim();
                const wordCount = text.split(/\s+/).length;
                if (wordCount >= 100) {
                    return current;
                }
            }
            current = current.parentElement;
        }
        
        return null;
    }

    async detectLanguage(text) {
        try {
            // Quick check for content language
            const hasChineseChars = /[\u4e00-\u9fff]/.test(text);
            const hasJapaneseChars = /[\u3040-\u309f\u30a0-\u30ff]/.test(text);
            const hasKoreanChars = /[\uac00-\ud7af]/.test(text);
            const hasLatinChars = /[a-zA-Z]/.test(text);
            const hasSpanishChars = /[áéíóúñ¿¡]/i.test(text);
            
            // Quick language detection based on characters
            if (hasSpanishChars) {
                console.debug('Text appears to be Spanish based on character analysis');
                return 'es-ES';
            } else if (hasChineseChars) {
                return 'zh-TW';
            } else if (hasJapaneseChars) {
                return 'ja-JP';
            } else if (hasKoreanChars) {
                return 'ko-KR';
            } else if (hasLatinChars && !hasChineseChars && !hasJapaneseChars && !hasKoreanChars) {
                console.debug('Text appears to be English based on character analysis');
                return 'en';
            }

            // Check cache first
            const cacheKey = text.slice(0, 100);
            console.debug('Analyzing text:', text.slice(0, 100) + '...');
            console.debug('Current URL:', window.location.href);
            console.debug('Previous URL:', this._lastUrl);

            if (this.languageCache.has(cacheKey)) {
                const cachedLang = this.languageCache.get(cacheKey);
                console.debug('Found cached language:', cachedLang);
                return cachedLang;
            }

            // Rate limit check
            const now = Date.now();
            if (now - this.lastDetectionTime < this.detectionCooldown) {
                console.debug('Rate limiting in effect, waiting...');
                await new Promise(resolve => 
                    setTimeout(resolve, this.detectionCooldown - (now - this.lastDetectionTime))
                );
            }
            this.lastDetectionTime = now;

            const sampleText = text.slice(0, 500);
            
            try {
                const apiKey = await getApiKey();
                if (!apiKey) {
                    throw new Error('API key not available');
                }

                const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{
                                text: `Language detection task. Respond with ONLY the 2-letter language code. Example: "en" for English text, "zh" for Chinese text. Analyze: "${sampleText}"`
                            }]
                        }],
                        generationConfig: {
                            temperature: 0.1,
                            candidateCount: 1,
                            maxOutputTokens: 1,
                            topK: 1,
                            topP: 1
                        }
                    })
                });

                const responseText = await response.text();
                console.debug('Raw API response:', responseText);

                if (!response.ok) {
                    throw new Error(`API error (${response.status}): ${responseText}`);
                }

                const data = JSON.parse(responseText);
                console.debug('Parsed API response:', data);

                const detectedLang = data.candidates[0].content.parts[0].text.trim().toLowerCase();
                console.debug('Raw detected language:', detectedLang);

                const cleanLang = detectedLang.replace(/[^a-z-]/gi, '').slice(0, 2);
                console.debug('Cleaned language code:', cleanLang);

                const normalizedLang = this.normalizeLanguageCode(cleanLang);
                console.debug('Final normalized language:', normalizedLang);

                this.languageCache.set(cacheKey, normalizedLang);
                return normalizedLang;

            } catch (apiError) {
                console.error('API call failed:', apiError);
                // If API fails, use character analysis
                if (hasLatinChars && !hasChineseChars && !hasJapaneseChars && !hasKoreanChars) {
                    console.debug('Falling back to English based on character analysis');
                    return 'en';
                }
                throw apiError;
            }

        } catch (error) {
            console.error('Language detection error:', {
                error: error.message,
                stack: error.stack,
                text: text.slice(0, 100) + '...'
            });

            // Check text characteristics
            const textAnalysis = {
                hasChineseChars,
                hasJapaneseChars,
                hasKoreanChars,
                hasLatinChars,
                pageLang: document.documentElement.lang || 
                    document.querySelector('html').getAttribute('lang')
            };
            console.debug('Fallback analysis:', textAnalysis);

            // Use character analysis for fallback
            if (hasChineseChars) return 'zh-TW';
            if (hasJapaneseChars) return 'ja-JP';
            if (hasKoreanChars) return 'ko-KR';
            if (hasLatinChars) return 'en';
            
            return 'en';  // Default to English if nothing else matches
        }
    }

    async showSummaryWithOverlay(element, event) {
        const text = element.textContent.trim();
        const wordCount = text ? text.split(/\s+/).length : 0;
        if (!text || wordCount < 100 || !this.canSummarize()) return;

        // Detect language of the current text block
        const contentLanguage = await this.detectLanguage(text);
        console.debug('Detected language:', contentLanguage, 'for text:', text.slice(0, 50) + '...');

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
            summary = await this.summarizeText(text, contentLanguage);
            this.summaryCache.set(text, summary);
        }

        // Show tooltip with HTML content
        this.tooltip.innerHTML = summary;
        this.tooltip.style.display = 'block';
        this.updateTooltipPosition(event);
        if (!summary.includes('Error') && !summary.includes('Please set your Groq API key')) {
            this.speakSummary(summary, contentLanguage);
        }
    }

    async summarizeText(text, contentLanguage) {
        try {
            try {
                const apiKey = await getApiKey();
                if (!apiKey) {
                    throw new Error('API key not available');
                }

                if (Date.now() < this.rateLimitedUntil) {
                    return this.getRateLimitMessage();
                }

                // Check if extension context is still valid
                if (!chrome.runtime?.id) {
                    console.log('Extension context lost, attempting to reconnect...');
                    const reconnected = await this.reconnectExtension();
                    if (!reconnected) {
                        throw new Error('Extension context invalidated');
                    }
                }

                // Get language level from memory first
                let level = this.languageLevel;

                // If not in memory, try to get from storage
                if (!level) {
                    try {
                        const response = await chrome.storage.local.get(['languageLevel']);
                        level = response.languageLevel || 'intermediate';
                        this.languageLevel = level;
                    } catch (storageError) {
                        console.warn('Failed to get language level from storage:', storageError);
                        level = 'intermediate';  // Fallback
                    }
                }

                return await this.summarizeChunk(text, apiKey, contentLanguage);
            } catch (innerError) {
                if (innerError.message === 'Extension context invalidated') {
                    return 'Extension reconnecting... Please try again in a moment.';
                }
                throw innerError;
            }
        } catch (error) {
            console.error('Error summarizing:', error);
            switch (error.message) {
                case 'API key not available':
                    return 'Please set your Gemini API key in the extension options';
                case 'Extension context invalidated':
                    return 'Extension disconnected. Please refresh the page.';
                default:
                    return 'Error generating summary. Please try reloading the page.';
            }
        }
    }

    getRateLimitMessage() {
        const waitSeconds = Math.ceil((this.rateLimitedUntil - Date.now()) / 1000);
        return `Rate limit exceeded. Please wait ${waitSeconds} seconds.`;
    }

    async summarizeChunk(text, apiKey, contentLanguage) {
        const languageLevelPrompts = {
            beginner: {
                'en': "You are a helpful assistant that explains text in very simple terms. Use basic vocabulary and simple sentences. Always start with 'This'.",
                'zh-TW': "你是一個用簡單的方式解釋文字的助手。請用基礎的詞彙和簡單的句子結構。總是以「這」開始。",
                'zh-CN': "你是一个用简单的方式解释文字的助手。请用基础的词汇和简单的句子结构。总是以「这」开始。",
                'ja-JP': "あなたは簡単な用語で説明するアシスタントです。基本的な語彙と簡単な文構造を使用してください。必ず「これは」で始めてください。",
                'fr-FR': "Tu es un assistant qui explique le texte de manière très simple. Utilise un vocabulaire basique et des phrases courtes. Commence toujours par 'C'est'.",
                'es-ES': "Eres un asistente que explica el texto de forma muy simple. Usa vocabulario básico y frases cortas. Empieza siempre con 'Esto'.",
                'pt-PT': "És um assistente que explica o texto de forma muito simples. Usa vocabulário básico e frases curtas. Começa sempre com 'Isto'.",
                'de-DE': "Du bist ein Assistent, der Text sehr einfach erklärt. Verwende grundlegendes Vokabular und kurze Sätze. Beginne immer mit 'Das'.",
                'ar-SA': "أنت مساعد يشرح النص بطريقة بسيطة جداً. استخدم مفردات أساسية وجمل قصيرة. ابدأ دائماً بـ 'هذا'.",
                // Add more languages as needed
            },
            intermediate: {
                'en': "You are a helpful assistant that summarizes text concisely. Use intermediate-level vocabulary. Always start with 'This'.",
                'zh-TW': "你是一個簡潔總結文字的助手。請用中等程度的詞彙。總是以「這」開始。",
                'zh-CN': "你是一个简洁总结文字的助手。请用中等程度的词汇。总是以「这」开始。",
                'ja-JP': "あなたは文章を簡潔に要約するアシスタントです。中級レベルの語彙を使用してください。必ず「これは」で始めてください。",
                'fr-FR': "Tu es un assistant qui résume le texte de façon concise. Utilise un vocabulaire de niveau intermédiaire. Commence toujours par 'C'est'.",
                'es-ES': "Eres un asistente que resume el texto de manera concisa. Usa vocabulario de nivel intermedio. Empieza siempre con 'Esto'.",
                'pt-PT': "És um assistente que resume o texto de forma concisa. Usa vocabulário de nível intermédio. Começa sempre com 'Isto'.",
                'de-DE': "Du bist ein Assistent, der Text prägnant zusammenfasst. Verwende Vokabular mittleren Niveaus. Beginne immer mit 'Das'.",
                'ar-SA': "أنت مساعد يلخص النص بإيجاز. استخدم مفردات متوسطة المستوى. ابدأ دائماً بـ 'هذا'.",
            },
            advanced: {
                'en': "You are a helpful assistant that provides sophisticated summaries. Use advanced vocabulary and complex concepts. Always start with 'This'.",
                'zh-TW': "你是一個提供專業摘要的助手。可以使用進階詞彙和複雜概念。總是以「這」開始。",
                'zh-CN': "你是一个提供专业摘要的助手。可以使用进阶词汇和复杂概念。总是以「这」开始。",
                'ja-JP': "あなたは高度な要約を提供するアシスタントです。高度な語彙と複雑な概念を使用できます。必ず「これは」で始めてください。",
                'fr-FR': "Tu es un assistant qui fournit des résumés sophistiqués. Utilise un vocabulaire avancé et des concepts complexes. Commence toujours par 'C'est'.",
                'es-ES': "Eres un asistente que proporciona resúmenes sofisticados. Usa vocabulario avanzado y conceptos complejos. Empieza siempre con 'Esto'.",
                'pt-PT': "És um assistente que fornece resumos sofisticados. Usa vocabulário avançado e conceitos complexos. Começa sempre com 'Isto'.",
                'de-DE': "Du bist ein Assistent, der anspruchsvolle Zusammenfassungen liefert. Verwende fortgeschrittenes Vokabular und komplexe Konzepte. Beginne immer mit 'Das'.",
                'ar-SA': "أنت مساعد يقدم ملخصات متطورة. استخدم مفردات متقدمة ومفاهيم معقدة. ابدأ دائماً بـ 'هذا'.",
            }
        };

        // Get the appropriate prompt for the content language
        const prompt = languageLevelPrompts[this.languageLevel][contentLanguage] || 
            languageLevelPrompts[this.languageLevel]['en'];

        // Create language-specific instruction
        const instruction = contentLanguage.startsWith('zh') ? 
            `請用1-2句話總結以下文字，使用${this.languageLevel}程度的語言，以「這」開始。` :
            contentLanguage === 'ja-JP' ?
            `1-2文で要約してください。${this.languageLevel}レベルの言葉を使用し、「これは」で始めてください。` :
            `Summarize this in 1-2 sentences using ${this.languageLevel}-level language. Start with 'This'.`;

        // Add warning/risk instruction based on language
        const warningInstruction = contentLanguage.startsWith('zh') ?
            "標記任何警告詞彙用<<WARNING>>...<</WARNING>>，危險概念用<<RISK>>...<</RISK>>" :
            contentLanguage === 'ja-JP' ?
            "警告すべき単語は<<WARNING>>...<</WARNING>>、危険な概念は<<RISK>>...<</RISK>>で囲んでください" :
            "Mark any warning terms with <<WARNING>>...<</WARNING>> and risky concepts with <<RISK>>...<</RISK>>";

        const requestBody = {
            contents: [{
                parts: [{
                    text: `${prompt}\n\n${instruction} ${warningInstruction}: ${text}`
                }]
            }],
            generationConfig: {
                temperature: 0.3,
                candidateCount: 1,
                stopSequences: ["\n"]
            }
        };

        console.debug('Summarization request:', {
            contentLanguage,
            prompt,
            instruction,
            warningInstruction,
            sampleText: text.slice(0, 100) + '...'
        });

        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Summarization API error:', errorText);
            if (errorText.includes('rate_limit_exceeded')) {
                this.rateLimitedUntil = Date.now() + 60000;
                return this.getRateLimitMessage();
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.debug('Summarization response:', data);
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
        try {
            // Check if extension context is still valid
            if (!chrome.runtime?.id) {
                throw new Error('Extension context invalidated');
            }

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
        } catch (error) {
            console.error('Error loading settings:', error);
            // Use default values if settings can't be loaded
            this.languageLevel = 'intermediate';
            this.voiceOption = 'none';
            this.siteScope = 'current';
            this.isEnabled = true;
        }
    }

    stopSpeech() {
        if (this.speechSynthesis.speaking || this.speechSynthesis.pending) {
            this.speechSynthesis.cancel();
            console.debug('Speech stopped');
        }
        this.currentUtterance = null;
    }

    speakSummary(text, contentLanguage) {
        if (this.voiceOption === 'none') return;
        
        // Ensure any previous speech is stopped
        this.stopSpeech();
        
        let cleanText = text.replace(/<[^>]*>/g, '');
        if (cleanText.includes('Error')) return;
        
        const utterance = new SpeechSynthesisUtterance(cleanText);
        
        console.debug('Speaking in language:', contentLanguage);
        
        // Add event handlers for speech
        utterance.onstart = () => {
            console.debug('Speech started:', cleanText.slice(0, 50) + '...');
        };
        
        utterance.onend = () => {
            console.debug('Speech ended');
            this.currentUtterance = null;
        };
        
        utterance.onerror = (event) => {
            console.error('Speech error:', {
                error: event.error,
                message: event.message,
                elapsedTime: event.elapsedTime,
                language: contentLanguage,
                text: cleanText.slice(0, 100) + '...'
            });
            
            // Try fallback to a different voice if available
            if (event.error === 'language-unavailable') {
                console.debug('Attempting fallback voice...');
                const fallbackVoice = this.voices.find(v => 
                    v.lang.startsWith(contentLanguage.split('-')[0]) ||
                    v.lang.startsWith('en')
                );
                if (fallbackVoice) {
                    utterance.voice = fallbackVoice;
                    this.speechSynthesis.speak(utterance);
                    return;
                }
            }
            this.currentUtterance = null;
        };

        // Filter voices by content language
        let voices = this.voices.filter(voice => {
            const voiceLang = voice.lang.toLowerCase();
            const contentLang = contentLanguage.toLowerCase();
            const baseContentLang = contentLanguage.split('-')[0].toLowerCase();
            
            return voiceLang === contentLang || 
                voiceLang.startsWith(baseContentLang) ||
                (baseContentLang === 'es' && voiceLang.startsWith('es'));
        });
        
        console.debug('Available voices for language:', contentLanguage, voices.map(v => v.name));
        
        // If no voices found for the specific language, fall back to English
        if (voices.length === 0) {
            console.log(`No voices found for ${contentLanguage}, falling back to English`);
            voices = this.voices.filter(voice => voice.lang.startsWith('en'));
        }

        if (voices.length > 0) {
            // Sort voices by quality (prefer native over fallback)
            voices.sort((a, b) => {
                const aScore = a.lang.toLowerCase().startsWith(contentLanguage.toLowerCase()) ? 2 :
                    a.lang.toLowerCase().startsWith(contentLanguage.split('-')[0]) ? 1 : 0;
                const bScore = b.lang.toLowerCase().startsWith(contentLanguage.toLowerCase()) ? 2 :
                    b.lang.toLowerCase().startsWith(contentLanguage.split('-')[0]) ? 1 : 0;
                return bScore - aScore;
            });

            if (this.voiceOption === 'male') {
                const maleVoice = voices.find(voice => 
                    voice.name.toLowerCase().includes('male') ||
                    !voice.name.toLowerCase().includes('female')
                );
                utterance.voice = maleVoice || voices[0];
            } else if (this.voiceOption === 'female') {
                const femaleVoice = voices.find(voice => 
                    voice.name.toLowerCase().includes('female')
                );
                utterance.voice = femaleVoice || voices[0];
            }
        }
        
        // Set the language for the utterance
        utterance.lang = contentLanguage;
        utterance.pitch = 1.0;
        utterance.rate = 1.0;
        
        this.currentUtterance = utterance;
        console.debug('Using voice:', utterance.voice?.name, 'for language:', contentLanguage);
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

function getMainContent() {
    // Get all text content while excluding script, style, and other non-content elements
    const forbiddenTags = ['script', 'style', 'noscript', 'header', 'nav', 'footer'];
    
    // Clone the body to avoid modifying the actual page
    const bodyClone = document.body.cloneNode(true);
    
    // Remove forbidden elements
    forbiddenTags.forEach(tag => {
        const elements = bodyClone.getElementsByTagName(tag);
        while (elements.length > 0) {
            elements[0].parentNode.removeChild(elements[0]);
        }
    });
    
    // Get text content and clean it up
    let content = bodyClone.textContent || '';
    content = content
        .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
        .trim();
    
    // Count words
    const wordCount = content.split(/\s+/).length;
    
    // Only return content if it's longer than 50 words
    if (wordCount > 50) {
        return content;
    }
    return null;
}

async function summarizeContent() {
    const content = getMainContent();
    
    // If content is null or too short, don't proceed with summarization
    if (!content) {
        console.log('Content is too short or empty - skipping summarization');
        return;
    }
    
    // Proceed with existing summarization logic
    try {
        // ... rest of your summarization code ...
    } catch (error) {
        console.error('Error during summarization:', error);
    }
} 