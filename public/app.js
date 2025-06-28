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
    measurementId: "G-BDW8YWD1QW"
};

// --- This wrapper ensures the code runs only after the page is fully loaded ---
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

    // --- State variables ---
    let currentUser = null;
    let db, auth, analytics;
    let mediaRecorder;
    let audioStream;
    let audioChunks = [];
    let activeApiKey = null;
    let firebaseInitialized = false;
    let promptsCache = new Map();

    // --- DOM element references ---
    const recordButton = document.getElementById('recordButton');
    const stopButton = document.getElementById('stopButton');
    const summarizeButton = document.getElementById('summarizeButton');
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

    // FIXED: The loginHtml constant was missing its content.
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
    // AI ACTIONS & LIBRARY FUNCTIONS
    // =================================================================
    
    function handleSummarize() {
        const promptId = 'summarize';
        const promptTemplate = promptsCache.get(promptId);
        if (!promptTemplate) {
            openModal("Error", "Could not find the 'summarize' prompt.");
            return;
        }
        generateTextWithGemini(promptTemplate, "Summary", promptId);
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
            } else {
                throw new Error('Invalid API response.');
            }
        } catch (err) {
            modalBody.innerHTML = `<p class="text-red-400">Could not generate ${taskTitle.toLowerCase()}. Error: ${err.message}</p>`;
            logEvent('ai_action_failure', { prompt_id: promptId, error: err.message });
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
                
                if (!title) {
                    alert("Please enter a title.");
                    return;
                }
                if (!selectedCollection) {
                    alert("Please select a collection.");
                    return;
                }
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

        const saveButton = document.getElementById('saveConfirmButton');
        saveButton.disabled = true;
        saveButton.textContent = 'Saving...';

        try {
            await addDoc(collection(db, "users", currentUser.uid, "transcripts"), {
                title: title,
                content: transcriptContent,
                collectionId: collectionId,
                createdAt: serverTimestamp()
            });
            logEvent('save_transcript_success');
            saveButton.textContent = 'Saved!';
            saveButton.classList.remove('btn-primary');
            saveButton.classList.add('bg-green-600');
            
            setTimeout(() => closeModal(), 1200);

        } catch (error) {
            console.error("Error saving transcript:", error);
            logEvent('save_transcript_failure', { error: error.message });
            saveButton.disabled = false;
            saveButton.textContent = 'Save Transcript';
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
        summarizeButton.disabled = !hasTranscript || isRecording;
        aiDropdownButton.disabled = !hasTranscript || isRecording;
        saveButton.disabled = !hasTranscript || isRecording || !isLoggedIn;
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
    recordButton.addEventListener('click', startRecording);
    stopButton.addEventListener('click', stopRecording);
    summarizeButton.addEventListener('click', handleSummarize);
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
            const taskTitle = button.textContent;
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
