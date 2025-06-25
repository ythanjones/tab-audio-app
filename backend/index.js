// File: functions/index.js
// This file has been corrected to use the proper server-side syntax
// for the Google AI SDK, which will fix the silent deployment failure.

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleAuth } = require("@google-ai/generativelanguage");
const { DiscussServiceClient } = require("@google-ai/generativelanguage").v1beta2;

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();

// Define the API Key from environment variables for security
const API_KEY = functions.config().gemini.key;
const MODEL_NAME = "models/gemini-1.5-flash-latest";

const client = new DiscussServiceClient({
  authClient: new GoogleAuth().fromAPIKey(API_KEY),
});

/**
 * Cloud Function that triggers whenever a new document is created in the "feedback" collection.
 * It acts as an "AI Judge" to provide an objective quality score on the response.
 */
exports.gradeAiResponse = functions.firestore
  .document("feedback/{feedbackId}")
  .onCreate(async (snap, context) => {
    const feedbackData = snap.data();
    const { transcript, prompt, response } = feedbackData;

    // Do not run the judge on its own feedback or if the initial response was an error.
    if (!transcript || !prompt || !response || response.startsWith("ERROR:")) {
      functions.logger.log("Skipping AI grading for incomplete or error feedback.");
      return null;
    }
    
    functions.logger.log(`Grading response for feedback ID: ${context.params.feedbackId}`);

    // The "meta-prompt" for our AI Judge
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
      if (!API_KEY) {
        throw new Error("GEMINI_API_KEY environment variable not set.");
      }
      
      const [judgeResult] = await client.generateMessage({
        model: MODEL_NAME,
        prompt: { messages: [{ content: judgingPrompt }] },
      });
      
      const judgeResponseText = judgeResult.candidates[0].content;
      
      // Clean up the response to ensure it's valid JSON
      const jsonText = judgeResponseText.replace(/```json|```/g, "").trim();
      const gradingResult = JSON.parse(jsonText);

      functions.logger.log("AI Judge response received:", gradingResult);

      // Update the original feedback document with the AI Judge's scores
      return snap.ref.set({ ai_grade: gradingResult }, { merge: true });

    } catch (error) {
      functions.logger.error("Error during AI grading:", error);
      // Save the error to the document for later review
      return snap.ref.set({ ai_grade_error: error.message }, { merge: true });
    }
  });