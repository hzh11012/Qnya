import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject
} from 'fastify-type-provider-zod';

/**
 * OpenAPI 文档插件
 *
 * 基于路由中已声明的 zod schema 自动生成 OpenAPI 文档：
 * - JSON:    GET /api/docs/json
 * - Swagger UI: /api/docs
 *
 * 前端可通过 openapi-typescript 拉取该 JSON 生成接口类型。
 *
 * @see {@link https://github.com/fastify/fastify-swagger}
 */
async function swaggerPlugin(fastify: FastifyInstance) {
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Qnya API',
        description: 'Qnya 后端接口文档（由路由 zod schema 自动生成）',
        version: '1.0.0'
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'session'
          }
        }
      }
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
    hideUntagged: false
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/api/docs'
  });
}

// 使用 fastify-plugin 注册到根作用域，确保能收集到所有路由
export default fp(swaggerPlugin, { name: 'swagger' });
