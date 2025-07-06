// Temporary query service that bypasses vector search for testing
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const API_KEY = process.env.GEMINI_API_KEY || 'your-api-key-here';
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

app.get('/', (req, res) => {
    res.json({ 
        status: 'Temporary Query Service (Vector Search Bypassed)',
        timestamp: new Date().toISOString()
    });
});

app.post('/chat', async (req, res) => {
    const { userId, question } = req.body;
    
    if (!userId || !question) {
        return res.status(400).json({ error: "Missing required fields" });
    }
    
    try {
        // Bypass vector search and give a helpful response
        const prompt = `You are an AI assistant. The user asked: "${question}". 
        
        Since this is a test mode, respond helpfully but mention that the full AI Knowledge Base system is being set up. Encourage them to add content to their library using the "Add to AI Knowledge" button once the system is fully operational.`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const answer = response.text();
        
        res.json({ 
            answer: answer + "\n\n💡 Note: This is test mode. Once your vector search is configured, I'll be able to search through your specific content!",
            sources: [],
            mode: "bypass"
        });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ 
            error: "Chat service temporarily unavailable. Please check API key configuration.",
            details: error.message 
        });
    }
});

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
    console.log(`🚀 Temporary query service running on port ${PORT}`);
    console.log('🔧 This bypasses vector search for testing purposes');
});
