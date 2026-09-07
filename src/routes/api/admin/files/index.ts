import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  FileTreeQuerySchema,
  FileTreeSchemaResponse,
  type FileTreeQuery
} from '../../../../schemas/files.js';
import { readDir } from '../../../../utils/fs.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, config, httpErrors } = fastify;

  /** 获取资源目录文件夹列表（按需加载，每次只返回一层） */
  fastify.get<{ Querystring: FileTreeQuery }>(
    '/tree',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: FileTreeQuerySchema,
        response: { 200: SuccessResponseSchema(FileTreeSchemaResponse) }
      }
    },
    async (request, reply) => {
      const { path: subPath } = request.query;
      const rootDir = config.RESOURCE_ROOT_PATH;

      // 安全检查：防止路径穿越
      const resolved = path.resolve(rootDir, subPath);
      if (!resolved.startsWith(path.resolve(rootDir))) {
        throw httpErrors.badRequest('非法路径');
      }

      try {
        const nodes = await readDir(rootDir, subPath);
        return reply.success('获取文件树成功', nodes);
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          throw httpErrors.notFound('目录不存在');
        }
        throw err;
      }
    }
  );
}
