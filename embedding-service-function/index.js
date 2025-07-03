// File: embedding-service-function/index.js
// Complete fixed version with correct configuration

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { PredictionServiceClient } = require('@google-cloud/aiplatform');

// --- Configuration ---
const PROJECT_ID = 'tab-audio-app'; 
const LOCATION = 'europe-west2'; 
const PUBLISHER = 'google';
const EMBEDDING_MODEL = 'gemini-embedding-001';

// ✅ FIXED: Updated with correct IDs
const VECTOR_SEARCH_INDEX_ID = '7989579253001748480';         // Base index ID (for upserts)
const VECTOR_SEARCH_ENDPOINT_ID = '6958254938333904896';      // Endpoint ID
const DEPLOYED_INDEX_ID = 'tab_audio_app_1751241281157';     // ✅ Deployed index ID (for queries if needed)

admin.initializeApp({ projectId: PROJECT_ID });

// Initialize the Vertex AI Client
const clientOptions = { apiEndpoint: `${LOCATION}-aiplatform.googleapis.com` };
const predictionServiceClient = new PredictionServiceClient(clientOptions);

// =================================================================
// Firestore Triggers
// =================================================================

/**
 * Triggers when a new transcript is created.
 */
exports.onTranscriptCreated = functions.firestore
    .document('users/{userId}/transcripts/{docId}')
    .onCreate(async (snap, context) => {
        console.log(`🎙️ New transcript detected: ${context.params.docId}`);
        const data = snap.data();
        
        // We use the full document content for the embedding.
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
 */
exports.onPacketCreated = functions.firestore
    .document('users/{userId}/learning_packets/{docId}')
    .onCreate(async (snap, context) => {
        console.log(`📦 New learning packet detected: ${context.params.docId}`);
        const data = snap.data();
        
        // For packets, we combine the summary and key concepts for a richer embedding.
        const summaryText = data.packet?.summary || '';
        const conceptsText = (data.packet?.keyConcepts || [])
            .map(c => `${c.concept}: ${c.definition}`)
            .join('\n');
        
        const textToEmbed = `${data.title || 'Untitled Packet'}\n\n${summaryText}\n\n${conceptsText}`;

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
        const embedding = await generateEmbedding(text);
        console.log(`✅ Successfully generated embedding with ${embedding.length} dimensions`);

        // 2. Prepare the data point to be upserted into the Vector Search index.
        const dataPoint = {
            datapointId: firestoreDocId, // Use the Firestore document ID as the unique ID in the index
            featureVector: embedding,
            restricts: [ // Metadata for filtering queries
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
        
        // Log to Firestore for debugging (optional)
        try {
            await admin.firestore().collection('embedding_errors').add({
                documentId: firestoreDocId,
                error: error.message,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                metadata
            });
        } catch (logError) {
            console.error('Failed to log error to Firestore:', logError);
        }
        
        return { success: false, error: error.message, documentId: firestoreDocId };
    }
}

/**
 * Generates an embedding for a given text string.
 */
async function generateEmbedding(text) {
    const endpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/${PUBLISHER}/models/${EMBEDDING_MODEL}`;
    
    const instance = { 
        content: text,
        task_type: "RETRIEVAL_DOCUMENT"  // For documents being stored
    };
    
    const request = { endpoint, instances: [instance] };
    
    console.log(`📡 Making embedding request to: ${endpoint}`);
    
    try {
        const [response] = await predictionServiceClient.predict(request);
        
        // Extract embedding from response
        const embedding = response.predictions[0].structValue.fields.embedding.listValue.values.map(v => v.numberValue);
        
        console.log(`✅ Embedding generated successfully: ${embedding.length} dimensions`);
        return embedding;
    } catch (error) {
        console.error(`❌ Embedding generation failed:`, {
            message: error.message,
            code: error.code,
            details: error.details
        });
        throw error;
    }
}

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

// =================================================================
// Optional: Manual embedding function for testing
// =================================================================

/**
 * HTTP function to manually trigger embedding for existing documents
 * Call: POST /manualEmbedding with { userId, documentId, documentType }
 */
exports.manualEmbedding = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method not allowed');
    }
    
    const { userId, documentId, documentType } = req.body;
    
    if (!userId || !documentId || !documentType) {
        return res.status(400).json({ 
            error: 'Missing required fields: userId, documentId, documentType' 
        });
    }
    
    try {
        console.log(`🔧 Manual embedding requested for ${documentType}: ${documentId}`);
        
        // Fetch the document from Firestore
        let docSnapshot;
        if (documentType === 'transcript') {
            docSnapshot = await admin.firestore()
                .collection('users').doc(userId)
                .collection('transcripts').doc(documentId)
                .get();
        } else if (documentType === 'packet') {
            docSnapshot = await admin.firestore()
                .collection('users').doc(userId)
                .collection('learning_packets').doc(documentId)
                .get();
        } else {
            return res.status(400).json({ error: 'Invalid documentType. Must be "transcript" or "packet"' });
        }
        
        if (!docSnapshot.exists) {
            return res.status(404).json({ error: 'Document not found' });
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
            textToEmbed = `${data.title || 'Untitled'}\n\n${summaryText}\n\n${conceptsText}`;
        }
        
        if (!textToEmbed.trim()) {
            return res.status(400).json({ error: 'No content found to embed' });
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
        
        res.json(result);
        
    } catch (error) {
        console.error('Manual embedding failed:', error);
        res.status(500).json({ 
            error: 'Internal server error', 
            message: error.message 
        });
    }
});