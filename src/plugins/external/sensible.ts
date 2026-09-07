import type {
  FastifyInstance,
  FastifyError,
  FastifyReply,
  FastifyRequest
} from 'fastify';
import fp from 'fastify-plugin';
import sensible from '@fastify/sensible';
import { normalizeError } from '../../utils/result.js';

declare module 'fastify' {
  interface FastifyReply {
    success: <T>(message: string, data?: T) => FastifyReply;
  }
}

/**
 * This plugin adds some utilities to handle http errors.
 *
 * @see {@link https://github.com/fastify/fastify-sensible}
 */
const sensiblePlugin = async (fastify: FastifyInstance) => {
  await fastify.register(sensible);

  // 添加 reply.success() 方法
  fastify.decorateReply('success', function <
    T
  >(this: FastifyReply, message: string, data?: T) {
    return this.status(200).send({
      code: 200,
      message,
      ...(data !== undefined && { data })
    });
  });

  const isProduction = fastify.config.NODE_ENV === 'production';

  // 自定义错误处理器
  // - 4xx 错误：返回原始 message（业务语义，如 "番剧不存在"）
  // - 5xx 错误：记录完整错误日志，生产环境返回通用提示，开发环境返回真实信息
  fastify.setErrorHandler(
    (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      const statusCode = error.statusCode || 500;

      if (statusCode >= 500) {
        request.log.error(
          { err: normalizeError(error) },
          'Unhandled error in %s %s',
          request.method,
          request.url
        );
      }

      reply.status(statusCode).send({
        code: statusCode,
        message:
          statusCode >= 500 && isProduction ? '服务器错误' : error.message
      });
    }
  );
};

export default fp(sensiblePlugin, {
  name: 'sensible',
  dependencies: ['@fastify/env']
});
