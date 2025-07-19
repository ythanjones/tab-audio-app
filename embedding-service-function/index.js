// File: embedding-service-function/index.js
// ChromaDB version - Much simpler than Vertex AI!

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { ChromaClient } = require('chromadb');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Firebase
admin.initializeApp();

// Configuration
const PROJECT_ID = 'tab-audio-app';
const EMBEDDING_MODEL = 'text-embedding-004'; // Latest stable embedding model
const GEMINI_API_KEY = 'AIzaSyCH7jBG_iSTFAYrWEtazEvlXk2ZC413AGo'
// Initialize ChromaDB client
let chromaClient;
let genAI;

// Custom embedding function for ChromaDB
class GeminiEmbeddingFunction {
    constructor(apiKey) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    }

    async generate(texts) {
        try {
            // ChromaDB expects an array of embeddings for an array of texts
            const embeddings = [];
            
            for (const text of texts) {
                const result = await this.model.embedContent({
                    content: { parts: [{ text }] },
                    taskType: "RETRIEVAL_DOCUMENT"
                });
                embeddings.push(result.embedding.values);
            }
            
            return embeddings;
        } catch (error) {
            console.error('Embedding generation error:', error);
            throw error;
        }
    }
}

// Initialize ChromaDB and embedding function
function getChromaClient() {
    if (!chromaClient) {
        chromaClient = new ChromaClient({
            path: process.env.CHROMADB_PATH || "http://localhost:8000" // Can be configured for production
        });
    }
    return chromaClient;
}

function getEmbeddingFunction() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured');
    }
    return new GeminiEmbeddingFunction(apiKey);
}

// =================================================================
// HTTP Functions for Manual Embedding
// =================================================================

/**
 * HTTP endpoint to add documents to the AI knowledge base
 */
exports.addToKnowledgeBase = functions.https.onRequest(async (req, res) => {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', '3600');
        return res.status(204).send('');
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { userId, documents } = req.body;
    
    if (!userId || !documents || !Array.isArray(documents)) {
        return res.status(400).json({ 
            error: 'Missing required fields',
            expected: { userId: 'string', documents: 'array' }
        });
    }

    try {
        console.log(`📚 Adding ${documents.length} documents to knowledge base for user ${userId}`);
        
        const client = getChromaClient();
        const embedder = getEmbeddingFunction();
        
        // Get or create user's collection
        let collection;
        try {
            collection = await client.getCollection({
                name: `user_${userId}`,
                embeddingFunction: embedder
            });
        } catch (error) {
            // Collection doesn't exist, create it
            console.log(`Creating new collection for user ${userId}`);
            collection = await client.createCollection({
                name: `user_${userId}`,
                embeddingFunction: embedder
            });
        }
        
        // Process documents
        const results = [];
        const batch = admin.firestore().batch();
        
        for (const doc of documents) {
            try {
                const { documentId, text, title, documentType, collectionId } = doc;
                
                // Add to ChromaDB
                await collection.add({
                    ids: [documentId],
                    documents: [text],
                    metadatas: [{
                        userId,
                        documentId,
                        title: title || 'Untitled',
                        documentType: documentType || 'transcript',
                        collectionId: collectionId || 'default',
                        timestamp: new Date().toISOString()
                    }]
                });
                
                // Update Firestore to mark as embedded
                const docPath = documentType === 'learning_packet' 
                    ? `users/${userId}/learning_packets/${documentId}`
                    : `users/${userId}/transcripts/${documentId}`;
                    
                const docRef = admin.firestore().doc(docPath);
                batch.update(docRef, { 
                    embeddedInAI: true,
                    embeddedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                
                results.push({ 
                    success: true, 
                    documentId,
                    message: 'Successfully added to AI knowledge base'
                });
                
            } catch (error) {
                console.error(`Failed to embed document ${doc.documentId}:`, error);
                results.push({ 
                    success: false, 
                    documentId: doc.documentId,
                    error: error.message 
                });
            }
        }
        
        // Commit Firestore updates
        await batch.commit();
        
        const successCount = results.filter(r => r.success).length;
        console.log(`✅ Successfully embedded ${successCount}/${documents.length} documents`);
        
        res.status(200).json({ 
            success: true,
            results,
            summary: {
                total: documents.length,
                successful: successCount,
                failed: documents.length - successCount
            }
        });
        
    } catch (error) {
        console.error('Error in addToKnowledgeBase:', error);
        res.status(500).json({ 
            error: 'Internal server error', 
            message: error.message 
        });
    }
});

/**
 * HTTP endpoint to remove documents from the AI knowledge base
 */
exports.removeFromKnowledgeBase = functions.https.onRequest(async (req, res) => {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', '3600');
        return res.status(204).send('');
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { userId, documentIds } = req.body;
    
    if (!userId || !documentIds || !Array.isArray(documentIds)) {
        return res.status(400).json({ 
            error: 'Missing required fields',
            expected: { userId: 'string', documentIds: 'array' }
        });
    }

    try {
        console.log(`🗑️ Removing ${documentIds.length} documents from knowledge base for user ${userId}`);
        
        const client = getChromaClient();
        
        // Get user's collection
        let collection;
        try {
            collection = await client.getCollection({
                name: `user_${userId}`
            });
        } catch (error) {
            return res.status(404).json({ 
                error: 'No knowledge base found for this user' 
            });
        }
        
        // Remove from ChromaDB
        await collection.delete({
            ids: documentIds
        });
        
        // Update Firestore
        const batch = admin.firestore().batch();
        
        for (const documentId of documentIds) {
            // Update both possible document types
            const transcriptRef = admin.firestore()
                .collection('users').doc(userId)
                .collection('transcripts').doc(documentId);
                
            const packetRef = admin.firestore()
                .collection('users').doc(userId)
                .collection('learning_packets').doc(documentId);
            
            batch.update(transcriptRef, { 
                embeddedInAI: false,
                removedFromAIAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            batch.update(packetRef, { 
                embeddedInAI: false,
                removedFromAIAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        
        await batch.commit();
        
        console.log(`✅ Successfully removed ${documentIds.length} documents`);
        
        res.json({ 
            success: true,
            removedCount: documentIds.length,
            message: 'Documents removed from AI knowledge base'
        });
        
    } catch (error) {
        console.error('Remove from knowledge base failed:', error);
        res.status(500).json({ 
            error: 'Internal server error', 
            message: error.message 
        });
    }
});

/**
 * Optional: Clean up empty collections
 */
exports.cleanupEmptyCollections = functions.pubsub
    .schedule('every 24 hours')
    .onRun(async (context) => {
        console.log('🧹 Running collection cleanup...');
        
        try {
            const client = getChromaClient();
            const collections = await client.listCollections();
            
            for (const collection of collections) {
                const col = await client.getCollection({ name: collection.name });
                const count = await col.count();
                
                if (count === 0) {
                    console.log(`Deleting empty collection: ${collection.name}`);
                    await client.deleteCollection({ name: collection.name });
                }
            }
            
            console.log('✅ Cleanup complete');
        } catch (error) {
            console.error('Cleanup failed:', error);
        }
    });