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


/**
 * Finds relevant documents for a user's question using vector search and fetches them from Firestore.
 * @param {string} userId - The ID of the user
 * @param {string} question - The user's question
 * @param {Array<string>} collectionIds - Array of collection IDs to filter by (can be empty)
 * @returns {Promise<Array>} Array of relevant Firestore documents
 */
async function findRelevantDocuments(userId, question, collectionIds) {
    try {
        // Step 1: Generate embedding for the question
        const questionEmbedding = await generateEmbedding(question);
        
        // Step 2: Construct the findNeighbors request
        const indexEndpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/indexEndpoints/${VECTOR_SEARCH_ENDPOINT_ID}`;
        
        // Build the restricts array for filtering
        const restricts = [
            {
                namespace: 'userId',
                allowList: [userId]
            }
        ];
        
        // Add collectionId filter if collectionIds array is not empty
        if (collectionIds && collectionIds.length > 0) {
            restricts.push({
                namespace: 'collectionId',
                allowList: collectionIds
            });
        }
        
        const findNeighborsRequest = {
            endpoint: indexEndpoint,
            deployedIndexId: DEPLOYED_INDEX_ID,  // MOVED TO TOP LEVEL
            queries: [{
                datapoint: {
                    featureVector: questionEmbedding
                },
                neighborCount: 5,
                restricts: restricts
            }]
        };
        
        // Step 3: Query the vector database
        const [response] = await predictionServiceClient.findNeighbors(findNeighborsRequest);
        
        // Step 4: Parse the response to get document IDs and types
        if (!response.nearestNeighbors || response.nearestNeighbors.length === 0 || 
            !response.nearestNeighbors[0].neighbors) {
            return [];
        }
        
        const neighbors = response.nearestNeighbors[0].neighbors;
        if (!neighbors || neighbors.length === 0) {
            return [];
        }
        
        // Group document IDs by their type for efficient batch fetching
        const transcriptIds = [];
        const learningPacketIds = [];
        
        neighbors.forEach(neighbor => {
            const datapointId = neighbor.datapoint.datapointId;
            
            // Extract documentType from the restricts metadata
            let documentType = null;
            if (neighbor.datapoint.restricts) {
                for (const restrict of neighbor.datapoint.restricts) {
                    if (restrict.namespace === 'documentType' && restrict.allowList && restrict.allowList.length > 0) {
                        documentType = restrict.allowList[0];
                        break;
                    }
                }
            }
            
            // Group IDs by document type
            if (documentType === 'transcript') {
                transcriptIds.push(datapointId);
            } else if (documentType === 'learning_packet') {
                learningPacketIds.push(datapointId);
            }
        });
        
        // Step 5: Fetch documents from Firestore using batch queries
        const allDocuments = [];
        
        // Fetch transcripts if any
        if (transcriptIds.length > 0) {
            const transcriptsSnapshot = await db
                .collection('users')
                .doc(userId)
                .collection('transcripts')
                .where(admin.firestore.FieldPath.documentId(), 'in', transcriptIds)
                .get();
            
            transcriptsSnapshot.forEach(doc => {
                allDocuments.push({ id: doc.id, ...doc.data() });
            });
        }
        
        // Fetch learning packets if any
        if (learningPacketIds.length > 0) {
            const learningPacketsSnapshot = await db
                .collection('users')
                .doc(userId)
                .collection('learning_packets')
                .where(admin.firestore.FieldPath.documentId(), 'in', learningPacketIds)
                .get();
            
            learningPacketsSnapshot.forEach(doc => {
                allDocuments.push({ id: doc.id, ...doc.data() });
            });
        }
        
        return allDocuments;
        
    } catch (error) {
        console.error('Error in findRelevantDocuments:', error);
        throw error;
    }
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