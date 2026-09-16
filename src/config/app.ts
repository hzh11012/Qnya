import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions
} from 'fastify';
import qs from 'qs';
import { join } from 'node:path';
import AutoLoad, { type AutoloadPluginOptions } from '@fastify/autoload';
import type { LoggerOptions } from 'pino';
import { randomUUID } from 'node:crypto';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

interface AppOptions
  extends FastifyServerOptions, Partial<AutoloadPluginOptions> {}

const isDev = process.env.NODE_ENV !== 'production';

// 根据环境配置日志
const getLoggerConfig = (): LoggerOptions | boolean => {
  if (isDev) {
    // 开发环境：使用 pino-pretty，输出到控制台
    return {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname'
        }
      },
      level: 'debug'
    };
  }

  // 生产环境：输出到 stdout
  return { level: 'info' };
};

const options: AppOptions = {
  logger: getLoggerConfig(),
  genReqId: () => randomUUID(),
  // 生产部署在反向代理（nginx/Docker）后面时必须开启，
  // 否则 request.ip 恒为代理地址，限流会对所有用户共享同一个桶，
  // 且日志中无法记录真实客户端 IP
  trustProxy: true,
  routerOptions: {
    querystringParser: (str: string) => qs.parse(str)
  }
};

const buildApp = async (
  opts: AppOptions = options
): Promise<FastifyInstance> => {
  const fastify = Fastify(opts).withTypeProvider<ZodTypeProvider>();

  // 加载第三方库
  await fastify.register(AutoLoad, {
    dir: join(import.meta.dirname, '../plugins/external'),
    options: { ...opts }
  });

  // 加载应用库
  await fastify.register(AutoLoad, {
    dir: join(import.meta.dirname, '../plugins/app'),
    options: { ...opts },
    ignorePattern: /.*-client\.ts$/
  });

  // 加载路由
  await fastify.register(AutoLoad, {
    dir: join(import.meta.dirname, '../routes'),
    autoHooks: true,
    cascadeHooks: true,
    ignorePattern: /^tools$/,
    options: { ...opts }
  });

  // 初始化应用
  await fastify.seeder.seed();

  return fastify;
};

export { options, buildApp };
