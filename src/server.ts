import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient, AdpcQuestion, AdpcOption, User } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

const API_KEY = process.env.API_KEY || 'adpc_master_key_2026';

interface SubmissionResponse {
  questionId: string;
  optionId: string;
}

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
        metadata: request.body ?? {}
      }
    });
  } catch (err) {
    request.log.warn('Audit log failed', err as Error);
  }
});

app.post('/api/users', async (request: FastifyRequest, reply: FastifyReply) => {
  const body = request.body as { email?: string; name?: string };
  if (!body.email) return reply.code(422).send({ error: 'email required' });

  const user = await prisma.user.upsert({
    where: { email: body.email },
    update: { name: body.name ?? '' },
    create: { email: body.email, name: body.name ?? '' }
  });
  return reply.send(user);
});

app.get('/api/questions', async (request: FastifyRequest, reply: FastifyReply) => {
  const query = request.query as { version?: string };
  const version = query.version ?? 'v1';

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

  return reply.send({ version, questions });
});

app.post('/api/submissions', async (request: FastifyRequest, reply: FastifyReply) => {
  const body = request.body as { userId?: string; version?: string; responses?: SubmissionResponse[] };
  if (!body.responses || !Array.isArray(body.responses) || body.responses.length === 0) {
    return reply.code(422).send({ error: 'responses must be a non-empty array' });
  }
  if (!body.userId) return reply.code(422).send({ error: 'userId is required' });

  const responses = body.responses.map((r: SubmissionResponse) => ({
    questionId: String(r.questionId),
    optionId: String(r.optionId)
  }));

  const qIds = responses.map((r: SubmissionResponse) => r.questionId);
  const uniqueQ = new Set(qIds);
  if (uniqueQ.size !== qIds.length) {
    return reply.code(422).send({ error: 'Duplicate questionId in responses' });
  }

  try {
    const resultPayload = await prisma.$transaction(async (tx) => {
      const questions = await tx.adpcQuestion.findMany({
        where: { id: { in: qIds } },
        include: { options: true }
      });

      const foundQIds = new Set(questions.map((q: AdpcQuestion) => q.id));
      const missing = qIds.filter((id: string) => !foundQIds.has(id));
      if (missing.length > 0) {
        throw { status: 422, message: `Question(s) not found: ${missing.join(',')}` };
      }

      const optionToQuestion: Record<string, { questionId: string; weight: number; dimension: string }> = {};
      for (const q of questions) {
        for (const opt of q.options as AdpcOption[]) {
          optionToQuestion[opt.id] = {
            questionId: q.id,
            weight: opt.weight ?? 0,
            dimension: opt.dimension ?? q.dimension ?? 'UNKNOWN'
          };
        }
      }

      for (const r of responses) {
        const meta = optionToQuestion[r.optionId];
        if (!meta) {
          throw { status: 422, message: `optionId not found: ${r.optionId}` };
        }
        if (meta.questionId !== r.questionId) {
          throw { status: 422, message: `optionId ${r.optionId} does not belong to question ${r.questionId}` };
        }
      }

      const submission = await tx.adpcSubmission.create({
        data: {
          userId: body.userId!,
          version: body.version ?? 'v1',
          status: 'PROCESSED',
          responses: {
            create: responses.map(r => ({
              questionId: r.questionId,
              optionId: r.optionId
            }))
          }
        }
      });

      const minPossible: Record<string, number> = {};
      const maxPossible: Record<string, number> = {};
      for (const q of questions) {
        const weights = (q.options as AdpcOption[]).map(o => o.weight ?? 0);
        const dim = q.dimension ?? 'UNKNOWN';
        minPossible[dim] = (minPossible[dim] ?? 0) + Math.min(...weights);
        maxPossible[dim] = (maxPossible[dim] ?? 0) + Math.max(...weights);
      }

      const chosen: Record<string, number> = {};
      for (const r of responses) {
        const meta = optionToQuestion[r.optionId];
        const dim = meta.dimension;
        chosen[dim] = (chosen[dim] ?? 0) + meta.weight;
      }

      const dims = ['DOMINANCIA', 'INFLUENCIA', 'ESTABILIDADE', 'CONFORMIDADE'];
      const scores: Record<string, number> = {};
      for (const dim of dims) {
        const ch = chosen[dim] ?? 0;
        const min = minPossible[dim] ?? 0;
        const max = maxPossible[dim] ?? 0;
        const denom = max - min;
        scores[dim] = denom > 0 ? Math.round(((ch - min) / denom)  100) : 0;
      }

      const primaryProfile = Object.keys(scores).sort((a, b) => scores[b] - scores[a])[0] ?? 'EQUILIBRADO';

      const adpcResult = await tx.adpcResult.create({
        data: {
          submissionId: submission.id,
          scores,
          primaryProfile,
          explanations: scores as any,
          pdfUrl: null
        }
      });

      return { submissionId: submission.id, result: adpcResult };
    });

    return reply.send(resultPayload);
  } catch (err: any) {
    if (err && err.status && err.message) {
      return reply.code(err.status).send({ error: err.message });
    }
    request.log.error('submission failed', err);
    return reply.code(500).send({ error: 'Failed to process submission', details: err?.message ?? String(err) });
  }
});

app.get('/api/results/:submissionId', async (request: FastifyRequest, reply: FastifyReply) => {
  const { submissionId } = request.params as { submissionId: string };
  if (!submissionId) return reply.code(422).send({ error: 'submissionId required' });

  const result = await prisma.adpcResult.findUnique({
    where: { submissionId },
    include: { submission: true }
  });
  if (!result) return reply.code(404).send({ error: 'Result not found' });
  return reply.send(result);
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
