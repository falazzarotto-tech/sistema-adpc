import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

const API_KEY = process.env.API_KEY || 'adpc_master_key_2026';

app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
  const apiKey = request.headers['x-api-key'];
  if (apiKey !== API_KEY) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  try {
    await prisma.auditLog.create({
      data: {
        requestId: uuidv4(),
        action: `${request.method} ${request.url}`,
        ip: request.ip,
        userAgent: (request.headers['user-agent'] as string) || '',
        metadata: (request.body as any) ?? {}
      }
    });
  } catch (err) {
    request.log.warn('Audit log failed', err as Error);
  }
});

app.post('/api/users', async (request: FastifyRequest, reply: FastifyReply) => {
  const body = request.body as any;
  if (!body.email) return reply.code(422).send({ error: 'email required' });
  const user = await prisma.user.upsert({
    where: { email: body.email },
    update: { name: body.name ?? '' },
    create: { email: body.email, name: body.name ?? '' }
  });
  return reply.send(user);
});

app.get('/api/questions', async (request: FastifyRequest, reply: FastifyReply) => {
  const query = request.query as any;
  const version = query.version ?? 'v1';
  const questions = await prisma.adpcQuestion.findMany({
    where: { version },
    orderBy: { code: 'asc' },
    include: { options: { orderBy: { code: 'asc' }, select: { id: true, code: true, text: true } } }
  });
  return reply.send({ version, questions });
});

app.post('/api/submissions', async (request: FastifyRequest, reply: FastifyReply) => {
  const body = request.body as any;
  if (!body.responses || !Array.isArray(body.responses)) {
    return reply.code(422).send({ error: 'responses required' });
  }
  try {
    const resultPayload = await prisma.$transaction(async (tx) => {
      const questions = await tx.adpcQuestion.findMany({
        where: { id: { in: body.responses.map((r: any) => r.questionId) } },
        include: { options: true }
      });
      const optionToQuestion: Record<string, any> = {};
      questions.forEach((q: any) => {
        q.options.forEach((opt: any) => {
          optionToQuestion[opt.id] = {
            questionId: q.id,
            weight: opt.weight ?? 0,
            dimension: opt.dimension ?? q.dimension ?? 'UNKNOWN'
          };
        });
      });
      const submission = await tx.adpcSubmission.create({
        data: {
          userId: body.userId,
          version: body.version ?? 'v1',
          status: 'PROCESSED',
          responses: { create: body.responses.map((r: any) => ({ questionId: r.questionId, optionId: r.optionId })) }
        }
      });
      const chosen: Record<string, number> = {};
      body.responses.forEach((r: any) => {
        const meta = optionToQuestion[r.optionId];
        if (meta) { chosen[meta.dimension] = (chosen[meta.dimension] ?? 0) + meta.weight; }
      });
      const scores: Record<string, number> = {};
      ['DOMINANCIA', 'INFLUENCIA', 'ESTABILIDADE', 'CONFORMIDADE'].forEach(d => {
        scores[d] = chosen[d] ? Math.min(chosen[d]  10, 100) : 50;
      });
      const adpcResult = await tx.adpcResult.create({
        data: {
          submissionId: submission.id,
          scores: scores as any,
          primaryProfile: Object.keys(scores).sort((a, b) => scores[b] - scores[a])[0],
          explanations: scores as any
        }
      });
      return { submissionId: submission.id, result: adpcResult };
    });
    return reply.send(resultPayload);
  } catch (err: any) {
    return reply.code(500).send({ error: 'Failed', details: err?.message });
  }
});

app.get('/api/results/:submissionId', async (request: FastifyRequest, reply: FastifyReply) => {
  const params = request.params as any;
  const result = await prisma.adpcResult.findUnique({
    where: { submissionId: params.submissionId },
    include: { submission: true }
  });
  if (!result) return reply.code(404).send({ error: 'Result not found' });
  return reply.send(result);
});

const start = async () => {
  try {
    const port = Number(process.env.PORT || 3000);
    const host = '0.0.0.0';
    await app.listen({ port, host });
    console.log(`Servidor rodando em http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
start();
