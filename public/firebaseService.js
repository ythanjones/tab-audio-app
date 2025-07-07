// File: public/firebaseService.js
// Shared module for Firebase initialization and core services.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-analytics.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";

// Your web app's Firebase configuration - THIS SHOULD BE SECURELY MANAGED
// For this exercise, we'll keep it here, but in a real app, consider environment variables or a secure config solution.
const firebaseConfig = {
    apiKey: "AIzaSyCH7jBG_iSTFAYrWEtazEvlXk2ZC413AGo", // IMPORTANT: Exposing API keys in client-side code is risky.
    authDomain: "tab-audio-app.firebaseapp.com",
    projectId: "tab-audio-app",
    storageBucket: "tab-audio-app.firebasestorage.app",
    messagingSenderId: "715569829205",
    appId: "1:715569829205:web:216b98f170035f2fcf0bdc",
    measurementId: "G-X9T1WHYM35"
};

let app;
let auth;
let db;
let analytics;
let firebaseInitialized = false;

try {
    if (!firebaseConfig.apiKey) {
        throw new Error("Firebase apiKey is missing. Firebase cannot be initialized.");
    }
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    analytics = getAnalytics(app);
    firebaseInitialized = true;
    console.log("Firebase initialized successfully via firebaseService.js");
} catch (error) {
    console.error("Firebase initialization failed in firebaseService.js:", error);
    // Potentially dispatch a custom event or set a global flag that other parts of the app can check
    // to know that Firebase is not available.
}

export {
    app,
    auth,
    db,
    analytics,
    firebaseInitialized,
    // Export specific Firebase functions if they are widely used, e.g.
    // onAuthStateChanged,
    // collection,
    // doc,
    // etc. from "firebase/auth" and "firebase/firestore"
    // However, it's often cleaner for consumer modules to import these directly from Firebase SDK
    // and use the initialized `auth` and `db` instances from this service.
};
