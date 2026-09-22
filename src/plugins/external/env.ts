import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import env from '@fastify/env';

declare module 'fastify' {
  export interface FastifyInstance {
    config: {
      NODE_ENV: string;
      PORT: number;
      POSTGRES_HOST: string;
      POSTGRES_PORT: number;
      POSTGRES_USER: string;
      POSTGRES_PASSWORD: string;
      POSTGRES_DB: string;
      ADMIN_EMAIL: string;
      RATE_LIMIT_MAX: number;
      CORS_ORIGINS: string;
      // Database pool configuration
      DB_POOL_MAX: number;
      DB_POOL_IDLE_TIMEOUT: number;
      DB_POOL_CONNECTION_TIMEOUT: number;
      // Redis
      REDIS_URL: string;
      // Meilisearch
      MEILI_URL: string;
      MEILI_MASTER_KEY: string;
      // Session
      SESSION_DOMAIN: string;
      SESSION_SECRET: string;
      SESSION_MAX_AGE: number;
      SESSION_RENEW_THRESHOLD: number;
      // SMTP
      SMTP_HOST: string;
      SMTP_PORT: number;
      SMTP_SECURE: boolean;
      SMTP_USER: string;
      SMTP_PASS: string;
      SMTP_FROM: string;
      // qBittorrent
      QBIT_HOST: string;
      QBIT_USERNAME: string;
      QBIT_PASSWORD: string;
      QBIT_DOWNLOAD_PATH: string;
      QBIT_HOST_DOWNLOAD_PATH: string;
      QBIT_WEBHOOK_SECRET: string;
      // Resource
      RESOURCE_ROOT_PATH: string;
      // TMDB
      TMDB_API_KEY: string;
      TMDB_IMAGE_DOMAIN: string;
      TMDB_API_DOMAIN: string;
      // MCP
      MCP_TOKEN: string;
    };
  }
}

const schema = {
  type: 'object',
  required: [
    'POSTGRES_PASSWORD',
    'ADMIN_EMAIL',
    'REDIS_URL',
    'MEILI_URL',
    'SESSION_DOMAIN',
    'SESSION_SECRET',
    'SMTP_HOST',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM',
    'QBIT_HOST',
    'QBIT_USERNAME',
    'QBIT_PASSWORD',
    'QBIT_DOWNLOAD_PATH',
    'QBIT_WEBHOOK_SECRET',
    'RESOURCE_ROOT_PATH'
  ],
  properties: {
    // Environment
    NODE_ENV: { type: 'string', default: 'development' },
    PORT: { type: 'number', default: 3000 },
    // Admin
    ADMIN_EMAIL: { type: 'string' },
    // Database
    POSTGRES_HOST: { type: 'string', default: 'localhost' },
    POSTGRES_PORT: { type: 'number', default: 5432 },
    POSTGRES_USER: { type: 'string', default: 'qnya' },
    POSTGRES_PASSWORD: { type: 'string' },
    POSTGRES_DB: { type: 'string', default: 'qnya' },
    DB_POOL_MAX: { type: 'number', default: 20 },
    DB_POOL_IDLE_TIMEOUT: { type: 'number', default: 30000 },
    DB_POOL_CONNECTION_TIMEOUT: { type: 'number', default: 2000 },
    // Redis
    REDIS_URL: { type: 'string' },
    // Meilisearch
    MEILI_URL: { type: 'string' },
    MEILI_MASTER_KEY: { type: 'string', default: '' },
    // Session
    SESSION_DOMAIN: { type: 'string' },
    SESSION_SECRET: { type: 'string' },
    SESSION_MAX_AGE: { type: 'number', default: 604800000 },
    SESSION_RENEW_THRESHOLD: { type: 'number', default: 86400000 },
    // Security
    RATE_LIMIT_MAX: { type: 'number', default: 100 },
    CORS_ORIGINS: { type: 'string', default: '' },
    // SMTP
    SMTP_HOST: { type: 'string' },
    SMTP_PORT: { type: 'number', default: 465 },
    SMTP_SECURE: { type: 'boolean', default: true },
    SMTP_USER: { type: 'string' },
    SMTP_PASS: { type: 'string' },
    SMTP_FROM: { type: 'string' },
    // qBittorrent
    QBIT_HOST: { type: 'string' },
    QBIT_USERNAME: { type: 'string' },
    QBIT_PASSWORD: { type: 'string' },
    QBIT_DOWNLOAD_PATH: { type: 'string' },
    QBIT_HOST_DOWNLOAD_PATH: { type: 'string' },
    QBIT_WEBHOOK_SECRET: { type: 'string' },
    // Resource
    RESOURCE_ROOT_PATH: { type: 'string' },
    // TMDB
    TMDB_API_KEY: { type: 'string' },
    TMDB_IMAGE_DOMAIN: { type: 'string', default: 'image.tmdb.org' },
    TMDB_API_DOMAIN: { type: 'string', default: 'api.themoviedb.org' },
    // MCP
    MCP_TOKEN: { type: 'string', default: '' }
  }
};

/**
 * This plugins helps to check environment variables.
 *
 * @see {@link https://github.com/fastify/fastify-env}
 */
const envPlugin = async (fastify: FastifyInstance) => {
  await fastify.register(env, {
    schema,
    dotenv: true
  });
};

export default fp(envPlugin, {
  name: '@fastify/env'
});
