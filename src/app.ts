import fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const app = fastify({ logger: true });

// --- MIDDLEWARE: API KEY & AUDITORIA ---

app.addHook('onRequest', async (request, reply) => {
  request.headers['x-request-id'] = uuidv4();

  if (request.url === '/') return;

  const apiKey = request.headers['x-api-key'];
  const validKey = process.env.API_KEY;

  if (!apiKey || apiKey !== validKey) {
    reply.code(401).send({ error: 'Não autorizado: API Key inválida ou ausente.' });
  }
});

app.addHook('onResponse', async (request, reply) => {
  if (request.url === '/') return;

  try {
    await prisma.auditLog.create({
      data: {
        requestId: String(request.headers['x-request-id']),
        action: `${request.method} ${request.url}`,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        statusCode: reply.statusCode,
        metadata: {
          body: request.body as any,
          params: request.params as any,
          query: request.query as any
        }
      }
    });
  } catch (err) {
    app.log.error(err as Error, 'Erro ao gravar log de auditoria');
  }
});

// --- ROTAS ---

app.get('/', async () => {
  return { 
    status: 'Sistema ADPC Online', 
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString() 
  };
});

app.post('/api/users', async (request, reply) => {
  const { email, name } = request.body as { email: string, name: string };
  
  const user = await prisma.user.create({
    data: { email, name }
  });

  return user;
});

// --- INICIALIZAÇÃO ---

const start = async () => {
  try {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;
    const host = '0.0.0.0';

    await app.listen({ port, host });
    console.log(`🚀 Servidor ADPC Protegido rodando na porta ${port}`);
  } catch (err) {
    app.log.error(err as Error);
    process.exit(1);
  }
};

start();

export default app;
