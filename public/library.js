// =================================================================
// LIBRARY PAGE SCRIPT
// =================================================================
// This script will handle all interactivity for the library.html page.
// It will connect to Firebase to fetch, create, update, and delete
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
    // Add other Firestore functions as needed: query, where, getDocs, addDoc, doc, setDoc, deleteDoc, etc.
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

    // --- INITIALIZATION ---
    try {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        console.log("Library page Firebase initialized successfully.");

        // Listen for authentication state changes
        onAuthStateChanged(auth, (user) => {
            if (user) {
                // User is signed in.
                currentUser = user;
                console.log("User authenticated:", user.uid);
                // This is the entry point to load all user data.
                loadUserLibrary(); 
            } else {
                // User is signed out.
                currentUser = null;
                console.log("User is not authenticated. Redirecting to main page.");
                // Redirect to the main page if the user is not logged in, as the library is a protected area.
                window.location.href = 'index.html';
            }
        });
    } catch (error) {
        console.error("Firebase Initialization Error on Library Page:", error);
        // Display a critical error message on the page
        document.body.innerHTML = '<h1>Error: Could not initialize application.</h1>';
    }


    // =================================================================
    // CORE LOGIC (To be implemented)
    // =================================================================

    /**
     * Main function to load all collections for the current user.
     * This will be the first function called after a user is authenticated.
     */
    function loadUserLibrary() {
        console.log("Loading user library...");
        // 1. Clear existing collections from the UI.
        // 2. Create a Firestore query to get all documents from the user's 'collections' subcollection.
        // 3. Loop through the results and call a 'renderCollection' function for each one.
        // 4. If no collections are found, maybe show a special "Create your first collection" message.
        // 5. Automatically select and load the first collection in the list.
    }

    /**
     * Renders a single collection item in the sidebar.
     * @param {object} collectionData - The data for the collection from Firestore.
     */
    function renderCollection(collectionData) {
        // 1. Create the `<li>` element for the collection.
        // 2. Set its text and data attributes (like data-id).
        // 3. Add a click event listener that sets this collection as 'active' and calls 'loadCollectionItems'.
        // 4. Append the new element to collectionsListEl.
    }

    /**
     * Fetches and displays all items (transcripts, decks) for a given collection ID.
     * @param {string} collectionId - The ID of the collection to load.
     */
    function loadCollectionItems(collectionId) {
        activeCollectionId = collectionId;
        console.log(`Loading items for collection: ${collectionId}`);
        // 1. Update the UI: set the main title, highlight the active collection in the sidebar.
        // 2. Clear the existing items from the itemsListEl.
        // 3. Create a Firestore query to get all items where 'collectionId' matches the provided ID.
        //    This might involve querying both 'transcripts' and 'flashcardDecks' collections.
        // 4. For each item found, call a 'renderItem' function.
        // 5. If no items are found, show the 'empty-state' message.
    }

    /**
     * Renders a single item (transcript or deck) in the main content area.
     * @param {object} itemData - The data for the item from Firestore.
     */
    function renderItem(itemData) {
        // 1. Create the main `<div>` for the library item.
        // 2. Populate the title, icon (file-text or layers), and badge.
        // 3. Create the action buttons (Rename, Export, Delete, etc.).
        // 4. Add event listeners to each button to handle its specific action (e.g., call 'renameItem', 'deleteItem').
        // 5. Append the new element to itemsListEl.
    }


    // =================================================================
    // EVENT LISTENERS
    // =================================================================

    newCollectionBtn.addEventListener('click', () => {
        // 1. Prompt the user for a new collection name (e.g., using a simple `prompt()` or a custom modal).
        // 2. If a name is provided, call a 'createNewCollection' function.
        console.log("New Collection button clicked.");
    });

    /**
     * Firestore logic to create a new collection document for the user.
     * @param {string} name - The name for the new collection.
     */
    function createNewCollection(name) {
        // 1. Use `addDoc` to create a new document in the user's 'collections' subcollection in Firestore.
        // 2. On success, call 'renderCollection' to add it to the UI instantly.
    }

});