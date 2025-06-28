// =================================================================
// LIBRARY PAGE SCRIPT (FUNCTIONAL)
// =================================================================
// This script handles all interactivity for the library.html page.
// It connects to Firebase to fetch, create, update, and delete
// collections and the items (transcripts, flashcard decks) within them.
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


    // --- INITIALIZATION ---
    try {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        console.log("Library page Firebase initialized successfully.");

        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUser = user;
                loadUserLibrary(); 
            } else {
                currentUser = null;
                window.location.href = 'index.html';
            }
        });
    } catch (error) {
        console.error("Firebase Initialization Error on Library Page:", error);
        document.body.innerHTML = '<h1>Error: Could not initialize application.</h1>';
    }


    // =================================================================
    // CORE LOGIC
    // =================================================================

    async function loadUserLibrary() {
        if (!currentUser) return;
        collectionsListEl.innerHTML = '<li>Loading collections...</li>';

        const collectionsRef = collection(db, "users", currentUser.uid, "collections");
        const q = query(collectionsRef, orderBy("createdAt", "desc"));
        
        try {
            const querySnapshot = await getDocs(q);
            collectionsListEl.innerHTML = ''; // Clear loading message
            
            if (querySnapshot.empty) {
                // If no collections, create a default one
                await createNewCollection("My First Collection", true);
                return; // The function will be re-triggered by the creation
            }
            
            const collections = [];
            querySnapshot.forEach((doc) => {
                collections.push({ id: doc.id, ...doc.data() });
            });

            collections.forEach(col => renderCollection(col));

            // Automatically select the first collection
            if (collections.length > 0) {
                loadCollectionItems(collections[0].id, collections[0].name);
            }

        } catch (error) {
            console.error("Error loading collections: ", error);
            collectionsListEl.innerHTML = '<li>Error loading collections.</li>';
        }
    }

    function renderCollection(collectionData) {
        const li = document.createElement('li');
        li.className = 'collection-item';
        li.dataset.id = collectionData.id;

        const a = document.createElement('a');
        a.innerHTML = `<i data-feather="folder"></i><span>${collectionData.name}</span>`;
        a.onclick = () => {
            loadCollectionItems(collectionData.id, collectionData.name);
        };
        li.appendChild(a);
        collectionsListEl.appendChild(li);
        feather.replace(); // Re-initialize icons
    }

    async function loadCollectionItems(collectionId, collectionName) {
        if (!currentUser) return;
        activeCollectionId = collectionId;

        // Update UI
        currentCollectionTitleEl.textContent = collectionName;
        document.querySelectorAll('.collection-item').forEach(item => {
            item.classList.toggle('is-active', item.dataset.id === collectionId);
        });

        itemsListEl.innerHTML = '<li>Loading items...</li>';
        emptyStateEl.classList.add('hidden');

        try {
            const items = [];
            // Query transcripts
            const transcriptsRef = collection(db, "users", currentUser.uid, "transcripts");
            const tq = query(transcriptsRef, where("collectionId", "==", collectionId), orderBy("createdAt", "desc"));
            const tSnapshot = await getDocs(tq);
            tSnapshot.forEach(doc => items.push({ id: doc.id, type: 'transcript', ...doc.data() }));

            // Query flashcard decks (future)
            // const decksRef = collection(db, "users", currentUser.uid, "flashcardDecks");
            // const dq = query(decksRef, where("collectionId", "==", collectionId));
            // const dSnapshot = await getDocs(dq);
            // dSnapshot.forEach(doc => items.push({ id: doc.id, type: 'deck', ...doc.data() }));

            itemsListEl.innerHTML = ''; // Clear loading message

            if (items.length === 0) {
                emptyStateEl.classList.remove('hidden');
            } else {
                items.forEach(item => renderItem(item));
            }

        } catch (error) {
            console.error(`Error loading items for collection ${collectionId}:`, error);
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

        itemDiv.innerHTML = `
            <div class="item-main">
                <i data-feather="${iconType}" class="item-icon"></i>
                <div class="item-details">
                    <p class="item-title">${itemData.title}</p>
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
    
    async function createNewCollection(name, selectAfterCreating = false) {
        if (!currentUser || !name) return;
        
        try {
            const docRef = await addDoc(collection(db, "users", currentUser.uid, "collections"), {
                name: name,
                createdAt: serverTimestamp()
            });

            const newCollection = { id: docRef.id, name: name };
            renderCollection(newCollection);
            
            if (selectAfterCreating) {
                loadCollectionItems(newCollection.id, newCollection.name);
            }
        } catch (error) {
            console.error("Error creating new collection: ", error);
            alert("Could not create collection.");
        }
    }

    async function deleteItem(itemId, itemType) {
        if (!currentUser || !confirm(`Are you sure you want to delete this ${itemType}?`)) return;

        const collectionName = itemType === 'transcript' ? 'transcripts' : 'flashcardDecks';
        try {
            await deleteDoc(doc(db, "users", currentUser.uid, collectionName, itemId));
            // Refresh the view
            const currentCollectionName = currentCollectionTitleEl.textContent;
            loadCollectionItems(activeCollectionId, currentCollectionName);
        } catch (error) {
            console.error("Error deleting item:", error);
            alert("Could not delete item.");
        }
    }

    async function deleteActiveCollection() {
        if (!currentUser || !activeCollectionId) return;
        if (!confirm(`Are you sure you want to delete this entire collection and all its contents? This cannot be undone.`)) return;

        try {
            const batch = writeBatch(db);

            // Delete all items in the collection
            const transcriptsRef = collection(db, "users", currentUser.uid, "transcripts");
            const tq = query(transcriptsRef, where("collectionId", "==", activeCollectionId));
            const tSnapshot = await getDocs(tq);
            tSnapshot.forEach(doc => batch.delete(doc.ref));

            // Add future item types here (e.g., flashcard decks)

            // Delete the collection itself
            const collectionDocRef = doc(db, "users", currentUser.uid, "collections", activeCollectionId);
            batch.delete(collectionDocRef);

            await batch.commit();

            // Reload the entire library to refresh the state
            loadUserLibrary();

        } catch (error) {
            console.error("Error deleting collection:", error);
            alert("Could not delete collection.");
        }
    }


    // =================================================================
    // EVENT LISTENERS
    // =================================================================

    newCollectionBtn.addEventListener('click', () => {
        const name = prompt("Enter a name for your new collection:");
        if (name) {
            createNewCollection(name);
        }
    });

    deleteCollectionBtn.addEventListener('click', deleteActiveCollection);

});
