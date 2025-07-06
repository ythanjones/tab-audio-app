// File: backend/index.js
// This service acts as the "AI Judge" for quality assurance.

const express = require('express');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cors = require('cors');

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// The API key must be securely stored as an environment variable in Cloud Run
const API_KEY = process.env.GEMINI_API_KEY;

// Initialize the Google AI client with the API key
let genAI;
if (API_KEY) {
    genAI = new GoogleGenerativeAI(API_KEY);
    console.log("✅ GEMINI_API_KEY found and AI client initialized successfully.");
} else {
    console.error("❌ GEMINI_API_KEY environment variable not set. The /grade-response endpoint will not work.");
}

// ✅ FIX: Add health check endpoint
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: 'AI Judge Server is running',
        timestamp: new Date().toISOString(),
        endpoints: ['/grade-response'],
        apiKeyConfigured: !!API_KEY,
        version: '1.0.1'
    });
});

// ✅ FIX: Add endpoint to check API key status
app.get('/health', (req, res) => {
    res.status(200).json({
        service: 'AI Judge Server',
        status: 'healthy',
        apiKeyConfigured: !!API_KEY,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// This is our main API endpoint. The front-end will send requests here.
app.post('/grade-response', async (req, res) => {
    console.log("📝 Received request to grade response.");

    const { feedbackId, transcript, prompt, response } = req.body;

    // ✅ FIX: Better error handling and validation
    if (!feedbackId || !transcript || !prompt || !response) {
        console.error("❌ Missing required fields in request body:", {
            feedbackId: !!feedbackId,
            transcript: !!transcript,
            prompt: !!prompt,
            response: !!response
        });
        return res.status(400).json({ 
            error: 'Missing required fields',
            required: ['feedbackId', 'transcript', 'prompt', 'response'],
            received: Object.keys(req.body)
        });
    }

    if (response.startsWith("ERROR:")) {
        console.log("⏭️ Skipping AI grading for error feedback.");
        return res.status(200).json({ 
            message: "Skipped grading for error response.",
            feedbackId: feedbackId
        });
    }
    
    // ✅ FIX: Better error message when API key is missing
    if (!genAI) {
        console.error("❌ AI client not initialized because API key is missing.");
        return res.status(500).json({ 
            error: 'Server configuration error: GEMINI_API_KEY not set',
            solution: 'Please configure the GEMINI_API_KEY environment variable in Cloud Run'
        });
    }

    console.log(`🔍 Grading response for feedback ID: ${feedbackId}`);
    
    const judgingPrompt = `Rate this AI response from 1-5. Return only JSON: {"relevance_score": 4, "clarity_score": 4, "formatting_score": 4, "justification": "Good response"}

Original text: ${transcript}
AI response: ${response}`;

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        console.log("🤖 Sending request to Gemini API...");
        
        const result = await model.generateContent(judgingPrompt);
        const judgeResponse = await result.response;
        const judgeResponseText = judgeResponse.text();
    
        console.log("📄 Raw AI Judge response received");
        
        // ✅ FIX: Better JSON parsing with error handling
        let gradingResult;
        try {
            const jsonText = judgeResponseText.replace(/```json|```/g, "").trim();
            gradingResult = JSON.parse(jsonText);
            console.log("✅ AI Judge response parsed successfully:", gradingResult);
        } catch (parseError) {
            console.error("❌ Failed to parse AI Judge response as JSON:", parseError.message);
            console.error("Raw response:", judgeResponseText);
            return res.status(500).json({
                error: 'Failed to parse AI grading response',
                rawResponse: judgeResponseText.substring(0, 200) + '...'
            });
        }

        // ✅ FIX: Validate the grading result structure
        const requiredFields = ['relevance_score', 'clarity_score', 'formatting_score', 'justification'];
        const missingFields = requiredFields.filter(field => !(field in gradingResult));
        
        if (missingFields.length > 0) {
            console.error("❌ AI Judge response missing required fields:", missingFields);
            return res.status(500).json({
                error: 'Invalid AI grading response structure',
                missingFields: missingFields,
                receivedFields: Object.keys(gradingResult)
            });
        }

        // This path is specific to where the app saves feedback.
        // It needs to match the path used in app.js
        console.log("💾 Searching for feedback document...");
        const feedbackRef = db.collectionGroup('feedback').where('feedbackId', '==', feedbackId).limit(1);
        const feedbackSnapshot = await feedbackRef.get();

        if (feedbackSnapshot.empty) {
            const error = `No feedback document found with ID: ${feedbackId}`;
            console.error("❌", error);
            throw new Error(error);
        }
        
        const docToUpdate = feedbackSnapshot.docs[0].ref;
        console.log("📝 Updating feedback document with AI grade...");
        
        await docToUpdate.set({ 
            ai_grade: gradingResult,
            graded_at: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log("✅ Feedback document updated successfully");
        return res.status(200).json({ 
            success: true, 
            grade: gradingResult,
            feedbackId: feedbackId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error("❌ Error during AI grading:", error);
        
        // ✅ FIX: Better error response with more details
        const errorResponse = {
            error: 'AI grading failed',
            message: error.message,
            feedbackId: feedbackId,
            timestamp: new Date().toISOString()
        };

        // Add specific error details based on error type
        if (error.message.includes('API key')) {
            errorResponse.solution = 'Check GEMINI_API_KEY configuration';
        } else if (error.message.includes('No feedback document')) {
            errorResponse.solution = 'Verify feedbackId is correct and document exists';
        } else if (error.message.includes('quota')) {
            errorResponse.solution = 'API quota exceeded, try again later';
        }

        return res.status(500).json(errorResponse);
    }
});

// ✅ FIX: Add graceful error handling for unhandled routes
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        availableEndpoints: ['/', '/health', '/grade-response'],
        requestedPath: req.originalUrl,
        method: req.method
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

// The server listens for requests on the port provided by Cloud Run
const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`🚀 AI Judge Server listening on port ${port}`);
    console.log(`📊 API Key configured: ${!!API_KEY ? '✅ YES' : '❌ NO'}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📝 Available endpoints: /, /health, /grade-response`);
});