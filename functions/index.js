/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const functions = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const embeddingFunctions = require('../embedding-service-function/index.js');

exports.addToKnowledgeBase = embeddingFunctions.addToKnowledgeBase;
exports.removeFromKnowledgeBase = embeddingFunctions.removeFromKnowledgeBase;

