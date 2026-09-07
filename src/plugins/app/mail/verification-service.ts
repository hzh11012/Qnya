import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomInt } from 'node:crypto';

const CODE_MAX_ATTEMPTS = 5; // 与 code-repository 中的限制保持一致

declare module 'fastify' {
  interface FastifyInstance {
    verificationService: ReturnType<typeof createVerificationService>;
  }
}

const createVerificationService = (fastify: FastifyInstance) => {
  const codeRepository = fastify.codeRepository;
  const mailService = fastify.mailService;
  const config = fastify.config;

  return {
    /**
     * 生成6位数字验证码
     */
    generateCode(): string {
      return randomInt(100000, 1000000).toString();
    },

    /**
     * 生成、存储并发送验证码
     *
     * 失败时抛出异常，由全局错误处理器统一返回 500。
     */
    async sendVerificationCode(email: string): Promise<void> {
      const code = this.generateCode();

      // 存储验证码
      await codeRepository.store(email, code);

      // 开发环境只打印日志，不发送邮件
      if (config.NODE_ENV === 'development') {
        fastify.log.info(`[DEV] 验证码: ${code} -> ${email}`);
        return;
      }

      // 生产环境发送邮件
      try {
        await mailService.sendVerificationCode(email, code);
      } catch (error) {
        fastify.log.error({ error }, 'Failed to send verification code');

        // 发送失败时删除已存储的验证码（best-effort）
        await codeRepository.delete(email).catch(e => {
          fastify.log.error(
            { error: e },
            'Failed to delete code after send failure'
          );
        });

        throw error;
      }
    },

    /**
     * 验证验证码
     *
     * @returns true=验证成功，false=验证码错误或已过期
     */
    async verifyCode(email: string, code: string): Promise<boolean> {
      const storedCode = await codeRepository.get(email);

      if (!storedCode) {
        return false;
      }

      if (storedCode !== code) {
        // 限制失败次数，防止暴力穷举 6 位验证码
        const attempts = await codeRepository.recordFailedAttempt(email);
        if (attempts >= CODE_MAX_ATTEMPTS) {
          await codeRepository.delete(email);
        }
        return false;
      }

      // 验证成功后删除验证码与失败计数（一次性使用）
      await codeRepository.delete(email);
      await codeRepository.clearAttempts(email);
      return true;
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const service = createVerificationService(fastify);
    fastify.decorate('verificationService', service);
  },
  {
    name: 'verification-service',
    dependencies: ['code-repository', 'mail-service', '@fastify/env']
  }
);
