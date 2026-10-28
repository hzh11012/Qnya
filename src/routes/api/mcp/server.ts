import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { registerSearchTmdb } from './tools/search-tmdb.js';
import { registerGetTmdbDetail } from './tools/get-tmdb-detail.js';
import { registerListAnime } from './tools/list-anime.js';
import { registerListSeries } from './tools/list-series.js';
import { registerListTags } from './tools/list-tags.js';
import { registerCreateAnime } from './tools/create-anime.js';
import { registerUpdateAnime } from './tools/update-anime.js';
import { registerCreateVideo } from './tools/create-video.js';
import { registerCreateTopic } from './tools/create-topic.js';
import { registerGetSiteStats } from './tools/get-site-stats.js';
import { registerGetAnime } from './tools/get-anime.js';
import { registerAddTorrent } from './tools/add-torrent.js';
import { registerListTorrents } from './tools/list-torrents.js';
import { registerListTasks } from './tools/list-tasks.js';
import { registerSearchResources } from './tools/search-resources.js';

const skillsContent = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'skills.md'),
  'utf-8'
);

export function createMcpServer(fastify: FastifyInstance): McpServer {
  const server = new McpServer({ name: 'qnya', version: '1.0.0' });

  // Resource: 操作指南（供外部模型读取）
  server.registerResource(
    'skills',
    'qnya://skills',
    {
      mimeType: 'text/markdown',
      description: 'Qnya MCP 操作指南：工具速查、标准工作流和强制约束'
    },
    async uri => ({
      contents: [
        { uri: uri.href, mimeType: 'text/markdown', text: skillsContent }
      ]
    })
  );

  // 概览
  registerGetSiteStats(server, fastify);

  // TMDB
  registerSearchTmdb(server, fastify);
  registerGetTmdbDetail(server, fastify);

  // 番剧管理
  registerListAnime(server, fastify);
  registerGetAnime(server, fastify);
  registerListSeries(server, fastify);
  registerListTags(server, fastify);
  registerCreateAnime(server, fastify);
  registerUpdateAnime(server, fastify);

  // 剧集与专题
  registerCreateVideo(server, fastify);
  registerCreateTopic(server, fastify);

  // 下载管理
  registerAddTorrent(server, fastify);
  registerListTorrents(server, fastify);
  registerListTasks(server, fastify);
  registerSearchResources(server);

  return server;
}
