// File: test-chromadb-integration.js
// Test script to verify ChromaDB implementation is working

const fetch = require('node-fetch');
const { ChromaClient } = require('chromadb');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Configuration - Update these values
const CONFIG = {
    EMBEDDING_FUNCTION_URL: 'https://europe-west2-tab-audio-app.cloudfunctions.net/addToKnowledgeBase',
    QUERY_SERVICE_URL: 'http://localhost:8080/chat', // Update when deployed
    CHROMADB_URL: 'http://localhost:8000',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'AIzaSyCH7jBG_iSTFAYrWEtazEvlXk2ZC413AGo',
    TEST_USER_ID: 'test-user-' + Date.now()
};

// Test data
const TEST_DOCUMENTS = [
    {
        documentId: 'test-doc-1',
        text: 'ChromaDB is an open-source vector database designed for AI applications. It allows you to store embeddings alongside metadata and provides fast similarity search.',
        title: 'Introduction to ChromaDB',
        documentType: 'transcript',
        collectionId: 'test-collection'
    },
    {
        documentId: 'test-doc-2',
        text: 'Vector embeddings are numerical representations of text that capture semantic meaning. They enable similarity search and are fundamental to modern AI applications.',
        title: 'Understanding Vector Embeddings',
        documentType: 'transcript',
        collectionId: 'test-collection'
    },
    {
        documentId: 'test-packet-1',
        text: 'Machine learning models can convert text into vectors. These vectors can then be compared to find similar content.',
        title: 'ML and Vectors Learning Packet',
        documentType: 'learning_packet',
        collectionId: 'test-collection'
    }
];

const TEST_QUERIES = [
    'What is ChromaDB?',
    'How do vector embeddings work?',
    'Tell me about similarity search',
    'What are the benefits of using a vector database?'
];

// Color codes for console output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

async function testDirectChromaDB() {
    console.log(`\n${colors.blue}=== Testing Direct ChromaDB Connection ===${colors.reset}`);
    
    try {
        const client = new ChromaClient({ path: CONFIG.CHROMADB_URL });
        const collections = await client.listCollections();
        console.log(`${colors.green}✓ Connected to ChromaDB${colors.reset}`);
        console.log(`  Collections found: ${collections.length}`);
        return true;
    } catch (error) {
        console.log(`${colors.red}✗ Failed to connect to ChromaDB${colors.reset}`);
        console.log(`  Error: ${error.message}`);
        console.log(`  Make sure ChromaDB is running at ${CONFIG.CHROMADB_URL}`);
        return false;
    }
}

async function testEmbeddingGeneration() {
    console.log(`\n${colors.blue}=== Testing Embedding Generation ===${colors.reset}`);
    
    try {
        const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
        
        const result = await model.embedContent({
            content: { parts: [{ text: "Test embedding" }] },
            taskType: "RETRIEVAL_DOCUMENT"
        });
        
        console.log(`${colors.green}✓ Embedding generation successful${colors.reset}`);
        console.log(`  Embedding dimensions: ${result.embedding.values.length}`);
        return true;
    } catch (error) {
        console.log(`${colors.red}✗ Embedding generation failed${colors.reset}`);
        console.log(`  Error: ${error.message}`);
        console.log(`  Check your GEMINI_API_KEY`);
        return false;
    }
}

async function testAddToKnowledgeBase() {
    console.log(`\n${colors.blue}=== Testing Add to Knowledge Base ===${colors.reset}`);
    
    try {
        const response = await fetch(CONFIG.EMBEDDING_FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: CONFIG.TEST_USER_ID,
                documents: TEST_DOCUMENTS
            })
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            console.log(`${colors.green}✓ Successfully added documents to knowledge base${colors.reset}`);
            console.log(`  Total: ${result.summary.total}`);
            console.log(`  Successful: ${result.summary.successful}`);
            console.log(`  Failed: ${result.summary.failed}`);
            return true;
        } else {
            console.log(`${colors.red}✗ Failed to add documents${colors.reset}`);
            console.log(`  Response:`, result);
            return false;
        }
    } catch (error) {
        console.log(`${colors.red}✗ Failed to call embedding function${colors.reset}`);
        console.log(`  Error: ${error.message}`);
        console.log(`  Check if Firebase Functions are deployed`);
        return false;
    }
}

async function testQueryService() {
    console.log(`\n${colors.blue}=== Testing Query Service ===${colors.reset}`);
    
    // Wait a bit for embeddings to be processed
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    for (const query of TEST_QUERIES) {
        try {
            console.log(`\n${colors.yellow}Query: "${query}"${colors.reset}`);
            
            const response = await fetch(CONFIG.QUERY_SERVICE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: CONFIG.TEST_USER_ID,
                    question: query,
                    collectionIds: []
                })
            });
            
            const result = await response.json();
            
            if (response.ok) {
                console.log(`${colors.green}✓ Query successful${colors.reset}`);
                console.log(`  Sources found: ${result.sources ? result.sources.length : 0}`);
                console.log(`  Answer preview: ${result.answer.substring(0, 100)}...`);
                
                if (result.sources && result.sources.length > 0) {
                    console.log(`  Top source: "${result.sources[0].title}" (relevance: ${result.sources[0].relevanceScore})`);
                }
            } else {
                console.log(`${colors.red}✗ Query failed${colors.reset}`);
                console.log(`  Error:`, result.error);
            }
        } catch (error) {
            console.log(`${colors.red}✗ Failed to query${colors.reset}`);
            console.log(`  Error: ${error.message}`);
        }
    }
}

async function testRemoveFromKnowledgeBase() {
    console.log(`\n${colors.blue}=== Testing Remove from Knowledge Base ===${colors.reset}`);
    
    try {
        const response = await fetch(CONFIG.EMBEDDING_FUNCTION_URL.replace('addTo', 'removeFrom'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: CONFIG.TEST_USER_ID,
                documentIds: ['test-doc-1']
            })
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            console.log(`${colors.green}✓ Successfully removed document${colors.reset}`);
            console.log(`  Removed count: ${result.removedCount}`);
            return true;
        } else {
            console.log(`${colors.red}✗ Failed to remove document${colors.reset}`);
            console.log(`  Response:`, result);
            return false;
        }
    } catch (error) {
        console.log(`${colors.red}✗ Failed to call remove function${colors.reset}`);
        console.log(`  Error: ${error.message}`);
        return false;
    }
}

async function cleanup() {
    console.log(`\n${colors.blue}=== Cleaning Up Test Data ===${colors.reset}`);
    
    try {
        const client = new ChromaClient({ path: CONFIG.CHROMADB_URL });
        await client.deleteCollection({ name: `user_${CONFIG.TEST_USER_ID}` });
        console.log(`${colors.green}✓ Cleaned up test collection${colors.reset}`);
    } catch (error) {
        console.log(`${colors.yellow}⚠ Could not clean up collection (may not exist)${colors.reset}`);
    }
}

// Main test runner
async function runTests() {
    console.log(`${colors.blue}${'='.repeat(50)}${colors.reset}`);
    console.log(`${colors.blue}ChromaDB Integration Test Suite${colors.reset}`);
    console.log(`${colors.blue}${'='.repeat(50)}${colors.reset}`);
    
    console.log(`\nConfiguration:`);
    console.log(`  ChromaDB URL: ${CONFIG.CHROMADB_URL}`);
    console.log(`  Query Service: ${CONFIG.QUERY_SERVICE_URL}`);
    console.log(`  Test User ID: ${CONFIG.TEST_USER_ID}`);
    
    const tests = [
        { name: 'ChromaDB Connection', fn: testDirectChromaDB },
        { name: 'Embedding Generation', fn: testEmbeddingGeneration },
        { name: 'Add to Knowledge Base', fn: testAddToKnowledgeBase },
        { name: 'Query Service', fn: testQueryService },
        { name: 'Remove from Knowledge Base', fn: testRemoveFromKnowledgeBase }
    ];
    
    const results = [];
    
    for (const test of tests) {
        const passed = await test.fn();
        results.push({ name: test.name, passed });
        
        if (!passed && test.name === 'ChromaDB Connection') {
            console.log(`\n${colors.red}Stopping tests - ChromaDB connection required${colors.reset}`);
            break;
        }
    }
    
    // Cleanup
    await cleanup();
    
    // Summary
    console.log(`\n${colors.blue}=== Test Summary ===${colors.reset}`);
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    
    results.forEach(result => {
        const icon = result.passed ? `${colors.green}✓` : `${colors.red}✗`;
        console.log(`${icon} ${result.name}${colors.reset}`);
    });
    
    console.log(`\nTotal: ${passed}/${total} tests passed`);
    
    if (passed === total) {
        console.log(`\n${colors.green}🎉 All tests passed! Your ChromaDB integration is working correctly.${colors.reset}`);
    } else {
        console.log(`\n${colors.yellow}⚠️  Some tests failed. Check the errors above and ensure all services are running.${colors.reset}`);
    }
}

// Run the tests
if (require.main === module) {
    runTests().catch(error => {
        console.error(`${colors.red}Fatal error:${colors.reset}`, error);
        process.exit(1);
    });
}

module.exports = { runTests, CONFIG };