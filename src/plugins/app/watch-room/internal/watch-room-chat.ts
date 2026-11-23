import { RoomError } from '../../../../utils/watch-room.js';
import type { WatchRoomCore } from './watch-room-core.js';

/** 聊天：仅房间成员可发送，消息与业务同事务写入、提交后广播 */
export const createWatchRoomChat = (core: WatchRoomCore) => {
  const { repo, runExclusive, requireMembership, getUserBrief, pushMessage } =
    core;

  return {
    /** 发送聊天消息（仅房间成员；实时广播 + 持久化） */
    async sendChat(userId: string, roomId: string, content: string) {
      return runExclusive(userId, async (tx, flush) => {
        // 只读校验房间存在，不加行锁：聊天不需要和播放控制抢同一行，
        // 否则每条消息都会把房间的所有操作串行化
        const room = await repo.findRoomById(roomId, tx);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

        await requireMembership(userId, roomId, tx);

        const user = await getUserBrief(tx, userId);
        return pushMessage(
          tx,
          {
            roomId,
            userId,
            type: 'chat',
            eventType: null,
            content,
            // 发送者快照存进 metadata，推送与历史载荷统一构建
            metadata: { user }
          },
          flush
        );
      });
    }
  };
};

export type WatchRoomChat = ReturnType<typeof createWatchRoomChat>;
