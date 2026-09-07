import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { isVideoFile } from '../../../utils/video.js';
import { WebhookQuery, WebhookSchema } from '../../../schemas/webhook.js';

/**
 * 常量时间字符串比较，防止计时侧信道泄露 secret
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

export default async function (fastify: FastifyInstance) {
  const { tasksRepository, qbit, config, log, httpErrors } = fastify;

  /**
   * qBittorrent 下载完成 Webhook
   *
   * 配置：qBit 设置 -> 下载 -> 下载完成时运行外部程序
   * 填入：curl -X POST "http://localhost:3000/api/webhook/qbit?hash=%I&tag=%G&token=你的WEBHOOK_SECRET"
   */
  fastify.post<{ Querystring: WebhookQuery }>(
    '/qbit',
    {
      schema: { querystring: WebhookSchema }
    },
    async (request, reply) => {
      const { hash, tag, token } = request.query;

      if (!safeEqual(token, config.QBIT_WEBHOOK_SECRET)) {
        throw httpErrors.unauthorized('未授权');
      }

      if (tag !== 'qnya') {
        return reply.success('非特定标签，已跳过');
      }

      log.info({ hash, tag }, 'Received download complete webhook');

      // 检查是否已处理过
      const existing = await tasksRepository.findByTorrentHash(hash);
      if (existing.length > 0) {
        log.info({ hash }, 'Torrent already processed');
        return reply.success('种子已存在');
      }

      // 获取种子信息
      const torrentInfo = await qbit.getTorrentInfo(hash);
      if (!torrentInfo) {
        log.error({ hash }, 'Failed to get torrent info');
        throw httpErrors.internalServerError('获取种子信息失败');
      }

      // 获取文件列表
      const files = await qbit.getTorrentFiles(hash);

      // 过滤视频文件
      const videoFiles = files.filter(f => isVideoFile(f.name));

      if (videoFiles.length === 0) {
        log.warn({ hash }, 'No video files in torrent');
        return reply.success('无视频文件');
      }

      // 创建任务记录
      const hostDownloadPath =
        config.QBIT_HOST_DOWNLOAD_PATH || torrentInfo.save_path;

      const taskParams = videoFiles.map(f => ({
        torrentHash: hash,
        fileIndex: f.index,
        filename: f.name.split('/').pop() || f.name,
        filePath: `${hostDownloadPath}/${f.name}`,
        fileSize: f.size
      }));

      await tasksRepository.createMany(taskParams);
      return reply.success('创建任务成功');
    }
  );
}
