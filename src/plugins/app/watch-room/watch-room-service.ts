import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq, sql } from 'drizzle-orm';
import { watchRoomsTable, type AnimeType } from '../../../db/index.js';
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
    tx: Tx,
    userId: string
  ): Promise<WatchRoomUserBrief> => {
    const briefs = await repo.findUserBriefs([userId], tx);
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
    // 先锁房间行再改成员行（与解散/踢人保持"房间 → 成员"的加锁顺序：
    // 反序会与房主解散的级联删除互相等待而死锁）。房间已解散则无需离开
    const room = await repo.lockRoomById(tx, membership.roomId);
    if (!room) return;

    // 已被并发结束（如同时被房主踢出）：不再重复发离开通知
    const ended = await repo.endMembership(tx, membership.id, 'left');
    if (!ended) return;

    const brief = await getUserBrief(tx, membership.userId);

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

    /**
     * 创建房间（创建者自动成为房主并进入房间；已在其他房间则按切换规则处理）
     * @param excludeTypes 创建者无权访问的动漫类型（初始视频不能属于这些类型）
     */
    async createRoom(
      userId: string,
      input: {
        name: string;
        visibility: 'public' | 'private';
        announcement?: string | null;
        password?: string;
        videoId: string;
      },
      excludeTypes?: AnimeType[]
    ) {
      if (input.password && input.visibility !== 'private') {
        throw new RoomError('INVALID_PARAMS', '仅私人房间可以设置密码');
      }
      if (!input.password && input.visibility === 'private') {
        throw new RoomError('INVALID_PARAMS', '私人房间必须设置密码');
      }

      const video = await repo.findPlayableVideo(input.videoId, excludeTypes);
      if (!video)
        throw new RoomError('VIDEO_NOT_FOUND', '视频不存在或不可播放');

      // scrypt 刻意耗时，放在事务外计算，避免持有数据库连接与用户锁期间阻塞
      const passwordHash = input.password
        ? await hashRoomPassword(input.password)
        : null;

      return runExclusive(userId, async (tx, flush) => {
        const room = await repo.createRoom(tx, {
          ownerId: userId,
          name: input.name,
          announcement: input.announcement ?? null,
          visibility: input.visibility,
          passwordHash,
          currentVideoId: input.videoId
        });

        // 先处理旧房间（插入新 active 成员前必须释放唯一索引槽位）
        const existing = await repo.findActiveMembershipByUser(userId, tx);
        if (existing) {
          const brief = await getUserBrief(tx, userId);
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

        const brief = await getUserBrief(tx, userId);
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
    },

    /**
     * 加入房间（Socket room:join）
     *
     * 顺序严格遵守 PRD：先完整验证目标房间（存在/密码/人数），
     * 全部通过后才退出旧房间（房主则解散）——目标验证失败时原房间不受影响。
     * @param excludeTypes 加入者无权访问的动漫类型（房间正在播放这些类型时拒绝加入）
     */
    async joinRoom(
      userId: string,
      roomId: string,
      input: WatchRoomJoinInput,
      excludeTypes?: AnimeType[]
    ) {
      const target = await repo.findRoomById(roomId);
      if (!target) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

      // scrypt 刻意耗时，不能在持有数据库连接、用户锁与房间行锁期间计算：
      // 事务前预先校验（房间密码创建后不可修改，结果在事务内仍然有效）
      const passwordValid =
        !target.passwordHash ||
        (!!input.password &&
          (await verifyRoomPassword(input.password, target.passwordHash)));

      return runExclusive(userId, async (tx, flush) => {
        // 目标房间与旧房间按 id 顺序一次锁定（两个房主互相加入对方房间时，
        // 分别先锁目标再锁旧房间会死锁）
        const current = await repo.findActiveMembershipByUser(userId, tx);
        const rooms = await repo.lockRoomsByIds(
          tx,
          current && current.roomId !== roomId
            ? [roomId, current.roomId]
            : [roomId]
        );
        const room = rooms.get(roomId);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

        // 等锁期间旧房间可能已被解散 / 用户被踢出：加锁后重新读取成员关系
        const existing = await repo.findActiveMembershipByUser(userId, tx);

        // 已在目标房间：幂等返回，不重复通知（已是成员，无需再校验密码）
        if (existing && existing.roomId === roomId) {
          return { alreadyJoined: true as const, roomId };
        }

        // —— 目标房间验证（失败直接抛错，旧房间保留）——
        if (!passwordValid) {
          throw input.password
            ? new RoomError('ROOM_PASSWORD_INVALID', '房间密码错误')
            : new RoomError('ROOM_PRIVATE', '私人房间需要输入密码');
        }

        // 混合角色房间：正在播放的内容加入者无权观看时拒绝加入
        // （视频已下架/草稿不阻止加入，房主可另行切换）
        if (room.currentVideoId && excludeTypes?.length) {
          const video = await repo.isVideoPlayable(tx, room.currentVideoId);
          if (video && excludeTypes.includes(video.animeType)) {
            throw new RoomError(
              'VIDEO_UNAVAILABLE',
              '房间正在播放你无权观看的内容'
            );
          }
        }

        const memberCount = await repo.countActiveMembers(tx, roomId);
        if (memberCount >= room.maxMembers) {
          throw new RoomError('ROOM_FULL', '房间人数已满');
        }

        // —— 全部验证通过，执行切换 ——
        let previousRoomId: string | null = null;
        if (existing) {
          previousRoomId = existing.roomId;
          const brief = await getUserBrief(tx, userId);
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

        const brief = await getUserBrief(tx, userId);
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
    },

    /**
     * 主动离开房间。房主主动离开（退出/关闭/切换）时房间立即解散，
     * 不进行房主转让；不在任何房间时抛 ROOM_MEMBER_NOT_FOUND。
     * 传入 roomId 时只离开该房间（客户端停留在旧房间页面时，
     * 不能误退出、甚至误解散用户已切换到的新房间）
     */
    async leaveRoom(userId: string, opts?: { roomId?: string }) {
      return runExclusive(userId, async (tx, flush) => {
        const membership = await repo.findActiveMembershipByUser(userId, tx);
        if (!membership) {
          throw new RoomError('ROOM_MEMBER_NOT_FOUND', '不在任何房间中');
        }
        if (opts?.roomId && membership.roomId !== opts.roomId) {
          throw new RoomError('ROOM_MEMBER_NOT_FOUND', '你不是该房间的成员');
        }

        if (membership.role === 'owner') {
          const brief = await getUserBrief(tx, userId);
          await dissolveRoomTx(
            tx,
            membership.roomId,
            brief,
            `房主 ${brief.nickname} 解散了房间`,
            flush
          );
        } else {
          await leaveRoomTx(tx, membership, 'member_left', flush);
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
        const brief = await getUserBrief(tx, userId);
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

        const operatorBrief = await getUserBrief(tx, userId);
        const targetBrief = await getUserBrief(tx, targetUserId);
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

        const updated = await repo.updateRoomInfo(tx, roomId, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.announcement !== undefined
            ? { announcement: input.announcement }
            : {})
        });

        const operatorBrief = await getUserBrief(tx, userId);
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

    // ============================================
    // 查询
    // ============================================

    /**
     * 公开房间列表（大厅：按创建时间倒序分页，附成员数与当前视频）
     * @param excludeTypes 观看者无权访问的动漫类型（正在播放这些类型的房间不展示）
     */
    async listPublicRooms(
      query: WatchRoomListQuery,
      excludeTypes: AnimeType[] | undefined
    ) {
      const { items, total } = await repo.findPublicRooms(query, excludeTypes);

      return {
        items: items.map(item => ({
          id: item.id,
          name: item.name,
          ownerId: item.ownerId,
          owner: {
            userId: item.ownerId,
            nickname: item.ownerName,
            avatar: item.ownerAvatar
          },
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

    /**
     * 房间详情（公开房间任何人可见；私人房间对非成员等同不存在，防泄露）
     * @param excludeTypes 观看者无权访问的动漫类型（命中时不返回当前视频信息）
     */
    async getRoomDetail(
      roomId: string,
      viewerId?: string,
      excludeTypes?: AnimeType[]
    ) {
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

      const [briefs, memberCount, video] = await Promise.all([
        repo.findUserBriefs([room.ownerId]),
        repo.countActiveMembers(db, roomId),
        room.currentVideoId
          ? repo.findPlayableVideo(room.currentVideoId, excludeTypes)
          : null
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
    async getRoomState(
      userId: string,
      roomId: string,
      excludeTypes?: AnimeType[]
    ) {
      const detail = await this.getRoomDetail(roomId, userId, excludeTypes);
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
    async getCurrentRoom(userId: string, excludeTypes?: AnimeType[]) {
      const membership = await repo.findActiveMembershipByUser(userId);
      if (!membership) return null;
      return this.getRoomState(userId, membership.roomId, excludeTypes);
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
     *
     * @param value play/seek 为播放位置（秒；play 不传则从当前位置继续），change_video 为视频ID
     * @param excludeTypes 房主无权访问的动漫类型（change_video 不能切到这些类型）
     */
    async controlPlayback(
      userId: string,
      roomId: string,
      action: 'play' | 'pause' | 'seek' | 'change_video',
      value?: number | string,
      excludeTypes?: AnimeType[]
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
            const video = await repo.isVideoPlayable(tx, videoId, excludeTypes);
            if (!video) {
              throw new RoomError('VIDEO_NOT_FOUND', '视频不存在或不可播放');
            }
            // 混合角色房间：不能切到房间内任一成员无权观看的内容
            const roles = await repo.findActiveMemberRoles(tx, roomId);
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

        const briefs = await repo.findUserBriefs([userId], tx);
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

    /** Socket 断开时的房间退出处理（不在任何房间时直接返回） */
    async disconnectLeave(userId: string) {
      await runExclusive(userId, async (tx, flush) => {
        const membership = await repo.findActiveMembershipByUser(userId, tx);
        if (!membership) return;

        const brief = await getUserBrief(tx, userId);
        if (membership.role === 'owner') {
          await dissolveRoomTx(
            tx,
            membership.roomId,
            brief,
            `房主 ${brief.nickname} 断开连接，房间已解散`,
            flush
          );
        } else {
          await leaveRoomTx(tx, membership, 'member_left', flush);
        }
      });
    },

    /**
     * 用户被禁用时的连带处理：房主房间解散，成员退出所在房间，
     * 并断开其全部 Socket 连接。
     * （房主账号被删除时房间由外键级联删除，无需处理）
     */
    async handleUserDisabled(userId: string) {
      try {
        await runExclusive(userId, async (tx, flush) => {
          const membership = await repo.findActiveMembershipByUser(userId, tx);
          if (!membership) return;

          const brief = await getUserBrief(tx, userId);
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
      } finally {
        // 已建立的连接不会重新握手，必须主动断开；房间清理失败时，
        // 断开触发的离开逻辑也会再兜底一次
        conn.disconnectUser(userId);
      }
    },

    /**
     * 清空全部房间（服务启动时调用）：单实例 + 断开即离开，启动时不存在任何连接，
     * 上次关闭/崩溃前没来得及执行离开逻辑的房间全部解散（成员/消息级联删除）
     */
    async clearAllRooms() {
      const deleted = await db
        .delete(watchRoomsTable)
        .returning({ id: watchRoomsTable.id });
      return deleted.length;
    },

    // ============================================
    // 管理端（admin）：跨房间治理，不要求操作者是房间成员
    // ============================================

    /** 管理端房间列表（含私人房间，附成员数） */
    async adminListRooms(query: AdminWatchRoomListQuery) {
      const { items, total } = await repo.findRoomsForAdmin(query);

      return {
        items: items.map(item => ({
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

        const updated = await repo.updateRoomInfo(tx, roomId, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.announcement !== undefined
            ? { announcement: input.announcement }
            : {})
        });

        // 写系统通知并实时广播，成员端同步展示
        const operator = await getUserBrief(tx, adminUserId);
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

    /** 管理端房间详情（列表条目结构） */
    async adminGetRoom(roomId: string) {
      const room = await repo.findRoomById(roomId);
      if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

      const [briefs, memberCount, video] = await Promise.all([
        repo.findUserBriefs([room.ownerId]),
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
     * 管理端删除房间（硬删除，级联成员/消息）。
     * 开放中房间先广播 room:closed 让成员客户端退出，再删除记录。
     */
    async adminDeleteRoom(adminUserId: string, roomId: string) {
      await runExclusive(adminUserId, async (tx, flush) => {
        const room = await repo.lockRoomById(tx, roomId);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

        const operator = await getUserBrief(tx, adminUserId);
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
    dependencies: [
      'watch-room-repository',
      'watch-room-connections',
      'rbac-middleware'
    ]
  }
);
