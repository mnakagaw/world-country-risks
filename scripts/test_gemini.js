import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const models = ["gemini-1.5-flash", "gemini-1.5-flash-001", "gemini-1.5-pro", "gemini-pro"];

async function test() {
    console.log("Testing Gemini API...");
    console.log("Key available:", !!process.env.GEMINI_API_KEY);

    for (const modelName of models) {
        console.log(`\nAttempting model: ${modelName}`);
        try {
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: modelName });

            const result = await model.generateContent("Hello");
            console.log(`SUCCESS with ${modelName}:`, result.response.text().slice(0, 20));
            return; // Exit on first success
        } catch (err) {
            console.error(`FAILED ${modelName}:`, err.message);
        }
    }
}

test();
