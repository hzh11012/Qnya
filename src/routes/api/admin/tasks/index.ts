import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  type TaskListQuery,
  TaskListSchema,
  TaskListSchemaResponse,
  type DeleteTaskBody,
  DeleteTaskSchema,
  IngestTaskSchema,
  type IngestTaskBody
} from '../../../../schemas/webhook.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, tasksRepository, config, httpErrors } = fastify;

  /** 任务列表 */
  fastify.get<{ Querystring: TaskListQuery }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: TaskListSchema,
        response: {
          200: SuccessResponseSchema(TaskListSchemaResponse)
        }
      }
    },
    async (request, reply) => {
      const data = await tasksRepository.findAll(request.query);
      return reply.success('获取任务列表成功', data);
    }
  );

  /** 删除任务记录 */
  fastify.delete<{ Params: DeleteTaskBody }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        params: DeleteTaskSchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;

      const existing = await tasksRepository.findById(id);
      if (!existing) {
        throw httpErrors.notFound('任务记录不存在');
      }

      await tasksRepository.deleteById(id);
      return reply.success('删除任务记录成功');
    }
  );

  /** 入库：将下载完成的文件移动到指定目录 */
  fastify.post<{ Body: IngestTaskBody }>(
    '/ingest',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        body: IngestTaskSchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id, path: destination } = request.body;
      const rootDir = config.RESOURCE_ROOT_PATH;

      // 安全检查：目标路径必须在资源根目录下
      const resolvedDest = path.resolve(rootDir, destination);
      if (!resolvedDest.startsWith(path.resolve(rootDir))) {
        throw httpErrors.badRequest('非法目标路径');
      }

      // 查找任务
      const task = await tasksRepository.findById(id);
      if (!task) {
        throw httpErrors.notFound('任务不存在');
      }

      if (task.status !== 'pending') {
        throw httpErrors.badRequest('任务状态不允许入库');
      }

      // 源路径动态拼接：任务只存相对路径，用当下配置还原，挂载变更对存量任务依然有效
      const downloadRoot = path.resolve(config.QBIT_HOST_DOWNLOAD_PATH);
      const sourcePath = path.resolve(downloadRoot, task.filename);
      // 安全检查：filename 来自种子文件列表，防止拼接后逃出下载目录
      if (!sourcePath.startsWith(downloadRoot + path.sep)) {
        throw httpErrors.badRequest('非法文件路径');
      }
      const ext = path.extname(task.filename);
      const targetPath = path.join(resolvedDest, `index${ext}`);

      try {
        await fs.mkdir(resolvedDest, { recursive: true });
        await fs.rename(sourcePath, targetPath);
      } catch (e: any) {
        if (e.code !== 'EXDEV') throw e;
        await fs.cp(sourcePath, targetPath);
        await fs.rm(sourcePath, { force: true });
      }

      // 标记任务为已完成
      await tasksRepository.markCompleted(id);
      return reply.success('入库成功');
    }
  );
}
