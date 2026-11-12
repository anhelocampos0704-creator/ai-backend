const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { OpenAI } = require('openai');

const app = express();
app.use(express.json());
app.use(cors());

// Inicializar el cliente de OpenAI apuntando a la baseURL de OpenRouter[cite: 1, 2]
const openrouter = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
        'HTTP-Referer': 'https://tu-sitio-web.com', // Opcional: para rankings en OpenRouter[cite: 1, 2]
        'X-Title': 'Mi Aplicativo Web', // Opcional: nombre de tu app[cite: 1, 2]
    },
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message, history } = req.body;
        
        // Construir el arreglo de mensajes combinando historial y mensaje actual[cite: 2]
        const messages = [...(history || []), { role: 'user', content: message }];

        // Llamada a la API a través de OpenRouter[cite: 2]
        const completion = await openrouter.chat.completions.create({
            model: 'openai/gpt-4o-mini', // Modelo soportado por OpenRouter[cite: 2]
            messages: messages,
        });

        const reply = completion.choices[0].message.content;
        res.json({ reply });

    } catch (error) {
        console.error('Error al comunicarse con OpenRouter:', error);
        res.status(500).json({ error: 'Error interno al procesar la solicitud con la IA' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});