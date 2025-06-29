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
    const sessionLog = [];
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;

    console.log = function(...args) {
        sessionLog.push({ timestamp: new Date().toISOString(), level: 'LOG', message: args.join(' ') });
        originalConsoleLog.apply(console, args);
    };

    console.error = function(...args) {
        sessionLog.push({ timestamp: new Date().toISOString(), level: 'ERROR', message: args.join(' ') });
        originalConsoleError.apply(console, args);
    };
    
    function logEvent(name, params = {}) {
        const eventData = { timestamp: new Date().toISOString(), level: 'EVENT', name, params };
        sessionLog.push(eventData);
        originalConsoleLog(`EVENT: ${name}`, params);
        if (typeof analytics !== 'undefined' && analytics) {
            fbLogEvent(analytics, name, params);
        }
    }

    // --- State variables & Constants ---
    const AI_JUDGE_URL = 'https://idx-tab-audio-app-25992832-715569829205.europe-west2.run.app/grade-response';
    const AGENT_SERVICE_URL = 'https://learning-agent-service-715569829205.europe-west2.run.app/generate-packet'; 
    
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
    const summarizeButton = document.getElementById('summarizeButton');
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
        logEvent('app_initialized');

        loadPrompts();

        onAuthStateChanged(auth, async (user) => {
            currentUser = user;
            if (user) {
                logEvent('auth_state_changed', { status: 'logged_in', userId: user.uid });
                userInfo.classList.remove('hidden');
                loginContainer.innerHTML = ''; 
                loginContainer.classList.add('hidden');
                userEmailEl.textContent = user.email;
                await fetchUserApiKey();
            } else {
                logEvent('auth_state_changed', { status: 'logged_out' });
                userInfo.classList.add('hidden');
                loginContainer.classList.remove('hidden');
                renderLoginButton();
                activeApiKey = null;
            }
            updateUI();
        });

    } catch (error) {
        console.error("Firebase Initialization Error:", error.message);
        openModal("Critical Error", `Could not initialize the application. Error: ${error.message}`);
    }
    
    function renderLoginButton() {
        loginContainer.innerHTML = `<button id="loginPromptButton" class="btn btn-secondary">Login / Sign Up</button>`;
        document.getElementById('loginPromptButton').addEventListener('click', openLoginModal);
    }

    function openLoginModal() {
        logEvent('ui_action', { component: 'login_modal', action: 'open' });
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
        logEvent('auth_attempt', { email: email });
        try {
            await signInWithEmailAndPassword(auth, email, password);
            logEvent('auth_success', { type: 'login' });
            closeModal();
        } catch (error) {
            if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
                try {
                    await createUserWithEmailAndPassword(auth, email, password);
                    logEvent('auth_success', { type: 'signup' });
                    closeModal();
                } catch (signUpError) {
                    logEvent('auth_failure', { type: 'signup', error: signUpError.message });
                    alert(`Signup failed: ${signUpError.message}`);
                }
            } else {
                logEvent('auth_failure', { type: 'login', error: error.message });
                alert(`Login failed: ${error.message}`);
            }
        }
    }

    function handleLogout() {
        logEvent('logout_attempt');
        signOut(auth).catch(error => {
            logEvent('logout_failure', { error: error.message });
            openModal("Error", `Logout failed: ${error.message}`);
        });
    }
    
    async function fetchUserApiKey() {
        if (!currentUser) return;
        logEvent('api_key_fetch_attempt');
        try {
            const userDocRef = doc(db, "users", currentUser.uid);
            const docSnap = await getDoc(userDocRef);
            if (docSnap.exists() && docSnap.data().geminiApiKey) {
                activeApiKey = docSnap.data().geminiApiKey;
                logEvent('api_key_fetch_success', { found: true });
            } else {
                activeApiKey = null;
                logEvent('api_key_fetch_success', { found: false });
            }
        } catch (e) {
            console.error("Error fetching API key: ", e);
            activeApiKey = null;
            logEvent('api_key_fetch_failure', { error: e.message });
        }
    }

    async function loadPrompts() {
        if (!firebaseInitialized) return;
        logEvent('prompts_load_attempt');
        try {
            const querySnapshot = await getDocs(collection(db, "prompts"));
            querySnapshot.forEach((doc) => promptsCache.set(doc.id, doc.data().text));
            logEvent('prompts_load_success', { count: promptsCache.size });
        } catch(e) {
            console.error("Could not load prompts from Firestore:", e);
            logEvent('prompts_load_failure', { error: e.message });
        }
    }
    
    // =================================================================
    // CORE FUNCTIONALITY: RECORDING & TRANSCRIPTION
    // =================================================================
        
    async function startRecording() {
        logEvent('recording_start_attempt');
        if (!getApiKey()) {
            logEvent('recording_start_failure', { reason: 'api_key_missing' });
            openModal("API Key Required", "Please log in and set your Gemini API key to use this application.");
            return;
        }
        
        if (mediaRecorder && mediaRecorder.state === "recording") return;

        try {
            const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            if (displayStream.getAudioTracks().length === 0) {
                displayStream.getTracks().forEach(track => track.stop());
                logEvent('recording_start_failure', { reason: 'no_audio_track' });
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
            logEvent('recording_start_success');
            updateUI();
        } catch (err) {
            console.error("Error starting recording:", err);
            logEvent('recording_start_failure', { reason: 'permission_denied_or_unknown', error: err.message });
            openModal("Recording Error", `Failed to start recording. Please grant permission. Error: ${err.message}`);
        }
    }

    async function stopRecording() {
        if (!mediaRecorder || mediaRecorder.state === "inactive") return;
        
        logEvent('recording_stop_attempt', { audio_chunks_present: audioChunks.length > 0 });
        mediaRecorder.onstop = async () => {
            if (audioStream) audioStream.getTracks().forEach(track => track.stop());
            updateUI();
            if (audioChunks.length > 0) {
                logEvent('transcription_initiated');
                await transcribeAudio();
            } else {
                logEvent('recording_stop_complete', { transcribed: false, reason: 'no_audio_chunks' });
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
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const payload = { contents: [{ parts: [{ text: "Transcribe the following audio recording accurately." }, { inline_data: { mime_type: "audio/webm", data: base64Audio } }] }] };

        try {
            const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error?.message || `API Error: ${response.status}`);
            if (result.candidates && result.candidates[0].content.parts[0].text) {
                const transcript = result.candidates[0].content.parts[0].text;
                outputEl.textContent = transcript;
                logEvent('transcription_success', { character_length: transcript.length });
            } else {
                throw new Error('Invalid API response structure.');
            }
        } catch (err) {
            outputEl.textContent = `Transcription Failed: ${err.message}`;
            logEvent('transcription_failure', { error: err.message });
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

        logEvent('agent_action_initiated', { action: 'generate_learning_packet' });
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
            logEvent('agent_action_success');
            displayLearningPacket(learningPacket);

        } catch (error) {
            console.error("Error calling agent service:", error);
            logEvent('agent_action_failure', { error: error.message });
            modalBody.innerHTML = `<p class="text-red-400">Could not generate Learning Packet. Error: ${error.message}</p>`;
        }
    }
    
    function displayLearningPacket(packet) {
        modalTitle.textContent = "Your Learning Packet";
        let html = '<div class="space-y-6">';

        if (packet.summary && !packet.summary.startsWith("Error:")) {
            html += `
                <div>
                    <h3 class="text-lg font-bold text-amber-500 mb-2 border-b border-slate-700 pb-1">Summary</h3>
                    <p class="text-slate-300 whitespace-pre-wrap">${packet.summary}</p>
                </div>
            `;
        }

        if (packet.keyConcepts && packet.keyConcepts.length > 0 && !packet.keyConcepts[0].concept.startsWith("Error")) {
            html += `
                <div>
                    <h3 class="text-lg font-bold text-amber-500 mb-2 border-b border-slate-700 pb-1">Key Concepts</h3>
                    <ul class="space-y-2 list-disc list-inside">
                        ${packet.keyConcepts.map(item => `<li><strong>${item.concept}:</strong> ${item.definition}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        if (packet.flashcards && packet.flashcards.length > 0 && !packet.flashcards[0].front.startsWith("Error")) {
            html += `
                <div>
                    <h3 class="text-lg font-bold text-amber-500 mb-2 border-b border-slate-700 pb-1">Flashcards</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        ${packet.flashcards.map(card => `
                            <div class="bg-slate-800 p-3 rounded-md border border-slate-700">
                                <p class="font-semibold">Q: ${card.front}</p>
                                <p class="text-slate-400 mt-1">A: ${card.back}</p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        
        html += '</div>';
        modalBody.innerHTML = html;
    }
    
    async function generateTextWithGemini(promptTemplate, taskTitle, promptId) {
        const apiKey = getApiKey();
        if (!apiKey) return;
        
        openModal(taskTitle, '<div class="flex justify-center items-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div></div>');
        
        const transcript = outputEl.textContent;
        const finalPrompt = promptTemplate.replace('{transcript}', transcript);
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const payload = { contents: [{ parts: [{ text: finalPrompt }] }] };

        try {
            const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error?.message || `API Error: ${response.status}`);
            if (result.candidates && result.candidates[0].content.parts[0].text) {
                const generatedText = result.candidates[0].content.parts[0].text;
                animateText(modalBody, generatedText);
                logEvent('ai_action_success', { prompt_id: promptId });
                showFeedbackUI(transcript, finalPrompt, generatedText, promptId);
            } else {
                throw new Error('Invalid API response.');
            }
        } catch (err) {
            modalBody.innerHTML = `<p class="text-red-400">Could not generate ${taskTitle.toLowerCase()}. Error: ${err.message}</p>`;
            logEvent('ai_action_failure', { prompt_id: promptId, error: err.message });
        }
    }

    function showFeedbackUI(transcript, prompt, response, promptId) {
        modalFeedbackEl.classList.remove('hidden');
        modalFeedbackEl.innerHTML = `
            <p class="text-sm text-slate-400 mb-2">Was this response helpful?</p>
            <div class="flex justify-center gap-4">
                <button class="feedback-btn p-2 rounded-full hover:bg-slate-700" data-rating="positive">
                    <i data-feather="thumbs-up" class="w-6 h-6 text-green-500"></i>
                </button>
                <button class="feedback-btn p-2 rounded-full hover:bg-slate-700" data-rating="negative">
                    <i data-feather="thumbs-down" class="w-6 h-6 text-red-500"></i>
                </button>
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
        
        modalFeedbackEl.innerHTML = '<p class="text-sm text-slate-400">Thank you for your feedback!</p>';
        logEvent('feedback_submitted', { prompt_id: promptId, rating, has_detailed_text: !!detailedFeedback });

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
            logEvent('feedback_saved_to_firestore', { feedbackId });

            fetch(AI_JUDGE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    feedbackId: feedbackId,
                    transcript: transcript,
                    prompt: prompt,
                    response: response
                })
            })
            .then(res => {
                if (res.ok) { logEvent('ai_judge_request_successful', { feedbackId }); } 
                else { logEvent('ai_judge_request_failed', { feedbackId, status: res.status }); }
            })
            .catch(err => {
                console.error("Error calling AI Judge service:", err);
                logEvent('ai_judge_request_error', { feedbackId, error: err.message });
            });
        } catch (err) {
            console.error("Error saving feedback to Firestore:", err);
            logEvent('feedback_save_failed', { error: err.message });
        }
    }

    async function openSaveModal() {
        if (!currentUser) {
            openModal("Login Required", "You must be logged in to save your work.");
            return;
        }
        const transcriptText = outputEl.textContent.trim();
        if (!transcriptText || transcriptText.startsWith("Your transcript")) {
            openModal("Error", "There is no transcript to save.");
            return;
        }
        logEvent('save_modal_opened');
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
                collectionsHtml += `
                    <label for="col-${col.id}" class="flex items-center space-x-3 p-2 rounded-md hover:bg-slate-700 cursor-pointer">
                        <input type="radio" id="col-${col.id}" name="collection" value="${col.id}" ${index === 0 ? 'checked' : ''} class="w-4 h-4 text-amber-500 bg-slate-900 border-slate-600 focus:ring-amber-500">
                        <span>${col.name}</span>
                    </label>
                `;
            });
            
            const defaultTitle = transcriptText.substring(0, 50) + (transcriptText.length > 50 ? "..." : "");
            const saveModalHtml = `
                <div class="space-y-4">
                    <div>
                        <label for="transcriptTitle" class="block text-sm font-medium text-slate-300 mb-1">Title</label>
                        <input type="text" id="transcriptTitle" value="${defaultTitle}" class="w-full bg-slate-900 border border-slate-600 rounded-md p-2 focus:ring-amber-500 focus:border-amber-500">
                    </div>
                    <div>
                        <p class="block text-sm font-medium text-slate-300">Choose a collection</p>
                        <div class="mt-2 space-y-1 max-h-40 overflow-y-auto p-1 border border-slate-700 rounded-md">${collectionsHtml}</div>
                    </div>
                    <button id="saveConfirmButton" class="btn btn-primary w-full">Save Transcript</button>
                </div>
            `;
            openModal("Save to Library", saveModalHtml);

            document.getElementById('saveConfirmButton').addEventListener('click', () => {
                const title = document.getElementById('transcriptTitle').value;
                const selectedCollection = document.querySelector('input[name="collection"]:checked');
                if (!title) { alert("Please enter a title."); return; }
                if (!selectedCollection) { alert("Please select a collection."); return; }
                saveTranscriptToLibrary(title, selectedCollection.value);
            });
        } catch (error) {
            console.error("Error fetching collections:", error);
            logEvent('save_modal_failure', { reason: 'fetch_collections_error', error: error.message });
            openModal("Error", "Could not load your collections. Please try again.");
        }
    }

    async function saveTranscriptToLibrary(title, collectionId) {
        if (!currentUser) return;
        const transcriptContent = outputEl.textContent.trim();
        logEvent('save_transcript_attempt', { collection_id: collectionId, title_length: title.length });
        const saveButtonEl = document.getElementById('saveConfirmButton');
        saveButtonEl.disabled = true;
        saveButtonEl.textContent = 'Saving...';

        try {
            await addDoc(collection(db, "users", currentUser.uid, "transcripts"), {
                title: title,
                content: transcriptContent,
                collectionId: collectionId,
                createdAt: serverTimestamp()
            });
            logEvent('save_transcript_success');
            saveButtonEl.textContent = 'Saved!';
            saveButtonEl.classList.remove('btn-primary');
            saveButtonEl.classList.add('bg-green-600');
            setTimeout(() => closeModal(), 1200);
        } catch (error) {
            console.error("Error saving transcript:", error);
            logEvent('save_transcript_failure', { error: error.message });
            saveButtonEl.disabled = false;
            saveButtonEl.textContent = 'Save Transcript';
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
        logEvent('debug_modal_opened');
        const reportHtml = `
            <div id="debug-report-content">${JSON.stringify(sessionLog, null, 2)}</div>
            <button id="copyLogBtn" class="btn">Copy to Clipboard</button>
        `;
        openModal("Session Debug Log", reportHtml);
        
        document.getElementById('copyLogBtn').addEventListener('click', () => {
            const logText = JSON.stringify(sessionLog, null, 2);
            navigator.clipboard.writeText(logText).then(() => {
                alert('Log copied to clipboard!');
                logEvent('debug_log_copied');
            }).catch(err => {
                console.error('Failed to copy log', err);
                logEvent('debug_log_copy_failed', { error: err.message });
            });
        });
    }
    
    // =================================================================
    // EVENT LISTENERS
    // =================================================================
    learningPacketButton.addEventListener('click', handleGeneratePacket);
    recordButton.addEventListener('click', startRecording);
    stopButton.addEventListener('click', stopRecording);
    // REMOVED: summarizeButton event listener as it's now in the dropdown
    saveButton.addEventListener('click', openSaveModal);
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
            const promptTemplate = promptsCache.get(promptId);

            if (!promptTemplate) {
                openModal("Error", `Prompt '${promptId}' not found.`);
                return;
            }
            generateTextWithGemini(promptTemplate, taskTitle, promptId);
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
