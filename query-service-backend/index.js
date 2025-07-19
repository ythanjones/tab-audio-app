const functions = require('firebase-functions');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { ChromaClient } = require('chromadb');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CHROMADB_URL = process.env.CHROMADB_URL;

if (!GEMINI_API_KEY) {
    console.error("FATAL ERROR: GEMINI_API_KEY environment variable not set!");
}
if (!CHROMADB_URL) {
    console.error("FATAL ERROR: CHROMADB_URL environment variable not set!");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const chromaDbClient = new ChromaClient({ path: CHROMADB_URL });

const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
const chatModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

app.post('/query', async (req, res) => {
    const { collectionId, query, userId } = req.body;

    if (!collectionId || !query || !userId) {
        return res.status(400).json({ error: 'Missing required fields: collectionId, query, userId' });
    }

    try {
        const collection = await chromaDbClient.getCollection({ name: collectionId });

        // --- CORRECTED EMBEDDING LOGIC ---
        const embeddingResult = await embeddingModel.embedContent(query);
        const queryEmbedding = embeddingResult.embedding;
        // --- END CORRECTION ---

        const results = await collection.query({
            queryEmbeddings: [queryEmbedding.values],
            nResults: 5,
            where: { userId: userId }
        });

        if (!results.documents || results.documents.length === 0 || results.documents[0].length === 0) {
            return res.status(200).json({ answer: "I could not find any relevant information in the knowledge base to answer your question." });
        }

        const context = results.documents[0].join('\n\n');
        const prompt = `Based on the following context, answer the user's question.\n\nContext:\n${context}\n\nQuestion:\n${query}\n\nAnswer:`;

        const chatResult = await chatModel.generateContent(prompt);
        const response = await chatResult.response;
        const answer = response.text();

        res.status(200).json({ answer });
    } catch (error) {
        console.error('Error querying knowledge base:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

exports.queryKnowledgeBase = functions.region('europe-west2').https.onRequest(app);