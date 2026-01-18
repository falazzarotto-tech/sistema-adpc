import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from './app.js';
describe('Fase 1: Infraestrutura - Health Check', () => {
    beforeAll(async () => {
        await app.ready();
    });
    afterAll(async () => {
        await app.close();
    });
    it('deve retornar o formato de resposta ADPC {ok, data, error, meta}', async () => {
        const response = await request(app.server).get('/health');
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('ok', true);
        expect(response.body).toHaveProperty('meta');
        expect(response.body.meta).toHaveProperty('request_id');
    });
});
//# sourceMappingURL=app.test.js.map