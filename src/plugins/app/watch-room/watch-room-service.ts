import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { watchRoomsTable } from '../../../db/index.js';
import type { watchRoomMessagesTable as MessagesTable } from '../../../db/index.js';
import type {
  AdminWatchRoomListQuery,
  WatchRoomEventType,
  WatchRoomJoinInput,
  WatchRoomListQuery,
  WatchRoomUpdateInput,
  WatchRoomUserBrief
} from '../../../schemas/watch-room.js';
import {
  hashRoomPassword,
  RoomError,
  verifyRoomPassword
} from '../../../utils/watch-room.js';

declare module 'fastify' {
  interface FastifyInstance {
    watchRoomService: ReturnType<typeof createWatchRoomService>;
  }
}

/** 房主解散时用于广播的成员清理回调集合（事务提交后统一执行） */
type Flush = (fn: () => void) => void;

const createWatchRoomService = (fastify: FastifyInstance) => {
  const db = fastify.db;
  const repo = fastify.watchRoomRepository;
  const conn = fastify.watchRoomConnections;

  /** 事务类型别名（db.transaction 回调的事务执行器） */
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  // ============================================
  // 内部工具
  // ============================================

  /** 邀请凭证 SHA-256 哈希（数据库只存哈希，不存明文） */
  const hashToken = (token: string) =>
    createHash('sha256').update(token).digest('hex');

  /** 生成高强度随机邀请凭证（base64url，不可预测） */
  const generateToken = () => randomBytes(32).toString('base64url');

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

  /** 查用户简要信息 */
  const getUserBrief = async (userId: string): Promise<WatchRoomUserBrief> => {
    const briefs = await repo.findUserBriefs([userId]);
    const brief = briefs.get(userId);
    if (!brief) throw new RoomError('ROOM_MEMBER_NOT_FOUND', '用户不存在');
    return { userId, nickname: brief.nickname, avatar: brief.avatar };
  };

  /** 系统通知 metadata 结构 */
  interface SystemMeta {
    operator?: WatchRoomUserBrief;
    target?: WatchRoomUserBrief;
    [key: string]: unknown;
  }

  /** 统一的消息实时载荷（与持久化结构一致） */
  const toMessagePayload = (message: typeof MessagesTable.$inferSelect) => {
    const meta = (message.metadata ?? {}) as SystemMeta;
    const payload: Record<string, unknown> = {
      messageId: message.id,
      roomId: message.roomId,
      type: message.type,
      content: message.content,
      createdAt: message.createdAt
    };

    if (message.type === 'chat' && message.userId) {
      payload.user = meta.user;
    }

    if (message.type === 'system' && message.eventType) {
      payload.system = {
        eventType: message.eventType,
        ...(meta.operator ? { operator: meta.operator } : {}),
        ...(meta.target ? { target: meta.target } : {}),
        ...(meta.metadata ? { metadata: meta.metadata } : {})
      };
    }

    return payload;
  };

  /**
   * 事务内写入系统通知（与业务操作同一事务，保证一致性），
   * 广播延迟到事务提交后执行（操作失败不产生成功通知）
   */
  const pushSystemMessage = async (
    tx: Tx,
    roomId: string,
    eventType: WatchRoomEventType,
    content: string,
    meta: SystemMeta,
    flush: Flush
  ) => {
    const message = await repo.insertMessage(tx, {
      roomId,
      userId: null,
      type: 'system',
      eventType,
      content,
      metadata: meta
    });
    const payload = toMessagePayload(message);
    flush(() => conn.emitToRoom(roomId, 'room:system-message', payload));
    return payload;
  };

  /** 事务内解散房间（硬删除；幂等：房间不存在则跳过；content 为广播文案） */
  const dissolveRoomTx = async (
    tx: Tx,
    roomId: string,
    operator: WatchRoomUserBrief,
    content: string,
    flush: Flush
  ): Promise<boolean> => {
    const room = await repo.lockRoomById(tx, roomId);
    if (!room) return false; // 不存在/已删除，幂等返回

    const memberUserIds = await repo.findRoomMemberUserIds(tx, roomId);
    const deleted = await repo.deleteRoom(tx, roomId);
    if (!deleted) return false;

    // 房间记录即将删除，解散通知不落库，直接广播 room:closed 让成员端退出
    flush(() => {
      conn.emitToRoom(roomId, 'room:closed', {
        roomId,
        message: {
          roomId,
          type: 'system',
          content,
          system: { eventType: 'room_closed', operator },
          createdAt: new Date()
        }
      });
      conn.dropRoom(roomId);
      conn.clearRoomState(roomId, memberUserIds).catch(() => undefined);
    });
    return true;
  };

  /** 事务内普通成员离开（reason 区分主动离开与切换房间） */
  const leaveRoomTx = async (
    tx: Tx,
    membership: { id: string; userId: string; roomId: string },
    eventType: Extract<WatchRoomEventType, 'member_left' | 'member_switched'>,
    flush: Flush
  ) => {
    const brief = await getUserBrief(membership.userId);
    await repo.endMembership(tx, membership.id, 'left');

    const content =
      eventType === 'member_switched'
        ? `${brief.nickname} 离开了房间（切换至其他房间）`
        : `${brief.nickname} 离开了房间`;

    const payload = await pushSystemMessage(
      tx,
      membership.roomId,
      eventType,
      content,
      { target: brief },
      flush
    );

    flush(() => {
      conn
        .clearUserRoom(membership.userId, membership.roomId)
        .catch(() => undefined);
      conn
        .markRoomOffline(membership.roomId, membership.userId)
        .catch(() => undefined);
      conn.dropUserFromRoom(membership.userId, membership.roomId);
      conn.emitToRoom(membership.roomId, 'room:member-left', {
        roomId: membership.roomId,
        userId: membership.userId,
        reason: eventType === 'member_switched' ? 'switched' : 'left',
        message: payload
      });
    });
  };

  /**
   * 以用户维度事务锁串行执行房间变更（全平台单房间限制的并发保证：
   * 同一用户的加入/离开/切换在数据库层面串行，不会同时归属两个房间）
   */
  const runExclusive = async <T>(
    userId: string,
    fn: (tx: Tx, flush: Flush) => Promise<T>
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

  /** 校验用户是房间的 active 成员，返回成员记录（可选事务执行器） */
  const requireMembership = async (
    userId: string,
    roomId: string,
    executor?: Parameters<typeof repo.findActiveMembershipByUser>[1]
  ) => {
    const membership = await repo.findActiveMembershipByUser(userId, executor);
    if (!membership || membership.roomId !== roomId) {
      throw new RoomError('ROOM_MEMBER_NOT_FOUND', '你不是该房间的成员');
    }
    return membership;
  };

  // ============================================
  // 房间生命周期
  // ============================================

  return {
    computePlayback,

    /** 创建房间（创建者自动成为房主并进入房间；已在其他房间则按切换规则处理） */
    async createRoom(
      userId: string,
      input: {
        name: string;
        visibility: 'public' | 'private';
        announcement?: string | null;
        password?: string;
        videoId?: string;
      }
    ) {
      if (input.password && input.visibility !== 'private') {
        throw new RoomError('ROOM_PERMISSION_DENIED', '仅私人房间可以设置密码');
      }

      if (input.videoId) {
        const video = await repo.findPlayableVideo(input.videoId);
        if (!video)
          throw new RoomError('VIDEO_NOT_FOUND', '视频不存在或不可播放');
      }

      const room = await runExclusive(userId, async (tx, flush) => {
        const room = await repo.createRoom(tx, {
          ownerId: userId,
          name: input.name,
          announcement: input.announcement ?? null,
          visibility: input.visibility,
          passwordHash: null, // 下面补充哈希
          currentVideoId: input.videoId ?? null
        });

        // scrypt 快速，事务内同步计算，保证创建与密码写入原子生效
        if (input.password) {
          const passwordHash = await hashRoomPassword(input.password);
          await tx
            .update(watchRoomsTable)
            .set({ passwordHash })
            .where(eq(watchRoomsTable.id, room.id));
        }

        // 先处理旧房间（插入新 active 成员前必须释放唯一索引槽位）
        const existing = await repo.findActiveMembershipByUser(userId, tx);
        if (existing) {
          const brief = await getUserBrief(userId);
          if (existing.role === 'owner') {
            await dissolveRoomTx(
              tx,
              existing.roomId,
              brief,
              `房主 ${brief.nickname} 解散了房间`,
              flush
            );
          } else {
            await leaveRoomTx(tx, existing, 'member_switched', flush);
          }
        }

        await repo.insertMember(tx, { roomId: room.id, userId, role: 'owner' });

        const brief = await getUserBrief(userId);
        await pushSystemMessage(
          tx,
          room.id,
          'member_joined',
          `${brief.nickname} 创建了房间`,
          { target: brief },
          flush
        );

        return room;
      });

      // Redis 归属回写（创建即进入房间）
      await conn.setUserRoom(userId, room.id);

      return room;
    },

    /**
     * 加入房间（统一入口：HTTP join 与 Socket room:join 都走这里）
     *
     * 顺序严格遵守 PRD：先完整验证目标房间（存在/开放/凭证/密码/人数），
     * 全部通过后才退出旧房间（房主则解散）——目标验证失败时原房间不受影响。
     */
    async joinRoom(userId: string, roomId: string, input: WatchRoomJoinInput) {
      const outcome = await runExclusive(userId, async (tx, flush) => {
        const room = await repo.lockRoomById(tx, roomId);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

        // —— 目标房间验证（失败直接抛错，旧房间保留）——
        if (room.visibility === 'private') {
          if (!input.inviteToken) {
            throw new RoomError('ROOM_PRIVATE', '私人房间需要邀请凭证');
          }
          const result = await repo.findValidInvite(
            tx,
            roomId,
            hashToken(input.inviteToken)
          );
          if (!result.invite) {
            throw result.expired
              ? new RoomError('INVITE_EXPIRED', '邀请凭证已过期')
              : new RoomError('INVITE_INVALID', '邀请凭证无效');
          }
        }

        if (room.passwordHash) {
          if (
            !input.password ||
            !(await verifyRoomPassword(input.password, room.passwordHash))
          ) {
            throw new RoomError('ROOM_PASSWORD_INVALID', '房间密码错误');
          }
        }

        const existing = await repo.findActiveMembershipByUser(userId, tx);

        // 已在目标房间：幂等返回，不重复通知
        if (existing && existing.roomId === roomId) {
          return { alreadyJoined: true as const, roomId };
        }

        const memberCount = await repo.countActiveMembers(tx, roomId);
        if (memberCount >= room.maxMembers) {
          throw new RoomError('ROOM_FULL', '房间人数已满');
        }

        // —— 全部验证通过，执行切换 ——
        let previousRoomId: string | null = null;
        if (existing) {
          previousRoomId = existing.roomId;
          const brief = await getUserBrief(userId);
          if (existing.role === 'owner') {
            await dissolveRoomTx(
              tx,
              existing.roomId,
              brief,
              `房主 ${brief.nickname} 解散了房间`,
              flush
            );
          } else {
            await leaveRoomTx(tx, existing, 'member_switched', flush);
          }
        }

        const member = await repo.insertMember(tx, {
          roomId,
          userId,
          role: 'member'
        });

        const brief = await getUserBrief(userId);
        const joinedPayload = await pushSystemMessage(
          tx,
          roomId,
          'member_joined',
          `${brief.nickname} 加入了房间`,
          { target: brief },
          flush
        );

        flush(() => {
          conn.emitToRoom(roomId, 'room:member-joined', {
            roomId,
            member: {
              userId,
              nickname: brief.nickname,
              avatar: brief.avatar,
              role: member.role,
              joinedAt: member.createdAt
            },
            message: joinedPayload
          });
          if (previousRoomId) {
            // 跨设备切换：原房间中该用户的所有连接收到切换事件
            conn.emitToUser(userId, 'room:switched', {
              roomId: previousRoomId,
              newRoomId: roomId,
              reason: 'joined_another_room'
            });
            conn.dropUserFromRoom(userId, previousRoomId);
          }
        });

        return { alreadyJoined: false as const, roomId, previousRoomId };
      });

      // Redis 归属更新（事务提交后执行；重复加入同一房间时也回写，
      // 修复 Redis 重启丢失归属后的状态恢复）
      await conn.setUserRoom(userId, roomId);
      if (outcome.previousRoomId) {
        await conn.clearUserRoom(userId, outcome.previousRoomId);
        await conn.markRoomOffline(outcome.previousRoomId, userId);
      }

      return outcome;
    },

    /**
     * 邀请链接直连加入：按凭证解析房间后复用 joinRoom 的统一验证流程
     * （凭证有效性/过期在 joinRoom 内再次校验，保证与房间维度校验一致）
     */
    async joinRoomByInvite(
      userId: string,
      input: { token: string; password?: string }
    ) {
      const resolved = await repo.resolveInviteToken(hashToken(input.token));
      if (!resolved.ok) {
        throw resolved.expired
          ? new RoomError('INVITE_EXPIRED', '邀请凭证已过期')
          : new RoomError('INVITE_INVALID', '邀请凭证无效');
      }
      return this.joinRoom(userId, resolved.roomId, {
        inviteToken: input.token,
        ...(input.password && { password: input.password })
      });
    },

    /**
     * 主动离开房间。房主主动离开（退出/关闭/切换）时房间立即解散，
     * 不进行房主转让；幂等：不在任何房间时抛 ROOM_MEMBER_NOT_FOUND
     */
    async leaveRoom(userId: string, opts?: { switched?: boolean }) {
      return runExclusive(userId, async (tx, flush) => {
        const membership = await repo.findActiveMembershipByUser(userId);
        if (!membership) {
          throw new RoomError('ROOM_MEMBER_NOT_FOUND', '不在任何房间中');
        }

        if (membership.role === 'owner') {
          const brief = await getUserBrief(userId);
          await dissolveRoomTx(
            tx,
            membership.roomId,
            brief,
            `房主 ${brief.nickname} 解散了房间`,
            flush
          );
        } else {
          await leaveRoomTx(
            tx,
            membership,
            opts?.switched ? 'member_switched' : 'member_left',
            flush
          );
        }

        return { roomId: membership.roomId };
      });
    },

    /** 房主关闭房间（= 解散，与主动退出一致） */
    async closeRoom(userId: string, roomId: string) {
      return runExclusive(userId, async (tx, flush) => {
        const membership = await requireMembership(userId, roomId, tx);
        if (membership.role !== 'owner') {
          throw new RoomError('ROOM_PERMISSION_DENIED', '仅房主可以关闭房间');
        }
        const brief = await getUserBrief(userId);
        await dissolveRoomTx(
          tx,
          roomId,
          brief,
          `房主 ${brief.nickname} 解散了房间`,
          flush
        );
        return { roomId };
      });
    },

    /** 房主踢出成员（清理其全部连接，被踢用户收到明确踢出结果） */
    async kickMember(userId: string, roomId: string, targetUserId: string) {
      await runExclusive(userId, async (tx, flush) => {
        const room = await repo.lockRoomById(tx, roomId);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

        const operator = await requireMembership(userId, roomId, tx);
        if (operator.role !== 'owner') {
          throw new RoomError('ROOM_PERMISSION_DENIED', '仅房主可以踢出成员');
        }

        const target = await repo.findActiveMembershipByUser(targetUserId, tx);
        if (!target || target.roomId !== roomId) {
          throw new RoomError('ROOM_MEMBER_NOT_FOUND', '目标用户不是房间成员');
        }
        if (target.role === 'owner') {
          throw new RoomError('ROOM_PERMISSION_DENIED', '无法移出房主');
        }

        const operatorBrief = await getUserBrief(userId);
        const targetBrief = await getUserBrief(targetUserId);
        await repo.endMembership(tx, target.id, 'kicked');

        const payload = await pushSystemMessage(
          tx,
          roomId,
          'member_kicked',
          `房主 ${operatorBrief.nickname} 将 ${targetBrief.nickname} 移出了房间`,
          { operator: operatorBrief, target: targetBrief },
          flush
        );

        flush(() => {
          conn.emitToRoom(roomId, 'room:member-kicked', {
            roomId,
            userId: targetUserId,
            message: payload
          });
          // 被踢用户的所有连接收到明确踢出结果（不含本房间广播，避免权限残留）
          conn.emitToUser(targetUserId, 'room:kicked', {
            roomId,
            message: payload
          });
          conn.dropUserFromRoom(targetUserId, roomId);
        });
      });

      // 事务提交后清理 Redis 归属与在线状态
      await conn.clearUserRoom(targetUserId, roomId);
      await conn.markRoomOffline(roomId, targetUserId);
    },

    /** 房主修改房间信息（名称/公告） */
    async updateRoom(
      userId: string,
      roomId: string,
      input: WatchRoomUpdateInput
    ) {
      return runExclusive(userId, async (tx, flush) => {
        const room = await repo.lockRoomById(tx, roomId);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

        const membership = await requireMembership(userId, roomId, tx);
        if (membership.role !== 'owner') {
          throw new RoomError(
            'ROOM_PERMISSION_DENIED',
            '仅房主可以修改房间信息'
          );
        }

        const updated = await repo.updateRoomInfo(roomId, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.announcement !== undefined
            ? { announcement: input.announcement }
            : {})
        });

        const operatorBrief = await getUserBrief(userId);
        const payload = await pushSystemMessage(
          tx,
          roomId,
          'room_updated',
          `${operatorBrief.nickname} 修改了房间信息`,
          { operator: operatorBrief },
          flush
        );

        flush(() => {
          conn.emitToRoom(roomId, 'room:updated', {
            roomId,
            name: updated!.name,
            announcement: updated!.announcement,
            message: payload
          });
        });

        return updated;
      });
    },

    /**
     * 创建/重新生成邀请凭证（房主）。
     * 重新生成后旧凭证立即失效；targetUserId 可选（生成邀请通知）。
     */
    async createInvite(
      userId: string,
      roomId: string,
      input: { userId?: string; expiresInDays?: number }
    ) {
      return runExclusive(userId, async (tx, flush) => {
        const room = await repo.lockRoomById(tx, roomId);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');
        if (room.visibility !== 'private') {
          throw new RoomError(
            'ROOM_PERMISSION_DENIED',
            '公开房间不需要邀请凭证'
          );
        }

        const membership = await requireMembership(userId, roomId, tx);
        if (membership.role !== 'owner') {
          throw new RoomError(
            'ROOM_PERMISSION_DENIED',
            '仅房主可以生成邀请凭证'
          );
        }

        const token = generateToken();
        const expiresAt = input.expiresInDays
          ? new Date(Date.now() + input.expiresInDays * 86400_000)
          : null;

        const invite = await repo.createInvite(tx, {
          roomId,
          tokenHash: hashToken(token),
          createdBy: userId,
          expiresAt
        });

        // 邀请通知：仅代表邀请已发出，不代表被邀请用户已加入
        if (input.userId) {
          const targetBriefs = await repo.findUserBriefs([input.userId]);
          const targetBrief = targetBriefs.get(input.userId);
          if (!targetBrief) {
            throw new RoomError('ROOM_MEMBER_NOT_FOUND', '被邀请用户不存在');
          }
          const operatorBrief = await getUserBrief(userId);
          await pushSystemMessage(
            tx,
            roomId,
            'member_invited',
            `房主 ${operatorBrief.nickname} 邀请了 ${targetBrief.nickname} 加入房间`,
            {
              operator: operatorBrief,
              target: { userId: input.userId, ...targetBrief }
            },
            flush
          );
        }

        return { token, expiresAt: invite.expiresAt };
      });
    },

    // ============================================
    // 查询
    // ============================================

    /** 公开房间列表（大厅：分页/排序/搜索，附实时在线人数与当前视频） */
    async listPublicRooms(query: WatchRoomListQuery) {
      const { items, total } = await repo.findPublicRooms(query);

      // 并行拉取各房间实时在线名单（Redis 集合）
      const onlineLists = await Promise.all(
        items.map(item => conn.getRoomOnlineUsers(item.id))
      );

      return {
        items: items.map((item, index) => ({
          id: item.id,
          name: item.name,
          ownerId: item.ownerId,
          owner: {
            userId: item.ownerId,
            nickname: item.ownerName,
            avatar: item.ownerAvatar
          },
          onlineCount: onlineLists[index].length,
          memberCount: Number(item.memberCount),
          maxMembers: item.maxMembers,
          isPlaying: item.isPlaying,
          currentVideo: item.currentVideoId
            ? {
                videoId: item.currentVideoId,
                title: item.videoTitle,
                episode: item.videoEpisode,
                animeId: item.animeId,
                animeName: item.animeName,
                animeCover: item.animeCover
              }
            : null,
          createdAt: item.createdAt
        })),
        total
      };
    },

    /** 房间详情（公开房间任何人可见；私人房间对非成员等同不存在，防泄露） */
    async getRoomDetail(roomId: string, viewerId?: string) {
      const room = await repo.findRoomById(roomId);
      if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

      let isMember = false;
      if (viewerId) {
        const membership = await repo.findActiveMembershipByUser(viewerId);
        isMember = membership?.roomId === roomId;
      }

      if (room.visibility === 'private' && !isMember) {
        throw new RoomError('ROOM_NOT_FOUND', '房间不存在');
      }

      const [briefs, onlineUserIds, memberCount, video] = await Promise.all([
        repo.findUserBriefs([room.ownerId]),
        // 在线人数以 Redis 实时集合为准（成员关系统一以 active 记录为准）
        conn.getRoomOnlineUsers(roomId),
        repo.countActiveMembers(db, roomId),
        room.currentVideoId ? repo.findPlayableVideo(room.currentVideoId) : null
      ]);
      const onlineCount = onlineUserIds.length;

      const ownerBrief = briefs.get(room.ownerId);
      if (!ownerBrief) throw new RoomError('ROOM_NOT_FOUND', '房主不存在');

      return {
        id: room.id,
        name: room.name,
        announcement: room.announcement,
        visibility: room.visibility,
        ownerId: room.ownerId,
        owner: {
          userId: room.ownerId,
          nickname: ownerBrief.nickname,
          avatar: ownerBrief.avatar
        },
        onlineCount,
        memberCount,
        maxMembers: room.maxMembers,
        playback: computePlayback(room),
        currentVideo: video
          ? {
              videoId: video.videoId,
              title: video.title,
              episode: video.episode,
              animeId: video.animeId,
              animeName: video.animeName,
              animeCover: video.animeCover
            }
          : null,
        createdAt: room.createdAt
      };
    },

    /** 房间完整状态（成员视角：成员列表 + 我的角色）。单会话模型下在房成员即在线 */
    async getRoomState(userId: string, roomId: string) {
      const detail = await this.getRoomDetail(roomId, userId);
      await requireMembership(userId, roomId);

      const members = await repo.findRoomMembers(roomId);

      return {
        ...detail,
        members: members.map(m => ({
          userId: m.userId,
          nickname: m.nickname,
          avatar: m.avatar,
          role: m.role,
          joinedAt: m.joinedAt
        })),
        me: {
          role: members.find(m => m.userId === userId)?.role ?? 'member',
          canControlPlayback:
            members.find(m => m.userId === userId)?.role === 'owner'
        }
      };
    },

    /** 当前用户所在房间（跨设备状态恢复 / 加入前检查） */
    async getCurrentRoom(userId: string) {
      const roomId = await conn.getUserRoom(userId);
      if (!roomId) return null;

      // Redis 归属可能因房间解散/踢人产生残留，以数据库为准校验
      const membership = await repo.findActiveMembershipByUser(userId);
      if (!membership || membership.roomId !== roomId) {
        await conn.clearUserRoom(userId, roomId);
        return null;
      }

      const room = await repo.findRoomById(roomId);
      if (!room) {
        await conn.clearUserRoom(userId, roomId);
        return null;
      }

      return this.getRoomState(userId, roomId);
    },

    /** 房间消息历史（聊天 + 系统通知统一分页） */
    async listMessages(
      userId: string,
      roomId: string,
      page: number,
      pageSize: number
    ) {
      await requireMembership(userId, roomId);
      const { items, total } = await repo.findMessages(roomId, page, pageSize);

      const messages = items.map(item => {
        const meta = (item.metadata ?? {}) as SystemMeta;
        const payload: Record<string, unknown> = {
          messageId: item.id,
          roomId: item.roomId,
          type: item.type,
          content: item.content,
          createdAt: item.createdAt
        };

        if (item.type === 'chat' && item.userId) {
          payload.user = {
            userId: item.userId,
            nickname: item.userNickname,
            avatar: item.userAvatar
          };
        }

        if (item.type === 'system' && item.eventType) {
          payload.system = {
            eventType: item.eventType,
            ...(meta.operator ? { operator: meta.operator } : {}),
            ...(meta.target ? { target: meta.target } : {}),
            ...(meta.metadata ? { metadata: meta.metadata } : {})
          };
        }

        return payload;
      });

      return { items: messages, total };
    },

    // ============================================
    // 播放同步（仅房主可控）
    // ============================================

    /**
     * 播放控制统一入口：验证房主权限 → 更新权威状态 → 广播 sync
     * 播放过程不写库，仅在操作时刻更新持久化状态
     */
    async controlPlayback(
      userId: string,
      roomId: string,
      action: 'play' | 'pause' | 'seek' | 'change_video',
      value?: number | string
    ) {
      return runExclusive(userId, async (tx, flush) => {
        const room = await repo.lockRoomById(tx, roomId);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

        const membership = await requireMembership(userId, roomId, tx);
        if (membership.role !== 'owner') {
          throw new RoomError('ROOM_PERMISSION_DENIED', '仅房主可以控制播放');
        }

        // 播放中的真实位置 = 存档位置 + 已播放时长
        const currentPosition =
          room.playbackPosition +
          (room.isPlaying
            ? (Date.now() - room.playbackUpdatedAt.getTime()) / 1000
            : 0);

        let patch: Partial<typeof watchRoomsTable.$inferInsert>;

        switch (action) {
          case 'play':
            patch = {
              isPlaying: true,
              playbackPosition: currentPosition,
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
            const video = await repo.isVideoPlayable(tx, videoId);
            if (!video) {
              throw new RoomError('VIDEO_NOT_FOUND', '视频不存在或不可播放');
            }
            patch = {
              currentVideoId: videoId,
              // 切换视频后播放状态重置，等待成员完成媒体加载
              playbackPosition: 0,
              isPlaying: false,
              playbackUpdatedAt: new Date(),
              playbackRevision: room.playbackRevision + 1
            };
            break;
          }
        }

        const [updated] = await tx
          .update(watchRoomsTable)
          .set(patch)
          .where(eq(watchRoomsTable.id, roomId))
          .returning();

        const playback = computePlayback(updated);
        flush(() => {
          conn.emitToRoom(roomId, 'playback:sync', { roomId, playback });
        });

        return playback;
      });
    },

    // ============================================
    // 聊天
    // ============================================

    /** 发送聊天消息（仅房间成员；实时广播 + 持久化） */
    async sendChat(userId: string, roomId: string, content: string) {
      return runExclusive(userId, async (tx, flush) => {
        const room = await repo.lockRoomById(tx, roomId);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

        await requireMembership(userId, roomId, tx);

        const briefs = await repo.findUserBriefs([userId]);
        const brief = briefs.get(userId);
        if (!brief) throw new RoomError('ROOM_MEMBER_NOT_FOUND', '用户不存在');

        const message = await repo.insertMessage(tx, {
          roomId,
          userId,
          type: 'chat',
          eventType: null,
          content,
          // 聊天消息发送者信息冗余进 metadata，广播载荷可统一构建
          metadata: {
            user: { userId, nickname: brief.nickname, avatar: brief.avatar }
          }
        });

        const payload = toMessagePayload(message);
        flush(() => {
          conn.emitToRoom(roomId, 'chat:message', payload);
        });

        return payload;
      });
    },

    // ============================================
    // 断开即离开（网络断开与主动离开同等处理）：
    // 房主断开 → 解散；普通成员断开 → 退出房间
    // ============================================

    /**
     * Socket 断开时的房间退出处理。
     *
     * 归属与成员资格已失效（重复断开/已被移出）时仅做 Redis 兜底清理。
     */
    async disconnectLeave(userId: string, roomId: string) {
      try {
        return await runExclusive(userId, async (tx, flush) => {
          const membership = await repo.findActiveMembershipByUser(userId, tx);
          if (!membership || membership.roomId !== roomId) return;

          const brief = await getUserBrief(userId);
          if (membership.role === 'owner') {
            await dissolveRoomTx(
              tx,
              roomId,
              brief,
              `房主 ${brief.nickname} 断开连接，房间已解散`,
              flush
            );
          } else {
            await leaveRoomTx(tx, membership, 'member_left', flush);
          }
        });
      } finally {
        // 兜底清理：成员资格可能已失效（leave/dissolve 的 flush 已处理过的场景幂等）
        await conn.clearUserRoom(userId, roomId).catch(() => undefined);
        await conn.markRoomOffline(roomId, userId).catch(() => undefined);
      }
    },

    /**
     * 用户被禁用时的连带处理：房主房间解散，成员退出所在房间。
     * （房主账号被删除时房间由外键级联删除，无需处理）
     */
    async handleUserDisabled(userId: string) {
      return runExclusive(userId, async (tx, flush) => {
        const membership = await repo.findActiveMembershipByUser(userId, tx);
        if (!membership) return;

        const brief = await getUserBrief(userId);
        if (membership.role === 'owner') {
          await dissolveRoomTx(
            tx,
            membership.roomId,
            brief,
            `房主 ${brief.nickname} 账号已被停用，房间已解散`,
            flush
          );
        } else {
          await leaveRoomTx(tx, membership, 'member_left', flush);
        }
      });
    },

    // ============================================
    // 管理端（admin）：跨房间治理，不要求操作者是房间成员
    // ============================================

    /** 管理端房间列表（含私人/已关闭房间，附实时在线人数） */
    async adminListRooms(query: AdminWatchRoomListQuery) {
      const { items, total } = await repo.findRoomsForAdmin(query);

      const onlineLists = await Promise.all(
        items.map(item => conn.getRoomOnlineUsers(item.id))
      );

      return {
        items: items.map((item, index) => ({
          id: item.id,
          name: item.name,
          announcement: item.announcement,
          visibility: item.visibility,
          ownerId: item.ownerId,
          owner: {
            userId: item.ownerId,
            nickname: item.ownerName,
            avatar: item.ownerAvatar
          },
          memberCount: Number(item.memberCount),
          onlineCount: onlineLists[index].length,
          maxMembers: item.maxMembers,
          isPlaying: item.isPlaying,
          currentVideo: item.currentVideoId
            ? {
                videoId: item.currentVideoId,
                title: item.videoTitle,
                episode: item.videoEpisode,
                animeId: item.animeId,
                animeName: item.animeName,
                animeCover: item.animeCover
              }
            : null,
          createdAt: item.createdAt
        })),
        total
      };
    },

    /** 管理端编辑房间信息（开放中房间实时广播 room:updated） */
    async adminUpdateRoom(
      adminUserId: string,
      roomId: string,
      input: WatchRoomUpdateInput
    ) {
      return runExclusive(adminUserId, async (tx, flush) => {
        const room = await repo.lockRoomById(tx, roomId);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

        const updated = await repo.updateRoomInfo(roomId, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.announcement !== undefined
            ? { announcement: input.announcement }
            : {})
        });

        // 写系统通知并实时广播，成员端同步展示
        const operator = await getUserBrief(adminUserId);
        const payload = await pushSystemMessage(
          tx,
          roomId,
          'room_updated',
          `管理员 ${operator.nickname} 修改了房间信息`,
          { operator },
          flush
        );
        flush(() => {
          conn.emitToRoom(roomId, 'room:updated', {
            roomId,
            name: updated!.name,
            announcement: updated!.announcement,
            message: payload
          });
        });

        return updated;
      });
    },

    /** 管理端房间详情（列表条目结构，含实时在线人数） */
    async adminGetRoom(roomId: string) {
      const room = await repo.findRoomById(roomId);
      if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

      const [briefs, onlineUserIds, memberCount, video] = await Promise.all([
        repo.findUserBriefs([room.ownerId]),
        conn.getRoomOnlineUsers(roomId),
        repo.countActiveMembers(db, roomId),
        room.currentVideoId ? repo.findPlayableVideo(room.currentVideoId) : null
      ]);
      const ownerBrief = briefs.get(room.ownerId);
      if (!ownerBrief) throw new RoomError('ROOM_NOT_FOUND', '房主不存在');

      return {
        id: room.id,
        name: room.name,
        announcement: room.announcement,
        visibility: room.visibility,
        ownerId: room.ownerId,
        owner: {
          userId: room.ownerId,
          nickname: ownerBrief.nickname,
          avatar: ownerBrief.avatar
        },
        memberCount,
        onlineCount: onlineUserIds.length,
        maxMembers: room.maxMembers,
        isPlaying: room.isPlaying,
        currentVideo: video
          ? {
              videoId: video.videoId,
              title: video.title,
              episode: video.episode,
              animeId: video.animeId,
              animeName: video.animeName,
              animeCover: video.animeCover
            }
          : null,
        createdAt: room.createdAt
      };
    },

    /**
     * 管理端删除房间（硬删除，级联成员/消息/邀请凭证）。
     * 开放中房间先广播 room:closed 让成员客户端退出，再删除记录。
     */
    async adminDeleteRoom(adminUserId: string, roomId: string) {
      await runExclusive(adminUserId, async (tx, flush) => {
        const room = await repo.lockRoomById(tx, roomId);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

        const operator = await getUserBrief(adminUserId);
        await dissolveRoomTx(
          tx,
          roomId,
          operator,
          `管理员 ${operator.nickname} 解散了房间`,
          flush
        );
      });

      return { roomId };
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    fastify.decorate('watchRoomService', createWatchRoomService(fastify));
  },
  {
    name: 'watch-room-service',
    dependencies: ['watch-room-repository', 'watch-room-connections']
  }
);
