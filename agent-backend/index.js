// File: agent-backend/index.js
// This service acts as an orchestrator, calling multiple AI tools to create a 'Learning Packet'.

const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Express app
const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' })); // Allow larger request bodies for long transcripts

// --- Configuration ---
const PORT = process.env.PORT || 8080;
const API_KEY = process.env.GEMINI_API_KEY;

// --- Initialize Google AI Client ---
let genAI;
let model;
if (API_KEY) {
    genAI = new GoogleGenerativeAI(API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    console.log("✅ GEMINI_API_KEY found and AI client initialized successfully.");
} else {
    console.error("❌ GEMINI_API_KEY environment variable not set. The agent service will not work.");
}

// ✅ FIX: Add health check endpoint
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: 'Learning Agent Service is running',
        timestamp: new Date().toISOString(),
        endpoints: ['/generate-packet', '/chat'],
        apiKeyConfigured: !!API_KEY,
        version: '1.0.1'
    });
});

// ✅ FIX: Add health endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        service: 'Learning Agent Service',
        status: 'healthy',
        apiKeyConfigured: !!API_KEY,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// =================================================================
//  AI "TOOLS"
//  These functions are responsible for calling the Gemini API for a specific task.
// =================================================================

/**
 * Tool to generate a summary for a given transcript.
 * @param {string} transcript The full text of the transcript.
 * @returns {Promise<string>} The generated summary text.
 */
async function summarizeTool(transcript) {
    console.log("🔧 Executing summarizeTool...");
    const prompt = `Please provide a concise, easy-to-understand summary of the following transcript. Focus on the main ideas and key takeaways. --- ${transcript}`;
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        console.log("✅ Summary generated successfully");
        return response.text();
    } catch (error) {
        console.error("❌ Error in summarizeTool:", error);
        return "Error: Could not generate summary."; // Return a safe string on error
    }
}

/**
 * Tool to generate key concepts from a transcript.
 * @param {string} transcript The full text of the transcript.
 * @returns {Promise<object[]>} An array of key concept objects.
 */
async function keyConceptsTool(transcript) {
    console.log("🔧 Executing keyConceptsTool...");
    const prompt = `Analyze the following transcript and list the key concepts, terms, and definitions discussed. Return your response ONLY as a raw JSON array with the structure: [{"concept": "[Concept Name]", "definition": "[A clear and concise definition]"}] --- ${transcript}`;
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(text);
        console.log("✅ Key concepts generated successfully");
        return parsed;
    } catch (error) {
        console.error("❌ Error in keyConceptsTool (parsing JSON):", error);
        return [{ concept: "Error", definition: "Could not generate key concepts." }]; // Return a safe object on error
    }
}

/**
 * Tool to generate flashcards from a transcript.
 * @param {string} transcript The full text of the transcript.
 * @returns {Promise<object[]>} An array of flashcard objects.
 */
async function flashcardsTool(transcript) {
    console.log("🔧 Executing flashcardsTool...");
    const prompt = `Based on the following transcript, generate a set of flashcards. Return your response ONLY as a raw JSON array with the structure: [{"front": "[A question or term]", "back": "[The answer or definition]"}] --- ${transcript}`;
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(text);
        console.log("✅ Flashcards generated successfully");
        return parsed;
    } catch (error) {
        console.error("❌ Error in flashcardsTool (parsing JSON):", error);
        return [{ front: "Error", back: "Could not generate flashcards." }]; // Return a safe object on error
    }
}

/**
 * Tool to extract actionable items from a transcript.
 * @param {string} transcript The full text of the transcript.
 * @returns {Promise<string[]>} An array of action item strings.
 */
async function actionItemsTool(transcript) {
    console.log("🔧 Executing actionItemsTool...");
    const prompt = `Analyze the following transcript and list any specific, actionable tasks, suggestions, or next steps mentioned. Return your response ONLY as a raw JSON array of strings: ["Action item 1", "Action item 2", ...] --- ${transcript}`;
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(text);
        console.log("✅ Action items generated successfully");
        return parsed;
    } catch (error) {
        console.error("❌ Error in actionItemsTool (parsing JSON):", error);
        return ["Error: Could not generate action items."]; // Return a safe array on error
    }
}

// =================================================================
//  AGENT ORCHESTRATION
// =================================================================

/**
 * Main endpoint to generate a complete learning packet.
 */
app.post('/generate-packet', async (req, res) => {
    console.log("📦 Received request for /generate-packet");

    const { transcript } = req.body;
    if (!transcript) {
        console.error("❌ Request failed: No transcript provided.");
        return res.status(400).json({ 
            error: 'A transcript is required.',
            required: ['transcript'],
            received: Object.keys(req.body)
        });
    }

    if (!genAI || !model) {
        console.error("❌ Agent failed: Server is not configured with an API key.");
        return res.status(500).json({ 
            error: 'Server configuration error: GEMINI_API_KEY not set',
            solution: 'Please configure the GEMINI_API_KEY environment variable in Cloud Run'
        });
    }

    try {
        console.log("🔄 Agent is orchestrating tools in parallel...");
        const startTime = Date.now();
        
        // Run all tools at the same time for maximum efficiency
        const [summary, keyConcepts, flashcards, actionItems] = await Promise.all([
            summarizeTool(transcript),
            keyConceptsTool(transcript),
            flashcardsTool(transcript),
            actionItemsTool(transcript)
        ]);

        const processingTime = Date.now() - startTime;
        console.log(`✅ All tools completed successfully in ${processingTime}ms`);

        // Bundle the results into a single "learning packet"
        const learningPacket = {
            summary,
            keyConcepts,
            flashcards,
            actionItems,
            metadata: {
                transcriptLength: transcript.length,
                processingTimeMs: processingTime,
                generatedAt: new Date().toISOString(),
                toolsUsed: ['summarize', 'keyConcepts', 'flashcards', 'actionItems']
            }
        };

        res.status(200).json(learningPacket);

    } catch (error) {
        console.error("❌ An error occurred during agent orchestration:", error);
        res.status(500).json({ 
            error: 'Failed to generate learning packet',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ✅ FIX: Add chat endpoint (redirects to proper endpoint with helpful message)
app.post('/chat', async (req, res) => {
    console.log("💬 Received request for /chat (redirecting to /generate-packet)");
    
    // Check if this is a request that should go to generate-packet
    if (req.body.transcript) {
        console.log("🔀 Redirecting chat request with transcript to generate-packet");
        return res.status(200).json({
            message: "This endpoint has been moved. Please use /generate-packet for transcript processing.",
            redirectTo: "/generate-packet",
            yourRequest: req.body
        });
    }
    
    // For other chat requests, provide helpful information
    res.status(404).json({ 
        error: 'Chat endpoint not implemented on this service',
        message: 'This service is specialized for generating learning packets from transcripts.',
        availableEndpoints: ['/generate-packet'],
        suggestion: 'Use /generate-packet with a transcript field in the request body',
        example: {
            method: 'POST',
            endpoint: '/generate-packet',
            body: { transcript: 'Your transcript text here...' }
        }
    });
});

// ✅ FIX: Add graceful error handling for unhandled routes
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        availableEndpoints: ['/', '/health', '/generate-packet', '/chat'],
        requestedPath: req.originalUrl,
        method: req.method,
        suggestion: 'Use /generate-packet for learning packet generation'
    });
});

// ✅ FIX: Add global error handler
app.use((err, req, res, next) => {
    console.error('❌ Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message,
        timestamp: new Date().toISOString()
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Learning Agent Service listening on port ${PORT}`);
    console.log(`📊 API Key configured: ${!!API_KEY ? '✅ YES' : '❌ NO'}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📝 Available endpoints: /, /health, /generate-packet, /chat`);
});