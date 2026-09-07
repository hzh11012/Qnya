import { FastifyInstance } from 'fastify';
import {
  SendCodeSchema,
  LoginSchema,
  type SendCodeBody,
  type LoginBody,
  UserInfoSchema
} from '../../../schemas/auth.js';
import { SuccessResponseSchema } from '../../../schemas/common.js';

export default async function (fastify: FastifyInstance) {
  const {
    authenticate,
    verificationService,
    usersRepository,
    sessionRepository,
    httpErrors
  } = fastify;

  fastify.get(
    '/me',
    {
      preHandler: [authenticate],
      schema: {
        response: {
          200: SuccessResponseSchema(UserInfoSchema)
        }
      }
    },
    async (request, reply) => {
      const userId = request.sessionData!.userId;

      const user = await usersRepository.findById(userId);
      if (!user) {
        throw httpErrors.notFound('用户不存在');
      }

      return reply.success('获取用户信息成功', user);
    }
  );

  fastify.post<{ Body: SendCodeBody }>(
    '/send-code',
    {
      // 发送验证码会触发真实邮件，需比全局限流更严格的防滥用限制（防邮件轰炸）
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '1 minute'
        }
      },
      schema: {
        body: SendCodeSchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (_request, reply) => {
      const { email } = _request.body;

      await verificationService.sendVerificationCode(email);
      return reply.success('验证码已发送到您的邮箱');
    }
  );

  fastify.post<{ Body: LoginBody }>(
    '/login',
    {
      schema: {
        body: LoginSchema,
        response: {
          200: SuccessResponseSchema(UserInfoSchema)
        }
      }
    },
    async (request, reply) => {
      const { email, code } = request.body;

      // 验证验证码
      const valid = await verificationService.verifyCode(email, code);
      if (!valid) {
        throw httpErrors.badRequest('验证码错误或已过期');
      }

      // 获取或创建用户
      const user = await usersRepository.findOrCreate(email);

      // 创建 session
      const sessionToken = await sessionRepository.createSession(
        user.id,
        user.email,
        user.status,
        user.role
      );

      const cookieOptions = sessionRepository.getCookieOptions();
      reply.setCookie('session', sessionToken, cookieOptions);

      return reply.success('登录成功', user);
    }
  );

  fastify.post(
    '/logout',
    {
      preHandler: [authenticate],
      schema: {
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const sessionToken = request.sessionToken;

      if (sessionToken) {
        try {
          await sessionRepository.deleteSession(sessionToken);
        } catch (error) {
          // 登出时删除 session 失败仅记录日志，不影响登出流程
          fastify.log.warn({ error }, 'Failed to delete session');
        }
      }

      reply.clearCookie('session', { path: '/' });
      return reply.success('登出成功');
    }
  );
}
