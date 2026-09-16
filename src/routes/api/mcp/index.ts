import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';

/** 会话空闲超过该时长后清除，防止客户端异常断开导致 Map 泄漏 */
const SESSION_TTL_MS = 60 * 60 * 1000;

type SessionEntry = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastSeen: number;
};

const sessions = new Map<string, SessionEntry>();

/**
 * 常量时间字符串比较，防止计时侧信道泄露 token
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // 长度不同时仍做一次比较，保持耗时一致
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** 清理空闲超时的会话 */
function sweepStaleSessions() {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now - entry.lastSeen > SESSION_TTL_MS) {
      sessions.delete(id);
      void entry.transport.close().catch(() => {});
    }
  }
}

export default async function (fastify: FastifyInstance) {
  const { config, log } = fastify;

  // fail-closed：未配置 token 时拒绝所有请求，避免管理级接口裸奔
  if (!config.MCP_TOKEN) {
    log.warn('MCP_TOKEN 未配置，MCP 接口将拒绝所有请求');
  }

  const verifyToken = (auth: string | undefined): boolean => {
    if (!config.MCP_TOKEN) return false;
    if (typeof auth !== 'string') return false;
    return safeEqual(auth, `Bearer ${config.MCP_TOKEN}`);
  };

  const handle = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    if (!verifyToken(request.headers.authorization)) {
      reply.status(401).send({ error: 'Unauthorized' });
      return;
    }

    sweepStaleSessions();

    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    let entry = sessionId ? sessions.get(sessionId) : undefined;

    if (entry) {
      entry.lastSeen = Date.now();
    }

    if (!entry) {
      if (sessionId) {
        reply.status(404).send({ error: 'Session not found' });
        return;
      }

      // onsessioninitialized 在 handleRequest 处理 initialize 消息时触发，
      // 此时 entry 已赋值，通过闭包读取最新值存入 sessions
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string) => {
          sessions.set(id, entry!);
        }
      });

      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) sessions.delete(id);
      };

      const server = createMcpServer(fastify);
      await server.connect(transport);
      entry = { transport, server, lastSeen: Date.now() };
    }

    reply.hijack();
    await entry.transport.handleRequest(request.raw, reply.raw, request.body);
  };

  fastify.get('/', handle);
  fastify.post('/', handle);
  fastify.delete('/', handle);
}
