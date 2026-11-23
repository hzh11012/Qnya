import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  watchRoomsTable,
  type watchRoomMembersTable as MembersTable,
  type watchRoomMessagesTable as MessagesTable
} from '../../../../db/index.js';
import type * as schema from '../../../../db/index.js';
import type {
  WatchRoomEventType,
  WatchRoomUserBrief
} from '../../../../schemas/watch-room.js';
import { RoomError } from '../../../../utils/watch-room.js';

export type WatchRoomDb = NodePgDatabase<typeof schema>;
/** db.transaction 回调的事务执行器 */
export type WatchRoomTx = Parameters<
  Parameters<WatchRoomDb['transaction']>[0]
>[0];
/** 事务提交后统一执行的广播回调 */
export type Flush = (fn: () => void) => void;

/** 消息 metadata（聊天：发送者快照；系统通知：操作者 / 目标用户） */
export interface MessageMeta {
  user?: WatchRoomUserBrief;
  operator?: WatchRoomUserBrief;
  target?: WatchRoomUserBrief;
  [key: string]: unknown;
}

/** 解散原因（审计枚举：日志里按它聚合「谁因为什么把房间弄没了」） */
export type RoomDissolveReason =
  | 'owner_leave'
  | 'owner_switch'
  | 'owner_disconnected'
  | 'owner_disabled'
  | 'admin_delete';

/**
 * 放映室的事务基元：行锁、成员校验、消息写入，以及「事务内变更 + 提交后广播」
 * 的统一包装。生命周期 / 播放 / 聊天等模块都基于这里，避免各自重写一遍。
 */
export const createWatchRoomCore = (fastify: FastifyInstance) => {
  const db = fastify.db;
  const repo = fastify.watchRoomRepository;
  const conn = fastify.watchRoomConnections;

  /** 根据 room 行推算当前权威播放位置（播放中按服务端时间外推） */
  const computePlayback = (room: typeof watchRoomsTable.$inferSelect) => {
    const elapsedSeconds = room.isPlaying
      ? (Date.now() - room.playbackUpdatedAt.getTime()) / 1000
      : 0;
    return {
      videoId: room.currentVideoId,
      position: room.playbackPosition + elapsedSeconds,
      isPlaying: room.isPlaying,
      revision: room.playbackRevision,
      serverTime: Date.now()
    };
  };

  /** 事务内查用户简要信息（复用事务连接，不另占连接池） */
  const getUserBrief = async (
    tx: WatchRoomTx,
    userId: string
  ): Promise<WatchRoomUserBrief> => {
    const briefs = await repo.findUserBriefs([userId], tx);
    const brief = briefs.get(userId);
    if (!brief) throw new RoomError('ROOM_MEMBER_NOT_FOUND', '用户不存在');
    return { userId, nickname: brief.nickname, avatar: brief.avatar };
  };

  /**
   * 审计留痕：踢人 / 解散 / 管理端删房这类「影响他人且不可回滚」的操作，
   * 除了房间内的系统通知，再往服务端日志写一条结构化记录。
   *
   * 为什么不用消息表：解散会把房间连同消息一起级联删除，通知一条都留不下；
   * 日志在服务端，房间没了也能回溯是谁在什么时候把谁移出 / 把哪间房删了。
   * 只经 flush 在事务提交后执行，回滚的事务不产生审计记录。
   */
  const auditLog = (action: string, data: Record<string, unknown>) => {
    fastify.log.info(
      { audit: 'watch-room', action, ...data },
      `watch-room audit: ${action}`
    );
  };

  /** 统一的消息载荷（实时推送与历史接口共用） */
  const toMessagePayload = (message: typeof MessagesTable.$inferSelect) => {
    const meta = (message.metadata ?? {}) as MessageMeta;
    const payload: Record<string, unknown> = {
      messageId: message.id,
      roomId: message.roomId,
      type: message.type,
      content: message.content,
      createdAt: message.createdAt
    };

    if (message.type === 'chat') {
      payload.user = meta.user;
    }

    if (message.type === 'system' && message.eventType) {
      payload.system = {
        eventType: message.eventType,
        ...(meta.operator ? { operator: meta.operator } : {}),
        ...(meta.target ? { target: meta.target } : {})
      };
    }

    return payload;
  };

  /**
   * 事务内写入消息（与业务操作同一事务，保证一致性），提交后推送 room:message
   * （聊天与系统通知同一事件；操作失败不产生成功通知）
   */
  const pushMessage = async (
    tx: WatchRoomTx,
    data: Parameters<typeof repo.insertMessage>[1],
    flush: Flush
  ) => {
    const message = await repo.insertMessage(tx, data);
    const payload = toMessagePayload(message);
    flush(() => conn.emitToRoom(data.roomId, 'room:message', payload));
    return payload;
  };

  /** 事务内写入系统通知 */
  const pushSystemMessage = (
    tx: WatchRoomTx,
    roomId: string,
    eventType: WatchRoomEventType,
    content: string,
    meta: MessageMeta,
    flush: Flush
  ) =>
    pushMessage(
      tx,
      {
        roomId,
        userId: null,
        type: 'system',
        eventType,
        content,
        metadata: meta
      },
      flush
    );

  /**
   * 事务内解散房间（硬删除；幂等：房间不存在则跳过；content 为解散提示文案）。
   * 传 audit 时同时留一条审计日志（经 flush 在提交后写，回滚不记）。
   */
  const dissolveRoomTx = async (
    tx: WatchRoomTx,
    roomId: string,
    content: string,
    flush: Flush,
    audit?: { actor: WatchRoomUserBrief | null; reason: RoomDissolveReason }
  ) => {
    const deleted = await repo.deleteRoom(tx, roomId);
    if (!deleted) return; // 不存在/已删除，幂等返回

    if (audit) {
      flush(() =>
        auditLog('room.dissolve', {
          roomId,
          roomName: deleted.name,
          visibility: deleted.visibility,
          ownerId: deleted.ownerId,
          actorId: audit.actor?.userId ?? null,
          actorNickname: audit.actor?.nickname ?? null,
          reason: audit.reason
        })
      );
    }

    // 房间记录已删除，解散提示不落库，直接推送 room:closed 让成员端退出
    flush(() => {
      conn.emitToRoom(roomId, 'room:closed', { roomId, content });
      conn.dropRoom(roomId);
    });
  };

  /**
   * 事务内普通成员离开（主动离开 / 切换房间 / 断开 / 被踢；kickedBy 为踢人的房主）。
   * 先推送 room:member-left 再取消订阅：被踢用户据此得知自己被移出
   */
  const leaveRoomTx = async (
    tx: WatchRoomTx,
    membership: { id: string; userId: string; roomId: string },
    flush: Flush,
    kickedBy?: WatchRoomUserBrief
  ) => {
    // 先锁房间行再删成员行（与解散保持"房间 → 成员"的加锁顺序：
    // 反序会与房主解散的级联删除互相等待而死锁）。房间已解散则无需离开
    const room = await repo.lockRoomById(tx, membership.roomId);
    if (!room) return;

    // 已被并发移除（如同时被房主踢出）：不再重复发离开通知
    const ended = await repo.deleteMembership(tx, membership.id);
    if (!ended) return;

    const brief = await getUserBrief(tx, membership.userId);

    // 被踢是房主对他人行使权力，系统通知会随房间删除而消失，另外留审计
    if (kickedBy) {
      flush(() =>
        auditLog('member.kick', {
          roomId: membership.roomId,
          roomName: room.name,
          operatorId: kickedBy.userId,
          operatorNickname: kickedBy.nickname,
          targetUserId: membership.userId,
          targetNickname: brief.nickname
        })
      );
    }

    await pushSystemMessage(
      tx,
      membership.roomId,
      kickedBy ? 'member_kicked' : 'member_left',
      kickedBy
        ? `房主 ${kickedBy.nickname} 将 ${brief.nickname} 移出了房间`
        : `${brief.nickname} 离开了房间`,
      kickedBy ? { operator: kickedBy, target: brief } : { target: brief },
      flush
    );

    flush(() => {
      conn.emitToRoom(membership.roomId, 'room:member-left', {
        roomId: membership.roomId,
        userId: membership.userId,
        reason: kickedBy ? 'kicked' : 'left'
      });
      conn.dropUserFromRoom(membership.userId, membership.roomId);
    });
  };

  /**
   * 事务内退出用户当前所在房间：房主 → 解散（dissolve.content 为解散提示文案）；
   * 普通成员 → 离开。reason 只进审计日志，用来区分「主动解散 / 换房 / 断线 / 停用」。
   */
  const exitRoomTx = async (
    tx: WatchRoomTx,
    membership: typeof MembersTable.$inferSelect,
    flush: Flush,
    dissolve: { content?: string; reason: RoomDissolveReason } = {
      reason: 'owner_leave'
    }
  ) => {
    if (membership.role !== 'owner') {
      return leaveRoomTx(tx, membership, flush);
    }
    const brief = await getUserBrief(tx, membership.userId);
    await dissolveRoomTx(
      tx,
      membership.roomId,
      `房主 ${brief.nickname} ${dissolve.content ?? '解散了房间'}`,
      flush,
      { actor: brief, reason: dissolve.reason }
    );
  };

  /**
   * 以用户维度事务锁串行执行房间变更（全平台单房间限制的并发保证：
   * 同一用户的加入/离开/切换在数据库层面串行，不会同时归属两个房间）
   */
  const runExclusive = async <T>(
    userId: string,
    fn: (tx: WatchRoomTx, flush: Flush) => Promise<T>
  ): Promise<T> => {
    let broadcasts: Array<() => void> = [];
    const result = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
      const pending: Array<() => void> = [];
      const value = await fn(tx, pending.push.bind(pending) as Flush);
      broadcasts = pending;
      return value;
    });
    // 事务提交成功后才执行广播（操作失败不广播）
    for (const fn of broadcasts) {
      try {
        fn();
      } catch (error) {
        fastify.log.error({ error }, 'watch-room broadcast failed');
      }
    }
    return result;
  };

  /**
   * 校验用户是房间成员，返回成员记录（可传事务执行器）。
   *
   * 越权不伪装成 404：只有房间真的不存在才 404，房间存在但调用者不是成员
   * 一律 ROOM_PERMISSION_DENIED（403）。原来统一抛 ROOM_MEMBER_NOT_FOUND
   * 会让「没权限」看起来像「资源没了」，前端和排障都会误判成房间被解散。
   *
   * 注意顺序：只有校验失败时才多查一次房间（正常成员校验仍是一条查询）。
   */
  const requireMembership = async (
    userId: string,
    roomId: string,
    executor?: WatchRoomTx
  ) => {
    const membership = await repo.findMembershipByUser(userId, executor);
    if (membership?.roomId === roomId) return membership;

    const room = await repo.findRoomById(roomId, executor);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');
    throw new RoomError('ROOM_PERMISSION_DENIED', '你不是该房间的成员');
  };

  return {
    fastify,
    db,
    repo,
    conn,
    computePlayback,
    getUserBrief,
    auditLog,
    toMessagePayload,
    pushMessage,
    pushSystemMessage,
    dissolveRoomTx,
    leaveRoomTx,
    exitRoomTx,
    runExclusive,
    requireMembership
  };
};

export type WatchRoomCore = ReturnType<typeof createWatchRoomCore>;
