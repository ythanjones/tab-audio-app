import LoggingService from './loggingService.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAnalytics, logEvent as fbLogEvent } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-analytics.js";
import { getFirestore, collection, addDoc, doc, setDoc, getDoc, serverTimestamp, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
import { 
    getAuth, 
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyCH7jBG_iSTFAYrWEtazEvlXk2ZC413AGo",
    authDomain: "tab-audio-app.firebaseapp.com",
    projectId: "tab-audio-app",
    storageBucket: "tab-audio-app.firebasestorage.app",
    messagingSenderId: "715569829205",
    appId: "1:715569829205:web:216b98f170035f2fcf0bdc",
    measurementId: "G-X9T1WHYM35"
};

document.addEventListener('DOMContentLoaded', () => {

    // =================================================================
    // DIAGNOSTICS & LOGGING SYSTEM
    // =================================================================
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;

    console.log = function(...args) {
        LoggingService.logEvent('console_log', { message: args.join(' ') });
        originalConsoleLog.apply(console, args);
    };

    console.error = function(...args) {
        LoggingService.logEvent('console_error', { message: args.join(' ') });
        originalConsoleError.apply(console, args);
    };

    // --- State variables & Constants ---
    const AI_JUDGE_URL = 'https://backend-service-g4vupj46ma-nw.a.run.app/grade-response';
    const AGENT_SERVICE_URL = 'https://agent-backend-service-g4vupj46ma-nw.a.run.app/generate-packet';    
    // ✅ FIX: Add service health check URLs
    const BACKEND_HEALTH_URL = 'https://backend-service-g4vupj46ma-nw.a.run.app/health';
    const AGENT_HEALTH_URL = 'https://agent-backend-service-g4vupj46ma-nw.a.run.app/health';

    let currentUser = null;
    let db, auth, analytics;
    let mediaRecorder;
    let audioStream;
    let audioChunks = [];
    let activeApiKey = null;
    let firebaseInitialized = false;
    let promptsCache = new Map();

    // --- DOM element references ---
    const learningPacketButton = document.getElementById('learningPacketButton');
    const recordButton = document.getElementById('recordButton');
    const stopButton = document.getElementById('stopButton');
    const saveButton = document.getElementById('saveButton');
    const outputEl = document.getElementById('transcriptionOutput');
    const loginContainer = document.getElementById('loginContainer');
    const userInfo = document.getElementById('userInfo');
    const userEmailEl = document.getElementById('userEmail');
    const logoutButton = document.getElementById('logoutButton');
    const aiDropdownButton = document.getElementById('aiDropdownButton');
    const aiDropdownMenu = document.getElementById('aiDropdownMenu');
    const aiButtons = document.querySelectorAll('.ai-button');
    const modalBackdrop = document.getElementById('modal-backdrop');
    const modalContent = document.getElementById('modal-content');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalFeedbackEl = document.getElementById('modal-feedback');
    const modalClose = document.getElementById('modal-close');
    const debugButton = document.getElementById('debugButton');
    
    // =================================================================
    // INITIALIZATION & AUTHENTICATION
    // =================================================================

    try {
        if (!firebaseConfig.apiKey) throw new Error("Firebase config object is empty.");
        
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        analytics = getAnalytics(app);
        db = getFirestore(app);
        firebaseInitialized = true;
        LoggingService.init();
        LoggingService.logEvent('app_initialized');

        loadPrompts();

        onAuthStateChanged(auth, async (user) => {
            currentUser = user;
            if (user) {
                LoggingService.logEvent('auth_state_changed', { status: 'logged_in', userId: user.uid });
                userInfo.classList.remove('hidden');
                loginContainer.innerHTML = ''; 
                loginContainer.classList.add('hidden');
                userEmailEl.textContent = user.email;
                
                // Add "Go to Library" button
                userInfo.insertAdjacentHTML('beforeend', `
                    <button id="goToLibraryBtn" class="btn btn-secondary ml-4">My Library</button>
                `);
                document.getElementById('goToLibraryBtn').addEventListener('click', () => {
                    window.location.href = 'library.html';
                });
                
                await fetchUserApiKey();
            } else {
                LoggingService.logEvent('auth_state_changed', { status: 'logged_out' });
                userInfo.classList.add('hidden');
                loginContainer.classList.remove('hidden');
                renderLoginButton();
                activeApiKey = null;
            }
            updateUI();
        });

    } catch (error) {
        console.error("Error calling agent service:", error);
        LoggingService.logEvent('agent_action_failure', { error: error.message });
        
        // ✅ FIX: Better error messages with suggestions
        let errorMessage = `Could not generate Learning Packet. ${error.message}`;
        
        if (error.message.includes('GEMINI_API_KEY')) {
            errorMessage += '\n\nSuggestion: The backend service needs the GEMINI_API_KEY environment variable configured.';
        } else if (error.message.includes('404')) {
            errorMessage += '\n\nSuggestion: The service endpoint may not be available. Check service deployment.';
        } else if (error.message.includes('500')) {
            errorMessage += '\n\nSuggestion: There was a server error. Check the service logs for more details.';
        }
        
        modalBody.innerHTML = `<p class="text-red-400 whitespace-pre-line">${errorMessage}</p>`;
    }
    
    function renderLoginButton() {
        loginContainer.innerHTML = `<button id="loginPromptButton" class="btn btn-secondary">Login / Sign Up</button>`;
        document.getElementById('loginPromptButton').addEventListener('click', openLoginModal);
    }

    function openLoginModal() {
        LoggingService.logEvent('ui_action', { component: 'login_modal', action: 'open' });
        const loginHtml = `
            <div class="space-y-4">
                <div>
                    <label for="emailInput" class="block text-sm font-medium text-slate-300">Email</label>
                    <input type="email" id="emailInput" class="w-full mt-1 bg-slate-900 border border-slate-600 rounded-md p-2 focus:ring-amber-500 focus:border-amber-500">
                </div>
                <div>
                    <label for="passwordInput" class="block text-sm font-medium text-slate-300">Password</label>
                    <input type="password" id="passwordInput" class="w-full mt-1 bg-slate-900 border border-slate-600 rounded-md p-2 focus:ring-amber-500 focus:border-amber-500">
                </div>
                <button id="loginSubmitButton" class="btn btn-primary w-full">Login / Sign Up</button>
            </div>
        `;
        openModal("Login", loginHtml);
        document.getElementById('loginSubmitButton').addEventListener('click', handleAuth);
    }
    
    async function handleAuth() {
        const email = document.getElementById('emailInput').value;
        const password = document.getElementById('passwordInput').value;
        if (!email || !password) {
            alert("Please enter both email and password.");
            return;
        }
        LoggingService.logEvent('auth_attempt', { email: email });
        try {
            await signInWithEmailAndPassword(auth, email, password);
            LoggingService.logEvent('auth_success', { type: 'login' });
            closeModal();
        } catch (error) {
            if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
                try {
                    await createUserWithEmailAndPassword(auth, email, password);
                    LoggingService.logEvent('auth_success', { type: 'signup' });
                    closeModal();
                } catch (signUpError) {
                    LoggingService.logEvent('auth_failure', { type: 'signup', error: signUpError.message });
                    alert(`Signup failed: ${signUpError.message}`);
                }
            } else {
                LoggingService.logEvent('auth_failure', { type: 'login', error: error.message });
                alert(`Login failed: ${error.message}`);
            }
        }
    }

    function handleLogout() {
        LoggingService.logEvent('logout_attempt');
        signOut(auth).catch(error => {
            LoggingService.logEvent('logout_failure', { error: error.message });
            openModal("Error", `Logout failed: ${error.message}`);
        });
    }
    
    async function fetchUserApiKey() {
        if (!currentUser) return;
        LoggingService.logEvent('api_key_fetch_attempt');
        try {
            const userDocRef = doc(db, "users", currentUser.uid);
            const docSnap = await getDoc(userDocRef);
            if (docSnap.exists() && docSnap.data().geminiApiKey) {
                activeApiKey = docSnap.data().geminiApiKey;
                LoggingService.logEvent('api_key_fetch_success', { found: true });
            } else {
                activeApiKey = null;
                LoggingService.logEvent('api_key_fetch_success', { found: false });
            }
        } catch (e) {
            console.error("Error fetching API key: ", e);
            activeApiKey = null;
            LoggingService.logEvent('api_key_fetch_failure', { error: e.message });
        }
    }

    async function loadPrompts() {
        if (!firebaseInitialized) return;
        LoggingService.logEvent('prompts_load_attempt');
        try {
            const querySnapshot = await getDocs(collection(db, "prompts"));
            querySnapshot.forEach((doc) => promptsCache.set(doc.id, doc.data().text));
            LoggingService.logEvent('prompts_load_success', { count: promptsCache.size });
        } catch(e) {
            console.error("Could not load prompts from Firestore:", e);
            LoggingService.logEvent('prompts_load_failure', { error: e.message });
        }
    }
    
    // =================================================================
    // CORE FUNCTIONALITY: RECORDING & TRANSCRIPTION
    // =================================================================
        
    async function startRecording() {
        LoggingService.logEvent('recording_start_attempt');
        if (!getApiKey()) {
            LoggingService.logEvent('recording_start_failure', { reason: 'api_key_missing' });
            openModal("API Key Required", "Please log in and set your Gemini API key to use this application.");
            return;
        }
        
        if (mediaRecorder && mediaRecorder.state === "recording") return;

        try {
            const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            if (displayStream.getAudioTracks().length === 0) {
                displayStream.getTracks().forEach(track => track.stop());
                LoggingService.logEvent('recording_start_failure', { reason: 'no_audio_track' });
                openModal("Audio Error", "No audio track found. Please ensure you share screen or tab audio.");
                return;
            }

            audioStream = new MediaStream(displayStream.getAudioTracks());
            displayStream.getVideoTracks().forEach(track => track.stop());
            audioChunks = [];

            mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunks.push(event.data);
            };

            audioStream.getTracks()[0].onended = () => stopRecording();
            mediaRecorder.start(1000); 
            LoggingService.logEvent('recording_start_success');
            updateUI();
        } catch (err) {
            console.error("Error starting recording:", err);
            LoggingService.logEvent('recording_start_failure', { reason: 'permission_denied_or_unknown', error: err.message });
            openModal("Recording Error", `Failed to start recording. Please grant permission. Error: ${err.message}`);
        }
    }

    async function stopRecording() {
        if (!mediaRecorder || mediaRecorder.state === "inactive") return;
        
        LoggingService.logEvent('recording_stop_attempt', { audio_chunks_present: audioChunks.length > 0 });
        mediaRecorder.onstop = async () => {
            if (audioStream) audioStream.getTracks().forEach(track => track.stop());
            updateUI();
            if (audioChunks.length > 0) {
                LoggingService.logEvent('transcription_initiated');
                await transcribeAudio();
            } else {
                LoggingService.logEvent('recording_stop_complete', { transcribed: false, reason: 'no_audio_chunks' });
                outputEl.textContent = "No audio was captured. Please try recording again.";
            }
        };
        mediaRecorder.stop();
    }
    
    async function transcribeAudio() {
        outputEl.textContent = "Transcribing, please wait...";
        const apiKey = getApiKey();
        if (!apiKey) return;
    
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const base64Audio = await blobToBase64(audioBlob);
        
        // Using a more direct and robust prompt for transcription
        const prompt = "Provide a verbatim transcript for the following audio. If the audio is silent or contains no discernible speech, return an empty string.";
        
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const payload = { 
            contents: [{ 
                parts: [
                    { text: prompt }, 
                    { inline_data: { mime_type: "audio/webm", data: base64Audio } }
                ] 
            }] 
        };
    
        try {
            const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const result = await response.json();
            
            // More robust check for API errors
            if (!response.ok) {
                const errorMessage = result.error?.message || `API Error: ${response.status}`;
                throw new Error(errorMessage);
            }
    
            const transcript = result.candidates?.[0]?.content?.parts?.[0]?.text;
    
            // Future-proofing: Check if the API returned a transcript or not
            if (typeof transcript === 'string' && transcript.trim().length > 0) {
                outputEl.textContent = transcript;
                LoggingService.logEvent('transcription_success', { character_length: transcript.length });
            } else if (typeof transcript === 'string') {
                outputEl.textContent = "No speech was detected in the audio.";
                LoggingService.logEvent('transcription_success', { character_length: 0, reason: 'no_speech_detected'});
            }
            else {
                // If the structure is not what we expect, log the entire response
                console.error("Unexpected API response structure:", JSON.stringify(result, null, 2));
                throw new Error('Invalid API response structure. See console for details.');
            }
        } catch (err) {
            outputEl.textContent = `Transcription Failed: ${err.message}`;
            LoggingService.logEvent('transcription_failure', { error: err.message });
        } finally {
            updateUI();
        }
    }

    // =================================================================
    // AGENT, AI & FEEDBACK FUNCTIONS
    // =================================================================

    async function handleGeneratePacket() {
        const apiKey = getApiKey();
        if (!apiKey) return;

        LoggingService.logEvent('agent_action_initiated', { action: 'generate_learning_packet' });
        openModal("Generating Learning Packet", '<div class="flex justify-center items-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div><p class="ml-4">The agent is working...</p></div>');
        
        const transcript = outputEl.textContent;
        
        try {
            const response = await fetch(AGENT_SERVICE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Agent service failed with status: ${response.status}`);
            }

            const learningPacket = await response.json();
            LoggingService.logEvent('agent_action_success');
            displayLearningPacket(learningPacket, transcript);

        } catch (error) {
            console.error("Error calling agent service:", error);
            LoggingService.logEvent('agent_action_failure', { error: error.message });
            modalBody.innerHTML = `<p class="text-red-400">Could not generate Learning Packet. Error: ${error.message}</p>`;
        }
    }
    
    function displayLearningPacket(packet, transcript) {
        modalTitle.textContent = "Your Learning Packet";
        let html = '<div class="space-y-6">';
        const originalPrompt = "Generate a complete learning packet including a summary, key concepts, flashcards, and action items from the provided transcript.";
    
        // Summary Section
        if (packet.summary && !packet.summary.startsWith("Error:")) {
            html += createPacketSection('Summary', packet.summary, 'summarize_packet_part', transcript, originalPrompt);
        }
    
        // Key Concepts Section
        if (packet.keyConcepts && packet.keyConcepts.length > 0 && !packet.keyConcepts[0].concept.startsWith("Error")) {
            const conceptsHtml = `<ul class="space-y-2 list-disc list-inside">${packet.keyConcepts.map(item => `<li><strong>${item.concept}:</strong> ${item.definition}</li>`).join('')}</ul>`;
            html += createPacketSection('Key Concepts', conceptsHtml, 'keyConcepts_packet_part', transcript, originalPrompt);
        }
    
        // ✅ NEW: Action Items Section
        if (packet.actionItems && packet.actionItems.length > 0 && !packet.actionItems[0].startsWith("Error")) {
            const actionItemsHtml = `
                <ul class="space-y-2">
                    ${packet.actionItems.map(item => `
                        <li class="flex items-start gap-3 p-3 bg-slate-800 rounded-md border border-slate-700">
                            <div class="flex-shrink-0 mt-1">
                                <div class="w-4 h-4 border-2 border-amber-500 rounded-sm"></div>
                            </div>
                            <span class="text-slate-200">${item}</span>
                        </li>
                    `).join('')}
                </ul>
            `;
            html += createPacketSection('Action Items', actionItemsHtml, 'actionItems_packet_part', transcript, originalPrompt);
        }
    
        // Flashcards Section
        if (packet.flashcards && packet.flashcards.length > 0 && !packet.flashcards[0].front.startsWith("Error")) {
            const flashcardsHtml = `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">${packet.flashcards.map(card => `<div class="bg-slate-800 p-3 rounded-md border border-slate-700"><p class="font-semibold">Q: ${card.front}</p><p class="text-slate-400 mt-1">A: ${card.back}</p></div>`).join('')}</div>`;
            html += createPacketSection('Flashcards', flashcardsHtml, 'flashcards_packet_part', transcript, originalPrompt);
        }
        
        html += '</div>';
        
        modalFeedbackEl.innerHTML = `<button id="savePacketBtn" class="btn btn-primary">Save to Library</button>`;
        modalFeedbackEl.classList.remove('hidden');
        document.getElementById('savePacketBtn').addEventListener('click', () => openSaveModal(null, packet));
    
        modalBody.innerHTML = html;
        addFeedbackListeners();
        feather.replace();
    }
    
    function createPacketSection(title, content, promptId, transcript, originalPrompt) {
        return `
            <div class="packet-section">
                <h3 class="text-lg font-bold text-amber-500 mb-2 border-b border-slate-700 pb-1">${title}</h3>
                <div class="packet-content" data-response="${escape(content)}">${content}</div>
                <div class="feedback-widget" data-prompt-id="${promptId}" data-transcript="${escape(transcript)}" data-prompt="${escape(originalPrompt)}">
                    <p class="feedback-question">Helpful?</p>
                    <div class="feedback-buttons">
                        <button class="feedback-btn" data-rating="positive"><i data-feather="thumbs-up"></i></button>
                        <button class="feedback-btn" data-rating="negative"><i data-feather="thumbs-down"></i></button>
                    </div>
                    <div class="detailed-feedback-wrapper hidden">
                        <textarea class="detailed-feedback-input" placeholder="How can we improve?"></textarea>
                        <button class="submit-detailed-feedback">Submit</button>
                    </div>
                </div>
            </div>
        `;
    }

    function addFeedbackListeners() {
        document.querySelectorAll('.feedback-widget').forEach(widget => {
            widget.querySelector('[data-rating="positive"]').addEventListener('click', (e) => handlePacketFeedback(e, widget));
            widget.querySelector('[data-rating="negative"]').addEventListener('click', (e) => {
                widget.querySelector('.detailed-feedback-wrapper').classList.remove('hidden');
                widget.querySelector('.submit-detailed-feedback').onclick = (e_sub) => handlePacketFeedback(e, widget);
            });
        });
    }

    async function handlePacketFeedback(event, widget) {
        const rating = event.currentTarget.dataset.rating;
        const detailedInput = widget.querySelector('.detailed-feedback-input');
        const detailedFeedback = detailedInput ? detailedInput.value : '';

        const promptId = widget.dataset.promptId;
        const transcript = unescape(widget.dataset.transcript);
        const prompt = unescape(widget.dataset.prompt);
        const response = unescape(widget.querySelector('.packet-content').dataset.response);
        
        widget.innerHTML = '<p class="text-sm text-slate-400">Thank you!</p>';
        await saveAndJudgeFeedback(transcript, prompt, response, promptId, rating, detailedFeedback);
    }
    
    async function generateTextWithGemini(promptId, taskTitle) {
        const apiKey = getApiKey();
        if (!apiKey) {
            openModal("API Key Required", "Please set your Gemini API key to use the AI tools.");
            return;
        }
        
        const transcript = outputEl.textContent.trim();
        // Future-proofing: Prevent running on empty or placeholder text
        if (!transcript || transcript.startsWith("No speech") || transcript.startsWith("Your transcript")) {
            openModal("Error", "There is no transcript to process.");
            return;
        }
    
        const promptTemplate = promptsCache.get(promptId);
    
        // This block provides a much better error message if the prompt ID is wrong
        if (!promptTemplate) {
            const availablePrompts = Array.from(promptsCache.keys()).join(', ');
            const errorMessage = `Prompt with ID '${promptId}' was not found. Available prompts are: [${availablePrompts}]`;
            console.error(errorMessage);
            openModal("Error", errorMessage);
            return;
        }
        
        openModal(taskTitle, '<div class="flex justify-center items-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div></div>');
        
        const finalPrompt = promptTemplate.replace('{transcript}', transcript);
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const payload = { contents: [{ parts: [{ text: finalPrompt }] }] };
    
        try {
            const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const result = await response.json();
            
            if (!response.ok) {
                const errorMessage = result.error?.message || `API Error: ${response.status}`;
                throw new Error(errorMessage);
            }
            
            if (result.candidates && result.candidates[0].content.parts[0].text) {
                const generatedText = result.candidates[0].content.parts[0].text;
                animateText(modalBody, generatedText);
                LoggingService.logEvent('ai_action_success', { prompt_id: promptId });
                showFeedbackUI(transcript, finalPrompt, generatedText, promptId);
            } else {
                 // If the structure is not what we expect, log the entire response
                console.error("Unexpected API response structure:", JSON.stringify(result, null, 2));
                throw new Error('Invalid API response structure. See console for details.');
            }
        } catch (err) {
            modalBody.innerHTML = `<p class="text-red-400">Could not generate ${taskTitle.toLowerCase()}. Error: ${err.message}</p>`;
            LoggingService.logEvent('ai_action_failure', { prompt_id: promptId, error: err.message });
        }
    }

    function showFeedbackUI(transcript, prompt, response, promptId) {
        modalFeedbackEl.classList.remove('hidden');
        modalFeedbackEl.innerHTML = `
            <p class="text-sm text-slate-400 mb-2">Was this response helpful?</p>
            <div class="flex justify-center gap-4">
                <button class="feedback-btn p-2 rounded-full hover:bg-slate-700" data-rating="positive"><i data-feather="thumbs-up" class="w-6 h-6 text-green-500"></i></button>
                <button class="feedback-btn p-2 rounded-full hover:bg-slate-700" data-rating="negative"><i data-feather="thumbs-down" class="w-6 h-6 text-red-500"></i></button>
            </div>
            <div id="detailed-feedback-container" class="mt-3 hidden">
                <textarea id="detailed-feedback-input" class="w-full text-sm bg-slate-900 border-slate-600 rounded-md p-2" placeholder="Optional: How could we improve?"></textarea>
                <button id="submit-detailed-feedback" class="mt-2 text-xs bg-slate-600 text-white px-3 py-1.5 rounded-md hover:bg-slate-500">Submit Feedback</button>
            </div>
        `;
        feather.replace();

        const feedbackButtons = modalFeedbackEl.querySelectorAll('.feedback-btn');
        const detailedFeedbackContainer = document.getElementById('detailed-feedback-container');

        feedbackButtons.forEach(button => {
            button.addEventListener('click', async (e) => {
                const rating = e.currentTarget.dataset.rating;
                if (rating === 'negative') {
                    detailedFeedbackContainer.classList.remove('hidden');
                    document.getElementById('submit-detailed-feedback').onclick = () => {
                        const detailedText = document.getElementById('detailed-feedback-input').value;
                        saveAndJudgeFeedback(transcript, prompt, response, promptId, rating, detailedText);
                    };
                } else {
                    await saveAndJudgeFeedback(transcript, prompt, response, promptId, rating);
                }
            });
        });
    }

    async function saveAndJudgeFeedback(transcript, prompt, response, promptId, rating, detailedFeedback = '') {
        if (!currentUser) {
            modalFeedbackEl.innerHTML = '<p class="text-sm text-yellow-400">Please log in to submit feedback.</p>';
            return;
        }
        
        // This is a generic thanks message; specific widgets will overwrite themselves.
        if(modalFeedbackEl.contains(document.getElementById('detailed-feedback-container'))) {
            modalFeedbackEl.innerHTML = '<p class="text-sm text-slate-400">Thank you for your feedback!</p>';
        }
        
        LoggingService.logEvent('feedback_submitted', { prompt_id: promptId, rating, has_detailed_text: !!detailedFeedback });

        try {
            const feedbackDocRef = await addDoc(collection(db, "users", currentUser.uid, "feedback"), {
                userId: currentUser.uid,
                promptId: promptId,
                rating: rating,
                detailedFeedback: detailedFeedback,
                transcript: transcript,
                prompt: prompt,
                response: response,
                createdAt: serverTimestamp()
            });
            const feedbackId = feedbackDocRef.id;
            LoggingService.logEvent('feedback_saved_to_firestore', { feedbackId });

            fetch(AI_JUDGE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ feedbackId, transcript, prompt, response })
            })
            .then(res => {
                if (res.ok) { LoggingService.logEvent('ai_judge_request_successful', { feedbackId }); } 
                else { LoggingService.logEvent('ai_judge_request_failed', { feedbackId, status: res.status }); }
            })
            .catch(err => {
                console.error("Error calling AI Judge service:", err);
                LoggingService.logEvent('ai_judge_request_error', { feedbackId, error: err.message });
            });
        } catch (err) {
            console.error("Error saving feedback to Firestore:", err);
            LoggingService.logEvent('feedback_save_failed', { error: err.message });
        }
    }

    async function openSaveModal(isTranscript = true, packetToSave = null) {
        if (!currentUser) {
            openModal("Login Required", "You must be logged in to save your work.");
            return;
        }
        
        const contentToSave = isTranscript ? outputEl.textContent.trim() : "Learning Packet";
        if (!contentToSave || contentToSave.startsWith("Your transcript")) {
            openModal("Error", "There is nothing to save.");
            return;
        }
        
        LoggingService.logEvent('save_modal_opened', { type: isTranscript ? 'transcript' : 'packet' });
        openModal("Save to Library", '<p>Loading your collections...</p>');

        try {
            const collectionsRef = collection(db, "users", currentUser.uid, "collections");
            const q = query(collectionsRef, orderBy("createdAt", "desc"));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                openModal("No Collections Found", "Please create a collection in your library first.");
                return;
            }

            let collectionsHtml = '';
            querySnapshot.forEach((doc, index) => {
                const col = { id: doc.id, ...doc.data() };
                collectionsHtml += `<label class="flex items-center space-x-3 p-2 rounded-md hover:bg-slate-700 cursor-pointer"><input type="radio" name="collection" value="${col.id}" ${index === 0 ? 'checked' : ''} class="w-4 h-4 text-amber-500 bg-slate-900 border-slate-600 focus:ring-amber-500"><span>${col.name}</span></label>`;
            });
            
            const defaultTitle = contentToSave.substring(0, 50) + (contentToSave.length > 50 ? "..." : "");
            const saveModalHtml = `
                <div class="space-y-4">
                    <div>
                        <label for="itemTitle" class="block text-sm font-medium text-slate-300 mb-1">Title</label>
                        <input type="text" id="itemTitle" value="${defaultTitle}" class="w-full bg-slate-900 border border-slate-600 rounded-md p-2 focus:ring-amber-500 focus:border-amber-500">
                    </div>
                    <div>
                        <p class="block text-sm font-medium text-slate-300">Choose a collection</p>
                        <div class="mt-2 space-y-1 max-h-40 overflow-y-auto p-1 border border-slate-700 rounded-md">${collectionsHtml}</div>
                    </div>
                    <button id="saveConfirmButton" class="btn btn-primary w-full">Save</button>
                </div>
            `;
            openModal("Save to Library", saveModalHtml);

            document.getElementById('saveConfirmButton').addEventListener('click', () => {
                const title = document.getElementById('itemTitle').value;
                const selectedCollection = document.querySelector('input[name="collection"]:checked');
                if (!title || !selectedCollection) {
                    alert("Please provide a title and select a collection.");
                    return;
                }
                if(isTranscript) {
                    saveTranscriptToLibrary(title, selectedCollection.value);
                } else {
                    savePacketToLibrary(title, selectedCollection.value, packetToSave);
                }
            });
        } catch (error) {
            console.error("Error fetching collections:", error);
            LoggingService.logEvent('save_modal_failure', { reason: 'fetch_collections_error', error: error.message });
            openModal("Error", "Could not load your collections. Please try again.");
        }
    }

    async function saveTranscriptToLibrary(title, collectionId) {
        if (!currentUser) return;
        const transcriptContent = outputEl.textContent.trim();
        LoggingService.logEvent('save_transcript_attempt', { collection_id: collectionId });
        const saveButtonEl = document.getElementById('saveConfirmButton');
        saveButtonEl.disabled = true;
        saveButtonEl.textContent = 'Saving...';

        try {
            await addDoc(collection(db, "users", currentUser.uid, "transcripts"), {
                title, content: transcriptContent, collectionId, createdAt: serverTimestamp()
            });
            LoggingService.logEvent('save_transcript_success');
            saveButtonEl.textContent = 'Saved!';
            saveButtonEl.classList.add('bg-green-600');
            setTimeout(() => closeModal(), 1200);
        } catch (error) {
            LoggingService.logEvent('save_transcript_failure', { error: error.message });
            saveButtonEl.disabled = false;
            saveButtonEl.textContent = 'Save Transcript';
        }
    }
    
    async function savePacketToLibrary(title, collectionId, packet) {
        if (!currentUser || !packet) return;
        LoggingService.logEvent('save_packet_attempt', { collection_id: collectionId });
        const saveButtonEl = document.getElementById('saveConfirmButton');
        saveButtonEl.disabled = true;
        saveButtonEl.textContent = 'Saving...';

        try {
            await addDoc(collection(db, "users", currentUser.uid, "learning_packets"), {
                title, packet, collectionId, createdAt: serverTimestamp()
            });
            LoggingService.logEvent('save_packet_success');
            saveButtonEl.textContent = 'Saved!';
            saveButtonEl.classList.add('bg-green-600');
            setTimeout(() => closeModal(), 1200);
        } catch (error) {
            LoggingService.logEvent('save_packet_failure', { error: error.message });
            saveButtonEl.disabled = false;
            saveButtonEl.textContent = 'Save Packet';
        }
    }

    // =================================================================
    // UI & HELPER FUNCTIONS
    // =================================================================
    
    function updateUI() {
        const isRecording = mediaRecorder && mediaRecorder.state === 'recording';
        const hasTranscript = outputEl.textContent && !outputEl.textContent.startsWith("Your transcript") && !outputEl.textContent.startsWith("Transcribing") && !outputEl.textContent.startsWith("No audio");
        const isLoggedIn = !!currentUser;
        
        recordButton.disabled = isRecording;
        recordButton.classList.toggle('recording', isRecording);
        recordButton.querySelector('span').textContent = isRecording ? 'Recording...' : 'Record';
        
        stopButton.disabled = !isRecording;
        learningPacketButton.disabled = !hasTranscript || isRecording;
        saveButton.disabled = !hasTranscript || isRecording || !isLoggedIn;
        aiDropdownButton.disabled = !hasTranscript || isRecording;
    }

    function getApiKey() {
        if (activeApiKey) return activeApiKey;
        return null;
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
        });
    }
    
    function animateText(element, text) {
        element.innerHTML = text.replace(/\*/g, '').replace(/\n/g, '<br>');
    }

    function openModal(title, content) {
        modalTitle.textContent = title;
        modalBody.innerHTML = content;
        modalFeedbackEl.classList.add('hidden');
        modalBackdrop.classList.remove('hidden');
        setTimeout(() => {
            modalBackdrop.classList.add('opacity-100');
            modalContent.classList.add('scale-100', 'opacity-100');
        }, 10);
    }

    function closeModal() {
        modalBackdrop.classList.remove('opacity-100');
        modalContent.classList.remove('scale-100', 'opacity-100');
        setTimeout(() => modalBackdrop.classList.add('hidden'), 300);
    }
    
    function openDebugModal() {
        LoggingService.logEvent('debug_modal_opened');
        const logData = LoggingService.getLog();
        const reportHtml = `
            <pre class="bg-slate-900 p-3 rounded-md text-xs whitespace-pre-wrap"><code>${JSON.stringify(logData, null, 2)}</code></pre>
            <button id="copyLogBtn" class="btn btn-secondary mt-4">Copy to Clipboard</button>
        `;
        openModal("Session Debug Log", reportHtml);
        
        document.getElementById('copyLogBtn').addEventListener('click', () => {
            const logText = JSON.stringify(logData, null, 2);
            navigator.clipboard.writeText(logText).then(() => {
                alert('Log copied to clipboard!');
            }).catch(err => {
                console.error('Failed to copy log', err);
            });
        });
    }
    
    // =================================================================
    // EVENT LISTENERS
    // =================================================================
    learningPacketButton.addEventListener('click', handleGeneratePacket);
    recordButton.addEventListener('click', startRecording);
    stopButton.addEventListener('click', stopRecording);
    saveButton.addEventListener('click', () => openSaveModal(true, null)); // For saving transcripts
    logoutButton.addEventListener('click', handleLogout);
    debugButton.addEventListener('click', openDebugModal);
    
    aiDropdownButton.addEventListener('click', (e) => {
        const isExpanded = aiDropdownButton.getAttribute('aria-expanded') === 'true';
        aiDropdownButton.setAttribute('aria-expanded', !isExpanded);
        aiDropdownMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!aiDropdownButton.contains(e.target) && !aiDropdownMenu.contains(e.target)) {
            aiDropdownMenu.classList.add('hidden');
            aiDropdownButton.setAttribute('aria-expanded', 'false');
        }
    });

    aiButtons.forEach(button => {
        button.addEventListener('click', () => {
            const promptId = button.dataset.promptId;
            const taskTitle = button.textContent.replace(' Only','');
            
            // This now correctly calls the updated function
            generateTextWithGemini(promptId, taskTitle); 
            
            aiDropdownMenu.classList.add('hidden');
            aiDropdownButton.setAttribute('aria-expanded', 'false');
        });
    });

    modalClose.addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) closeModal();
    });
    
    updateUI();
});