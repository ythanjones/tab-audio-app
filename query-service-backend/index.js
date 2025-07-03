// File: query-service-backend/index.js
// Complete fixed version with correct DEPLOYED_INDEX_ID usage

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

// ✅ FIXED: Updated with correct deployed index ID
const VECTOR_SEARCH_ENDPOINT_ID = '6958254938333904896';        // Endpoint ID  
const DEPLOYED_INDEX_ID = 'tab_audio_app_1751241281157';       // ✅ CORRECT deployed index ID for queries

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

// ✅ Debug endpoint to test configuration
app.get('/debug', async (req, res) => {
    console.log("🔍 Debug endpoint called");
    
    try {
        const debugInfo = {
            timestamp: new Date().toISOString(),
            configuration: {
                PROJECT_ID,
                LOCATION,
                VECTOR_SEARCH_ENDPOINT_ID,
                DEPLOYED_INDEX_ID,
                EMBEDDING_MODEL,
                hasApiKey: !!API_KEY
            },
            endpoints: {
                embeddingEndpoint: `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/${PUBLISHER}/models/${EMBEDDING_MODEL}`,
                vectorSearchEndpoint: `projects/${PROJECT_ID}/locations/${LOCATION}/indexEndpoints/${VECTOR_SEARCH_ENDPOINT_ID}`
            }
        };
        
        // Test embedding generation
        try {
            console.log("Testing embedding generation...");
            const testEmbedding = await generateEmbedding("test query for debugging");
            debugInfo.embeddingTest = {
                success: true,
                dimensions: testEmbedding.length
            };
            console.log(`✅ Embedding test successful: ${testEmbedding.length} dimensions`);
        } catch (embeddingError) {
            console.error("❌ Embedding test failed:", embeddingError);
            debugInfo.embeddingTest = {
                success: false,
                error: embeddingError.message
            };
        }
        
        // Check Firestore data
        try {
            const transcriptsCount = await db.collectionGroup('transcripts').count().get();
            const packetsCount = await db.collectionGroup('learning_packets').count().get();
            debugInfo.firestoreData = {
                transcripts: transcriptsCount.data().count,
                packets: packetsCount.data().count
            };
        } catch (firestoreError) {
            debugInfo.firestoreData = {
                error: firestoreError.message
            };
        }
        
        res.status(200).json(debugInfo);
    } catch (error) {
        console.error("❌ Debug endpoint error:", error);
        res.status(500).json({ 
            error: error.message,
            stack: error.stack
        });
    }
});

// =================================================================
//  Main Chat Endpoint with Enhanced Logging
// =================================================================
app.post('/chat', async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    console.log(`🚀 [${requestId}] Received chat request`);

    const { userId, question, collectionIds = [] } = req.body;
    
    console.log(`📝 [${requestId}] Request details:`, {
        userId: userId ? `${userId.substring(0, 8)}...` : 'missing',
        question: question ? `"${question.substring(0, 50)}${question.length > 50 ? '...' : ''}"` : 'missing',
        collectionIds: collectionIds.length > 0 ? collectionIds : 'none'
    });
    
    if (!userId || !question) {
        console.log(`❌ [${requestId}] Missing required fields`);
        return res.status(400).json({ error: "Missing required fields: userId and question are required." });
    }
    
    if (!textGenerationModel) {
        console.log(`❌ [${requestId}] Server not configured with API key`);
        return res.status(500).json({ error: "Server is not configured with an API key." });
    }
    
    try {
        console.log(`🔍 [${requestId}] Starting document search...`);
        const relevantDocs = await findRelevantDocuments(userId, question, collectionIds, requestId);

        if (relevantDocs.length === 0) {
            console.log(`⚠️ [${requestId}] No relevant documents found`);
            return res.status(200).json({ 
                answer: "I couldn't find any relevant information in your library to answer that question.", 
                sources: [],
                debug: { requestId, documentsFound: 0 }
            });
        }

        console.log(`✅ [${requestId}] Found ${relevantDocs.length} relevant documents`);
        const answer = await generateChatResponse(question, relevantDocs, requestId);

        console.log(`🎉 [${requestId}] Chat response generated successfully`);
        res.status(200).json({ 
            answer: answer, 
            sources: relevantDocs,
            debug: { requestId, documentsFound: relevantDocs.length }
        });

    } catch (error) {
        console.error(`💥 [${requestId}] Error during chat processing:`, {
            message: error.message,
            code: error.code,
            details: error.details,
            stack: error.stack?.split('\n').slice(0, 5).join('\n') // First 5 lines of stack
        });
        
        res.status(500).json({ 
            error: "An internal error occurred while processing your chat request.",
            debug: { 
                requestId, 
                errorCode: error.code,
                errorMessage: error.message
            }
        });
    }
});

// =================================================================
//  Helper Functions with Enhanced Logging
// =================================================================

async function generateEmbedding(text, requestId = null) {
    const logPrefix = requestId ? `[${requestId}]` : '';
    console.log(`🧠 ${logPrefix} Generating embedding for text length: ${text.length}`);
    
    const endpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/${PUBLISHER}/models/${EMBEDDING_MODEL}`;
    const instance = { 
        content: text,
        task_type: "RETRIEVAL_QUERY"
    };
    const request = { endpoint, instances: [instance] };
    
    console.log(`📡 ${logPrefix} Making embedding request to: ${endpoint}`);
    
    try {
        const [response] = await predictionServiceClient.predict(request);
        const embedding = response.predictions[0].structValue.fields.embedding.listValue.values.map(v => v.numberValue);
        
        console.log(`✅ ${logPrefix} Embedding generated successfully: ${embedding.length} dimensions`);
        return embedding;
    } catch (error) {
        console.error(`❌ ${logPrefix} Embedding generation failed:`, {
            message: error.message,
            code: error.code,
            details: error.details
        });
        throw error;
    }
}

// ✅ FIXED: This function now properly uses DEPLOYED_INDEX_ID
async function findRelevantDocuments(userId, question, collectionIds = [], requestId = null) {
    const logPrefix = requestId ? `[${requestId}]` : '';
    console.log(`🔍 ${logPrefix} Finding relevant documents for question: "${question}"`);

    try {
        const questionEmbedding = await generateEmbedding(question, requestId);

        const endpointPath = `projects/${PROJECT_ID}/locations/${LOCATION}/indexEndpoints/${VECTOR_SEARCH_ENDPOINT_ID}`;
        
        console.log(`📍 ${logPrefix} Vector search endpoint: ${endpointPath}`);
        console.log(`🎯 ${logPrefix} Using deployed index ID: ${DEPLOYED_INDEX_ID}`); // ✅ Debug log

        // ✅ FIXED: Properly use DEPLOYED_INDEX_ID variable
        const findNeighborsRequest = {
            indexEndpoint: endpointPath,
            queries: [{
                datapoint: {
                    featureVector: questionEmbedding
                },
                neighborCount: 5,
                deployedIndexId: DEPLOYED_INDEX_ID  // ✅ NOW ACTUALLY USING THE VARIABLE!
            }]
        };

        console.log(`📊 ${logPrefix} Vector search request:`, {
            endpoint: endpointPath,
            deployedIndexId: DEPLOYED_INDEX_ID,
            neighborCount: 5,
            embeddingDimensions: questionEmbedding.length
        });

        console.log(`🚀 ${logPrefix} Executing vector search...`);
        const [findNeighborsResponse] = await predictionServiceClient.findNeighbors(findNeighborsRequest);
        
        console.log(`📥 ${logPrefix} Vector search response received`);
        
        const neighbors = findNeighborsResponse.nearestNeighbors?.[0]?.neighbors || [];
        console.log(`📋 ${logPrefix} Found ${neighbors.length} neighbors from vector search`);

        if (neighbors.length === 0) { 
            console.log(`⚠️ ${logPrefix} No neighbors found - index might be empty or no embeddings exist yet`);
            return []; 
        }

        // Enhanced neighbor logging
        neighbors.forEach((neighbor, i) => {
            console.log(`   Neighbor ${i + 1}: ID=${neighbor.datapoint.datapointId}, Distance=${neighbor.distance.toFixed(4)}`);
        });

        // Get document IDs from neighbors
        const docIds = neighbors.map(n => n.datapoint.datapointId);
        
        console.log(`🗂️ ${logPrefix} Fetching document details from Firestore for IDs: ${docIds.join(', ')}`);
        const relevantDocs = [];
        
        // Fetch documents from both collections
        for (const docId of docIds) {
            try {
                // Try transcripts first
                const transcriptSnapshot = await db.collectionGroup('transcripts').where(admin.firestore.FieldPath.documentId(), '==', docId).get();
                if (!transcriptSnapshot.empty) {
                    const doc = transcriptSnapshot.docs[0];
                    relevantDocs.push({ id: doc.id, type: 'transcript', ...doc.data() });
                    continue;
                }
                
                // Try learning packets
                const packetSnapshot = await db.collectionGroup('learning_packets').where(admin.firestore.FieldPath.documentId(), '==', docId).get();
                if (!packetSnapshot.empty) {
                    const doc = packetSnapshot.docs[0];
                    relevantDocs.push({ id: doc.id, type: 'packet', ...doc.data() });
                }
            } catch (error) {
                console.warn(`⚠️ ${logPrefix} Failed to fetch document ${docId}:`, error.message);
            }
        }

        console.log(`✅ ${logPrefix} Returning ${relevantDocs.length} relevant documents`);
        return relevantDocs;

    } catch (error) {
        console.error(`💥 ${logPrefix} Error in findRelevantDocuments:`, {
            message: error.message,
            code: error.code,
            details: error.details,
            stack: error.stack?.split('\n').slice(0, 3).join('\n')
        });
        throw error;
    }
}

async function generateChatResponse(question, relevantDocs, requestId = null) {
    const logPrefix = requestId ? `[${requestId}]` : '';
    console.log(`🤖 ${logPrefix} Generating chat response using ${relevantDocs.length} documents`);
    
    try {
        const context = relevantDocs.map(doc => {
            if (doc.type === 'transcript') {
                return `Document: ${doc.title}\nContent: ${doc.content}`;
            } else {
                return `Document: ${doc.title}\nSummary: ${doc.packet?.summary || 'No summary available'}`;
            }
        }).join('\n\n');

        const prompt = `Based on the following documents from the user's library, please answer their question.

Documents:
${context}

Question: ${question}

Please provide a helpful answer based on the information in these documents.`;

        const result = await textGenerationModel.generateContent(prompt);
        const response = result.response;
        const answer = response.text();
        
        console.log(`✅ ${logPrefix} Chat response generated (${answer.length} characters)`);
        return answer;
    } catch (error) {
        console.error(`❌ ${logPrefix} Error generating chat response:`, error);
        throw error;
    }
}

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Query Service listening on port ${PORT}`);
    console.log(`📊 Configuration:`, {
        PROJECT_ID,
        LOCATION,
        VECTOR_SEARCH_ENDPOINT_ID,
        DEPLOYED_INDEX_ID,
        EMBEDDING_MODEL,
        hasApiKey: !!API_KEY
    });
});