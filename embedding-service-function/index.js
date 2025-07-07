// File: embedding-service-function/index.js
// FIXED VERSION - Resolves GCLOUD_PROJECT and embedding format issues

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { PredictionServiceClient } = require('@google-cloud/aiplatform');
const { generateEmbedding: generateEmbeddingUtil } = require('../shared/embeddingUtils'); // Jules: Import shared function

// --- Configuration ---
const PROJECT_ID = 'tab-audio-app'; 
const LOCATION = 'europe-west2'; 
// const PUBLISHER = 'google'; // Jules: Moved to shared util
// const EMBEDDING_MODEL = 'gemini-embedding-001'; // Jules: Moved to shared util

// ✅ FIXED: Updated with correct IDs
const VECTOR_SEARCH_INDEX_ID = '7989579253001748480';         // Base index ID (for upserts)
const VECTOR_SEARCH_ENDPOINT_ID = '6958254938333904896';      // Endpoint ID
const DEPLOYED_INDEX_ID = 'tab_audio_app_1751241281157';     // Deployed index ID

// ✅ FIX: Initialize with explicit project ID to resolve GCLOUD_PROJECT error
admin.initializeApp({ 
    projectId: PROJECT_ID,
    // This ensures GCLOUD_PROJECT is properly set
});

// Initialize the Vertex AI Client
const clientOptions = { apiEndpoint: `${LOCATION}-aiplatform.googleapis.com` };
const predictionServiceClient = new PredictionServiceClient(clientOptions); // Jules: This client will be passed to the util

// =================================================================
// Firestore Triggers (AUTO-EMBEDDING - Optional)
// =================================================================

/**
 * Triggers when a new transcript is created.
 * NOTE: This is disabled by default - users will manually embed content
 */
exports.onTranscriptCreated = functions.firestore
    .document('users/{userId}/transcripts/{docId}')
    .onCreate(async (snap, context) => {
        console.log(`🎙️ New transcript detected: ${context.params.docId}`);
        
        // ✅ OPTIONAL: Auto-embed can be disabled to let users choose
        const AUTO_EMBED = false; // Set to true if you want automatic embedding
        
        if (!AUTO_EMBED) {
            console.log(`⏸️ Auto-embedding disabled. Users will manually choose content for AI.`);
            return { success: true, action: 'skipped_auto_embed' };
        }
        
        const data = snap.data();
        const textToEmbed = data.content || '';
        
        if (!textToEmbed.trim()) {
            console.log(`⚠️ No content found in transcript ${context.params.docId}, skipping embedding`);
            return { success: false, reason: 'No content' };
        }
        
        return handleEmbedding({
            firestoreDocId: context.params.docId,
            userId: context.params.userId,
            collectionId: data.collectionId,
            documentType: 'transcript',
            text: textToEmbed,
            title: data.title || 'Untitled Transcript'
        });
    });

/**
 * Triggers when a new learning packet is created.
 * NOTE: This is disabled by default - users will manually embed content
 */
exports.onPacketCreated = functions.firestore
    .document('users/{userId}/learning_packets/{docId}')
    .onCreate(async (snap, context) => {
        console.log(`📦 New learning packet detected: ${context.params.docId}`);
        
        // ✅ OPTIONAL: Auto-embed can be disabled to let users choose  
        const AUTO_EMBED = false; // Set to true if you want automatic embedding
        
        if (!AUTO_EMBED) {
            console.log(`⏸️ Auto-embedding disabled. Users will manually choose content for AI.`);
            return { success: true, action: 'skipped_auto_embed' };
        }
        
        const data = snap.data();
        
        // For packets, we combine the summary, key concepts, and action items for a richer embedding.
        const summaryText = data.packet?.summary || '';
        const conceptsText = (data.packet?.keyConcepts || [])
            .map(c => `${c.concept}: ${c.definition}`)
            .join('\n');
        const actionItemsText = (data.packet?.actionItems || [])
            .map(item => `• ${item}`)
            .join('\n');
        
        const textToEmbed = `${data.title || 'Untitled Packet'}\n\n${summaryText}\n\nKey Concepts:\n${conceptsText}\n\nAction Items:\n${actionItemsText}`;

        if (!textToEmbed.trim() || textToEmbed.length < 10) {
            console.log(`⚠️ Insufficient content in packet ${context.params.docId}, skipping embedding`);
            return { success: false, reason: 'Insufficient content' };
        }

        return handleEmbedding({
            firestoreDocId: context.params.docId,
            userId: context.params.userId,
            collectionId: data.collectionId,
            documentType: 'packet',
            text: textToEmbed,
            title: data.title || 'Untitled Packet'
        });
    });

// =================================================================
// Manual Embedding Functions (USER-CONTROLLED)
// =================================================================

/**
 * HTTP function to manually add content to AI knowledge base
 * Call: POST /addToKnowledgeBase with { userId, documentIds, documentType }
 */
exports.addToKnowledgeBase = functions.https.onRequest(async (req, res) => {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).send('');
        return;
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const { userId, documentIds, documentType } = req.body;
    
    if (!userId || !documentIds || !Array.isArray(documentIds) || !documentType) {
        return res.status(400).json({ 
            error: 'Missing required fields: userId, documentIds (array), documentType' 
        });
    }
    
    try {
        console.log(`🔧 Manual embedding requested for ${documentIds.length} ${documentType}(s)`);
        
        const results = [];
        const collectionPath = documentType === 'transcript' ? 'transcripts' : 'learning_packets';
        
        for (const documentId of documentIds) {
            try {
                // Fetch the document from Firestore
                const docSnapshot = await admin.firestore()
                    .collection('users').doc(userId)
                    .collection(collectionPath).doc(documentId)
                    .get();
                
                if (!docSnapshot.exists) {
                    results.push({ 
                        documentId, 
                        success: false, 
                        error: 'Document not found' 
                    });
                    continue;
                }
                
                const data = docSnapshot.data();
                
                // Prepare text for embedding
                let textToEmbed = '';
                if (documentType === 'transcript') {
                    textToEmbed = data.content || '';
                } else if (documentType === 'packet') {
                    const summaryText = data.packet?.summary || '';
                    const conceptsText = (data.packet?.keyConcepts || [])
                        .map(c => `${c.concept}: ${c.definition}`)
                        .join('\n');
                    const actionItemsText = (data.packet?.actionItems || [])
                        .map(item => `• ${item}`)
                        .join('\n');
                    textToEmbed = `${data.title || 'Untitled'}\n\n${summaryText}\n\nKey Concepts:\n${conceptsText}\n\nAction Items:\n${actionItemsText}`;
                }
                
                if (!textToEmbed.trim()) {
                    results.push({ 
                        documentId, 
                        success: false, 
                        error: 'No content found to embed' 
                    });
                    continue;
                }
                
                // Generate embedding
                const result = await handleEmbedding({
                    firestoreDocId: documentId,
                    userId: userId,
                    collectionId: data.collectionId,
                    documentType: documentType,
                    text: textToEmbed,
                    title: data.title || 'Untitled'
                });
                
                // Mark as embedded in Firestore
                await docSnapshot.ref.update({
                    embeddedInAI: true,
                    embeddedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                
                results.push({ 
                    documentId, 
                    success: result.success,
                    error: result.error || null
                });
                
            } catch (error) {
                console.error(`Failed to embed document ${documentId}:`, error);
                results.push({ 
                    documentId, 
                    success: false, 
                    error: error.message 
                });
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        
        res.json({ 
            success: successCount > 0,
            successCount,
            failCount,
            results
        });
        
    } catch (error) {
        console.error('Batch embedding failed:', error);
        res.status(500).json({ 
            error: 'Internal server error', 
            message: error.message 
        });
    }
});

/**
 * HTTP function to remove content from AI knowledge base
 * Call: POST /removeFromKnowledgeBase with { userId, documentIds }
 */
exports.removeFromKnowledgeBase = functions.https.onRequest(async (req, res) => {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).send('');
        return;
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const { userId, documentIds } = req.body;
    
    if (!userId || !documentIds || !Array.isArray(documentIds)) {
        return res.status(400).json({ 
            error: 'Missing required fields: userId, documentIds (array)' 
        });
    }
    
    try {
        console.log(`🗑️ Removing ${documentIds.length} documents from AI knowledge base`);
        
        // Remove from vector database
        const indexEndpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/indexEndpoints/${VECTOR_SEARCH_ENDPOINT_ID}`;
        
        const removeRequest = {
            indexEndpoint,
            datapointIds: documentIds
        };
        
        await predictionServiceClient.removeDatapoints(removeRequest);
        console.log(`✅ Successfully removed ${documentIds.length} datapoints from vector index`);
        
        // Update Firestore documents to mark as not embedded
        const batch = admin.firestore().batch();
        
        for (const documentId of documentIds) {
            // Try both transcript and packet collections
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
        
        res.json({ 
            success: true,
            removedCount: documentIds.length
        });
        
    } catch (error) {
        console.error('Remove from knowledge base failed:', error);
        res.status(500).json({ 
            error: 'Internal server error', 
            message: error.message 
        });
    }
});

// =================================================================
// Core Embedding and Storage Logic
// =================================================================

async function handleEmbedding(embeddingData) {
    const { firestoreDocId, text, ...metadata } = embeddingData;

    try {
        console.log(`🧠 Generating embedding for document: ${firestoreDocId}`);
        console.log(`📝 Document type: ${metadata.documentType}`);
        console.log(`👤 User ID: ${metadata.userId}`);
        console.log(`📁 Collection ID: ${metadata.collectionId}`);
        console.log(`📄 Text length: ${text.length} characters`);
        
        // 1. Generate the vector embedding from the text.
        // Jules: Use shared utility function, passing the client
        const embedding = await generateEmbeddingUtil(text, "RETRIEVAL_DOCUMENT", predictionServiceClient);
        console.log(`✅ Successfully generated embedding with ${embedding.length} dimensions`);

        // 2. Prepare the data point to be upserted into the Vector Search index.
        const dataPoint = {
            datapointId: firestoreDocId,
            featureVector: embedding,
            restricts: [
                { namespace: 'userId', allowList: [metadata.userId] },
                { namespace: 'collectionId', allowList: [metadata.collectionId] },
                { namespace: 'documentType', allowList: [metadata.documentType] }
            ]
        };

        // 3. Upsert the data point to the Vertex AI Vector Search index.
        console.log(`📤 Upserting vector to index endpoint: ${VECTOR_SEARCH_ENDPOINT_ID}`);
        await upsertToVectorSearch([dataPoint]);
        console.log(`🎉 Successfully upserted vector for document: ${firestoreDocId}`);

        return { success: true, documentId: firestoreDocId, embeddingDimensions: embedding.length };

    } catch (error) {
        console.error(`💥 Failed to process embedding for ${firestoreDocId}:`, {
            message: error.message,
            code: error.code,
            details: error.details,
            stack: error.stack?.split('\n').slice(0, 3).join('\n')
        });
        
        return { success: false, error: error.message, documentId: firestoreDocId };
    }
}

// Jules: Removed local generateEmbedding function as it's now in shared/embeddingUtils.js

/**
 * Upserts data points to the Vector Search index.
 */
async function upsertToVectorSearch(dataPoints) {
    const indexEndpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/indexEndpoints/${VECTOR_SEARCH_ENDPOINT_ID}`;
    
    const request = {
        indexEndpoint,
        datapoints: dataPoints,
    };
    
    console.log(`🚀 Upserting ${dataPoints.length} datapoint(s) to: ${indexEndpoint}`);
    
    try {
        await predictionServiceClient.upsertDatapoints(request);
        console.log(`✅ Successfully upserted ${dataPoints.length} datapoint(s)`);
    } catch (error) {
        console.error(`❌ Upsert failed:`, {
            message: error.message,
            code: error.code,
            details: error.details
        });
        throw error;
    }
}