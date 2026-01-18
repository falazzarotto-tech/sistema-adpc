import fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const app = fastify({ logger: true });

// --- MIDDLEWARE: API KEY & AUDITORIA ---

app.addHook('onRequest', async (request, reply) => {
  // 1. Gerar Request ID único para rastreamento
  request.headers['x-request-id'] = uuidv4();

  // 2. Pular validação de API Key na rota raiz (Healthcheck)
  if (request.url === '/') return;

  // 3. Validar API Key
  const apiKey = request.headers['x-api-key'];
  const validKey = process.env.API_KEY;

  if (!apiKey || apiKey !== validKey) {
    reply.code(401).send({ error: 'Não autorizado: API Key inválida ou ausente.' });
  }
});

// Hook para gravar o Log de Auditoria após a resposta ser enviada
app.addHook('onResponse', async (request, reply) => {
  if (request.url === '/') return; // Não logar healthchecks simples

  try {
    await prisma.auditLog.create({
      data: {
        requestId: String(request.headers['x-request-id']),
        action: `${request.method} ${request.url}`,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        statusCode: reply.statusCode,
        metadata: {
          body: request.body,
          params: request.params,
          query: request.query
        }
      }
    });
  } catch (err) {
    app.log.error('Erro ao gravar log de auditoria:', err);
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

// Exemplo de rota protegida (Cadastro de Usuário)
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
    app.log.error(err);
    process.exit(1);
  }
};

start();

export default app;
