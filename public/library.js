// =================================================================
// LIBRARY PAGE SCRIPT (v2.3 - Chat Enabled)
// =================================================================
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
    const logEvent = (name, params = {}) => {
        console.log(`LIBRARY EVENT: ${name}`, params);
    }

    // --- INITIALIZATION ---
    try {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        logEvent('firebase_initialized');

        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUser = user;
                logEvent('auth_state_changed', { status: 'logged_in' });
                loadUserLibrary(); 
            } else {
                currentUser = null;
                logEvent('auth_state_changed', { status: 'logged_out' });
                window.location.href = 'index.html';
            }
        });
    } catch (error) {
        console.error("Firebase Initialization Error on Library Page:", error);
        contentPanel.innerHTML = '<h1>Error: Could not initialize application.</h1>';
    }


    // =================================================================
    // CORE LOGIC
    // =================================================================

    async function loadUserLibrary() {
        if (!currentUser) return;
        logEvent('library_load_attempt');
        collectionsListEl.innerHTML = '<li>Loading...</li>';
        contentPanel.classList.add('hidden');

        const collectionsRef = collection(db, "users", currentUser.uid, "collections");
        const q = query(collectionsRef, orderBy("createdAt", "desc"));
        
        try {
            const querySnapshot = await getDocs(q);
            collectionsListEl.innerHTML = ''; 
            
            if (querySnapshot.empty) {
                logEvent('library_load_success', { collections_found: 0 });
                collectionsListEl.innerHTML = '<li class="p-2 text-slate-500 text-sm">No collections yet. Click "New Collection" to start.</li>';
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
            logEvent('library_load_success', { collections_found: collections.length });

            collections.forEach(col => renderCollection(col));

            if (collections.length > 0) {
                loadCollectionItems(collections[0].id, collections[0].name);
            }
            contentPanel.classList.remove('hidden');

        } catch (error) {
            console.error("Error loading collections: ", error);
            logEvent('library_load_failure', { error: error.message });
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
        logEvent('collection_items_load_attempt', { collectionId });

        currentCollectionTitleEl.textContent = collectionName;
        document.querySelectorAll('.collection-item').forEach(item => {
            item.classList.toggle('is-active', item.dataset.id === collectionId);
        });

        itemsListEl.innerHTML = '<li>Loading items...</li>';
        emptyStateEl.classList.add('hidden');

        try {
            const items = [];
            const transcriptsRef = collection(db, "users", currentUser.uid, "transcripts");
            const tq = query(transcriptsRef, where("collectionId", "==", collectionId), orderBy("createdAt", "desc"));
            const tSnapshot = await getDocs(tq);
            tSnapshot.forEach(doc => items.push({ id: doc.id, type: 'transcript', ...doc.data() }));

            const packetsRef = collection(db, "users", currentUser.uid, "learning_packets");
            const pq = query(packetsRef, where("collectionId", "==", collectionId), orderBy("createdAt", "desc"));
            const pSnapshot = await getDocs(pq);
            pSnapshot.forEach(doc => items.push({ id: doc.id, type: 'packet', ...doc.data() }));

            items.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

            itemsListEl.innerHTML = ''; 
            logEvent('collection_items_load_success', { collectionId, items_found: items.length });

            if (items.length === 0) {
                emptyStateEl.classList.remove('hidden');
            } else {
                items.forEach(item => renderItem(item));
            }

        } catch (error) {
            console.error(`Error loading items for collection ${collectionId}:`, error);
            logEvent('collection_items_load_failure', { collectionId, error: error.message });
            itemsListEl.innerHTML = '<li>Error loading items.</li>';
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
        logEvent('collection_create_attempt', { name });
        try {
            await addDoc(collection(db, "users", currentUser.uid, "collections"), {
                name: name,
                createdAt: serverTimestamp()
            });
            logEvent('collection_create_success');
            loadUserLibrary();
        } catch (error) {
            console.error("Error creating new collection: ", error);
            logEvent('collection_create_failure', { error: error.message });
            alert("Could not create collection.");
        }
    }
    
    async function deleteItem(itemId, itemType) {
        if (!currentUser || !confirm(`Are you sure you want to delete this ${itemType}?`)) return;
        logEvent('item_delete_attempt', { itemId, itemType });
        const collectionName = itemType === 'transcript' ? 'transcripts' : 'learning_packets';
        try {
            await deleteDoc(doc(db, "users", currentUser.uid, collectionName, itemId));
            logEvent('item_delete_success', { itemId });
            const currentCollectionName = currentCollectionTitleEl.textContent;
            loadCollectionItems(activeCollectionId, currentCollectionName);
        } catch (error) {
            console.error("Error deleting item:", error);
            logEvent('item_delete_failure', { itemId, error: error.message });
            alert("Could not delete item.");
        }
    }

    async function deleteActiveCollection() {
        if (!currentUser || !activeCollectionId) return;
        if (!confirm(`Are you sure you want to delete this entire collection and all its contents? This cannot be undone.`)) return;
        logEvent('collection_delete_attempt', { collectionId: activeCollectionId });
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
            logEvent('collection_delete_success', { collectionId: activeCollectionId });
            loadUserLibrary();
        } catch (error) {
            console.error("Error deleting collection:", error);
            logEvent('collection_delete_failure', { collectionId: activeCollectionId, error: error.message });
            alert("Could not delete collection.");
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
        logEvent('ui_action', { component: 'new_collection_button' });
        const name = prompt("Enter a name for your new collection:");
        if (name && name.trim() !== '') {
            createNewCollection(name.trim());
        }
    });

    deleteCollectionBtn.addEventListener('click', () => {
        logEvent('ui_action', { component: 'delete_collection_button' });
        deleteActiveCollection();
    });
    debugButton.addEventListener('click', openDebugModal);
    function openDebugModal() {
        // This function can be expanded later if needed
        alert("Debug modal for library page is not fully implemented yet.");
    }

});
