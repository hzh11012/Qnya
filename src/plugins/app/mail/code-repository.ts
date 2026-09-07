import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    codeRepository: ReturnType<typeof createCodeRepository>;
  }
}

const CODE_PREFIX = 'verify_code:';
const ATTEMPT_PREFIX = 'verify_attempts:';
const CODE_EXPIRE_SECONDS = 300; // 5分钟（失败计数与验证码同生命周期）

const createCodeRepository = (fastify: FastifyInstance) => {
  const redis = fastify.redis;

  return {
    /**
     * 存储验证码
     */
    async store(email: string, code: string) {
      await redis.setex(`${CODE_PREFIX}${email}`, CODE_EXPIRE_SECONDS, code);
    },

    /**
     * 获取验证码
     */
    async get(email: string) {
      return redis.get(`${CODE_PREFIX}${email}`);
    },

    /**
     * 删除验证码
     */
    async delete(email: string) {
      await redis.del(`${CODE_PREFIX}${email}`);
    },

    /**
     * 记录一次验证失败，返回累计失败次数
     */
    async recordFailedAttempt(email: string) {
      const key = `${ATTEMPT_PREFIX}${email}`;
      const attempts = await redis.incr(key);
      if (attempts === 1) {
        // 失败计数与验证码同生命周期
        await redis.expire(key, CODE_EXPIRE_SECONDS);
      }
      return attempts;
    },

    /**
     * 清除验证失败计数
     */
    async clearAttempts(email: string) {
      await redis.del(`${ATTEMPT_PREFIX}${email}`);
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const repo = createCodeRepository(fastify);
    fastify.decorate('codeRepository', repo);
  },
  {
    name: 'code-repository',
    dependencies: ['redis']
  }
);
