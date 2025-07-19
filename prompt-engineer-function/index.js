// File: prompt-engineer-function/index.js
// This Cloud Function is the "brain" of our self-improving system.
// It is automatically triggered when new feedback is created in Firestore.
// In service-A/index.js, service-B/index.js, etc.
require('dotenv').config({ path: '../.env' });

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Firebase and Google AI clients
admin.initializeApp();
const db = admin.firestore();

// IMPORTANT: You will need to set your Gemini API key as an environment variable
// for this function using the gcloud deploy command, just like we did for the other services.
const API_KEY = process.env.GEMINI_API_KEY;

let genAI;
let model;
if (API_KEY) {
    genAI = new GoogleGenerativeAI(API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
} else {
    console.error("GEMINI_API_KEY environment variable not set. The prompt engineer function will not work.");
}

/**
 * This function triggers whenever a new document is written to any 'feedback' subcollection.
 * The path includes wildcards '{userId}' and '{feedbackId}' to match any user and any feedback document.
 */
exports.analyzeFeedbackAndImprovePrompt = functions.firestore
    .document('users/{userId}/feedback/{feedbackId}')
    .onCreate(async (snap, context) => {
        
        // 1. Get the data from the new feedback document.
        const feedbackData = snap.data();
        const { promptId, rating, detailedFeedback, ai_grade, prompt: originalPrompt } = feedbackData;

        console.log(`New feedback received for promptId: ${promptId}. Rating: ${rating}.`);

        // 2. Decide if the prompt needs improvement.
        // We only act if the user rating is 'negative'.
        if (rating !== 'negative') {
            console.log("Feedback was not negative. No action needed.");
            return null;
        }
        
        if (!model) {
            console.error("Aborting: Google AI Client not initialized due to missing API key.");
            return null;
        }

        console.log("Negative feedback detected. Initiating prompt improvement process.");

        // 3. Construct the "Meta-Prompt".
        // This is a powerful prompt that we send to the AI to ask it to act as a prompt engineer.
        // It includes the old prompt, the user's complaint, and the AI Judge's objective score.
        const metaPrompt = `
            You are an expert AI Prompt Engineer. Your task is to improve a prompt for a learning assistant based on user feedback and an automated quality score.
            
            The ORIGINAL PROMPT was:
            ---
            ${originalPrompt}
            ---

            This prompt produced a result that a user rated as "negative".

            The USER'S DETAILED FEEDBACK was:
            ---
            ${detailedFeedback || "No detailed feedback was provided."}
            ---
            
            An automated AI Judge also provided the following quality scores for the response:
            ---
            ${JSON.stringify(ai_grade, null, 2) || "No AI grade was available."}
            ---

            Based on all of this information, please generate a new, improved version of the prompt. 
            The new prompt should be designed to avoid the issues raised by the user and to achieve higher quality scores in the future.
            
            Return ONLY the text of the new, improved prompt. Do not include any other explanatory text or markdown formatting.
        `;

        try {
            // 4. Call the Gemini API with our meta-prompt to get the new, improved prompt.
            console.log("Generating improved prompt...");
            const result = await model.generateContent(metaPrompt);
            const response = await result.response;
            const newPromptText = response.text();

            if (!newPromptText) {
                throw new Error("The AI did not return a new prompt.");
            }
            
            console.log("Successfully generated new prompt:", newPromptText);

            // 5. Update the original prompt in the main 'prompts' collection in Firestore.
            const promptDocRef = db.collection('prompts').doc(promptId);
            
            await promptDocRef.update({
                text: newPromptText,
                last_updated: admin.firestore.FieldValue.serverTimestamp(),
                previous_version: originalPrompt // Save the old version for history
            });

            console.log(`Successfully updated prompt '${promptId}' in Firestore.`);
            return { success: true, newPrompt: newPromptText };

        } catch (error) {
            console.error("Error during prompt engineering process:", error);
            // We could add error logging to a specific collection in Firestore here if needed.
            return { success: false, error: error.message };
        }
    });