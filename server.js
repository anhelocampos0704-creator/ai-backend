const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { OpenAI } = require('openai');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());
app.use(cors());

// ============================================================================
// 1. CONEXIÓN A LA BASE DE DATOS SAKILA)
//
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sakila',
    port: Number(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Comprobar la conexión con la base de datos al iniciar el servidor
(async () => {
    try {
        const connection = await db.getConnection();
        console.log('✅ Conexión establecida exitosamente con la base de datos MySQL (Sakila).');
        connection.release();
    } catch (error) {
        console.error('⚠️  No se pudo conectar a la base de datos MySQL (Sakila):', error.message);
        console.error('👉 Asegúrate de que el servicio MySQL esté corriendo y que los datos en .env (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT) sean correctos.');
    }
})();

const openrouter = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
        'HTTP-Referer': 'https://tu-sitio-web.com',
        'X-Title': 'Agente IA Sakila',
    },
});

//DEFINICIÓN DE HERRAMIENTAS 

const tools = [
    {
        type: 'function',
        function: {
            name: 'ejecutar_consulta_sql',
            description: 'Ejecuta una consulta SQL SELECT de solo lectura directamente en la base de datos conectada de Sakila. Úsala para buscar o agregar cualquier información sobre películas, inventario, clientes, alquileres, pagos, tiendas y personal.',
            parameters: {
                type: 'object',
                properties: {
                    consulta: {
                        type: 'string',
                        description: 'Sentencia SQL SELECT que se ejecutará en Sakila. No se permiten sentencias de modificación (INSERT, UPDATE, DELETE, DROP, etc.).'
                    }
                },
                required: ['consulta']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'recomendar_peliculas_accion_largas',
            description: 'Obtiene las películas de la categoría Acción con una duración superior a la indicada (por defecto más de 120 minutos / 2 horas) que más veces han sido alquiladas en la tienda.',
            parameters: {
                type: 'object',
                properties: {
                    minutos_minimos: {
                        type: 'number',
                        description: 'Duración mínima de la película en minutos (por defecto 120).'
                    },
                    limite: {
                        type: 'number',
                        description: 'Cantidad máxima de películas a recomendar (por defecto 3).'
                    }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'detectar_clientes_en_riesgo',
            description: 'Identifica a los clientes que llevan más tiempo sin realizar ningún alquiler de películas (clientes en riesgo de abandono / churn), calculando los días de inactividad respecto a la fecha más reciente registrada en la base de datos.',
            parameters: {
                type: 'object',
                properties: {
                    limite: {
                        type: 'number',
                        description: 'Número de clientes a retornar (por defecto 5).'
                    }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'analizar_movimiento_y_recaudacion_semanal',
            description: 'Realiza un análisis del movimiento en las tiendas agrupado por día de la semana (lunes a domingo), indicando el total de alquileres, transacciones de pago y el dinero promedio recaudado por día.',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    }
];


async function ejecutarHerramienta(nombre, argumentos) {
    try {
        switch (nombre) {
            case 'ejecutar_consulta_sql': {
                const { consulta } = argumentos;
                if (!consulta) return { error: 'Se requiere el parámetro consulta.' };

                // Seguridad básica: permitir únicamente consultas de lectura
                const queryTrim = consulta.trim().toUpperCase();
                const permitidos = ['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'EXPLAIN'];
                const esLectura = permitidos.some(palabra => queryTrim.startsWith(palabra));

                if (!esLectura) {
                    return { error: 'Seguridad: Solo se permiten consultas de lectura (SELECT, SHOW, DESCRIBE).' };
                }

                const [filas] = await db.query(consulta);
                return { resultados: filas };
            }

            case 'recomendar_peliculas_accion_largas': {
                const minMinutos = Number(argumentos?.minutos_minimos) || 120;
                const limite = Number(argumentos?.limite) || 3;

                const sql = `
                    SELECT 
                        f.film_id,
                        f.title AS titulo,
                        f.description AS descripcion,
                        f.length AS duracion_minutos,
                        f.rating AS clasificacion,
                        COUNT(r.rental_id) AS total_alquileres
                    FROM film f
                    INNER JOIN film_category fc ON f.film_id = fc.film_id
                    INNER JOIN category c ON fc.category_id = c.category_id
                    INNER JOIN inventory i ON f.film_id = i.film_id
                    INNER JOIN rental r ON i.inventory_id = r.inventory_id
                    WHERE LOWER(c.name) = 'action'
                      AND f.length > ?
                    GROUP BY f.film_id, f.title, f.description, f.length, f.rating
                    ORDER BY total_alquileres DESC
                    LIMIT ?;
                `;
                const [filas] = await db.query(sql, [minMinutos, limite]);
                return { peliculas: filas };
            }

            case 'detectar_clientes_en_riesgo': {
                const limite = Number(argumentos?.limite) || 5;

                const sql = `
                    SELECT 
                        c.customer_id,
                        c.first_name AS nombre,
                        c.last_name AS apellido,
                        c.email,
                        c.active AS estado_activo,
                        MAX(r.rental_date) AS ultimo_alquiler,
                        DATEDIFF(
                            (SELECT MAX(rental_date) FROM rental),
                            MAX(r.rental_date)
                        ) AS dias_sin_alquilar,
                        COUNT(r.rental_id) AS total_alquileres_historicos
                    FROM customer c
                    LEFT JOIN rental r ON c.customer_id = r.customer_id
                    GROUP BY c.customer_id, c.first_name, c.last_name, c.email, c.active
                    HAVING ultimo_alquiler IS NOT NULL
                    ORDER BY ultimo_alquiler ASC
                    LIMIT ?;
                `;
                const [filas] = await db.query(sql, [limite]);
                return { clientes_en_riesgo: filas };
            }

            case 'analizar_movimiento_y_recaudacion_semanal': {
                const sql = `
                    SELECT 
                        DAYNAME(p.payment_date) AS dia_semana,
                        DAYOFWEEK(p.payment_date) AS numero_dia,
                        COUNT(p.payment_id) AS total_transacciones,
                        ROUND(SUM(p.amount), 2) AS total_recaudado,
                        ROUND(AVG(p.amount), 2) AS promedio_por_transaccion,
                        COUNT(DISTINCT DATE(p.payment_date)) AS dias_registrados,
                        ROUND(SUM(p.amount) / COUNT(DISTINCT DATE(p.payment_date)), 2) AS promedio_recaudado_por_dia
                    FROM payment p
                    GROUP BY DAYNAME(p.payment_date), DAYOFWEEK(p.payment_date)
                    ORDER BY total_transacciones DESC;
                `;
                const [filas] = await db.query(sql);
                return { analisis_por_dia: filas };
            }

            default:
                return { error: `Herramienta desconocida: ${nombre}` };
        }
    } catch (error) {
        console.error(`Error al ejecutar herramienta ${nombre}:`, error);
        return {
            error: `Error de base de datos al ejecutar ${nombre}: ${error.message}`,
            detalle: 'Verifique que la base de datos Sakila esté creada e importada en MySQL.'
        };
    }
}


const SYSTEM_PROMPT = `
Eres un asistente de inteligencia artificial experto en análisis de datos conectado a la base de datos relacional Sakila en MySQL.

Tienes herramientas (tools) disponibles para consultar la base de datos externa en tiempo real:
1. "recomendar_peliculas_accion_largas": Para obtener películas de acción de más de 2 horas muy alquiladas.
2. "detectar_clientes_en_riesgo": Para saber qué clientes llevan mucho tiempo sin alquilar y podrían abandonar el servicio.
3. "analizar_movimiento_y_recaudacion_semanal": Para analizar el tráfico y la recaudación promedio según el día de la semana.
4. "ejecutar_consulta_sql": Para ejecutar cualquier consulta SELECT sobre la base de datos Sakila (tablas film, customer, rental, payment, category, inventory, store, etc.).

REGLAS DE CONDUCTA:
- SIEMPRE utiliza las herramientas para responder preguntas sobre los datos de Sakila. No inventes datos ni asumas resultados sin consultar la base de datos conectada.
- En la base de datos Sakila, las fechas registradas son históricas (periodo 2005-2006). Para calcular el tiempo de inactividad de los clientes, se toma como referencia la fecha más reciente de alquiler en la base de datos.
- Presenta tus respuestas de manera clara, profesional, amable y con formato estructurado (listas, negritas, detalles cuantitativos) en español.
`;

app.post('/api/chat', async (req, res) => {
    try {
        const { message, history } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'El mensaje del usuario es obligatorio.' });
        }

        // Construir la conversación incluyendo el prompt del sistema, el historial previo y el mensaje actual
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...(history || []).map(msg => ({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msg.content
            })),
            { role: 'user', content: message }
        ];

        // Primera llamada al modelo con las herramientas declaradas
        let completion = await openrouter.chat.completions.create({
            model: 'openai/gpt-4o-mini',
            messages: messages,
            tools: tools,
            tool_choice: 'auto',
        });

        let responseMessage = completion.choices[0].message;

        // Bucle de agente: Si la IA decide llamar a una o más herramientas, las ejecutamos
        // contra la base de datos y le devolvemos los resultados al modelo
        let iteraciones = 0;
        const MAX_ITERACIONES = 5;

        while (responseMessage.tool_calls && responseMessage.tool_calls.length > 0 && iteraciones < MAX_ITERACIONES) {
            iteraciones++;
            messages.push(responseMessage);

            for (const toolCall of responseMessage.tool_calls) {
                const nombreFuncion = toolCall.function.name;
                let argumentos = {};
                try {
                    argumentos = JSON.parse(toolCall.function.arguments || '{}');
                } catch (err) {
                    console.error('Error al parsear argumentos de la herramienta:', err);
                }

                console.log(`🤖 [Agente IA] Llamando herramienta: "${nombreFuncion}" con argumentos:`, argumentos);
                const resultado = await ejecutarHerramienta(nombreFuncion, argumentos);

                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(resultado)
                });
            }

            // Volver a llamar al modelo con los resultados de las herramientas
            completion = await openrouter.chat.completions.create({
                model: 'openai/gpt-4o-mini',
                messages: messages,
                tools: tools,
            });

            responseMessage = completion.choices[0].message;
        }

        const reply = responseMessage.content;
        res.json({ reply });

    } catch (error) {
        console.error('Error al comunicarse con OpenRouter o procesar la solicitud:', error);
        res.status(500).json({
            error: 'Error interno al procesar la solicitud con la IA.',
            detalle: error.message
        });
    }
});

// Endpoint de diagnóstico para verificar el estado de la conexión a la base de datos
app.get('/api/db-status', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT COUNT(*) AS total_tablas FROM information_schema.tables WHERE table_schema = ?', [process.env.DB_NAME || 'sakila']);
        res.json({
            estado: 'conectado',
            base_de_datos: process.env.DB_NAME || 'sakila',
            tablas_detectadas: rows[0].total_tablas
        });
    } catch (error) {
        res.status(500).json({
            estado: 'error_conexion',
            mensaje: error.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
