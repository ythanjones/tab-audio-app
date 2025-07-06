const { PredictionServiceClient } = require('@google-cloud/aiplatform');

// Configuration - matching your services
const PROJECT_ID = 'tab-audio-app';
const LOCATION = 'europe-west2';
const VECTOR_SEARCH_ENDPOINT_ID = '6958254938333904896';
const DEPLOYED_INDEX_ID = 'tab_audio_app_1751241281157';

const clientOptions = { apiEndpoint: `${LOCATION}-aiplatform.googleapis.com` };
const predictionServiceClient = new PredictionServiceClient(clientOptions);

async function testVectorSearch() {
    console.log('🧪 Testing Vector Search Configuration...');
    console.log(`Project: ${PROJECT_ID}`);
    console.log(`Location: ${LOCATION}`);
    console.log(`Endpoint ID: ${VECTOR_SEARCH_ENDPOINT_ID}`);
    console.log(`Deployed Index ID: ${DEPLOYED_INDEX_ID}`);
    
    try {
        // Test 1: Try to generate a simple embedding
        console.log('\n1️⃣ Testing embedding generation...');
        const endpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-embedding-001`;
        const instance = { 
            content: "test query",
            task_type: "RETRIEVAL_QUERY"
        };
        const request = { endpoint, instances: [instance] };
        
        const [response] = await predictionServiceClient.predict(request);
        const embedding = response.predictions[0].structValue.fields.embedding.listValue.values.map(v => v.numberValue);
        console.log(`✅ Embedding generated: ${embedding.length} dimensions`);
        
        // Test 2: Try to query the vector search (this is where it's failing)
        console.log('\n2️⃣ Testing vector search query...');
        const indexEndpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/indexEndpoints/${VECTOR_SEARCH_ENDPOINT_ID}`;
        
        const findNeighborsRequest = {
            indexEndpoint,
            deployedIndexId: DEPLOYED_INDEX_ID,
            queries: [{
                datapoint: {
                    datapointId: 'test-query-' + Date.now(),
                    featureVector: embedding
                },
                neighborCount: 3,
                restricts: [{
                    namespace: 'userId',
                    allowList: ['test-user']
                }]
            }]
        };
        
        console.log('Request structure:', JSON.stringify(findNeighborsRequest, null, 2));
        
        const [searchResponse] = await predictionServiceClient.findNeighbors(findNeighborsRequest);
        console.log('✅ Vector search successful!');
        console.log('Response:', JSON.stringify(searchResponse, null, 2));
        
    } catch (error) {
        console.error('❌ Vector search test failed:');
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        console.error('Error details:', error.details);
        
        if (error.code === 3) {
            console.error('\n🔍 GRPC Error Code 3 (INVALID_ARGUMENT) suggests:');
            console.error('   • Vector search endpoint does not exist');
            console.error('   • Deployed index ID is incorrect');
            console.error('   • Request format is invalid');
            console.error('   • Embedding dimensions do not match index');
        }
    }
}

testVectorSearch();
