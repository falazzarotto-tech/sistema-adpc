import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

const API_KEY = process.env.API_KEY || 'adpc_master_key_2026';

// Audit hook + API key check
app.addHook('preHandler', async (request, reply) => {
  const apiKey = request.headers['x-api-key'];
  if (apiKey !== API_KEY) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  // Attempt to create an audit log, but don't block on failure
  try {
    await prisma.auditLog.create({
      data: {
        requestId: uuidv4(),
        action: `${request.method} ${request.url}`,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        metadata: (request.body as any) || {}
      }
    });
  } catch (err) {
    request.log?.warn?.('Audit log failed', err);
  }
});

// Create / upsert user
app.post('/api/users', async (request, reply) => {
  const { email, name } = request.body as { email: string; name?: string };
  if (!email) return reply.code(422).send({ error: 'email required' });

  const user = await prisma.user.upsert({
    where: { email },
    update: { name },
    create: { email, name }
  });
  return reply.send(user);
});

// List questions
app.get('/api/questions', async (request, reply) => {
  const version = (request.query as any)?.version ?? 'v1';
  const questions = await prisma.adpcQuestion.findMany({
    where: { version },
    orderBy: { code: 'asc' },
    include: {
      options: {
        orderBy: { code: 'asc' },
        select: { id: true, code: true, text: true } // do not leak weights
      }
    }
  });
  return reply.send({ version, questions });
});

// Submit responses (with validations)
app.post('/api/submissions', async (request, reply) => {
  const body = request.body as any;
  if (!body || !Array.isArray(body.responses) || body.responses.length === 0) {
    return reply.code(422).send({ error: 'responses must be a non-empty array' });
  }
  const userId = body.userId;
  if (!userId) return reply.code(422).send({ error: 'userId is required' });

  // Basic shape validation
  const responses = body.responses.map((r: any) => ({
    questionId: String(r.questionId),
    optionId: String(r.optionId)
  }));

  // 1) Duplicate questionId?
  const qIds = responses.map(r => r.questionId);
  const uniqueQ = new Set(qIds);
  if (uniqueQ.size !== qIds.length) {
    return reply.code(422).send({ error: 'Duplicate questionId in responses' });
  }

  try {
    const resultPayload = await prisma.$transaction(async (tx) => {
      // Load questions with their options (weights present but not exposed to client)
      const questions = await tx.adpcQuestion.findMany({
        where: { id: { in: qIds } },
        include: { options: true }
      });

      // 2) All questionIds exist?
      const foundQIds = new Set(questions.map(q => q.id));
      const missing = qIds.filter(id => !foundQIds.has(id));
      if (missing.length > 0) {
        throw { status: 422, message: `Question(s) not found: ${missing.join(',')}` };
      }

      // Build map optionId -> questionId and option meta (weight, dimension)
      const optionToQuestion: Record<string, { questionId: string; weight: number; dimension: string }> = {};
      for (const q of questions) {
        for (const opt of q.options) {
          optionToQuestion[(opt as any).id] = {
            questionId: q.id,
            weight: Number((opt as any).weight ?? 0),
            dimension: String((opt as any).dimension ?? q.dimension ?? 'UNKNOWN')
          };
        }
      }

      // 3) Validate each option belongs to the given question
      for (const r of responses) {
        const meta = optionToQuestion[r.optionId];
        if (!meta) {
          throw { status: 422, message: `optionId not found: ${r.optionId}` };
        }
        if (meta.questionId !== r.questionId) {
          throw { status: 422, message: `optionId ${r.optionId} does not belong to question ${r.questionId}` };
        }
      }

      // Create submission + responses
      const submission = await tx.adpcSubmission.create({
        data: {
          userId,
          version: body.version || 'v1',
          status: 'PROCESSED',
          responses: {
            create: responses.map(r => ({
              questionId: r.questionId,
              optionId: r.optionId
            }))
          }
        }
      });

      // Scoring: normalize per-dimension using question options weights
      const minPossible: Record<string, number> = {};
      const maxPossible: Record<string, number> = {};
      // compute mins/maxs from all questions used (use questions array)
      for (const q of questions) {
        const weights = (q.options as any[]).map(o => Number(o.weight ?? 0));
        const dim = String(q.dimension ?? 'UNKNOWN');
        minPossible[dim] = (minPossible[dim] ?? 0) + Math.min(...weights);
        maxPossible[dim] = (maxPossible[dim] ?? 0) + Math.max(...weights);
      }

      // sum chosen weights per dimension
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
        scores[dim] = denom > 0 ? Math.round(((ch - min) / denom) * 100) : 0;
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
    request.log?.error?.('submission failed', err);
    return reply.code(500).send({ error: 'Failed to process submission', details: err?.message ?? String(err) });
  }
});

// Get result by submissionId (persistence check)
app.get('/api/results/:submissionId', async (request, reply) => {
  const { submissionId } = request.params as any;
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
