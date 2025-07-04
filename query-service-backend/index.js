// File: query-service-backend/index.js
// FIXED VERSION - Resolves embedding generation and search issues

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
const EMBEDDING_MODEL = 'gemini-embedding-001';

// Vector Search Configuration
const VECTOR_SEARCH_ENDPOINT_ID = '6958254938333904896';
const DEPLOYED_INDEX_ID = 'tab_audio_app_1751241281157';

// ✅ FIX: Initialize Firebase with explicit project ID
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

// Initialize AI Clients
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

// Health check endpoint
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: 'Query Service is running',
        timestamp: new Date().toISOString(),
        model: EMBEDDING_MODEL,
        project: PROJECT_ID
    });
});

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
        console.log(`Chat request from user: ${userId}`);
        console.log(`Question: ${question}`);
        console.log(`Collection filter:`, collectionIds);
        
        const relevantDocs = await findRelevantDocuments(userId, question, collectionIds);
        console.log(`Found ${relevantDocs.length} relevant documents`);

        if (relevantDocs.length === 0) {
            return res.status(200).json({ 
                answer: "I couldn't find any relevant information in your AI Knowledge Base to answer that question. Make sure you've added content to your AI Knowledge Base using the 'Add to AI Knowledge' button in your library.", 
                sources: [] 
            });
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
 * ✅ FIXED: Generates an embedding using correct format for gemini-embedding-001
 */
async function generateEmbedding(text) {
    const endpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/${PUBLISHER}/models/${EMBEDDING_MODEL}`;
    
    // ✅ FIX: Updated request format for gemini-embedding-001
    const instance = { 
        content: text,
        task_type: "RETRIEVAL_QUERY"  // For query embeddings
    };
    const request = { endpoint, instances: [instance] };
    
    console.log(`📡 Generating embedding for query`);
    
    try {
        const [response] = await predictionServiceClient.predict(request);
        
        // ✅ FIX: Extract embedding from correct response structure
        const embedding = response.predictions[0].structValue.fields.embedding.listValue.values.map(v => v.numberValue);
        
        console.log(`✅ Query embedding generated: ${embedding.length} dimensions`);
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
 * ✅ FIXED: Finds relevant documents using proper vector search format
 */
async function findRelevantDocuments(userId, question, collectionIds) {
    try {
        // Step 1: Generate embedding for the question
        console.log('Generating embedding for question:', question);
        let questionEmbedding;
        try {
            questionEmbedding = await generateEmbedding(question);
            console.log('Embedding generated successfully, dimension:', questionEmbedding.length);
        } catch (embeddingError) {
            console.error('Error generating embedding:', embeddingError);
            throw embeddingError;
        }
        
        // Step 2: Construct the findNeighbors request
        const indexEndpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/indexEndpoints/${VECTOR_SEARCH_ENDPOINT_ID}`;
        
        // ✅ FIX: Updated restricts format for proper filtering
        const restricts = [
            {
                namespace: 'userId',
                allowList: [userId]  // Use allowList instead of allow
            }
        ];
        
        // Add collectionId filter if collectionIds array is not empty
        if (collectionIds && collectionIds.length > 0) {
            restricts.push({
                namespace: 'collectionId',
                allowList: collectionIds  // Use allowList instead of allow
            });
        }
        
        // ✅ FIX: Proper findNeighbors request structure
        const findNeighborsRequest = {
            indexEndpoint,
            deployedIndexId: DEPLOYED_INDEX_ID,
            queries: [{
                datapoint: {
                    datapointId: 'query-' + Date.now(),
                    featureVector: questionEmbedding
                },
                neighborCount: 5,
                restricts: restricts
            }]
        };
        
        console.log('FindNeighbors request structure:');
        console.log('- Index endpoint:', indexEndpoint);
        console.log('- Deployed index ID:', DEPLOYED_INDEX_ID);
        console.log('- Embedding length:', questionEmbedding.length);
        console.log('- Restricts:', JSON.stringify(restricts, null, 2));
        
        // Step 3: Query the vector database
        console.log('🔍 Querying vector database...');
        const [response] = await predictionServiceClient.findNeighbors(findNeighborsRequest);
        
        // Step 4: Parse the response to get document IDs and types
        if (!response.nearestNeighbors || response.nearestNeighbors.length === 0 || 
            !response.nearestNeighbors[0].neighbors) {
            console.log('No neighbors found in vector database');
            return [];
        }
        
        const neighbors = response.nearestNeighbors[0].neighbors;
        if (!neighbors || neighbors.length === 0) {
            console.log('Empty neighbors array');
            return [];
        }
        
        console.log(`Found ${neighbors.length} vector neighbors`);
        
        // Group document IDs by their type for efficient batch fetching
        const transcriptIds = [];
        const learningPacketIds = [];
        
        neighbors.forEach((neighbor, index) => {
            const datapointId = neighbor.datapoint.datapointId;
            console.log(`Neighbor ${index + 1}: ${datapointId} (distance: ${neighbor.distance})`);
            
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
            
            // Group by document type
            if (documentType === 'transcript') {
                transcriptIds.push(datapointId);
            } else if (documentType === 'packet') {
                learningPacketIds.push(datapointId);
            } else {
                // Fallback: try both collections to find the document
                console.log(`⚠️ Unknown document type for ${datapointId}, will search both collections`);
                transcriptIds.push(datapointId);
                learningPacketIds.push(datapointId);
            }
        });
        
        console.log(`Grouped results: ${transcriptIds.length} transcripts, ${learningPacketIds.length} packets`);
        
        // Step 5: Fetch the actual documents from Firestore
        const relevantDocs = [];
        
        // Fetch transcripts
        for (const transcriptId of transcriptIds) {
            try {
                const transcriptDoc = await db
                    .collection('users').doc(userId)
                    .collection('transcripts').doc(transcriptId)
                    .get();
                
                if (transcriptDoc.exists) {
                    const data = transcriptDoc.data();
                    relevantDocs.push({
                        id: transcriptId,
                        type: 'transcript',
                        title: data.title || 'Untitled Transcript',
                        content: data.content || '',
                        collectionId: data.collectionId,
                        createdAt: data.createdAt
                    });
                    console.log(`✅ Found transcript: ${data.title}`);
                } else {
                    console.log(`⚠️ Transcript not found: ${transcriptId}`);
                }
            } catch (error) {
                console.error(`Error fetching transcript ${transcriptId}:`, error);
            }
        }
        
        // Fetch learning packets
        for (const packetId of learningPacketIds) {
            try {
                const packetDoc = await db
                    .collection('users').doc(userId)
                    .collection('learning_packets').doc(packetId)
                    .get();
                
                if (packetDoc.exists) {
                    const data = packetDoc.data();
                    const summary = data.packet?.summary || '';
                    const concepts = (data.packet?.keyConcepts || [])
                        .map(c => `${c.concept}: ${c.definition}`)
                        .join('\n');
                    const actionItems = (data.packet?.actionItems || [])
                        .map(item => `• ${item}`)
                        .join('\n');
                    
                    let content = summary;
                    if (concepts) content += `\n\nKey Concepts:\n${concepts}`;
                    if (actionItems) content += `\n\nAction Items:\n${actionItems}`;
                    
                    relevantDocs.push({
                        id: packetId,
                        type: 'packet',
                        title: data.title || 'Untitled Packet',
                        content: content,
                        collectionId: data.collectionId,
                        createdAt: data.createdAt
                    });
                    console.log(`✅ Found learning packet: ${data.title}`);
                } else {
                    console.log(`⚠️ Learning packet not found: ${packetId}`);
                }
            } catch (error) {
                console.error(`Error fetching learning packet ${packetId}:`, error);
            }
        }
        
        console.log(`Final result: ${relevantDocs.length} documents retrieved from Firestore`);
        return relevantDocs;
        
    } catch (error) {
        console.error("Error in findRelevantDocuments:", error);
        throw error;
    }
}

/**
 * Generates a chat response using the relevant documents as context
 */
async function generateChatResponse(question, relevantDocs) {
    // Prepare context from relevant documents
    const context = relevantDocs.map((doc, index) => {
        return `Source ${index + 1} (${doc.type}): ${doc.title}\n${doc.content.substring(0, 1000)}...`;
    }).join('\n\n');

    const prompt = `
        You are a helpful AI assistant that answers questions based on the user's personal library content.
        Your task is to answer the user's question based *only* on the provided context from their personal library.
        Do not use any external knowledge. If the answer cannot be found in the provided sources, state that clearly.

        Here is the user's question:
        "${question}"

        Here is the context from the user's library:
        ${context}

        Please provide a clear and concise answer to the question based on the sources above. If you reference specific information, mention which source it came from.
    `;

    try {
        console.log('🤖 Generating AI response...');
        const result = await textGenerationModel.generateContent(prompt);
        const response = await result.response;
        const answer = response.text();
        console.log('✅ AI response generated successfully');
        return answer;
    } catch (error) {
        console.error("Error in generateChatResponse:", error);
        return "Sorry, I encountered an error while trying to generate a response.";
    }
}

// Start the server
app.listen(PORT, () => {
    console.log(`Query Service listening on port ${PORT}`);
    console.log(`Project ID: ${PROJECT_ID}`);
    console.log(`Embedding Model: ${EMBEDDING_MODEL}`);
    console.log(`Vector Search Endpoint: ${VECTOR_SEARCH_ENDPOINT_ID}`);
    console.log(`Deployed Index: ${DEPLOYED_INDEX_ID}`);
});