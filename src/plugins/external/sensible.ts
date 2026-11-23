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

  // 5xx 的真实 message 可能带表名、约束名、SQL 片段，生产环境默认不外泄；
  // 排障时置 EXPOSE_ERROR_DETAIL=true 打开（日志中始终有完整错误与 reqId）
  const exposeErrorDetail =
    fastify.config.NODE_ENV !== 'production' ||
    fastify.config.EXPOSE_ERROR_DETAIL;

  // 自定义错误处理器
  // - 4xx：返回原始 message（业务语义，如 "番剧不存在"）
  // - 5xx：记录完整错误日志；响应按 exposeErrorDetail 决定是否透出真实原因
  fastify.setErrorHandler(
    (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      const statusCode = error.statusCode || 500;
      // 5xx 拆包 drizzle 等框架包装的错误，日志与响应都给出真实原因
      const normalized = statusCode >= 500 ? normalizeError(error) : error;

      if (statusCode >= 500) {
        request.log.error(
          { err: normalized },
          'Unhandled error in %s %s',
          request.method,
          request.url
        );
      }

      const fallback =
        statusCode >= 500 ? '服务器错误' : `请求失败 (${statusCode})`;
      const message =
        statusCode >= 500 && !exposeErrorDetail
          ? fallback
          : normalized.message || fallback;

      reply.status(statusCode).send({ code: statusCode, message });
    }
  );
};

export default fp(sensiblePlugin, {
  name: 'sensible',
  dependencies: ['@fastify/env']
});
