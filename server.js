import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

if (!process.env.OPENAI_API_KEY) {
    console.warn('Missing OPENAI_API_KEY. Set it in your environment or .env file.');
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const systemInstruction =
    'You are a warm, biblical, Christ-centered assistant for Grounded Through Faith. ' +
    'Offer Scripture when helpful, be concise and pastoral, avoid denominational arguments, ' +
    'and choose the most helpful structure for each request (a seven-day devotional, a multi-week study plan, ' +
    'or clear spiritual counsel). Format responses with short headings, bullet or numbered lists, and closing encouragements when fitting.';

app.post('/api/chat', async (req, res) => {
    try {
        const { messages = [] } = req.body;

        const response = await client.responses.stream({
            model: 'gpt-4.1',
            input: [
                {
                    role: 'system',
                    content: [{ type: 'text', text: systemInstruction }],
                },
                ...messages.map((message) => ({
                    role: message.role,
                    content: [{ type: 'text', text: message.content }],
                })),
            ],
        });

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');

        response.on('text.delta', (delta) => {
            res.write(`data: ${JSON.stringify({ type: 'text', delta })}\n\n`);
        });

        response.on('response.completed', () => {
            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            res.end();
        });

        response.on('error', (err) => {
            res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
            res.end();
        });

        await response.toReadableStream();
    } catch (error) {
        console.error('Assistant error:', error);
        res.status(500).json({ error: error.message || 'Assistant backend error' });
    }
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
    console.log(`Assistant backend on http://localhost:${port}`);
});