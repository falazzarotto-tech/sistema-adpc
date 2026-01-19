import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

const API_KEY = process.env.API_KEY || 'adpc_master_key_2026';

// Middleware de Segurança e Auditoria
app.addHook('preHandler', async (request, reply) => {
  const apiKey = request.headers['x-api-key'];
  
  if (apiKey !== API_KEY) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  // Auditoria básica
  await prisma.auditLog.create({
    data: {
      requestId: uuidv4(),
      action: `${request.method} ${request.url}`,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      metadata: (request.body as any) || {}
    }
  });
});

// Rota: Criar Usuário
app.post('/api/users', async (request, reply) => {
  const { email, name } = request.body as { email: string; name: string };
  const user = await prisma.user.upsert({
    where: { email },
    update: { name },
    create: { email, name }
  });
  return user;
});

// Rota: Listar Perguntas ADPC
app.get('/api/questions', async (request, reply) => {
  const version = (request.query as any)?.version ?? 'v1';
  const questions = await prisma.adpcQuestion.findMany({
    where: { version },
    orderBy: { code: 'asc' },
    include: {
      options: {
        orderBy: { code: 'asc' },
        select: { id: true, code: true, text: true }
      }
    }
  });
  return { version, questions };
});

// Rota: Enviar Respostas (Submissão)
app.post('/api/submissions', async (request, reply) => {
  const body = request.body as any;
  
  try {
    const result = await prisma.$transaction(async (tx) => {
      const submission = await tx.adpcSubmission.create({
        data: {
          userId: body.userId,
          version: body.version || 'v1',
          status: 'PROCESSED',
          responses: {
            create: body.responses.map((r: any) => ({
              questionId: r.questionId,
              optionId: r.optionId
            }))
          }
        }
      });

      // Cálculo simplificado para teste (Engine completa será refinada no próximo passo)
      const adpcResult = await tx.adpcResult.create({
        data: {
          submissionId: submission.id,
          scores: { DOMINANCIA: 50, INFLUENCIA: 50, ESTABILIDADE: 50, CONFORMIDADE: 50 },
          primaryProfile: 'EQUILIBRADO'
        }
      });

      return { submissionId: submission.id, result: adpcResult };
    });
    return result;
  } catch (e: any) {
    return reply.code(500).send({ error: e.message });
  }
});

const start = async () => {
  try {
    await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
start();
