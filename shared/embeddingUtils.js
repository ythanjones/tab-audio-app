// File: shared/embeddingUtils.js
// Shared utility for generating embeddings using Google Generative AI

const { PredictionServiceClient } = require('@google-cloud/aiplatform');

// --- Configuration ---
// These should ideally be configurable or passed in if they vary by service
const PROJECT_ID = 'tab-audio-app';
const LOCATION = 'europe-west2';
const PUBLISHER = 'google';
const EMBEDDING_MODEL = 'gemini-embedding-001';

// Initialize the Vertex AI Client
// Consider if this client needs to be initialized per-service or can be shared
// For now, keeping it within the function scope to be safe, but it could be initialized once.
// const clientOptions = { apiEndpoint: `${LOCATION}-aiplatform.googleapis.com` };
// const predictionServiceClient = new PredictionServiceClient(clientOptions);


/**
 * Generates an embedding for the given text using the specified task type.
 * @param {string} text The text to embed.
 * @param {string} taskType The type of embedding task (e.g., "RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY").
 * @param {PredictionServiceClient} client The PredictionServiceClient instance.
 * @returns {Promise<number[]>} The generated embedding vector.
 */
async function generateEmbedding(text, taskType, client) {
    const endpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/${PUBLISHER}/models/${EMBEDDING_MODEL}`;

    const instance = {
        content: text,
        task_type: taskType
    };

    const request = { endpoint, instances: [instance] };

    console.log(`📡 Making embedding request to: ${endpoint} for task_type: ${taskType}`);

    try {
        const [response] = await client.predict(request);

        if (!response.predictions || !response.predictions[0] || !response.predictions[0].structValue || !response.predictions[0].structValue.fields || !response.predictions[0].structValue.fields.embedding) {
            console.error('❌ Embedding response structure is invalid:', JSON.stringify(response, null, 2));
            throw new Error('Invalid embedding response structure from AI Platform.');
        }

        const embedding = response.predictions[0].structValue.fields.embedding.listValue.values.map(v => v.numberValue);

        console.log(`✅ Embedding generated successfully: ${embedding.length} dimensions for task_type: ${taskType}`);
        return embedding;
    } catch (error) {
        console.error(`❌ Embedding generation failed for task_type ${taskType}:`, {
            message: error.message,
            code: error.code,
            details: error.details,
            // Including stack for more detailed debugging if needed, but be mindful of log size
            // stack: error.stack
        });
        throw error; // Re-throw the error to be handled by the caller
    }
}

module.exports = {
    generateEmbedding,
    // Potentially export PROJECT_ID, LOCATION, etc., if needed by calling services for client initialization
};
