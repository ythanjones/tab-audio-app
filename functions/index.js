// functions/index.js
// In service-A/index.js, service-B/index.js, etc.
require('dotenv').config({ path: '../.env' });

const functions = require("firebase-functions");

// Import the ChromaDB functions from embedding-service-function
const { 
    addToKnowledgeBase, 
    removeFromKnowledgeBase 
} = require('../embedding-service-function/index.js');

// Export the functions
exports.addToKnowledgeBase = addToKnowledgeBase;
exports.removeFromKnowledgeBase = removeFromKnowledgeBase;

// Any other existing functions can stay here