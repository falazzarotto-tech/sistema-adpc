import fastify from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const app = fastify({
  logger: false
});

app.addHook('onRequest', async (request, reply) => {
  const requestId = (request.headers['x-request-id'] as string) || uuidv4();
  request.headers['x-request-id'] = requestId;
});

app.get('/health', async (request, reply) => {
  return {
    ok: true,
    data: { status: "ok" },
    meta: {
      request_id: request.headers['x-request-id'],
      timestamp: new Date().toISOString(),
      version: "1.0.0-adpc"
    }
  };
});

export { app };
