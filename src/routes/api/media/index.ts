import type { FastifyInstance } from 'fastify';

/**
 * 媒体文件鉴权（内部接口，供 nginx auth_request 子请求调用）
 *
 * nginx 在返回 /media/ 静态文件前，先以子请求命中本接口：
 * - 204：已登录且角色高于游客（user/premium/admin）→ 放行文件
 * - 401：未登录；403：角色不足 → nginx 拒绝文件请求
 *
 * 注意：
 * - nginx 子请求需要透传 Cookie，会话校验依赖它
 * - 子请求源 IP 恒为 127.0.0.1，且视频拖动进度条会产生密集 Range 请求，
 *   必须豁免全局限流（config.rateLimit = false），否则共享桶被打满后媒体全部 429
 */
export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac } = fastify;

  fastify.get(
    '/auth-check',
    {
      preHandler: [authenticate, rbac.requireRoleAtLeast('user')],
      // 不进 Swagger 文档
      schema: { hide: true },
      config: {
        rateLimit: false
      }
    },
    async (_request, reply) => reply.code(204).send()
  );
}
