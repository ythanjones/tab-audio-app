const { PredictionServiceClient } = require('@google-cloud/aiplatform');

// Try different configurations to find what works
const PROJECT_ID = 'tab-audio-app';

async function testEmbeddingFormats() {
    console.log('🧪 Testing different embedding configurations...\n');
    
    // Test multiple regions and formats
    const configurations = [
        {
            location: 'us-central1',
            endpoint: 'us-central1-aiplatform.googleapis.com',
            model: 'text-embedding-004'
        },
        {
            location: 'us-central1', 
            endpoint: 'us-central1-aiplatform.googleapis.com',
            model: 'textembedding-gecko@003'
        },
        {
            location: 'europe-west2',
            endpoint: 'europe-west2-aiplatform.googleapis.com', 
            model: 'text-embedding-004'
        },
        {
            location: 'us-central1',
            endpoint: 'us-central1-aiplatform.googleapis.com',
            model: 'text-embedding-gecko@003'
        }
    ];
    
    for (let i = 0; i < configurations.length; i++) {
        const config = configurations[i];
        console.log(`${i + 1}️⃣ Testing: ${config.model} in ${config.location}`);
        
        try {
            const clientOptions = { apiEndpoint: config.endpoint };
            const client = new PredictionServiceClient(clientOptions);
            
            const endpoint = `projects/${PROJECT_ID}/locations/${config.location}/publishers/google/models/${config.model}`;
            
            // Try the format that works with newer models
            const instance = {
                content: "test embedding query",
                task_type: "RETRIEVAL_QUERY"
            };
            
            const request = { endpoint, instances: [instance] };
            
            console.log(`   📡 Making request to: ${endpoint}`);
            const [response] = await client.predict(request);
            
            const embedding = response.predictions[0].structValue.fields.embedding.listValue.values.map(v => v.numberValue);
            
            console.log(`   ✅ SUCCESS! Generated ${embedding.length} dimensional embedding`);
            console.log(`   🎉 WORKING CONFIGURATION FOUND:`);
            console.log(`      - Location: ${config.location}`);
            console.log(`      - Model: ${config.model}`);
            console.log(`      - Endpoint: ${config.endpoint}`);
            console.log(`      - Dimensions: ${embedding.length}\n`);
            
            // Test with different content
            const testContent = "machine learning and artificial intelligence";
            const testInstance = {
                content: testContent,
                task_type: "RETRIEVAL_DOCUMENT" 
            };
            const testRequest = { endpoint, instances: [testInstance] };
            const [testResponse] = await client.predict(testRequest);
            const testEmbedding = testResponse.predictions[0].structValue.fields.embedding.listValue.values.map(v => v.numberValue);
            
            console.log(`   ✅ Document embedding also works: ${testEmbedding.length} dimensions`);
            console.log(`   🚀 This configuration is ready for production!\n`);
            return config; // Return the working config
            
        } catch (error) {
            console.log(`   ❌ Failed: ${error.message}\n`);
        }
    }
    
    console.log('❌ No working embedding configuration found');
    return null;
}

testEmbeddingFormats().then(workingConfig => {
    if (workingConfig) {
        console.log('🎯 NEXT STEP: Update your query-service with this working configuration!');
    }
}).catch(console.error);
