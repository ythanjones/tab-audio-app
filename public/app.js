import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAnalytics, logEvent as fbLogEvent } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-analytics.js";
import { getFirestore, collection, addDoc, doc, setDoc, getDoc, serverTimestamp, getDocs } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
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

    // --- State variables ---
    let mediaRecorder;
    let audioStream;
    let audioChunks = [];
    let animationTimeout;
    let currentUser = null;
    let activeApiKey = null;
    let firebaseInitialized = false;
    let analytics, db, auth;
    let promptsCache = new Map();

    // --- DOM element references (Updated for Redesign) ---
    const recordButton = document.getElementById('recordButton');
    const stopButton = document.getElementById('stopButton');
    const summarizeButton = document.getElementById('summarizeButton');
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
    const modalFeedback = document.getElementById('modal-feedback');
    const modalClose = document.getElementById('modal-close');


    // =================================================================
    // INITIALIZATION & AUTHENTICATION
    // =================================================================

    try {
        if (!firebaseConfig.apiKey) {
             throw new Error("Firebase config object is empty.");
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
                // User is signed in
                userInfo.classList.remove('hidden');
                loginContainer.innerHTML = ''; // Clear login prompt
                loginContainer.classList.add('hidden');
                userEmailEl.textContent = user.email;
                await fetchUserApiKey();
            } else {
                // User is signed out
                userInfo.classList.add('hidden');
                loginContainer.classList.remove('hidden');
                renderLoginButton();
                activeApiKey = null;
            }
            updateUI(); // Update UI based on auth state
        });

    } catch (error) {
        console.error("Firebase Initialization Error:", error.message);
        openModal("Critical Error", `Could not initialize the application. Please check your Firebase configuration. <br><br><strong>Error:</strong> ${error.message}`);
    }
    
    /**
     * Renders the login button for signed-out users.
     */
    function renderLoginButton() {
        loginContainer.innerHTML = `<button id="loginPromptButton" class="btn btn-secondary">Login / Sign Up</button>`;
        document.getElementById('loginPromptButton').addEventListener('click', openLoginModal);
    }

    /**
     * Opens a modal for user login/signup.
     */
    function openLoginModal() {
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

    /**
     * Handles the authentication logic for login/signup.
     */
    async function handleAuth() {
        const email = document.getElementById('emailInput').value;
        const password = document.getElementById('passwordInput').value;
        if (!email || !password) {
            alert("Please enter both email and password."); // Simple feedback for modal
            return;
        }

        try {
            await signInWithEmailAndPassword(auth, email, password);
            closeModal();
        } catch (error) {
            if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
                try {
                    await createUserWithEmailAndPassword(auth, email, password);
                    closeModal();
                } catch (signUpError) {
                    alert(`Signup failed: ${signUpError.message}`);
                }
            } else {
                alert(`Login failed: ${error.message}`);
            }
        }
    }

    /**
     * Handles user logout.
     */
    function handleLogout() {
        signOut(auth).catch(error => openModal("Error", `Logout failed: ${error.message}`));
    }
    
    /**
     * Fetches the saved API key for the current user from Firestore.
     */
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
                console.log("No saved API key found for user. Prompting to set one.");
                // You might want to automatically open a settings modal here
                // openSettingsModal(); 
            }
        } catch (e) {
            console.error("Error fetching API key: ", e);
            activeApiKey = null;
        }
    }
    
    /**
     * Loads AI prompts from Firestore into a local cache.
     */
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
        }
    }

    // =================================================================
    // CORE FUNCTIONALITY: RECORDING & TRANSCRIPTION
    // =================================================================
    
    /**
     * Starts recording system audio.
     */
    async function startRecording() {
        if (!getApiKey()) {
             openModal("API Key Required", "Please log in and set your Gemini API key in your profile settings to use this application.");
             return;
        }
        
        if (mediaRecorder && mediaRecorder.state === "recording") {
            return; // Already recording
        }

        try {
            const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            if (displayStream.getAudioTracks().length === 0) {
                displayStream.getTracks().forEach(track => track.stop());
                openModal("Audio Error", "No audio track found. Please ensure you are sharing your screen or tab audio when prompted.");
                return;
            }

            audioStream = new MediaStream(displayStream.getAudioTracks());
            audioChunks = []; // Reset for new recording

            mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunks.push(event.data);
            };

            // When the user stops sharing their screen, automatically stop recording
            audioStream.getTracks()[0].onended = () => stopRecording();

            mediaRecorder.start();
            updateUI();

        } catch (err) {
            console.error("Error starting recording:", err);
            openModal("Recording Error", `Failed to start recording. Please ensure you grant permission. Error: ${err.message}`);
        }
    }

    /**
     * Stops the recording and initiates transcription.
     */
    async function stopRecording() {
        if (!mediaRecorder || mediaRecorder.state === "inactive") {
            return; // Not recording
        }

        mediaRecorder.stop();
        // Stop all tracks to end the "screen sharing" notification
        if (audioStream) {
            audioStream.getTracks().forEach(track => track.stop());
        }
        
        updateUI();

        if (audioChunks.length > 0) {
            transcribeAudio();
        }
    }
    
    /**
     * Converts audio blob to base64 and sends to Gemini for transcription.
     */
    async function transcribeAudio() {
        outputEl.textContent = "Transcribing, please wait...";
        const apiKey = getApiKey();
        if (!apiKey) return;

        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const base64Audio = await blobToBase64(audioBlob);

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const payload = { 
            contents: [{ 
                parts: [
                    { text: "Transcribe the following audio recording accurately." },
                    { inline_data: { mime_type: "audio/webm", data: base64Audio } }
                ] 
            }] 
        };

        try {
            const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const result = await response.json();
            
            if (!response.ok) {
                 throw new Error(result.error?.message || `API Error: ${response.status}`);
            }

            if (result.candidates && result.candidates[0].content.parts[0].text) {
                const transcript = result.candidates[0].content.parts[0].text;
                outputEl.textContent = transcript;
            } else {
                throw new Error('Invalid API response structure.');
            }
        } catch (err) {
            outputEl.textContent = `Transcription Failed: ${err.message}`;
        } finally {
            updateUI(); // Update button states after transcription
        }
    }


    // =================================================================
    // AI ACTIONS & UI
    // =================================================================
    
    /**
     * Handles the primary "Summarize" button click.
     */
    function handleSummarize() {
        const promptId = 'summarize'; // Hardcoded for the main button
        const promptTemplate = promptsCache.get(promptId);
        if (!promptTemplate) {
            openModal("Error", "Could not find the 'summarize' prompt. Please check Firestore configuration.");
            return;
        }
        generateTextWithGemini(promptTemplate, "Summary", promptId);
    }
    
    /**
     * Generic function to call Gemini for text generation tasks.
     */
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

            if (!response.ok) {
                 throw new Error(result.error?.message || `API Error: ${response.status}`);
            }

            if (result.candidates && result.candidates[0].content.parts[0].text) {
                const generatedText = result.candidates[0].content.parts[0].text;
                animateText(modalBody, generatedText);
                // showFeedbackUI(transcript, finalPrompt, generatedText, promptId); // You can re-enable this if needed
            } else {
                throw new Error('Invalid API response.');
            }
        } catch (err) {
            modalBody.innerHTML = `<p class="text-red-400">Could not generate ${taskTitle.toLowerCase()}. Error: ${err.message}</p>`;
        }
    }

    /**
     * Updates the entire UI based on the current application state.
     */
    function updateUI() {
        const isRecording = mediaRecorder && mediaRecorder.state === 'recording';
        const hasTranscript = outputEl.textContent && !outputEl.textContent.startsWith("Your transcript") && !outputEl.textContent.startsWith("Transcribing");

        // Record Button State
        recordButton.disabled = isRecording;
        recordButton.classList.toggle('recording', isRecording);
        recordButton.querySelector('span').textContent = isRecording ? 'Recording...' : 'Record';

        // Stop Button State
        stopButton.disabled = !isRecording;

        // Analysis Buttons State
        summarizeButton.disabled = !hasTranscript || isRecording;
        aiDropdownButton.disabled = !hasTranscript || isRecording;
    }

    // =================================================================
    // HELPER FUNCTIONS
    // =================================================================

    function getApiKey() {
        if (activeApiKey) return activeApiKey;
        // In the new UI, we prompt via modals instead of an inline input
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
        // Simple text insertion for now, can be replaced with animation later
        element.innerHTML = text.replace(/\n/g, '<br>');
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
    
    // =================================================================
    // EVENT LISTENERS
    // =================================================================
    recordButton.addEventListener('click', startRecording);
    stopButton.addEventListener('click', stopRecording);
    summarizeButton.addEventListener('click', handleSummarize);
    logoutButton.addEventListener('click', handleLogout);
    
    // AI Dropdown logic
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
    
    // Initial UI state
    updateUI();
});