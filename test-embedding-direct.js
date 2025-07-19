// test-embedding-direct.js
const fetch = require('node-fetch');

// Set your API key
process.env.GEMINI_API_KEY = 'your-actual-api-key-here';

// Import the function directly
const functions = require('./embedding-service-function/index.js');

// Create mock request and response objects
const mockReq = {
    method: 'POST',
    body: {
        userId: "test-user-1",
        documents: [{
            documentId: "doc-1",
            text: "ChromaDB is now working perfectly with our YouTube learning app. It stores vector embeddings and enables semantic search.",
            title: "ChromaDB Success",
            documentType: "transcript",
            collectionId: "test-collection"
        }]
    }
};

const mockRes = {
    set: () => {},
    status: (code) => ({
        json: (data) => {
            console.log(`Response Status: ${code}`);
            console.log('Response Data:', JSON.stringify(data, null, 2));
        },
        send: (data) => {
            console.log(`Response Status: ${code}`);
            console.log('Response:', data);
        }
    })
};

// Call the function
console.log('Testing addToKnowledgeBase...');
functions.addToKnowledgeBase(mockReq, mockRes);