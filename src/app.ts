import fastify from 'fastify';
import { z } from 'zod';

const app = fastify({
  logger: true
});

// Rota de teste para o Live Run
app.get('/', async () => {
  return { status: 'Sistema ADPC Online', timestamp: new Date().toISOString() };
});

// Lógica de inicialização (Crucial para o Railway)
const start = async () => {
  try {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;
    const host = '0.0.0.0'; // Necessário para acesso externo no Railway

    await app.listen({ port, host });
    console.log(`🚀 Servidor ADPC rodando na porta ${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

export default app;
