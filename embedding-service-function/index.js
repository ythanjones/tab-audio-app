// File: embedding-service-function/index.js
// This Cloud Function automatically generates and stores vector embeddings
// for new documents saved to the user's library.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { PredictionServiceClient } = require('@google-cloud/aiplatform');

// --- Configuration ---
// IMPORTANT: You must replace these placeholders with your actual project details.
const PROJECT_ID = 'tab-audio-app'; 
const LOCATION = 'europe-west2'; 
const PUBLISHER = 'google';
const EMBEDDING_MODEL = 'gemini-embedding-001';

// You will get these values after creating the index and endpoint in the Google Cloud Console.
const VECTOR_SEARCH_INDEX_ID = '7989579253001748480';
const VECTOR_SEARCH_ENDPOINT_ID = '6958254938333904896';
// --------------------

admin.initializeApp();

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
        console.log(`New transcript detected: ${context.params.docId}`);
        const data = snap.data();
        
        // We use the full document content for the embedding.
        const textToEmbed = data.content;
        
        return handleEmbedding({
            firestoreDocId: context.params.docId,
            userId: context.params.userId,
            collectionId: data.collectionId,
            documentType: 'transcript',
            text: textToEmbed,
            title: data.title
        });
    });

/**
 * Triggers when a new learning packet is created.
 */
exports.onPacketCreated = functions.firestore
    .document('users/{userId}/learning_packets/{docId}')
    .onCreate(async (snap, context) => {
        console.log(`New learning packet detected: ${context.params.docId}`);
        const data = snap.data();
        
        // For packets, we combine the summary and key concepts for a richer embedding.
        const summaryText = data.packet.summary || '';
        const conceptsText = (data.packet.keyConcepts || [])
            .map(c => `${c.concept}: ${c.definition}`)
            .join('\n');
        
        const textToEmbed = `${data.title}\n\n${summaryText}\n\n${conceptsText}`;

        return handleEmbedding({
            firestoreDocId: context.params.docId,
            userId: context.params.userId,
            collectionId: data.collectionId,
            documentType: 'packet',
            text: textToEmbed,
            title: data.title
        });
    });


// =================================================================
// Core Embedding and Storage Logic
// =================================================================

async function handleEmbedding(embeddingData) {
    const { firestoreDocId, text, ...metadata } = embeddingData;

    try {
        // 1. Generate the vector embedding from the text.
        console.log(`Generating embedding for document: ${firestoreDocId}`);
        const embedding = await generateEmbedding(text);
        console.log(`Successfully generated embedding.`);

        // 2. Prepare the data point to be upserted into the Vector Search index.
        const dataPoint = {
            id: firestoreDocId, // Use the Firestore document ID as the unique ID in the index
            embedding: embedding,
            restricts: [ // Metadata for filtering queries
                { namespace: 'userId', allow: [metadata.userId] },
                { namespace: 'collectionId', allow: [metadata.collectionId] },
                { namespace: 'documentType', allow: [metadata.documentType] }
            ]
        };

        // 3. Upsert the data point to the Vertex AI Vector Search index.
        console.log(`Upserting vector to index: ${VECTOR_SEARCH_INDEX_ID}`);
        await upsertToVectorSearch([dataPoint]);
        console.log(`Successfully upserted vector for document: ${firestoreDocId}`);

        return { success: true };

    } catch (error) {
        console.error(`Failed to process embedding for ${firestoreDocId}:`, error);
        // We could add error logging to a specific collection in Firestore here if needed.
        return { success: false, error: error.message };
    }
}

async function generateEmbedding(text) {
    const endpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/${PUBLISHER}/models/${EMBEDDING_MODEL}`;
    const instance = { content: text };
    const request = { endpoint, instances: [instance] };
    
    const [response] = await predictionServiceClient.predict(request);
    return response.predictions[0].structValue.fields.embedding.listValue.values.map(v => v.numberValue);
}

async function upsertToVectorSearch(dataPoints) {
    const indexEndpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/indexEndpoints/${VECTOR_SEARCH_ENDPOINT_ID}`;
    const request = {
        indexEndpoint,
        datapoints: dataPoints,
    };
    await predictionServiceClient.upsertDatapoints(request);
}
