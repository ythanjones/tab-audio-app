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
} else {
    console.error("GEMINI_API_KEY environment variable not set. The agent service will not work.");
}

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
    console.log("Executing summarizeTool...");
    const prompt = `Please provide a concise, easy-to-understand summary of the following transcript. Focus on the main ideas and key takeaways. --- ${transcript}`;
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Error in summarizeTool:", error);
        return "Error: Could not generate summary."; // Return a safe string on error
    }
}

/**
 * Tool to generate key concepts from a transcript.
 * @param {string} transcript The full text of the transcript.
 * @returns {Promise<object[]>} An array of key concept objects.
 */
async function keyConceptsTool(transcript) {
    console.log("Executing keyConceptsTool...");
    const prompt = `Analyze the following transcript and list the key concepts, terms, and definitions discussed. Return your response ONLY as a raw JSON array with the structure: [{"concept": "[Concept Name]", "definition": "[A clear and concise definition]"}] --- ${transcript}`;
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json|```/g, "").trim();
        return JSON.parse(text);
    } catch (error) {
        console.error("Error in keyConceptsTool (parsing JSON):", error);
        return [{ concept: "Error", definition: "Could not generate key concepts." }]; // Return a safe object on error
    }
}

/**
 * Tool to generate flashcards from a transcript.
 * @param {string} transcript The full text of the transcript.
 * @returns {Promise<object[]>} An array of flashcard objects.
 */
async function flashcardsTool(transcript) {
    console.log("Executing flashcardsTool...");
    const prompt = `Based on the following transcript, generate a set of flashcards. Return your response ONLY as a raw JSON array with the structure: [{"front": "[A question or term]", "back": "[The answer or definition]"}] --- ${transcript}`;
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json|```/g, "").trim();
        return JSON.parse(text);
    } catch (error) {
        console.error("Error in flashcardsTool (parsing JSON):", error);
        return [{ front: "Error", back: "Could not generate flashcards." }]; // Return a safe object on error
    }
    /**
 * Tool to extract actionable items from a transcript.
 * @param {string} transcript The full text of the transcript.
 * @returns {Promise<string[]>} An array of action item strings.
 */
async function actionItemsTool(transcript) {
    console.log("Executing actionItemsTool...");
    const prompt = `Analyze the following transcript and list any specific, actionable tasks, suggestions, or next steps mentioned. Return your response ONLY as a raw JSON array of strings: ["Action item 1", "Action item 2", ...] --- ${transcript}`;
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json|```/g, "").trim();
        return JSON.parse(text);
    } catch (error) {
        console.error("Error in actionItemsTool (parsing JSON):", error);
        return ["Error: Could not generate action items."]; // Return a safe array on error
    }
}
}


// =================================================================
//  AGENT ORCHESTRATION
// =================================================================

/**
 * Main endpoint to generate a complete learning packet.
 */
app.post('/generate-packet', async (req, res) => {
    console.log("Received request for /generate-packet");

    const { transcript } = req.body;
    if (!transcript) {
        console.error("Request failed: No transcript provided.");
        return res.status(400).send({ error: 'A transcript is required.' });
    }

    if (!genAI || !model) {
        console.error("Agent failed: Server is not configured with an API key.");
        return res.status(500).send({ error: 'Server configuration error.' });
    }

    try {
        console.log("Agent is orchestrating tools in parallel...");
        
        // Run all tools at the same time for maximum efficiency
        const [summary, keyConcepts, flashcards, actionItems] = await Promise.all([
            summarizeTool(transcript),
            keyConceptsTool(transcript),
            flashcardsTool(transcript),
            actionItemsTool(transcript) // Add the new tool here
        ]);

        console.log("All tools completed successfully.");

        // Bundle the results into a single "learning packet"
        const learningPacket = {
            summary,
            keyConcepts,
            flashcards,
            actionItems
        };

        res.status(200).json(learningPacket);

    } catch (error) {
        console.error("An error occurred during agent orchestration:", error);
        res.status(500).send({ error: 'Failed to generate learning packet.' });
    }
});


// Start the server
app.listen(PORT, () => {
    console.log(`Learning Agent Service listening on port ${PORT}`);
});
