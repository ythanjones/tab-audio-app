// =================================================================
// LIBRARY PAGE SCRIPT (v2 - Robust & Log-Enabled)
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
    measurementId: "G-BDW8YWD1QW"
};

document.addEventListener('DOMContentLoaded', () => {

    // --- Simple Logger for this page ---
    const logEvent = (name, params = {}) => {
        console.log(`LIBRARY EVENT: ${name}`, params);
    };

    // --- STATE VARIABLES ---
    let currentUser = null;
    let db, auth;
    let activeCollectionId = null;

    // --- DOM ELEMENT REFERENCES ---
    const collectionsListEl = document.getElementById('collectionsList');
    const itemsListEl = document.getElementById('itemsList');
    const currentCollectionTitleEl = document.getElementById('current-collection-title');
    const emptyStateEl = document.getElementById('empty-state');
    const newCollectionBtn = document.getElementById('newCollectionBtn');
    const deleteCollectionBtn = document.getElementById('deleteCollectionBtn');
    const contentPanel = document.getElementById('library-content');


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
        contentPanel.classList.add('hidden'); // Hide content until loaded

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
        a.title = collectionData.name;
        a.innerHTML = `<i data-feather="folder"></i><span>${collectionData.name}</span>`;
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

        const iconType = itemData.type === 'transcript' ? 'file-text' : 'layers';
        const badgeClass = itemData.type === 'transcript' ? 'transcript-badge' : 'flashcard-badge';
        const badgeText = itemData.type === 'transcript' ? 'Transcript' : 'Flashcard Deck';

        itemDiv.innerHTML = `...`; // Same as before

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
            // Reload the whole library to ensure a clean state
            loadUserLibrary();
        } catch (error) {
            console.error("Error creating new collection: ", error);
            logEvent('collection_create_failure', { error: error.message });
            alert("Could not create collection.");
        }
    }

    // deleteItem and deleteActiveCollection functions remain the same...

    // =================================================================
    // EVENT LISTENERS
    // =================================================================

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

});
