// File: backend/index.js
// This file has been corrected to use the modern @google/generative-ai SDK.

const express = require('express');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require("@google/generative-ai"); // Correct import
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
// This should only be done once.
let genAI;
if (API_KEY) {
    genAI = new GoogleGenerativeAI(API_KEY);
} else {
    console.error("GEMINI_API_KEY environment variable not set. The /grade-response endpoint will not work.");
}


// This is our main API endpoint. The front-end will send requests here.
app.post('/grade-response', async (req, res) => {
    console.log("Received request to grade response.");

    const { feedbackId, transcript, prompt, response } = req.body;

    if (!feedbackId || !transcript || !prompt || !response) {
        console.error("Missing required fields in request body.");
        return res.status(400).send({ error: 'Missing required fields.' });
    }

    if (response.startsWith("ERROR:")) {
        console.log("Skipping AI grading for error feedback.");
        return res.status(200).send({ message: "Skipped grading for error response." });
    }
    
    // Check if the API key was loaded correctly at startup
    if (!genAI) {
        console.error("AI client not initialized because API key is missing.");
        return res.status(500).send({ error: 'Server is not configured with an API key.' });
    }

    console.log(`Grading response for feedback ID: ${feedbackId}`);
    
    const judgingPrompt = `
      You are a Quality Assurance specialist for an AI learning assistant. 
      Your task is to evaluate an AI-generated response based on a user's transcript.

      Here is the user's original transcript:
      ---
      ${transcript}
      ---

      Here is the prompt that was given to the worker AI:
      ---
      ${prompt}
      ---

      Here is the response that the worker AI generated:
      ---
      ${response}
      ---

      Please evaluate the response based on the following criteria and provide a score from 1 (poor) to 5 (excellent) for each. 
      Return your evaluation ONLY as a raw JSON object with the following structure: 
      {
        "relevance_score": [score], 
        "clarity_score": [score], 
        "formatting_score": [score], 
        "justification": "[Your brief justification for the scores]"
      }
    `;

    try {
        // --- CORRECTED SDK USAGE ---
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(judgingPrompt);
        const judgeResponse = await result.response;
        const judgeResponseText = judgeResponse.text();
        // -------------------------
    
        const jsonText = judgeResponseText.replace(/```json|```/g, "").trim();
        const gradingResult = JSON.parse(jsonText);

        console.log("AI Judge response received:", gradingResult);

        // Update the original feedback document with the AI Judge's scores
        const feedbackRef = db.collection('feedback').doc(feedbackId);
        await feedbackRef.set({ ai_grade: gradingResult }, { merge: true });

        return res.status(200).send({ success: true, grade: gradingResult });

    } catch (error) {
      console.error("Error during AI grading:", error);
      // Save the error to the document for later review
      const feedbackRef = db.collection('feedback').doc(feedbackId);
      await feedbackRef.set({ ai_grade_error: error.message }, { merge: true });
      return res.status(500).send({ error: error.message });
    }
});

// The server listens for requests on the port provided by Cloud Run
const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
