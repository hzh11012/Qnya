import { eq } from 'drizzle-orm';
import { watchRoomsTable, type AnimeType } from '../../../../db/index.js';
import { RoomError } from '../../../../utils/watch-room.js';
import type { WatchRoomCore } from './watch-room-core.js';

/**
 * 播放同步（仅房主可控）：播放过程不写库，只在操作时刻更新持久化状态并广播 sync。
 */
export const createWatchRoomPlayback = (core: WatchRoomCore) => {
  const {
    fastify,
    repo,
    conn,
    runExclusive,
    requireMembership,
    getUserBrief,
    pushSystemMessage,
    computePlayback
  } = core;

  return {
    /**
     * 播放控制统一入口：验证房主权限 → 更新权威状态 → 广播 sync
     *
     * @param value play/seek 为播放位置（秒；play 不传则从当前位置继续），change_video 为视频ID
     * @param excludeTypes 房主无权访问的动漫类型（change_video 不能切到这些类型）
     * @param autoplay 仅 change_video 有效：切完直接从 0 起播（自动连播），
     *   状态一次到位，客户端不必再补一条 play 去追第二次广播
     */
    async controlPlayback(
      userId: string,
      roomId: string,
      action: 'play' | 'pause' | 'seek' | 'change_video',
      value?: number | string,
      excludeTypes?: AnimeType[],
      autoplay = false
    ) {
      return runExclusive(userId, async (tx, flush) => {
        const room = await repo.lockRoomById(tx, roomId);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

        const membership = await requireMembership(userId, roomId, tx);
        if (membership.role !== 'owner') {
          throw new RoomError('ROOM_PERMISSION_DENIED', '仅房主可以控制播放');
        }

        // 播放中的真实位置 = 存档位置 + 已播放时长
        const currentPosition = computePlayback(room).position;

        let patch: Partial<typeof watchRoomsTable.$inferInsert>;
        /** 换集目标（写库成功后据此落系统通知：「X 切换到了《番名》第 N 话」） */
        let switchedTo: string | null = null;

        switch (action) {
          case 'play':
            patch = {
              isPlaying: true,
              // 附带位置时等价于 seek + play，只产生一次版本变更与广播
              playbackPosition:
                (value as number | undefined) ?? currentPosition,
              playbackUpdatedAt: new Date(),
              playbackRevision: room.playbackRevision + 1
            };
            break;
          case 'pause':
            patch = {
              isPlaying: false,
              playbackPosition: currentPosition,
              playbackUpdatedAt: new Date(),
              playbackRevision: room.playbackRevision + 1
            };
            break;
          case 'seek': {
            // 视频时长服务端不可知，不做上限；仅兜底非负数
            const position = Math.max(0, value as number);
            patch = {
              // seek 保持播放/暂停状态不变
              playbackPosition: position,
              playbackUpdatedAt: new Date(),
              playbackRevision: room.playbackRevision + 1
            };
            break;
          }
          case 'change_video': {
            const videoId = value as string;
            const video = await repo.findPlayableVideo(
              tx,
              videoId,
              excludeTypes
            );
            if (!video) {
              throw new RoomError('VIDEO_NOT_FOUND', '视频不存在或不可播放');
            }
            // 混合角色房间：不能切到房间内任一成员无权观看的内容
            const roles = await repo.findMemberRoles(tx, roomId);
            const blocked = roles.some(role =>
              fastify.rbac.excludeTypesFor(role)?.includes(video.animeType)
            );
            if (blocked) {
              throw new RoomError(
                'VIDEO_UNAVAILABLE',
                '房间内有成员无法观看该视频'
              );
            }
            patch = {
              currentVideoId: videoId,
              // 自动连播：状态一次到位（播放中、位置 0），客户端各自等新源就绪后起播；
              // 手动选集：保持「切完暂停」，等房主自己点播放
              playbackPosition: 0,
              isPlaying: autoplay,
              playbackUpdatedAt: new Date(),
              playbackRevision: room.playbackRevision + 1
            };
            switchedTo = `《${video.animeName}》第 ${video.episode} 话`;
            break;
          }
        }

        const [updated] = await tx
          .update(watchRoomsTable)
          .set(patch)
          .where(eq(watchRoomsTable.id, roomId))
          .returning();

        // 换集会打断全场剧情，落一条系统通知；播放/暂停/拖动过于频繁，不写消息
        if (switchedTo) {
          const operator = await getUserBrief(tx, userId);
          await pushSystemMessage(
            tx,
            roomId,
            'video_changed',
            `${operator.nickname} 切换到了${switchedTo}`,
            { operator },
            flush
          );
        }

        const playback = computePlayback(updated);
        flush(() => {
          conn.emitToRoom(roomId, 'playback:sync', { roomId, playback });
        });

        return playback;
      });
    },

    /**
     * 拉取当前权威播放状态（客户端周期校准用）。
     *
     * 只读：不写库、不递增 revision、不广播。返回的位置已由 computePlayback
     * 按服务端时间外推到「此刻」，客户端用 ACK 往返的 RTT/2 抵消单程延迟后
     * 即可对齐——服务端只在房主操作时广播，成员缓冲或切后台回来会一直失步。
     */
    async pullPlayback(userId: string, roomId: string) {
      await requireMembership(userId, roomId);
      const room = await repo.findRoomById(roomId);
      if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');
      return computePlayback(room);
    }
  };
};

export type WatchRoomPlayback = ReturnType<typeof createWatchRoomPlayback>;
