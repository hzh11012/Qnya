import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomBytes } from 'node:crypto';

export interface SessionData {
  userId: number;
  email: string;
  status: boolean;
  role: string;
  expiresAt: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    sessionRepository: ReturnType<typeof createSessionRepository>;
  }
}

const SESSION_PREFIX = 'session:';
const USER_SESSIONS_PREFIX = 'user_sessions:';

const createSessionRepository = (fastify: FastifyInstance) => {
  const redis = fastify.redis;
  const config = fastify.config;

  return {
    /**
     * 生成 session token
     */
    generateToken(): string {
      return randomBytes(32).toString('hex');
    },

    /**
     * 构建 session key
     * @param token 会话Token
     */
    buildKey(token: string): string {
      return `${SESSION_PREFIX}${token}`;
    },

    /**
     * 构建用户 sessions key
     * @param userId 用户ID
     */
    buildUserIndexKey(userId: number): string {
      return `${USER_SESSIONS_PREFIX}${userId}`;
    },

    /**
     * 验证 token 格式是否有效
     * @param token 会话Token
     */
    isValidToken(token: string | undefined | null) {
      return (
        typeof token === 'string' &&
        token.length === 64 &&
        /^[a-f0-9]+$/.test(token)
      );
    },

    /**
     * 创建 session
     */
    async createSession(
      userId: number,
      email: string,
      status: boolean,
      role: string
    ) {
      const token = this.generateToken();
      const now = Date.now();
      const maxAgeSeconds = Math.floor(config.SESSION_MAX_AGE / 1000);
      const expiresAt = now + config.SESSION_MAX_AGE;

      const sessionData: SessionData = {
        userId,
        email,
        status,
        role,
        expiresAt
      };

      const key = this.buildKey(token);
      const userIndexKey = this.buildUserIndexKey(userId);

      const pipeline = redis.pipeline();
      pipeline.setex(key, maxAgeSeconds, JSON.stringify(sessionData));
      pipeline.zadd(userIndexKey, expiresAt, token);
      pipeline.zremrangebyscore(userIndexKey, '-inf', now);
      await pipeline.exec();
      return token;
    },

    /**
     * 获取 session
     *
     * token 格式无效或不存在时返回 null。
     * @param token 会话Token
     */
    async getSession(token: string): Promise<SessionData | null> {
      if (!this.isValidToken(token)) return null;

      const key = this.buildKey(token);
      const data = await redis.get(key);
      if (!data) return null;
      return JSON.parse(data) as SessionData;
    },

    /**
     * 续签 session
     * @param token 会话Token
     * @param sessionData 会话数据
     */
    async renewSession(token: string, sessionData: SessionData) {
      if (!this.isValidToken(token)) return;

      const now = Date.now();
      const maxAgeSeconds = Math.floor(config.SESSION_MAX_AGE / 1000);
      const newExpiresAt = now + config.SESSION_MAX_AGE;

      sessionData.expiresAt = newExpiresAt;

      const sessionKey = this.buildKey(token);
      const userIndexKey = this.buildUserIndexKey(sessionData.userId);

      const pipeline = redis.pipeline();
      pipeline.setex(sessionKey, maxAgeSeconds, JSON.stringify(sessionData));
      pipeline.zadd(userIndexKey, newExpiresAt, token);
      pipeline.zremrangebyscore(userIndexKey, '-inf', now);
      await pipeline.exec();
    },

    /**
     * 检查是否需要续签
     * @param token 会话Token
     */
    async shouldRenew(token: string): Promise<boolean> {
      const ttl = await redis.ttl(this.buildKey(token));
      if (ttl <= 0) return false;

      const thresholdSeconds = config.SESSION_RENEW_THRESHOLD / 1000;
      return ttl < thresholdSeconds;
    },

    /**
     * 删除 session
     * @param token 会话Token
     */
    async deleteSession(token: string) {
      if (!this.isValidToken(token)) return;

      const session = await this.getSession(token);
      const key = this.buildKey(token);

      const pipeline = redis.pipeline();
      pipeline.del(key);

      if (session) {
        const userIndexKey = this.buildUserIndexKey(session.userId);
        pipeline.zrem(userIndexKey, token);
      }

      await pipeline.exec();
    },

    /**
     * 删除用户所有 session
     * @param userId 用户ID
     */
    async deleteAllUserSessions(userId: number) {
      const userIndexKey = this.buildUserIndexKey(userId);

      const tokens = await redis.zrange(userIndexKey, 0, -1);

      if (tokens.length > 0) {
        const keys = tokens.map(t => this.buildKey(t));
        await redis.del(...keys);
      }

      await redis.del(userIndexKey);
    },

    /**
     * 批量更新用户所有 session
     * @param userId 用户ID
     * @param updater 更新函数
     */
    async batchUpdateUserSessions(
      userId: number,
      updater: (session: SessionData) => void
    ) {
      const userIndexKey = this.buildUserIndexKey(userId);
      const now = Date.now();

      await redis.zremrangebyscore(userIndexKey, '-inf', now);
      const tokens = await redis.zrangebyscore(userIndexKey, now, '+inf');
      if (tokens.length === 0) return 0;

      // 批量获取
      const getPipeline = redis.pipeline();
      for (const token of tokens) {
        const key = this.buildKey(token);
        getPipeline.get(key);
        getPipeline.ttl(key);
      }
      const results = await getPipeline.exec();
      if (!results) return 0;

      // 批量更新
      const updatePipeline = redis.pipeline();
      let updatedCount = 0;

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const data = results[i * 2]?.[1] as string | null;
        const ttl = results[i * 2 + 1]?.[1] as number;

        if (data && ttl > 0) {
          const session = JSON.parse(data) as SessionData;
          updater(session);
          updatePipeline.setex(
            this.buildKey(token),
            ttl,
            JSON.stringify(session)
          );
          updatedCount++;
        }
      }

      await updatePipeline.exec();
      return updatedCount;
    },

    /**
     * 刷新用户所有 session 的状态
     * @param userId 用户ID
     * @param status 状态
     */
    async refreshUserSessionsStatus(userId: number, status: boolean) {
      return this.batchUpdateUserSessions(userId, session => {
        session.status = status;
      });
    },

    /**
     * 刷新用户所有 session 的角色
     * @param userId 用户ID
     * @param role 角色
     */
    async refreshUserSessionsRole(userId: number, role: string) {
      return this.batchUpdateUserSessions(userId, session => {
        session.role = role;
      });
    },

    /**
     * 获取 cookie 配置
     */
    getCookieOptions() {
      return {
        path: '/',
        httpOnly: true,
        domain: config.SESSION_DOMAIN,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        signed: true,
        maxAge: config.SESSION_MAX_AGE / 1000 // 秒
      };
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    const repo = createSessionRepository(fastify);
    fastify.decorate('sessionRepository', repo);
  },
  {
    name: 'session-repository',
    dependencies: ['redis', '@fastify/env']
  }
);
