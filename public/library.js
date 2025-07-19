// File: public/library.js
// UPDATED VERSION - AI Knowledge Base Controls

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

function safeFeatherReplace() {
    try {
        if (typeof feather !== 'undefined' && feather.replace) {
            feather.replace();
        } else {
            console.warn('Feather icons not yet loaded, skipping icon replacement');
            // Retry after a short delay
            setTimeout(() => {
                if (typeof feather !== 'undefined' && feather.replace) {
                    feather.replace();
                }
            }, 100);
        }
    } catch (error) {
        console.warn('Error replacing feather icons:', error);
    }
}

// Firebase configuration
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
    const EMBEDDING_SERVICE_URL = 'https://europe-west2-tab-audio-app.cloudfunctions.net/addToKnowledgeBase';
    const REMOVE_EMBEDDING_URL = 'https://europe-west2-tab-audio-app.cloudfunctions.net/removeFromKnowledgeBase';

    let app, auth, db, currentUser;
    let activeCollectionId = 'all';
    const selectedItems = new Set();

    // DOM Elements
    const collectionsListEl = document.getElementById('collections-list');
    const itemsListEl = document.getElementById('items-list');
    const currentCollectionTitleEl = document.getElementById('current-collection-title');
    const contentPanel = document.getElementById('content-panel');
    const emptyStateEl = document.getElementById('empty-state');
    const bulkActionsPanel = document.getElementById('bulk-actions-panel');
    const selectionInfo = document.getElementById('selection-info');
    const addToAIBtn = document.getElementById('add-to-ai-btn');
    const removeFromAIBtn = document.getElementById('remove-from-ai-btn');
    const selectAllBtn = document.getElementById('select-all-btn');
    const chatContainer = document.getElementById('chat-container');
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    const chatMessagesEl = document.getElementById('chat-messages');

    // Initialize Firebase
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        LoggingService.logEvent('firebase_init_success');

        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUser = user;
                LoggingService.logEvent('item_delete_failure', { 
                itemId, 
                error: error.message,
                code: error.code 
            });
            alert("Could not delete item. " + error.message);
        }
    }

    async function deleteActiveCollection() {
        if (!currentUser || !activeCollectionId || activeCollectionId === 'all') return;
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

    // Make functions available globally for HTML onclick handlers
    window.createNewCollection = createNewCollection;
    window.deleteActiveCollection = deleteActiveCollection;
    window.openDebugModal = openDebugModal;

}); // End of DOMContentLoadedauth_state_changed', { status: 'logged_in', userId: user.uid });
                loadUserLibrary(); 
            } else {
                currentUser = null;
                LoggingService.logEvent('auth_state_changed', { status: 'logged_out' });
                window.location.href = '/';
            }
        });
    } catch (error) {
        console.error('Firebase initialization failed:', error);
        LoggingService.logEvent('firebase_init_error', { error: error.message });
    }

    // =================================================================
    // LIBRARY LOADING LOGIC
    // =================================================================

    async function loadUserLibrary() {
        if (!currentUser) return;
        LoggingService.logEvent('library_load_attempt', { userId: currentUser.uid });
        
        try {
            const collectionsRef = collection(db, "users", currentUser.uid, "collections");
            const q = query(collectionsRef, orderBy("createdAt", "desc"));
            const querySnapshot = await getDocs(q);

            collectionsListEl.innerHTML = '';
            
            // Add "All Collections" option
            const allCollectionsLi = document.createElement('li');
            allCollectionsLi.className = 'collection-item is-active';
            allCollectionsLi.innerHTML = `<a href="#"><i data-feather="layers"></i><span>All Collections</span></a>`;
            allCollectionsLi.onclick = (e) => {
                e.preventDefault();
                loadAllCollections();
            };
            collectionsListEl.appendChild(allCollectionsLi);

            if (querySnapshot.empty) {
                collectionsListEl.innerHTML += '<li class="px-3 py-2 text-slate-400 italic">No collections yet. Click "New Collection" to start.</li>';
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
                loadAllCollections(); // Start with all collections view
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
        safeFeatherReplace();
    }

    async function loadAllCollections() {
        if (!currentUser) return;
        
        activeCollectionId = 'all';
        updateActiveCollection('all');
        currentCollectionTitleEl.textContent = "All Collections";
        
        try {
            // Load all transcripts
            const transcriptsRef = collection(db, "users", currentUser.uid, "transcripts");
            const tQuery = query(transcriptsRef, orderBy("createdAt", "desc"));
            const tSnapshot = await getDocs(tQuery);
            
            // Load all packets
            const packetsRef = collection(db, "users", currentUser.uid, "learning_packets");
            const pQuery = query(packetsRef, orderBy("createdAt", "desc"));
            const pSnapshot = await getDocs(pQuery);
            
            const allItems = [];
            
            tSnapshot.forEach(doc => {
                allItems.push({ id: doc.id, type: 'transcript', ...doc.data() });
            });
            
            pSnapshot.forEach(doc => {
                allItems.push({ id: doc.id, type: 'packet', ...doc.data() });
            });
            
            // Sort by creation time
            allItems.sort((a, b) => {
                const aTime = a.createdAt?.seconds || 0;
                const bTime = b.createdAt?.seconds || 0;
                return bTime - aTime;
            });
            
            renderItems(allItems);
            
        } catch (error) {
            console.error("Error loading all collections:", error);
            itemsListEl.innerHTML = '<p class="text-red-400">Error loading items.</p>';
        }
    }

    async function loadCollectionItems(collectionId, collectionName) {
        if (!currentUser) return;
        
        activeCollectionId = collectionId;
        updateActiveCollection(collectionId);
        currentCollectionTitleEl.textContent = collectionName;
        
        try {
            // Load transcripts for this collection
            const transcriptsRef = collection(db, "users", currentUser.uid, "transcripts");
            const tQuery = query(transcriptsRef, where("collectionId", "==", collectionId), orderBy("createdAt", "desc"));
            const tSnapshot = await getDocs(tQuery);
            
            // Load packets for this collection
            const packetsRef = collection(db, "users", currentUser.uid, "learning_packets");
            const pQuery = query(packetsRef, where("collectionId", "==", collectionId), orderBy("createdAt", "desc"));
            const pSnapshot = await getDocs(pQuery);
            
            const allItems = [];
            
            tSnapshot.forEach(doc => {
                allItems.push({ id: doc.id, type: 'transcript', ...doc.data() });
            });
            
            pSnapshot.forEach(doc => {
                allItems.push({ id: doc.id, type: 'packet', ...doc.data() });
            });
            
            // Sort by creation time
            allItems.sort((a, b) => {
                const aTime = a.createdAt?.seconds || 0;
                const bTime = b.createdAt?.seconds || 0;
                return bTime - aTime;
            });
            
            LoggingService.logEvent('collection_items_loaded', { 
                collectionId,
                total_items: allItems.length,
                transcripts: tSnapshot.size,
                packets: pSnapshot.size 
            });
            
            renderItems(allItems);

        } catch (error) {
            console.error("Error loading collection items:", error);
            LoggingService.logEvent('collection_items_load_failure', { 
                collectionId,
                error: error.message,
                code: error.code 
            });
            itemsListEl.innerHTML = '<p class="text-red-400">Error loading items.</p>';
        }
    }

    function updateActiveCollection(collectionId) {
        // Update visual state of collection list
        document.querySelectorAll('.collection-item').forEach(item => {
            item.classList.remove('is-active');
        });
        
        if (collectionId === 'all') {
            document.querySelector('.collection-item').classList.add('is-active');
        } else {
            const activeItem = document.querySelector(`[data-id="${collectionId}"]`);
            if (activeItem) activeItem.classList.add('is-active');
        }
    }

    function renderItems(items) {
        selectedItems.clear();
        updateBulkActionsPanel();
        
        if (items.length === 0) {
            itemsListEl.innerHTML = '';
            emptyStateEl.classList.remove('hidden');
            return;
        }
    
        emptyStateEl.classList.add('hidden');
        itemsListEl.innerHTML = '';
    
        items.forEach(item => renderItem(item));
        safeFeatherReplace(); // ✅ FIXED: Use safe function instead of feather.replace()
    }

    function renderItem(itemData) {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'library-item';
        itemDiv.onclick = () => viewItem(itemData);

        const iconType = itemData.type === 'transcript' ? 'file-text' : 'package';
        const badgeText = itemData.type === 'transcript' ? 'Transcript' : 'Learning Packet';
        const badgeClass = itemData.type === 'transcript' ? 'transcript' : 'packet';

        // Check if item is embedded in AI
        const isEmbedded = itemData.embeddedInAI === true;
        const aiIndicator = isEmbedded ?
            '<i data-feather="brain" class="ai-indicator embedded" title="Available for AI Chat"></i>' : 
            '<i data-feather="brain" class="ai-indicator not-embedded" title="Not in AI Knowledge Base"></i>';

        itemDiv.innerHTML = `
            <div class="item-selector">
                <input type="checkbox" class="item-checkbox" data-id="${itemData.id}" data-type="${itemData.type}">
            </div>
            <div class="item-main">
                <i data-feather="${iconType}" class="item-icon"></i>
                <div class="item-details">
                    <p class="item-title truncate" title="${itemData.title}">${itemData.title}</p>
                    <span class="item-badge ${badgeClass}">${badgeText}</span>
                </div>
                ${aiIndicator}
            </div>
            <div class="item-actions">
                <button class="btn-icon btn-delete-item" title="Delete"><i data-feather="x"></i></button>
            </div>
        `;

        // Add event listeners
        const checkbox = itemDiv.querySelector('.item-checkbox');
        checkbox.addEventListener('change', handleItemSelection);

        itemDiv.querySelector('.btn-delete-item').onclick = (e) => {
            e.stopPropagation();
            deleteItem(itemData.id, itemData.type);
        };

        itemsListEl.appendChild(itemDiv);
    }

    // =================================================================
    // AI KNOWLEDGE BASE CONTROLS
    // =================================================================

    function handleItemSelection(e) {
        const checkbox = e.target;
        const itemId = checkbox.dataset.id;
        const itemType = checkbox.dataset.type;
        
        if (checkbox.checked) {
            selectedItems.add(`${itemType}:${itemId}`);
        } else {
            selectedItems.delete(`${itemType}:${itemId}`);
        }
        
        updateBulkActionsPanel();
    }

    function updateBulkActionsPanel() {
        const count = selectedItems.size;
        
        if (count === 0) {
            bulkActionsPanel.classList.add('hidden');
            return;
        }
        
        bulkActionsPanel.classList.remove('hidden');
        selectionInfo.textContent = `${count} item${count === 1 ? '' : 's'} selected`;
    }

    // Event listeners for bulk actions
    if (addToAIBtn) {
        addToAIBtn.addEventListener('click', addSelectedToAI);
    }
    if (removeFromAIBtn) {
        removeFromAIBtn.addEventListener('click', removeSelectedFromAI);
    }
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', selectAllItems);
    }

    async function addSelectedToAI() {
        if (selectedItems.size === 0) return;
        
        addToAIBtn.disabled = true;
        addToAIBtn.innerHTML = '<i data-feather="loader" class="animate-spin"></i> Adding...';
        
        try {
            const itemsToAdd = Array.from(selectedItems).map(item => {
                const [type, id] = item.split(':');
                return { id, type };
            });
            
            const response = await fetch(EMBEDDING_SERVICE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUser.uid,
                    items: itemsToAdd
                })
            });
            
            if (response.ok) {
                showToast(`${itemsToAdd.length} item${itemsToAdd.length === 1 ? '' : 's'} added to AI Knowledge Base`, 'success');
                // Reload current view to update AI indicators
                if (activeCollectionId === 'all') {
                    loadAllCollections();
                } else {
                    const currentCollectionName = currentCollectionTitleEl.textContent;
                    loadCollectionItems(activeCollectionId, currentCollectionName);
                }
            } else {
                throw new Error('Failed to add items');
            }
            
        } catch (error) {
            console.error('Error adding to AI:', error);
            showToast('Error adding items to AI Knowledge Base', 'error');
        } finally {
            addToAIBtn.disabled = false;
            addToAIBtn.innerHTML = '<i data-feather="brain"></i> Add to AI';
            updateBulkActionsPanel();
            safeFeatherReplace(); // ✅ FIXED: Use safe function instead of feather.replace()
        }
    }

    async function removeSelectedFromAI() {
        if (selectedItems.size === 0) return;
        
        removeFromAIBtn.disabled = true;
        removeFromAIBtn.innerHTML = '<i data-feather="loader" class="animate-spin"></i> Removing...';
        
        try {
            const itemsToRemove = Array.from(selectedItems).map(item => {
                const [type, id] = item.split(':');
                return { id, type };
            });
            
            const response = await fetch(REMOVE_EMBEDDING_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUser.uid,
                    items: itemsToRemove
                })
            });
            
            if (response.ok) {
                showToast(`${itemsToRemove.length} item${itemsToRemove.length === 1 ? '' : 's'} removed from AI Knowledge Base`, 'success');
                // Reload current view to update AI indicators
                if (activeCollectionId === 'all') {
                    loadAllCollections();
                } else {
                    const currentCollectionName = currentCollectionTitleEl.textContent;
                    loadCollectionItems(activeCollectionId, currentCollectionName);
                }
            } else {
                throw new Error('Failed to remove items');
            }
            
        } catch (error) {
            console.error('Error removing from AI:', error);
            showToast('Error removing items from AI Knowledge Base', 'error');
        } finally {
            removeFromAIBtn.disabled = false;
            removeFromAIBtn.innerHTML = '<i data-feather="brain"></i> Remove from AI';
            updateBulkActionsPanel();
            safeFeatherReplace(); // ✅ FIXED: Use safe function instead of feather.replace()
        }
    }

    function selectAllItems() {
        const checkboxes = document.querySelectorAll('.item-checkbox');
        const allSelected = Array.from(checkboxes).every(cb => cb.checked);
        
        checkboxes.forEach(cb => {
            cb.checked = !allSelected;
            handleItemSelection({ target: cb });
        });
    }

    function showToast(message, type = 'info') {
        // Simple toast implementation
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('show');
        }, 100);
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => document.body.removeChild(toast), 300);
        }, 3000);
    }

    // =================================================================
    // ITEM VIEWING AND INTERACTION
    // =================================================================

    function viewItem(itemData) {
        if (itemData.type === 'transcript') {
            openModal(itemData.title, `<div class="space-y-4">
                <div class="transcript-content">
                    <p class="text-sm text-slate-400 mb-2">Recorded: ${new Date(itemData.createdAt?.seconds * 1000).toLocaleDateString()}</p>
                    <div class="bg-slate-800 p-4 rounded-md max-h-96 overflow-y-auto">
                        <p class="whitespace-pre-wrap">${itemData.content}</p>
                    </div>
                </div>
            </div>`);
        } else if (itemData.type === 'packet') {
            displayLearningPacket(itemData);
        }
    }

    function displayLearningPacket(packet) {
        let html = '<div class="space-y-6">';

        // Summary Section
        if (packet.summary && !packet.summary.startsWith("Error:")) {
            html += `<div class="packet-section">
                <h3 class="text-lg font-semibold mb-3">Summary</h3>
                <div class="bg-slate-800 p-4 rounded-md">
                    <p>${packet.summary}</p>
                </div>
            </div>`;
        }

        // Key Concepts Section
        if (packet.keyConcepts && packet.keyConcepts.length > 0 && !packet.keyConcepts[0].concept.startsWith("Error")) {
            const conceptsHtml = `<ul class="space-y-2 list-disc list-inside">${packet.keyConcepts.map(item => `<li><strong>${item.concept}:</strong> ${item.definition}</li>`).join('')}</ul>`;
            html += `<div class="packet-section">
                <h3 class="text-lg font-semibold mb-3">Key Concepts</h3>
                <div class="bg-slate-800 p-4 rounded-md">
                    ${conceptsHtml}
                </div>
            </div>`;
        }

        // Action Items Section
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
            html += `<div class="packet-section">
                <h3 class="text-lg font-semibold mb-3">Action Items</h3>
                <div class="space-y-2">
                    ${actionItemsHtml}
                </div>
            </div>`;
        }

        // Flashcards Section
        if (packet.flashcards && packet.flashcards.length > 0 && !packet.flashcards[0].front.startsWith("Error")) {
            const flashcardsHtml = `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">${packet.flashcards.map(card => `<div class="bg-slate-800 p-3 rounded-md border border-slate-700"><p class="font-semibold">Q: ${card.front}</p><p class="text-slate-400 mt-1">A: ${card.back}</p></div>`).join('')}</div>`;
            html += `<div class="packet-section">
                <h3 class="text-lg font-semibold mb-3">Flashcards</h3>
                ${flashcardsHtml}
            </div>`;
        }
        
        html += '</div>';
        
        openModal(packet.title, html);
    }

    // =================================================================
    // CHAT FUNCTIONALITY
    // =================================================================

    if (sendChatBtn && chatInput) {
        sendChatBtn.addEventListener('click', sendChatMessage);
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }

    async function sendChatMessage() {
        const question = chatInput.value.trim();
        if (!question || !currentUser) return;

        // Add user message to chat
        addChatMessage(question, 'user');
        chatInput.value = '';

        // Add loading message
        addChatMessage('Thinking...', 'bot', true);
        sendChatBtn.disabled = true;

        const payload = {
            question: question,
            userId: currentUser.uid,
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
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }

    // =================================================================
    // MODAL FUNCTIONALITY 
    // =================================================================

    function openModal(title, content) {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = content;
        document.getElementById('modal').classList.remove('hidden');
    }

    function closeModal() {
        document.getElementById('modal').classList.add('hidden');
    }

    // Close modal when clicking outside or on close button
    document.getElementById('modal-backdrop').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });
    
    document.getElementById('modal-close').addEventListener('click', closeModal);
    
    // ESC key to close
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    });

    function openDebugModal() {
        LoggingService.logEvent('debug_modal_opened_library');
        const logData = LoggingService.getLog();
        const logText = JSON.stringify(logData, null, 2);
        
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(logText);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `library-debug-log-${timestamp}.json`;
        
        const content = `
            <div class="space-y-4">
                <p class="text-slate-300">Debug information for troubleshooting:</p>
                <pre class="bg-slate-800 p-4 rounded-md text-xs overflow-auto max-h-96">${logText}</pre>
                <div class="flex gap-2">
                    <a href="${dataStr}" download="${filename}" class="btn btn-primary">
                        Download Log
                    </a>
                    <button onclick="navigator.clipboard.writeText('${logText.replace(/'/g, "\\'")}'); this.textContent='Copied!'" class="btn btn-secondary">
                        Copy to Clipboard
                    </button>
                </div>
            </div>
        `;
        
        openModal('Debug Information', content);
    }

    // =================================================================
    // EXISTING FUNCTIONS (KEPT FOR COMPATIBILITY)
    // =================================================================

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
            
            // Reload current view
            if (activeCollectionId === 'all') {
                loadAllCollections();
            } else {
                const currentCollectionName = currentCollectionTitleEl.textContent;
                loadCollectionItems(activeCollectionId, currentCollectionName);
            }
        } catch (error) {
            console.error("Error deleting item:", error);
            LoggingService.logEvent('