// File: query-service-backend/index.js
// ChromaDB version - Simplified query service
// In service-A/index.js, service-B/index.js, etc.
require('dotenv').config({ path: '../.env' });

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { ChromaClient } = require('chromadb');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Configuration
const PORT = process.env.PORT || 8080;
const PROJECT_ID = 'tab-audio-app';
const EMBEDDING_MODEL = 'text-embedding-004';
const CHAT_MODEL = 'gemini-1.5-flash';

// Initialize Firebase
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

// Initialize AI Clients
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error("❌ GEMINI_API_KEY environment variable not set!");
}

const genAI = new GoogleGenerativeAI(API_KEY);
const chatModel = genAI.getGenerativeModel({ model: CHAT_MODEL });
const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

// Initialize ChromaDB
let chromaClient;
function getChromaClient() {
    if (!chromaClient) {
        chromaClient = new ChromaClient({
            path: process.env.CHROMADB_URL || "http://localhost:8000"
        });
    }
    return chromaClient;
}

// Custom embedding function for queries
class GeminiQueryEmbedder {
    constructor(model) {
        this.model = model;
    }

    async generate(texts) {
        const embeddings = [];
        for (const text of texts) {
            const result = await this.model.embedContent({
                content: { parts: [{ text }] },
                taskType: "RETRIEVAL_QUERY" // Note: QUERY for searching
            });
            embeddings.push(result.embedding.values);
        }
        return embeddings;
    }
}

// Initialize Express app
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: 'ChromaDB Query Service is running',
        timestamp: new Date().toISOString(),
        embeddingModel: EMBEDDING_MODEL,
        chatModel: CHAT_MODEL,
        project: PROJECT_ID,
        chromadbConfigured: !!process.env.CHROMADB_URL
    });
});

// =================================================================
//  Main Chat Endpoint
// =================================================================
app.post('/chat', async (req, res) => {
    console.log("💬 Received chat request");

    const { userId, question, collectionIds = [] } = req.body;
    
    if (!userId || !question) {
        return res.status(400).json({ 
            error: "Missing required fields: userId and question are required." 
        });
    }
    
    if (!API_KEY) {
        return res.status(500).json({ 
            error: "Server is not configured with an API key." 
        });
    }
    
    try {
        console.log(`User: ${userId}`);
        console.log(`Question: ${question}`);
        console.log(`Collection filter:`, collectionIds);
        
        // Find relevant documents using ChromaDB
        const relevantDocs = await findRelevantDocuments(userId, question, collectionIds);
        console.log(`Found ${relevantDocs.length} relevant documents`);

        if (relevantDocs.length === 0) {
            return res.status(200).json({ 
                answer: "I couldn't find any relevant information in your AI Knowledge Base to answer that question. Make sure you've added content to your AI Knowledge Base using the 'Add to AI Knowledge' button in your library.", 
                sources: [] 
            });
        }

        // Generate answer using the chat model
        const answer = await generateChatResponse(question, relevantDocs);
        
        res.status(200).json({ 
            answer: answer, 
            sources: relevantDocs,
            model: CHAT_MODEL
        });

    } catch (error) {
        console.error("Error during /chat processing:", error);
        res.status(500).json({ 
            error: "An internal error occurred while processing your chat request.",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// =================================================================
//  Helper Functions
// =================================================================

/**
 * Find relevant documents using ChromaDB vector search
 */
async function findRelevantDocuments(userId, question, collectionIds) {
    try {
        const client = getChromaClient();
        const embedder = new GeminiQueryEmbedder(embeddingModel);
        
        // Get user's collection
        let collection;
        try {
            collection = await client.getCollection({
                name: `user_${userId}`,
                embeddingFunction: embedder
            });
        } catch (error) {
            console.log(`No collection found for user ${userId}`);
            return [];
        }
        
        // Build where clause for filtering
        const whereClause = {};
        if (collectionIds && collectionIds.length > 0) {
            whereClause.collectionId = { $in: collectionIds };
        }
        
        // Query ChromaDB
        console.log('🔍 Querying ChromaDB...');
        const results = await collection.query({
            queryTexts: [question],
            nResults: 5,
            where: Object.keys(whereClause).length > 0 ? whereClause : undefined
        });
        
        if (!results.ids || results.ids[0].length === 0) {
            return [];
        }
        
        // Fetch full documents from Firestore
        const documents = [];
        const ids = results.ids[0];
        const metadatas = results.metadatas[0];
        const distances = results.distances ? results.distances[0] : [];
        
        for (let i = 0; i < ids.length; i++) {
            const documentId = ids[i];
            const metadata = metadatas[i];
            const distance = distances[i];
            
            try {
                // Determine the collection based on document type
                const collectionName = metadata.documentType === 'learning_packet' 
                    ? 'learning_packets' 
                    : 'transcripts';
                
                const docRef = db.collection('users').doc(userId)
                    .collection(collectionName).doc(documentId);
                const docSnap = await docRef.get();
                
                if (docSnap.exists) {
                    const data = docSnap.data();
                    documents.push({
                        id: documentId,
                        title: data.title || metadata.title || 'Untitled',
                        content: data.content || '',
                        documentType: metadata.documentType,
                        collectionId: metadata.collectionId,
                        relevanceScore: distance ? (1 - distance).toFixed(3) : 'N/A',
                        // Include learning packet specific fields if available
                        ...(metadata.documentType === 'learning_packet' && {
                            summary: data.summary,
                            keyConcepts: data.keyConcepts,
                            questions: data.questions
                        })
                    });
                } else {
                    console.warn(`Document ${documentId} found in vector DB but not in Firestore`);
                }
            } catch (error) {
                console.error(`Error fetching document ${documentId}:`, error);
            }
        }
        
        console.log(`✅ Retrieved ${documents.length} documents from Firestore`);
        return documents;
        
    } catch (error) {
        console.error('Error in findRelevantDocuments:', error);
        return [];
    }
}

/**
 * Generate a chat response using the Gemini model
 */
async function generateChatResponse(question, relevantDocs) {
    // Prepare context from relevant documents
    let context = relevantDocs.map((doc, index) => {
        let docContext = `Document ${index + 1}: "${doc.title}"\n`;
        
        if (doc.documentType === 'learning_packet') {
            // For learning packets, use structured information
            if (doc.summary) {
                docContext += `Summary: ${doc.summary}\n`;
            }
            if (doc.keyConcepts && doc.keyConcepts.length > 0) {
                docContext += `Key Concepts:\n`;
                doc.keyConcepts.forEach(concept => {
                    docContext += `- ${concept.term}: ${concept.definition}\n`;
                });
            }
            if (doc.questions && doc.questions.length > 0) {
                docContext += `Related Questions:\n`;
                doc.questions.forEach(q => {
                    docContext += `- Q: ${q.question}\n  A: ${q.answer}\n`;
                });
            }
        } else {
            // For transcripts, use the full content
            docContext += `Content: ${doc.content}\n`;
        }
        
        docContext += `---\n`;
        return docContext;
    }).join('\n');

    const prompt = `You are a helpful AI assistant. Answer the user's question based on the provided context from their personal knowledge base. 
    Be conversational and helpful. If the context doesn't contain enough information to fully answer the question, acknowledge this and provide the best answer you can based on what's available.
    
    Context from knowledge base:
    ${context}
    
    User's question: ${question}
    
    Answer (be specific and reference the source documents when relevant):`;

    try {
        console.log('🤖 Generating AI response...');
        const result = await chatModel.generateContent(prompt);
        const answer = result.response.text();
        console.log('✅ AI response generated successfully');
        return answer;
    } catch (error) {
        console.error("Error in generateChatResponse:", error);
        return "Sorry, I encountered an error while trying to generate a response. Please try again.";
    }
}

// =================================================================
//  Additional Endpoints
// =================================================================

/**
 * Get user's knowledge base statistics
 */
app.get('/stats/:userId', async (req, res) => {
    const { userId } = req.params;
    
    try {
        const client = getChromaClient();
        
        // Get user's collection
        let collection;
        try {
            collection = await client.getCollection({
                name: `user_${userId}`
            });
        } catch (error) {
            return res.json({
                userId,
                totalDocuments: 0,
                collections: [],
                message: "No knowledge base found for this user"
            });
        }
        
        // Get all documents to analyze
        const allDocs = await collection.get();
        
        // Calculate statistics
        const stats = {
            userId,
            totalDocuments: await collection.count(),
            documentTypes: {},
            collections: {},
            lastUpdated: null
        };
        
        if (allDocs.metadatas) {
            allDocs.metadatas.forEach(metadata => {
                // Count by document type
                stats.documentTypes[metadata.documentType] = 
                    (stats.documentTypes[metadata.documentType] || 0) + 1;
                
                // Count by collection
                stats.collections[metadata.collectionId] = 
                    (stats.collections[metadata.collectionId] || 0) + 1;
                
                // Track last updated
                if (metadata.timestamp) {
                    const timestamp = new Date(metadata.timestamp);
                    if (!stats.lastUpdated || timestamp > stats.lastUpdated) {
                        stats.lastUpdated = timestamp;
                    }
                }
            });
        }
        
        res.json(stats);
        
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ 
            error: 'Failed to retrieve statistics',
            message: error.message 
        });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 ChromaDB Query Service listening on port ${PORT}`);
    console.log(`📊 Project ID: ${PROJECT_ID}`);
    console.log(`🧠 Embedding Model: ${EMBEDDING_MODEL}`);
    console.log(`💬 Chat Model: ${CHAT_MODEL}`);
    console.log(`🗄️ ChromaDB URL: ${process.env.CHROMADB_URL || 'http://localhost:8000'}`);
    if (!API_KEY) {
        console.error('⚠️  WARNING: GEMINI_API_KEY not set!');
    }
});