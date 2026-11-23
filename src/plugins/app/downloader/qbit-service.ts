import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { QBitClient } from './internal/qbit-client.js';

declare module 'fastify' {
  export interface FastifyInstance {
    qbit: QBitClient;
  }
}

const qbitPlugin = async (fastify: FastifyInstance) => {
  const qbit = new QBitClient(fastify);
  fastify.decorate('qbit', qbit);
  fastify.log.info('qBittorrent client initialized');
};

export default fp(qbitPlugin, {
  name: 'qbit',
  dependencies: ['@fastify/env']
});
