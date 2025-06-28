import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAnalytics, logEvent as fbLogEvent } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-analytics.js";
import { getFirestore, collection, addDoc, query, getDocs, orderBy, limit, doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
import { 
    getAuth, 
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBruGCfWHwVbxWC5mGUDTHAjT_1vcXveiw",
    authDomain: "tab-audio-app.firebaseapp.com",
    projectId: "tab-audio-app",
    storageBucket: "tab-audio-app.firebasestorage.app",
    messagingSenderId: "715569829205",
    appId: "1:715569829205:web:216b98f170035f2fcf0bdc",
    measurementId: "G-BDW8YWD1QW"
};

// --- This wrapper ensures the code runs only after the page is fully loaded ---
document.addEventListener('DOMContentLoaded', () => {

    // --- Diagnostics & Logging System ---
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

    function logEvent(name, params) {
        sessionLog.push({ timestamp: new Date().toISOString(), level: 'EVENT', name, params });
        if (analytics) {
            fbLogEvent(analytics, name, params);
        } else {
            console.log(`Analytics not initialized. Event not logged: ${name}`, params);
        }
    }
    // --- End Diagnostics ---

    // DOM element references
    const appContainer = document.getElementById('app-container');
    const recordButton = document.getElementById('recordButton');
    const pauseButton = document.getElementById('pauseButton');
    const transcribeButton = document.getElementById('transcribeButton');
    const statusEl = document.getElementById('status');
    const outputEl = document.getElementById('transcriptionOutput');
    const errorDisplay = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    
    // Interactive icon elements
    const apiKeyContainer = document.getElementById('apiKeyContainer');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const loginContainer = document.getElementById('loginContainer');
    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('emailInput');
    const passwordInput = document.getElementById('passwordInput');
    const loginButton = document.getElementById('loginButton');
    const userInfo = document.getElementById('userInfo');
    const userEmailEl = document.getElementById('userEmail');
    const logoutButton = document.getElementById('logoutButton');
    const historyButton = document.getElementById('historyButton');
    const settingsButton = document.getElementById('settingsButton');
    const saveButton = document.getElementById('saveButton');
    const debugButton = document.getElementById('debugButton');
    
    // AI Action Elements
    const aiDropdownButton = document.getElementById('aiDropdownButton');
    const aiDropdownMenu = document.getElementById('aiDropdownMenu');
    const aiButtons = document.querySelectorAll('.ai-button');

    const modalBackdrop = document.getElementById('modal-backdrop');
    const modalContent = document.getElementById('modal-content');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalFeedback = document.getElementById('modal-feedback');
    const modalClose = document.getElementById('modal-close');

    // State variables
    let mediaRecorder;
    let audioStream;
    let audioChunks = [];
    let animationTimeout;
    let currentUser = null; 
    let activeApiKey = null;
    let activeContainer = null;
    let firebaseInitialized = false;
    let analytics, db, auth;
    let recordingStartTime;

    // Initialize Firebase
    try {
        if (!firebaseConfig.apiKey) {
             throw new Error("Firebase config object is empty. Please paste your project's configuration keys into the script.");
        }
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        analytics = getAnalytics(app);
        db = getFirestore(app);
        firebaseInitialized = true;
        console.log("Firebase initialized successfully.");

        loadPrompts();

        onAuthStateChanged(auth, async (user) => {
            currentUser = user;
            if (user) {
                appContainer.classList.add('logged-in');
                userEmailEl.textContent = user.email;
                closeContainer(loginContainer);
                await fetchUserApiKey();
            } else {
                appContainer.classList.remove('logged-in');
                userEmailEl.textContent = '';
                activeApiKey = null;
            }
        });

    } catch (error) {
        console.error("Firebase Initialization Error:", error.message);
        showError(error.message, true);
    }
    
    async function handleAuth() {
        if (!firebaseInitialized) return;
        const email = emailInput.value;
        const password = passwordInput.value;
        if (!email || !password) {
            showError("Please enter both email and password.");
            return;
        }
        hideError();

        try {
            await signInWithEmailAndPassword(auth, email, password);
            logEvent('user_action', { action_type: 'login' });
        } catch (error) {
            if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
                try {
                    await createUserWithEmailAndPassword(auth, email, password);
                     logEvent('user_action', { action_type: 'signup' });
                } catch (signUpError) {
                    showError(signUpError.message);
                }
            } else {
                showError(error.message);
            }
        }
    }

    function handleLogout() {
        if (!firebaseInitialized) return;
        signOut(auth).then(() => {
            logEvent('user_action', { action_type: 'logout' });
        }).catch(error => showError(error.message));
    }

    function closeContainer(container) {
        if (!container || !container.classList.contains('is-active')) return;

        if (container.id === 'loginContainer') {
            container.classList.remove('is-fully-open');
            setTimeout(() => container.classList.remove('is-active'), 300);
        } else {
            container.classList.remove('is-active');
        }

        if (activeContainer === container) {
            activeContainer = null;
        }
    }

    function openContainer(containerToOpen) {
        if (activeContainer && activeContainer !== containerToOpen) {
            closeContainer(activeContainer);
        }
        
        containerToOpen.classList.add('is-active');
        activeContainer = containerToOpen;

        if (containerToOpen.id === 'loginContainer') {
             setTimeout(() => {
                if (containerToOpen.classList.contains('is-active')) containerToOpen.classList.add('is-fully-open');
            }, 400);
        } else if (containerToOpen.id === 'apiKeyContainer') {
            setTimeout(() => {
                if (containerToOpen.classList.contains('is-active')) apiKeyInput.focus();
            }, 400);
        }
    }
    
    function animateText(element, text, delay = 30) {
        clearTimeout(animationTimeout);
        element.innerHTML = '';
        const words = text.split(/\s+/).filter(w => w.length > 0);
        if (words.length === 0 && text.trim() === '') {
            element.innerHTML = ' ';
            return;
        }
        words.forEach((word, index) => {
            const wordSpan = document.createElement('span');
            wordSpan.textContent = word + ' ';
            wordSpan.className = 'text-reveal-word';
            wordSpan.style.animationDelay = `${index * delay}ms`;
            element.appendChild(wordSpan);
        });
    }
    
    function getApiKey() {
        if (activeApiKey) {
            hideError();
            return activeApiKey;
        }
        showError("Please log in and set your API key in settings, or provide a session key.");
        return null;
    }

    async function validateApiKey(key, shouldSave = false) {
        if (!key) {
            showError("API key field is empty.");
            return;
        }
        animateText(statusEl, "Validating API Key...");
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
        const payload = { contents: [{ parts: [{ text: "hello" }] }] };
        try {
            const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (response.ok) {
                activeApiKey = key;
                animateText(statusEl, "API Key is valid.");
                logEvent('api_key_validated', { success: true });
                hideError();
                closeContainer(apiKeyContainer);
                if (currentUser && shouldSave) {
                    await saveUserApiKey(key);
                    animateText(statusEl, "API Key saved to your profile.");
                }
            } else {
                const error = await response.json();
                throw new Error(error.error.message || `HTTP error! status: ${response.status}`);
            }
        } catch (err) {
            console.error("API Key validation error:", err);
            logEvent('api_key_validated', { success: false, error_message: err.message });
            showError(`API Key validation failed: ${err.message}`);
            animateText(statusEl, "Invalid API Key.");
        }
    }


    function showError(message, isCritical = false) {
        errorText.textContent = message;
        errorDisplay.classList.remove('hidden');
        if(isCritical) {
            errorDisplay.classList.add('bg-red-200', 'border-red-500', 'text-red-900', 'p-4', 'font-bold');
        }
        console.error(message);
    }

    function hideError() {
        if (!errorDisplay.classList.contains('hidden')) {
            errorDisplay.classList.add('hidden');
        }
    }

    function setAiButtonsState(enabled) {
        aiDropdownButton.disabled = !enabled;
        aiDropdownButton.classList.toggle('btn-disabled', !enabled);
    }
    
    function updateUI(status, message = '') {
        animateText(statusEl, message || status);
        
        const isRecording = status === 'Recording';
        const isPaused = status === 'Paused';
        const hasAudio = audioChunks.length > 0;

        recordButton.textContent = isPaused ? 'Resume' : 'Record';
        
        recordButton.disabled = isRecording && !isPaused;
        pauseButton.disabled = !isRecording || isPaused;
        transcribeButton.disabled = !hasAudio || isRecording;
        
        [recordButton, pauseButton, transcribeButton].forEach(btn => {
             btn.classList.toggle('btn-disabled', btn.disabled);
        });
    }

    async function handleStartClick() {
        if (!firebaseInitialized) {
            showError("Cannot start recording. Firebase is not configured correctly.", true);
            return;
        }
        hideError();
        if (!getApiKey()) return;
        
        if (mediaRecorder && mediaRecorder.state === 'paused') {
            mediaRecorder.resume();
            updateUI('Recording');
            return;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            showError("Your browser does not support screen capture.");
            return;
        }
        try {
            const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            if (displayStream.getAudioTracks().length > 0) {
                audioStream = new MediaStream(displayStream.getAudioTracks());
                displayStream.getVideoTracks()[0].stop();
                
                logEvent('recording_started', { user_id: currentUser ? currentUser.uid : 'anonymous' });
                audioChunks = []; // Reset for new recording

                mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
                
                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) audioChunks.push(event.data);
                };
                
                outputEl.innerHTML = '';
                setAiButtonsState(false);
                updateUI('Recording');
                mediaRecorder.start(1000); 
                
                audioStream.getTracks()[0].onended = () => handleRecordingStop(true);
            } else {
                showError("No audio track found. Please ensure you share tab audio.");
                displayStream.getTracks().forEach(track => track.stop());
            }
        } catch (err) {
            console.error("Error starting recording:", err);
            updateUI('Error', 'Failed to start recording.');
            if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
                showError('Permission to capture screen/audio was denied.');
            } else {
                showError(`An unknown error occurred: ${err.message}`);
            }
        }
    }
    
    function handlePauseClick() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.pause();
            updateUI('Paused');
        }
    }

    async function handleTranscribeClick() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        if (audioChunks.length === 0) {
            showError("No audio has been recorded to transcribe.");
            return;
        }
        updateUI('Transcribing...');
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const base64String = await blobToBase64(audioBlob);
        await transcribeAudio(base64String);
    }
    
    function handleRecordingStop(fromStreamEnd = false) {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        if (audioStream) {
            audioStream.getTracks().forEach(track => track.stop());
        }
        if(!fromStreamEnd && audioChunks.length > 0) {
            updateUI('Stopped');
        }
    }
    
    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
        });
    }
    
    async function transcribeAudio(base64Audio) {
        const apiKey = getApiKey();
        if (!apiKey) return;

        updateUI('Transcribing...');
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const payload = { contents: [{ parts: [{ text: "Transcribe the following audio recording." }, { inline_data: { mime_type: "audio/webm", data: base64Audio } }] }] };

        try {
            const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error.message || `API Error: ${response.status}`);
            }
            
            const result = await response.json();
            if (result.candidates && result.candidates[0].content.parts[0].text) {
                const transcript = result.candidates[0].content.parts[0].text;
                outputEl.textContent = transcript; // Use textContent for raw text
                updateUI('Transcription Complete', 'Transcription Complete');
                setAiButtonsState(true);
                logEvent('transcription_successful');
            } else {
                throw new Error('Invalid API response.');
            }
        } catch (err) {
             logEvent('transcription_failed', { error_code: 'CLIENT_SIDE', error_message: err.message });
             showError(`Transcription Failed: ${err.message}`);
             updateUI('Transcription Failed', 'Transcription Failed');
        }
    }

    async function generateTextWithGemini(promptTemplate, taskTitle, promptId) {
        const apiKey = getApiKey();
        if (!apiKey) return;
        
        modalFeedback.classList.add('hidden');
        openModal(taskTitle, '<div class="flex justify-center items-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>');
        
        const transcript = outputEl.textContent;
        const finalPrompt = promptTemplate.replace('{transcript}', transcript);

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const payload = { contents: [{ parts: [{ text: finalPrompt }] }] };

        try {
             const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
             if (!response.ok) throw new Error(`API Error: ${response.status}`);
            
             const result = await response.json();
             if (result.candidates && result.candidates[0].content.parts[0].text) {
                const generatedText = result.candidates[0].content.parts[0].text.replace(/\*/g, '');
                animateText(modalBody, generatedText);
                showFeedbackUI(transcript, promptTemplate, generatedText, promptId);
             } else {
                throw new Error('Invalid API response.');
             }
        } catch (err) {
            modalBody.innerHTML = `<p class="text-red-600">Could not generate ${taskTitle.toLowerCase()}. Error: ${err.message}</p>`;
        }
    }
    
    async function saveTranscript() {
        if (!currentUser) {
            showError("You must be logged in to save a transcript.");
            return;
        }
        const transcriptText = outputEl.textContent.trim();
        if (!transcriptText) {
            showError("There is no transcript to save.");
            return;
        }

        try {
            const docRef = await addDoc(collection(db, "users", currentUser.uid, "transcripts"), {
                title: transcriptText.substring(0, 40) + "...",
                content: transcriptText,
                createdAt: serverTimestamp()
            });
            logEvent('transcript_saved', { doc_id: docRef.id });
            animateText(statusEl, "Transcript Saved!");
        } catch (e) {
            console.error("Error adding document: ", e);
            showError("Could not save transcript. Please try again.");
            logEvent('save_failed', { error: e.message });
        }
    }

    async function viewHistory() {
        if (!currentUser) {
            showError("You must be logged in to view history.");
            return;
        }
        
        openModal("Transcript History", '<div class="flex justify-center items-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>');
        
        try {
            const q = query(collection(db, "users", currentUser.uid, "transcripts"), orderBy("createdAt", "desc"), limit(20));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
                modalBody.innerHTML = `<p class="text-slate-500">You have no saved transcripts.</p>`;
                return;
            }

            const list = document.createElement('ul');
            list.className = 'space-y-2';
            
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                const li = document.createElement('li');
                li.className = 'p-3 rounded-md hover:bg-slate-100 cursor-pointer';
                li.innerHTML = `<p class="font-semibold">${data.title}</p><p class="text-xs text-slate-500">${data.createdAt ? data.createdAt.toDate().toLocaleString() : 'Date not available'}</p>`;
                li.onclick = () => {
                    outputEl.textContent = data.content;
                    setAiButtonsState(true);
                    closeModal();
                };
                list.appendChild(li);
            });
            modalBody.innerHTML = '';
            modalBody.appendChild(list);

        } catch(e) {
             console.error("Error fetching history: ", e);
             modalBody.innerHTML = `<p class="text-red-600">Could not load history.</p>`;
        }
    }
    
    async function saveUserApiKey(key) {
        if (!currentUser) return;
        try {
            const userDocRef = doc(db, "users", currentUser.uid);
            await setDoc(userDocRef, { geminiApiKey: key }, { merge: true });
            logEvent('api_key_saved');
        } catch (e) {
            console.error("Error saving API key: ", e);
            showError("Could not save your API key.");
        }
    }

    async function fetchUserApiKey() {
        if (!currentUser) return;
        try {
            const userDocRef = doc(db, "users", currentUser.uid);
            const docSnap = await getDoc(userDocRef);
            if (docSnap.exists() && docSnap.data().geminiApiKey) {
                activeApiKey = docSnap.data().geminiApiKey;
                console.log("User API key loaded.");
            } else {
                activeApiKey = null;
                console.log("No saved API key found for user.");
            }
        } catch (e) {
            console.error("Error fetching API key: ", e);
            activeApiKey = null;
        }
    }
    
    async function loadPrompts() {
         if (!firebaseInitialized) return;
         try {
            const querySnapshot = await getDocs(collection(db, "prompts"));
            querySnapshot.forEach((doc) => {
                promptsCache.set(doc.id, doc.data().text);
            });
            console.log("Prompts loaded into cache:", promptsCache);
         } catch(e) {
            console.error("Could not load prompts from Firestore:", e);
            showError("Could not load AI prompts from the database.");
         }
    }

    function openSettingsModal() {
        const settingsHtml = `
            <div class="space-y-4">
                 <div>
                    <label for="modalApiKey" class="block text-sm font-medium text-slate-700">Your Gemini API Key</label>
                    <div class="mt-1 relative rounded-md shadow-sm">
                         <input type="password" id="modalApiKey" class="block w-full rounded-md border-slate-300 pr-10 focus:border-teal-500 focus:ring-teal-500 sm:text-sm" placeholder="Paste your API key here...">
                         <div class="absolute inset-y-0 right-0 pr-3 flex items-center">
                            <button id="revealApiKeyBtn" class="text-slate-400 hover:text-slate-600">
                                 <svg id="eyeIcon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                         </div>
                    </div>
                </div>
                <div class="flex justify-end">
                    <button id="saveApiKeyBtn" class="px-4 py-2 text-sm font-semibold text-white bg-teal-600 rounded-md hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500">
                       Save Key
                    </button>
                </div>
            </div>
        `;
        openModal("User Settings", settingsHtml);
        
        const modalApiKeyInput = document.getElementById('modalApiKey');
        const revealApiKeyBtn = document.getElementById('revealApiKeyBtn');
        const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');

        if (activeApiKey) {
            modalApiKeyInput.value = activeApiKey;
        }

        revealApiKeyBtn.addEventListener('click', () => {
            const isPassword = modalApiKeyInput.type === 'password';
            modalApiKeyInput.type = isPassword ? 'text' : 'password';
        });
        
        const saveAndClose = () => {
             const newKey = modalApiKeyInput.value.trim();
             if (newKey) {
                validateApiKey(newKey, true); // true indicates it should be saved
             }
             closeModal();
        };

        saveApiKeyBtn.addEventListener('click', saveAndClose);
        modalApiKeyInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveAndClose();
        });
    }
    
    function openDebugModal() {
         const reportHtml = `<pre class="bg-slate-800 text-white p-4 rounded-md text-xs whitespace-pre-wrap overflow-auto">${JSON.stringify(sessionLog, null, 2)}</pre>
            <button id="copyLogBtn" class="mt-4 px-4 py-2 text-sm font-semibold text-white bg-teal-600 rounded-md hover:bg-teal-700">Copy to Clipboard</button>
        `;
        openModal("Session Debug Log", reportHtml);
        
        document.getElementById('copyLogBtn').addEventListener('click', () => {
            const logText = JSON.stringify(sessionLog, null, 2);
            const textArea = document.createElement("textarea");
            textArea.value = logText;
            document.body.appendChild(textArea);
            textArea.select();
            try {
               document.execCommand('copy');
               animateText(statusEl, "Log copied!");
            } catch(err) {
               console.error('Failed to copy log', err);
               showError("Failed to copy log.");
            }
            document.body.removeChild(textArea);
            closeModal();
        });
    }
    
    function showFeedbackUI(transcript, prompt, response, promptId) {
        modalFeedback.classList.remove('hidden');
        const feedbackButtons = modalFeedback.querySelectorAll('.feedback-btn');
        const detailedFeedbackContainer = document.getElementById('detailed-feedback-container');
        const detailedFeedbackInput = document.getElementById('detailed-feedback-input');
        const submitDetailedFeedbackBtn = document.getElementById('submit-detailed-feedback');
        
        detailedFeedbackContainer.classList.add('hidden'); // Reset detailed view
        detailedFeedbackInput.value = '';
        
        let rating = '';

        const feedbackHandler = async (e) => {
            rating = e.currentTarget.dataset.rating;
            if(rating === 'negative') {
                detailedFeedbackContainer.classList.remove('hidden');
            } else {
                await saveFeedback();
            }
        };
        
        const saveFeedback = async (detailedText = '') => {
             try {
                const docRef = await addDoc(collection(db, "feedback"), {
                    userId: currentUser ? currentUser.uid : 'anonymous',
                    promptId: promptId,
                    rating: rating,
                    detailedFeedback: detailedText,
                    transcript: transcript,
                    prompt: prompt,
                    response: response,
                    createdAt: serverTimestamp()
                });
                 logEvent('prompt_feedback', { prompt_id: promptId, rating: rating, has_detailed_text: !!detailedText });
            } catch(err) {
                console.error("Error saving feedback:", err);
                logEvent('feedback_save_failed', { error: err.message });
            }
            modalFeedback.innerHTML = '<p class="text-sm text-slate-500">Thank you for your feedback!</p>';
        };

        submitDetailedFeedbackBtn.onclick = () => saveFeedback(detailedFeedbackInput.value);

        feedbackButtons.forEach(button => {
            const newButton = button.cloneNode(true);
            button.parentNode.replaceChild(newButton, button);
            newButton.addEventListener('click', feedbackHandler);
        });
    }


    function openModal(title, content) {
        modalTitle.textContent = title;
        if (typeof content === 'string') {
            modalBody.innerHTML = content;
        } else {
            modalBody.innerHTML = '';
            modalBody.appendChild(content);
        }
        modalFeedback.classList.add('hidden'); // Always hide feedback on new modal open
        modalBackdrop.classList.remove('hidden');
        setTimeout(() => {
            modalBackdrop.classList.add('opacity-100');
            modalContent.classList.remove('scale-95', 'opacity-0');
        }, 10);
    }

    function closeModal() {
        modalBackdrop.classList.remove('opacity-100');
        modalContent.classList.add('scale-95', 'opacity-0');
        setTimeout(() => modalBackdrop.classList.add('hidden'), 300);
    }

    // --- Event Listeners ---
    recordButton.addEventListener('click', handleStartClick);
    pauseButton.addEventListener('click', handlePauseClick);
    transcribeButton.addEventListener('click', handleTranscribeClick);
    saveButton.addEventListener('click', saveTranscript);
    historyButton.addEventListener('click', viewHistory);
    settingsButton.addEventListener('click', openSettingsModal);
    debugButton.addEventListener('click', openDebugModal);

    loginButton.addEventListener('click', (e) => {
        e.stopPropagation();
        handleAuth();
    });
    logoutButton.addEventListener('click', handleLogout);

    // AI Dropdown logic
    aiDropdownButton.addEventListener('click', (e) => {
        e.stopPropagation();
        aiDropdownMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!aiDropdownButton.contains(e.target) && !aiDropdownMenu.contains(e.target)) {
            aiDropdownMenu.classList.add('hidden');
        }
        if (activeContainer && !activeContainer.contains(e.target)) {
            closeContainer(activeContainer);
        }
    });

    aiButtons.forEach(button => {
        button.addEventListener('click', () => {
            const promptId = button.dataset.promptId;
            const taskTitle = button.textContent;
            const promptTemplate = promptsCache.get(promptId);

            if (!promptTemplate) {
                showError(`Prompt '${promptId}' not found. Please check Firestore configuration.`);
                return;
            }

            if (outputEl.textContent.trim()) {
                logEvent('ai_action_used', { action_type: promptId });
                generateTextWithGemini(promptTemplate, taskTitle, promptId);
            } else {
                showError("There is no transcript to analyze.");
            }
             aiDropdownMenu.classList.add('hidden');
        });
    });
    
    modalClose.addEventListener('click', closeModal);
    
    updateUI('Initial', 'Ready');
});
