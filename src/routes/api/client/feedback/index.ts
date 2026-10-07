import type { FastifyInstance } from 'fastify';
import { SuccessResponseSchema } from '../../../../schemas/common.js';
import {
  ClientFeedbackCreateParamsSchema,
  ClientFeedbackCreateBodySchema,
  type ClientFeedbackCreateParams,
  type ClientFeedbackCreateBody
} from '../../../../schemas/feedback.js';

export default async function (fastify: FastifyInstance) {
  const { authenticate, feedbackRepository, httpErrors } = fastify;

  /** 提交问题反馈 */
  fastify.post<{
    Params: ClientFeedbackCreateParams;
    Body: ClientFeedbackCreateBody;
  }>(
    '/:animeId',
    {
      preHandler: [authenticate],
      schema: {
        params: ClientFeedbackCreateParamsSchema,
        body: ClientFeedbackCreateBodySchema,
        response: { 200: SuccessResponseSchema() }
      }
    },
    async (request, reply) => {
      const created = await feedbackRepository.create({
        userId: request.sessionData!.userId,
        animeId: request.params.animeId,
        type: request.body.type,
        content: request.body.content
      });
      if (!created) {
        throw httpErrors.notFound('番剧不存在');
      }
      return reply.success('反馈提交成功');
    }
  );
}
