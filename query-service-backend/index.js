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
const EMBEDDING_MODEL = 'textembedding-gecko@003';

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
    const instance = { content: text };
    const request = { endpoint, instances: [instance] };

    const [response] = await predictionServiceClient.predict(request);
    return response.predictions[0].structValue.fields.embeddings.structValue.fields.values.listValue.values.map(v => v.numberValue);
}


/**
 * Finds relevant documents by querying the vector database.
 */
async function findRelevantDocuments(userId, question, collectionIds = []) {
    console.log(`Finding relevant documents for question: "${question}"`);

    const questionEmbedding = await generateEmbedding(question);

    const endpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/indexEndpoints/${VECTOR_SEARCH_ENDPOINT_ID}`;
    
    // Construct the filters for the vector search query
    const filters = [{ namespace: 'userId', allow: [userId] }];
    if (collectionIds && collectionIds.length > 0) {
        filters.push({ namespace: 'collectionId', allow: collectionIds });
    }

    const findNeighborsRequest = {
        indexEndpoint: endpoint,
        deployedIndexId: DEPLOYED_INDEX_ID,
        queries: [{
            embedding: questionEmbedding,
            neighborCount: 5, // Find the top 5 most relevant documents
            restricts: filters
        }]
    };
    
    const [findNeighborsResponse] = await predictionServiceClient.findNeighbors(findNeighborsRequest);
    const neighbors = findNeighborsResponse.nearestNeighbors[0]?.neighbors || [];

    if (neighbors.length === 0) {
        return [];
    }

    // Extract the document IDs from the neighbors
    const docIds = neighbors.map(n => n.datapoint.datapointId);
    
    // Fetch the full documents from Firestore using the retrieved IDs
    console.log(`Fetching documents from Firestore: ${docIds.join(', ')}`);
    const docPromises = [];
    
    // Check both transcripts and packets collections
    const transcriptsRef = db.collection(`users/${userId}/transcripts`);
    const packetsRef = db.collection(`users/${userId}/learning_packets`);
    
    docIds.forEach(id => {
        docPromises.push(transcriptsRef.doc(id).get());
        docPromises.push(packetsRef.doc(id).get());
    });

    const docSnapshots = await Promise.all(docPromises);
    const foundDocs = [];
    docSnapshots.forEach(docSnap => {
        if (docSnap.exists) {
            foundDocs.push({ id: docSnap.id, ...docSnap.data() });
        }
    });

    return foundDocs;
}

/**
 * Generates a final, synthesized answer based on the user's question and retrieved documents.
 */
async function generateChatResponse(question, documents) {
    console.log("Synthesizing final answer from relevant documents.");

    const context = documents.map(doc => `
        Source (Title: ${doc.title}):
        ---
        ${doc.content || JSON.stringify(doc.packet)}
        ---
    `).join('\n\n');

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
