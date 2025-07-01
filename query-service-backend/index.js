// File: query-service-backend/index.js
// This service handles the "Chat with your Library" feature.

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { PredictionServiceClient } = require('@google-cloud/aiplatform');

// --- Configuration ---
const PORT = process.env.PORT || 8080;
const PROJECT_ID = 'tab-audio-app'; 
const LOCATION = 'europe-west2'; 
const PUBLISHER = 'google';
const EMBEDDING_MODEL = 'gemini-embedding-001'; // Replaced retired 'textembedding-gecko@003'

// You will need to provide these IDs from your Vertex AI setup
const VECTOR_SEARCH_ENDPOINT_ID = '6958254938333904896'; 
const DEPLOYED_INDEX_ID = '7989579253001748480'; // The ID of the DEPLOYED index on the endpoint

// Initialize Firebase and AI Clients
admin.initializeApp();
const db = admin.firestore();

const API_KEY = process.env.GEMINI_API_KEY;
let textGenerationModel;
if (API_KEY) {
    const genAI = new GoogleGenerativeAI(API_KEY);
    textGenerationModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
} else {
    console.error("GEMINI_API_KEY environment variable not set. The chat service will not work.");
}

const clientOptions = { apiEndpoint: `${LOCATION}-aiplatform.googleapis.com` };
const predictionServiceClient = new PredictionServiceClient(clientOptions);

// Initialize Express app
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());


// =================================================================
//  Main Chat Endpoint
// =================================================================
app.post('/chat', async (req, res) => {
    console.log("Received request for /chat");

    const { userId, question, collectionIds = [] } = req.body;
    if (!userId || !question) {
        return res.status(400).json({ error: "Missing required fields: userId and question are required." });
    }
    if (!textGenerationModel) {
        return res.status(500).json({ error: "Server is not configured with an API key." });
    }
    
    try {
        const relevantDocs = await findRelevantDocuments(userId, question, collectionIds);

        if (relevantDocs.length === 0) {
            return res.status(200).json({ answer: "I couldn't find any relevant information in your library to answer that question.", sources: [] });
        }

        const answer = await generateChatResponse(question, relevantDocs);

        res.status(200).json({ answer: answer, sources: relevantDocs });

    } catch (error) {
        console.error("Error during /chat processing:", error);
        res.status(500).json({ error: "An internal error occurred while processing your chat request." });
    }
});


// =================================================================
//  Helper Functions
// =================================================================

/**
 * Generates an embedding for a given text string.
 */
async function generateEmbedding(text) {
    const endpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/${PUBLISHER}/models/${EMBEDDING_MODEL}`;
    // --- ADD THE TASK_TYPE PARAMETER ---
    const instance = { 
        content: text,
        task_type: "RETRIEVAL_QUERY" 
    };
    const request = { endpoint, instances: [instance] };
    
    const [response] = await predictionServiceClient.predict(request);
        
        // --- UPDATE THE RESPONSE PARSING ---
        // The new model uses 'embedding' (singular) instead of the complex 'embeddings' path.
        return response.predictions[0].structValue.fields.embedding.listValue.values.map(v => v.numberValue);
    }


// In query-service-backend/index.js
// PASTE THIS ENTIRE FUNCTION INTO THE HELPER FUNCTIONS SECTION

/**
 * Finds relevant documents by querying the vector database.
 */
async function findRelevantDocuments(userId, question, collectionIds = []) {
    console.log(`Finding relevant documents for question: "${question}"`);

    const questionEmbedding = await generateEmbedding(question);

    const endpointPath = `projects/${PROJECT_ID}/locations/${LOCATION}/indexEndpoints/${VECTOR_SEARCH_ENDPOINT_ID}`;

    const filters = [{ namespace: 'userId', allow: [userId] }];
    if (collectionIds && collectionIds.length > 0) {
        filters.push({ namespace: 'collectionId', allow: collectionIds });
    }

    const findNeighborsRequest = {
        endpoint: endpointPath,
        queries: [{
            embedding: questionEmbedding,
            neighborCount: 5,
            restricts: filters,
            deployedIndexId: DEPLOYED_INDEX_ID
        }]
    };

    const [findNeighborsResponse] = await predictionServiceClient.findNeighbors(findNeighborsRequest);
    const neighbors = findNeighborsResponse.nearestNeighbors[0]?.neighbors || [];

    if (neighbors.length === 0) { return []; }

    const docIdsByType = { transcripts: [], learning_packets: [] };
    neighbors.forEach(n => {
        const docId = n.datapoint.datapointId;
        const typeRestriction = n.datapoint.restricts.find(r => r.namespace === 'documentType');
        const docType = typeRestriction ? typeRestriction.allow[0] : null;

        if (docType === 'transcript') {
            docIdsByType.transcripts.push(docId);
        } else if (docType === 'packet') {
            docIdsByType.learning_packets.push(docId);
        }
    });

    console.log("Fetching documents from Firestore by type:", docIdsByType);
    const docPromises = [];
    const foundDocs = [];

    if (docIdsByType.transcripts.length > 0) {
        const transcriptsRef = db.collection(`users/${userId}/transcripts`);
        const transcriptQuery = transcriptsRef.where(admin.firestore.FieldPath.documentId(), 'in', docIdsByType.transcripts);
        docPromises.push(transcriptQuery.get());
    }
    if (docIdsByType.learning_packets.length > 0) {
        const packetsRef = db.collection(`users/${userId}/learning_packets`);
        const packetQuery = packetsRef.where(admin.firestore.FieldPath.documentId(), 'in', docIdsByType.learning_packets);
        docPromises.push(packetQuery.get());
    }

    const querySnapshots = await Promise.all(docPromises);
    querySnapshots.forEach(snapshot => {
        snapshot.forEach(docSnap => {
            if (docSnap.exists) {
                foundDocs.push({ id: docSnap.id, ...docSnap.data() });
            }
        });
    });

    return foundDocs;
}

/**
 * Generates a final, synthesized answer based on the user's question and retrieved documents.
 *
 * REFINED: This version now properly formats the context for learning packets
 * instead of using JSON.stringify. It creates a clean, readable block of text
 * from the summary and key concepts, improving the LLM's ability to understand the source.
 */
async function generateChatResponse(question, documents) {
    console.log("Synthesizing final answer from relevant documents.");

    // --- NEW LOGIC START ---
    const context = documents.map(doc => {
        let docContent = '';
        if (doc.content) { // This is a transcript
            docContent = doc.content;
        } else if (doc.packet) { // This is a learning packet
            const summaryText = doc.packet.summary || '';
            const conceptsText = (doc.packet.keyConcepts || [])
              .map(c => `- ${c.concept}: ${c.definition}`)
              .join('\n');
            docContent = `Summary:\n${summaryText}\n\nKey Concepts:\n${conceptsText}`;
        }
        
        return `
Source (Title: ${doc.title}):
---
${docContent.trim()}
---
        `;
    }).join('\n\n');
    // --- NEW LOGIC END ---

    const prompt = `
        You are a helpful learning assistant. Your task is to answer the user's question based *only* on the provided context from their personal library.
        Do not use any external knowledge. If the answer cannot be found in the provided sources, state that clearly.

        Here is the user's question:
        "${question}"

        Here is the context from the user's library:
        ${context}

        Please provide a clear and concise answer to the question based on the sources.
    `;

    try {
        const result = await textGenerationModel.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Error in generateChatResponse:", error);
        return "Sorry, I encountered an error while trying to generate a response.";
    }
}


// Start the server
app.listen(PORT, () => {
    console.log(`Query Service listening on port ${PORT}`);
});
