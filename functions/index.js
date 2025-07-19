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
const embeddingService = require('../embedding-service-function/index.js');

exports.addToKnowledgeBase = embeddingService.addToKnowledgeBase;
exports.removeFromKnowledgeBase = embeddingService.removeFromKnowledgeBase;

