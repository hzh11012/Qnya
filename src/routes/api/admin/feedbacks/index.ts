import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  type FeedbackListQuery,
  FeedbackListSchema,
  FeedbackListSchemaResponse,
  type UpdateFeedbackParams,
  UpdateFeedbackParamsSchema,
  type UpdateFeedbackBody,
  UpdateFeedbackBodySchema,
  type DeleteFeedbackParams,
  DeleteFeedbackParamsSchema
} from '../../../../schemas/feedback.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, rbac, feedbackRepository, httpErrors } = fastify;

  /** 获取反馈列表 */
  fastify.get<{ Querystring: FeedbackListQuery }>(
    '/',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        querystring: FeedbackListSchema,
        response: {
          200: SuccessResponseSchema(FeedbackListSchemaResponse)
        }
      }
    },
    async (request, reply) => {
      const data = await feedbackRepository.findAll(request.query);
      return reply.success('获取反馈列表成功', data);
    }
  );

  /** 编辑反馈 */
  fastify.put<{ Params: UpdateFeedbackParams; Body: UpdateFeedbackBody }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        params: UpdateFeedbackParamsSchema,
        body: UpdateFeedbackBodySchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;

      const existing = await feedbackRepository.findById(id);
      if (!existing) {
        throw httpErrors.notFound('反馈不存在');
      }

      await feedbackRepository.update(id, request.body);
      return reply.success('编辑反馈成功');
    }
  );

  /** 删除反馈 */
  fastify.delete<{ Params: DeleteFeedbackParams }>(
    '/:id',
    {
      preHandler: [authenticate, rbac.requireAnyRole('admin')],
      schema: {
        params: DeleteFeedbackParamsSchema,
        response: {
          200: SuccessResponseSchema()
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;

      const deleted = await feedbackRepository.deleteById(id);
      if (!deleted) {
        throw httpErrors.notFound('反馈不存在');
      }

      return reply.success('删除反馈成功');
    }
  );
}
