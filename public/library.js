// =================================================================
// LIBRARY PAGE SCRIPT (v2.3 - Chat Enabled)
// =================================================================
import LoggingService from './loggingService.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    query, 
    where, 
    getDocs, 
    addDoc, 
    doc, 
    deleteDoc,
    writeBatch,
    orderBy,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

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

    // --- Constants & State ---
    const QUERY_SERVICE_URL = 'https://query-service-715569829205.europe-west2.run.app/chat';
    let currentUser = null;
    let db, auth;
    let activeCollectionId = 'all'; // Default to all collections

    // --- DOM ELEMENT REFERENCES ---
    const collectionsListEl = document.getElementById('collectionsList');
    const itemsListEl = document.getElementById('itemsList');
    const currentCollectionTitleEl = document.getElementById('current-collection-title');
    const emptyStateEl = document.getElementById('empty-state');
    const newCollectionBtn = document.getElementById('newCollectionBtn');
    const deleteCollectionBtn = document.getElementById('deleteCollectionBtn');
    const contentPanel = document.getElementById('library-content');
    const chatMessagesEl = document.getElementById('chat-messages');
    const chatInputEl = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    const libraryViewContainer = document.getElementById('library-view-container');
    const chatContainer = document.getElementById('chat-container');
    const viewToggleButton = document.getElementById('viewToggleButton');
    const debugButton = document.getElementById('debugButton');

    // --- INITIALIZATION ---
    try {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        LoggingService.init();
        LoggingService.logEvent('library_page_loaded');

        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUser = user;
                LoggingService.logEvent('auth_state_changed', { status: 'logged_in', userId: user.uid });
                loadUserLibrary(); 
            } else {
                currentUser = null;
                LoggingService.logEvent('auth_state_changed', { status: 'logged_out' });
                window.location.href = 'index.html';
            }
        });
    } catch (error) {
        console.error("Firebase Initialization Error on Library Page:", error);
        LoggingService.logEvent('firebase_init_error', { error: error.message, stack: error.stack });
        contentPanel.innerHTML = '<h1>Error: Could not initialize application.</h1>';
    }


    // =================================================================
    // CORE LOGIC
    // =================================================================

    async function loadUserLibrary() {
        if (!currentUser) return;
        LoggingService.logEvent('library_load_attempt', { userId: currentUser.uid });
        collectionsListEl.innerHTML = `
            <li class="collection-item back-button">
                <a href="index.html" title="Back to Main App">
                    <i data-feather="arrow-left"></i><span>Back to Main App</span>
                </a>
            </li>
        `;
        contentPanel.classList.add('hidden');

        const collectionsRef = collection(db, "users", currentUser.uid, "collections");
        const q = query(collectionsRef, orderBy("createdAt", "desc"));
        
        try {
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
                LoggingService.logEvent('library_load_success', { collections_found: 0 });
                collectionsListEl.innerHTML += '<li class="p-2 text-slate-500 text-sm">No collections yet. Click "New Collection" to start.</li>';
                currentCollectionTitleEl.textContent = "Welcome";
                itemsListEl.innerHTML = '';
                emptyStateEl.classList.remove('hidden');
                contentPanel.classList.remove('hidden');
                return;
            }
            
            const collections = [];
            querySnapshot.forEach((doc) => {
                collections.push({ id: doc.id, ...doc.data() });
            });
            LoggingService.logEvent('library_load_success', { collections_found: collections.length });

            collections.forEach(col => renderCollection(col));

            if (collections.length > 0) {
                loadCollectionItems(collections[0].id, collections[0].name);
            }
            contentPanel.classList.remove('hidden');

        } catch (error) {
            console.error("Error loading collections: ", error);
            LoggingService.logEvent('library_load_failure', { 
                error: error.message, 
                code: error.code,
                stack: error.stack 
            });
            collectionsListEl.innerHTML = '<li>Error loading collections.</li>';
        }
    }

    function renderCollection(collectionData) {
        const li = document.createElement('li');
        li.className = 'collection-item';
        li.dataset.id = collectionData.id;

        const a = document.createElement('a');
        a.href = "#";
        a.title = collectionData.name;
        a.innerHTML = `<i data-feather="folder"></i><span class="truncate">${collectionData.name}</span>`;
        a.onclick = (e) => {
            e.preventDefault();
            loadCollectionItems(collectionData.id, collectionData.name);
        };
        li.appendChild(a);
        collectionsListEl.appendChild(li);
        feather.replace();
    }

    async function loadCollectionItems(collectionId, collectionName) {
        if (!currentUser) return;
        activeCollectionId = collectionId;
        LoggingService.logEvent('collection_items_load_attempt', { 
            collectionId,
            collectionName,
            userId: currentUser.uid 
        });

        currentCollectionTitleEl.textContent = collectionName;
        document.querySelectorAll('.collection-item').forEach(item => {
            item.classList.toggle('is-active', item.dataset.id === collectionId);
        });

        itemsListEl.innerHTML = '<li>Loading items...</li>';
        emptyStateEl.classList.add('hidden');

        try {
            const items = [];
            
            // Load transcripts
            LoggingService.logEvent('loading_transcripts', { collectionId });
            const transcriptsRef = collection(db, "users", currentUser.uid, "transcripts");
            const tq = query(transcriptsRef, where("collectionId", "==", collectionId), orderBy("createdAt", "desc"));
            const tSnapshot = await getDocs(tq);
            
            LoggingService.logEvent('transcripts_loaded', { 
                collectionId, 
                count: tSnapshot.size 
            });
            
            tSnapshot.forEach(doc => {
                const data = doc.data();
                items.push({ 
                    id: doc.id, 
                    type: 'transcript', 
                    ...data 
                });
            });

            // Load learning packets
            LoggingService.logEvent('loading_packets', { collectionId });
            const packetsRef = collection(db, "users", currentUser.uid, "learning_packets");
            const pq = query(packetsRef, where("collectionId", "==", collectionId), orderBy("createdAt", "desc"));
            const pSnapshot = await getDocs(pq);
            
            LoggingService.logEvent('packets_loaded', { 
                collectionId, 
                count: pSnapshot.size 
            });
            
            pSnapshot.forEach(doc => {
                const data = doc.data();
                items.push({ 
                    id: doc.id, 
                    type: 'packet', 
                    ...data 
                });
            });

            // Sort items by creation date
            items.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

            itemsListEl.innerHTML = ''; 
            LoggingService.logEvent('collection_items_load_success', { 
                collectionId, 
                total_items: items.length,
                transcripts: tSnapshot.size,
                packets: pSnapshot.size
            });

            if (items.length === 0) {
                emptyStateEl.classList.remove('hidden');
            } else {
                items.forEach(item => renderItem(item));
            }

        } catch (error) {
            console.error(`Error loading items for collection ${collectionId}:`, error);
            LoggingService.logEvent('collection_items_load_failure', { 
                collectionId, 
                error: error.message,
                code: error.code,
                stack: error.stack
            });
            
            // More detailed error message
            itemsListEl.innerHTML = `
                <li class="text-red-400">
                    Error loading items: ${error.message || 'Unknown error'}
                    <br><small class="text-red-300">Check console for details</small>
                </li>
            `;
        }
    }

    function renderItem(itemData) {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'library-item';
        itemDiv.dataset.id = itemData.id;

        let iconType, badgeClass, badgeText;
        if (itemData.type === 'transcript') {
            iconType = 'file-text';
            badgeClass = 'transcript-badge';
            badgeText = 'Transcript';
        } else {
            iconType = 'gift';
            badgeClass = 'packet-badge';
            badgeText = 'Learning Packet';
        }

        itemDiv.innerHTML = `
            <div class="item-main">
                <i data-feather="${iconType}" class="item-icon"></i>
                <div class="item-details">
                    <p class="item-title truncate" title="${itemData.title}">${itemData.title}</p>
                    <span class="item-badge ${badgeClass}">${badgeText}</span>
                </div>
            </div>
            <div class="item-actions">
                <button class="btn-icon btn-delete-item" title="Delete"><i data-feather="x"></i></button>
            </div>
        `;

        itemDiv.querySelector('.btn-delete-item').onclick = (e) => {
            e.stopPropagation();
            deleteItem(itemData.id, itemData.type);
        };

        itemsListEl.appendChild(itemDiv);
        feather.replace();
    }
    
    async function createNewCollection(name) {
        if (!currentUser || !name) return;
        LoggingService.logEvent('collection_create_attempt', { name });
        try {
            await addDoc(collection(db, "users", currentUser.uid, "collections"), {
                name: name,
                createdAt: serverTimestamp()
            });
            LoggingService.logEvent('collection_create_success');
            loadUserLibrary();
        } catch (error) {
            console.error("Error creating new collection: ", error);
            LoggingService.logEvent('collection_create_failure', { 
                error: error.message,
                code: error.code 
            });
            alert("Could not create collection. " + error.message);
        }
    }
    
    async function deleteItem(itemId, itemType) {
        if (!currentUser || !confirm(`Are you sure you want to delete this ${itemType}?`)) return;
        LoggingService.logEvent('item_delete_attempt', { itemId, itemType });
        const collectionName = itemType === 'transcript' ? 'transcripts' : 'learning_packets';
        try {
            await deleteDoc(doc(db, "users", currentUser.uid, collectionName, itemId));
            LoggingService.logEvent('item_delete_success', { itemId });
            const currentCollectionName = currentCollectionTitleEl.textContent;
            loadCollectionItems(activeCollectionId, currentCollectionName);
        } catch (error) {
            console.error("Error deleting item:", error);
            LoggingService.logEvent('item_delete_failure', { 
                itemId, 
                error: error.message,
                code: error.code 
            });
            alert("Could not delete item. " + error.message);
        }
    }

    async function deleteActiveCollection() {
        if (!currentUser || !activeCollectionId) return;
        if (!confirm(`Are you sure you want to delete this entire collection and all its contents? This cannot be undone.`)) return;
        LoggingService.logEvent('collection_delete_attempt', { collectionId: activeCollectionId });
        try {
            const batch = writeBatch(db);

            const transcriptsRef = collection(db, "users", currentUser.uid, "transcripts");
            const tq = query(transcriptsRef, where("collectionId", "==", activeCollectionId));
            const tSnapshot = await getDocs(tq);
            tSnapshot.forEach(doc => batch.delete(doc.ref));

            const packetsRef = collection(db, "users", currentUser.uid, "learning_packets");
            const pq = query(packetsRef, where("collectionId", "==", activeCollectionId));
            const pSnapshot = await getDocs(pq);
            pSnapshot.forEach(doc => batch.delete(doc.ref));

            const collectionDocRef = doc(db, "users", currentUser.uid, "collections", activeCollectionId);
            batch.delete(collectionDocRef);

            await batch.commit();
            LoggingService.logEvent('collection_delete_success', { collectionId: activeCollectionId });
            loadUserLibrary();
        } catch (error) {
            console.error("Error deleting collection:", error);
            LoggingService.logEvent('collection_delete_failure', { 
                collectionId: activeCollectionId, 
                error: error.message,
                code: error.code 
            });
            alert("Could not delete collection. " + error.message);
        }
    }

// =================================================================
// VIEW TOGGLING LOGIC
// =================================================================

    let isChatView = false; // Add this state variable near the top with the others

    function setView(showChat) {
        isChatView = showChat;
        if (showChat) {
        libraryViewContainer.classList.add('hidden');
        chatContainer.classList.remove('hidden');
        viewToggleButton.textContent = 'View Library';
    }   else {
        libraryViewContainer.classList.remove('hidden');
        chatContainer.classList.add('hidden');
        viewToggleButton.textContent = 'Chat with this Collection';
     }
    }
    // =================================================================
    // CHAT LOGIC
    // =================================================================

    async function handleChatSubmit() {
        const question = chatInputEl.value.trim();
        if (!question || !currentUser) return;

        chatInputEl.value = '';
        addChatMessage(question, 'user');
        sendChatBtn.disabled = true;
        addChatMessage('<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>', 'bot', true);

        const payload = {
            userId: currentUser.uid,
            question: question,
            collectionIds: activeCollectionId === 'all' ? [] : [activeCollectionId]
        };

        try {
            const response = await fetch(QUERY_SERVICE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            chatMessagesEl.removeChild(chatMessagesEl.lastChild);

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'The chat service returned an error.');
            }

            const data = await response.json();
            addChatMessage(data.answer, 'bot');
        } catch (error) {
            console.error("Error during chat:", error);
            LoggingService.logEvent('chat_error', { 
                error: error.message,
                stack: error.stack 
            });
            addChatMessage(`Sorry, I ran into an error: ${error.message}`, 'bot');
        } finally {
            sendChatBtn.disabled = false;
        }
    }

    function addChatMessage(message, sender, isLoading = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${sender}-message`;
        if(isLoading) {
            messageDiv.classList.add('loading');
        }
        messageDiv.innerHTML = `<p>${message.replace(/\n/g, '<br>')}</p>`;
        chatMessagesEl.appendChild(messageDiv);
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight; // Auto-scroll
    }

    // =================================================================
    // DEBUG MODAL - IMPROVED
    // =================================================================
    
    function openDebugModal() {
        LoggingService.logEvent('debug_modal_opened_library');
        const logData = LoggingService.getLog();
        const logText = JSON.stringify(logData, null, 2);
        
        const reportHtml = `
            <div style="position: relative;">
                <pre id="debugLogContent" class="bg-slate-900 p-3 rounded-md text-xs whitespace-pre-wrap" style="max-height: 60vh; overflow-y: auto; user-select: text; cursor: text;"><code>${logText}</code></pre>
                <div class="mt-4 flex gap-2">
                    <button id="copyLogBtn" class="btn btn-secondary">Copy to Clipboard</button>
                    <button id="selectAllBtn" class="btn btn-secondary">Select All</button>
                </div>
                <div id="copyFeedback" class="mt-2 text-green-400 hidden">Log copied to clipboard!</div>
            </div>
        `;
        openModal("Session Debug Log", reportHtml);
        
        // Copy to clipboard functionality
        document.getElementById('copyLogBtn').addEventListener('click', () => {
            navigator.clipboard.writeText(logText).then(() => {
                const feedback = document.getElementById('copyFeedback');
                feedback.classList.remove('hidden');
                setTimeout(() => feedback.classList.add('hidden'), 2000);
                LoggingService.logEvent('debug_log_copied');
            }).catch(err => {
                console.error('Failed to copy log', err);
                alert('Failed to copy log. You can manually select and copy the text.');
                LoggingService.logEvent('debug_log_copy_failed', { error: err.message });
            });
        });
        
        // Select all functionality
        document.getElementById('selectAllBtn').addEventListener('click', () => {
            const logContent = document.getElementById('debugLogContent');
            const range = document.createRange();
            range.selectNodeContents(logContent);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        });
    }
    
    function openModal(title, content) {
        // Remove any existing modal first
        const existingModal = document.getElementById('modal-backdrop');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Create modal with better styling for debug content
        const modalHtml = `
            <div id="modal-backdrop" class="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50" style="backdrop-filter: blur(4px);">
                <div id="modal-content" class="modal-content-area bg-slate-800 p-6 rounded-lg max-w-4xl w-full" style="max-height: 90vh; display: flex; flex-direction: column;">
                    <div class="flex justify-between items-center mb-4 flex-shrink-0">
                        <h2 class="text-2xl font-semibold text-slate-100">${title}</h2>
                        <button id="modal-close" class="text-slate-400 hover:text-slate-100 text-3xl leading-none">&times;</button>
                    </div>
                    <div class="text-slate-300 overflow-auto flex-grow">${content}</div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        const backdrop = document.getElementById('modal-backdrop');
        const closeBtn = document.getElementById('modal-close');
        
        const closeModal = () => {
            backdrop.remove();
        };
        
        closeBtn.addEventListener('click', closeModal);
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeModal();
        });
    }

    // =================================================================
    // EVENT LISTENERS
    // =================================================================
    
    sendChatBtn.addEventListener('click', handleChatSubmit);
    chatInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleChatSubmit();
        }
    });
    viewToggleButton.addEventListener('click', () => {
        setView(!isChatView); // Toggle the view
    });
    newCollectionBtn.addEventListener('click', () => {
        LoggingService.logEvent('ui_action', { component: 'new_collection_button' });
        const name = prompt("Enter a name for your new collection:");
        if (name && name.trim() !== '') {
            createNewCollection(name.trim());
        }
    });

    deleteCollectionBtn.addEventListener('click', () => {
        LoggingService.logEvent('ui_action', { component: 'delete_collection_button' });
        deleteActiveCollection();
    });
    
    debugButton.addEventListener('click', openDebugModal);

});