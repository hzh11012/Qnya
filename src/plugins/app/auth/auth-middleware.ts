import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import type { SessionData } from './session-repository.js';

declare module 'fastify' {
  interface FastifyRequest {
    sessionData: SessionData | null;
    sessionToken: string | null;
  }

  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  }
}

const createAuthMiddleware = (fastify: FastifyInstance) => {
  const { sessionRepository } = fastify;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionCookie = request.cookies.session;

    if (!sessionCookie) {
      return reply.unauthorized('未登录');
    }

    const unsigned = request.unsignCookie(sessionCookie);

    if (!unsigned.valid) {
      reply.clearCookie('session', { path: '/' });
      return reply.unauthorized('无效会话');
    }

    const sessionToken = unsigned.value;

    if (!sessionToken) {
      return reply.unauthorized('未登录');
    }

    const session = await sessionRepository.getSession(sessionToken);

    if (!session) {
      reply.clearCookie('session', { path: '/' });
      return reply.unauthorized('会话已过期');
    }

    if (!session.status) {
      reply.clearCookie('session', { path: '/' });
      return reply.forbidden('账号已停用');
    }

    // 自动续签
    if (await sessionRepository.shouldRenew(sessionToken)) {
      await sessionRepository.renewSession(sessionToken, session);
      const cookieOptions = sessionRepository.getCookieOptions();
      reply.setCookie('session', sessionToken, cookieOptions);
    }

    request.sessionData = session;
    request.sessionToken = sessionToken;
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    // 装饰 request
    fastify.decorateRequest('sessionData', null);
    fastify.decorateRequest('sessionToken', null);

    const authenticate = createAuthMiddleware(fastify);
    fastify.decorate('authenticate', authenticate);
  },
  {
    name: 'auth-middleware',
    dependencies: ['session-repository', '@fastify/cookie']
  }
);
