import {
  WATCH_ROOM_MAX_MEMBERS,
  type AnimeType
} from '../../../../db/index.js';
import type {
  WatchRoomJoinInput,
  WatchRoomUpdateInput
} from '../../../../schemas/watch-room.js';
import {
  hashRoomPassword,
  RoomError,
  verifyRoomPassword
} from '../../../../utils/watch-room.js';
import type { WatchRoomCore } from './watch-room-core.js';

/**
 * 密码通行证有效期（秒）：验证过一次密码后，退出/断线/换标签页回来的一段时间内
 * 免密入场。凭证只存「该用户已通过该房间密码」这一事实，不含密码本身。
 */
const PASSWORD_GRANT_TTL_SECONDS = 24 * 60 * 60;

/** 通行证 key：按 roomId + userId 记录 */
const passwordGrantKey = (roomId: string, userId: string) =>
  `watch-room:password-grant:${roomId}:${userId}`;

/**
 * 通行证指纹：存密码哈希派生串的前半段（实际是 scrypt 的 16 字节盐）。
 * 房主重新设置密码会重新生成盐，旧通行证自然失效（不必按前缀扫 key 清理）。
 */
const grantFingerprint = (passwordHash: string) => passwordHash.slice(0, 32);

/** 被移出过的账号再次尝试加入时的统一拒绝（预检与事务内各用一次） */
const bannedError = () =>
  new RoomError('ROOM_BANNED', '你已被房主移出该房间，无法再加入');

/**
 * 房间生命周期：创建 / 加入 / 离开 / 踢人 / 编辑 / 断线清理，
 * 以及管理端的编辑与删除。所有写操作都经 core.runExclusive 串行化。
 */
export const createWatchRoomLifecycle = (core: WatchRoomCore) => {
  const {
    fastify,
    db,
    repo,
    conn,
    runExclusive,
    requireMembership,
    getUserBrief,
    auditLog,
    pushSystemMessage,
    exitRoomTx,
    leaveRoomTx,
    dissolveRoomTx
  } = core;
  const redis = fastify.redis;

  /** 该账号是否已通过这个房间当前的密码（指纹一致视为通过） */
  const hasPasswordGrant = async (
    roomId: string,
    userId: string,
    passwordHash: string
  ) =>
    (await redis.get(passwordGrantKey(roomId, userId))) ===
    grantFingerprint(passwordHash);

  /**
   * 发放通行证，并顺带给已有的续期：经常回来的成员不会在第 24 小时
   * 突然被要求重新输入密码。房间解散后的残留 key 由 TTL 自然过期。
   */
  const grantPasswordAccess = async (
    roomId: string,
    userId: string,
    passwordHash: string
  ) => {
    await redis.set(
      passwordGrantKey(roomId, userId),
      grantFingerprint(passwordHash),
      'EX',
      PASSWORD_GRANT_TTL_SECONDS
    );
  };

  return {
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

      const video = await repo.findPlayableVideo(
        db,
        input.videoId,
        excludeTypes
      );
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
          currentVideoId: input.videoId,
          // 人数上限固定，不接受客户端传值
          maxMembers: WATCH_ROOM_MAX_MEMBERS
        });

        // 先退出旧房间（插入新成员记录前必须释放唯一索引槽位）
        const existing = await repo.findMembershipByUser(userId, tx);
        if (existing) {
          await exitRoomTx(tx, existing, flush, { reason: 'owner_switch' });
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

      // 被移出过就不必再走密码流程（事务内还会再校验一次，覆盖并发被踢的竞态）
      if (await repo.isBanned(db, roomId, userId)) throw bannedError();

      // scrypt 刻意耗时，不能在持有数据库连接、用户锁与房间行锁期间计算，
      // 因此在事务前预先校验；事务内会用行锁后的 passwordHash 复核（见下），
      // 避免「预读到加锁之间房主改了密码/转了公开」的竞态。
      // 24 小时内已验证过该房间密码的账号直接放行（退出/断线回来不必重输）。
      const passwordHash = target.passwordHash;
      const hasGrant = passwordHash
        ? await hasPasswordGrant(roomId, userId, passwordHash)
        : true;
      const passwordValid =
        hasGrant ||
        (!!passwordHash &&
          !!input.password &&
          (await verifyRoomPassword(input.password, passwordHash)));

      const outcome = await runExclusive(userId, async (tx, flush) => {
        // 目标房间与旧房间按 id 顺序一次锁定（两个房主互相加入对方房间时，
        // 分别先锁目标再锁旧房间会死锁）
        const current = await repo.findMembershipByUser(userId, tx);
        const rooms = await repo.lockRoomsByIds(
          tx,
          current && current.roomId !== roomId
            ? [roomId, current.roomId]
            : [roomId]
        );
        const room = rooms.get(roomId);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

        // 预读之后房间的密码可能已变化（房主转私人/改密码）：校验结果作废，
        // 让客户端拿新状态重试，避免用旧密码直接进房
        if (room.passwordHash !== passwordHash) {
          throw new RoomError('INVALID_PARAMS', '房间状态已变化，请重试');
        }

        // 等锁期间旧房间可能已被解散 / 用户被踢出：加锁后重新读取成员关系
        const existing = await repo.findMembershipByUser(userId, tx);

        // 已在目标房间：幂等返回，不重复通知（已是成员，无需再校验密码）
        if (existing && existing.roomId === roomId) {
          return {
            alreadyJoined: true as const,
            roomId,
            /** 本次是否要发/续密码通行证（已在房里不发，避免错误密码换到凭证） */
            passwordGrant: false
          };
        }

        // 被房主移出过：该房间永久拒绝此人（房间解散后黑名单随之删除）
        if (await repo.isBanned(tx, roomId, userId)) throw bannedError();

        // —— 目标房间验证（失败直接抛错，旧房间保留）——
        if (!passwordValid) {
          throw input.password
            ? new RoomError('ROOM_PASSWORD_INVALID', '房间密码错误')
            : new RoomError('ROOM_PRIVATE', '私人房间需要输入密码');
        }

        // 混合角色房间：正在播放的内容加入者无权观看时拒绝加入
        // （视频已下架/草稿不阻止加入，房主可另行切换）
        if (room.currentVideoId && excludeTypes?.length) {
          const video = await repo.findPlayableVideo(tx, room.currentVideoId);
          if (video && excludeTypes.includes(video.animeType)) {
            throw new RoomError(
              'VIDEO_UNAVAILABLE',
              '房间正在播放你无权观看的内容'
            );
          }
        }

        const memberCount = await repo.countMembers(tx, roomId);
        if (memberCount >= room.maxMembers) {
          throw new RoomError('ROOM_FULL', '房间人数已满');
        }

        // —— 全部验证通过，退出旧房间后加入 ——
        if (existing) {
          await exitRoomTx(tx, existing, flush, { reason: 'owner_switch' });
        }

        const member = await repo.insertMember(tx, {
          roomId,
          userId,
          role: 'member'
        });

        const brief = await getUserBrief(tx, userId);
        await pushSystemMessage(
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
            }
          });
        });

        return {
          alreadyJoined: false as const,
          roomId,
          /** 密码确实校验通过（或已有通行证）才发凭证 */
          passwordGrant: passwordValid
        };
      });

      // 事务提交成功后才发/续通行证（失败/回滚不留凭证）。
      // 写 Redis 失败不该让「已成功加入」变成 ACK 失败：凭证只是免密优化
      if (target.passwordHash && outcome.passwordGrant) {
        try {
          await grantPasswordAccess(roomId, userId, target.passwordHash);
        } catch (error) {
          fastify.log.warn(
            { error, roomId, userId },
            'watch-room password grant failed'
          );
        }
      }
      return outcome;
    },

    /**
     * 主动离开房间。房主离开时房间立即解散，不进行房主转让；
     * 不在任何房间时抛 ROOM_MEMBER_NOT_FOUND。
     * 传入 roomId 时只离开该房间（客户端停留在旧房间页面时，
     * 不能误退出、甚至误解散用户已切换到的新房间）
     */
    async leaveRoom(userId: string, opts?: { roomId?: string }) {
      return runExclusive(userId, async (tx, flush) => {
        const membership = await repo.findMembershipByUser(userId, tx);
        if (!membership) {
          throw new RoomError('ROOM_MEMBER_NOT_FOUND', '不在任何房间中');
        }
        if (opts?.roomId && membership.roomId !== opts.roomId) {
          // 人还在，只是不在这间房：属于越权而不是资源不存在
          throw new RoomError('ROOM_PERMISSION_DENIED', '你不是该房间的成员');
        }

        await exitRoomTx(tx, membership, flush, { reason: 'owner_leave' });
        return { roomId: membership.roomId };
      });
    },

    /** 房主踢出成员（被踢用户收到 reason 为 kicked 的 room:member-left） */
    async kickMember(userId: string, roomId: string, targetUserId: string) {
      await runExclusive(userId, async (tx, flush) => {
        const room = await repo.lockRoomById(tx, roomId);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

        const operator = await requireMembership(userId, roomId, tx);
        if (operator.role !== 'owner') {
          throw new RoomError('ROOM_PERMISSION_DENIED', '仅房主可以踢出成员');
        }

        const target = await repo.findMembershipByUser(targetUserId, tx);
        if (!target || target.roomId !== roomId) {
          throw new RoomError('ROOM_MEMBER_NOT_FOUND', '目标用户不是房间成员');
        }
        if (target.role === 'owner') {
          throw new RoomError('ROOM_PERMISSION_DENIED', '无法移出房主');
        }

        const operatorBrief = await getUserBrief(tx, userId);
        // 拉黑与移出同一事务：要么「已移出且不能再进」，要么都不发生
        await repo.banMember(tx, roomId, targetUserId);
        await leaveRoomTx(tx, target, flush, operatorBrief);
      });
    },

    /** 房主修改房间信息（名称/公告/公开状态） */
    async updateRoom(
      userId: string,
      roomId: string,
      input: WatchRoomUpdateInput
    ) {
      if (input.password && input.visibility !== 'private') {
        throw new RoomError('INVALID_PARAMS', '密码只能随私人房间设置');
      }
      // scrypt 刻意耗时，放在事务外计算，避免持有行锁期间阻塞
      const newPasswordHash = input.password
        ? await hashRoomPassword(input.password)
        : undefined;

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

        // 转私人必须有密码；房间已是私人且设过密码时可只改状态
        if (
          input.visibility === 'private' &&
          !newPasswordHash &&
          !room.passwordHash
        ) {
          throw new RoomError('INVALID_PARAMS', '私人房间必须设置密码');
        }

        const updated = await repo.updateRoomInfo(tx, roomId, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.announcement !== undefined
            ? { announcement: input.announcement }
            : {}),
          ...(input.visibility !== undefined
            ? {
                visibility: input.visibility,
                // 转公开时清掉密码：再转回私人要重新设置，避免口令悄悄沿用
                passwordHash:
                  input.visibility === 'private'
                    ? (newPasswordHash ?? room.passwordHash)
                    : null
              }
            : {})
        });

        const operatorBrief = await getUserBrief(tx, userId);
        const visibilityChanged =
          input.visibility !== undefined &&
          input.visibility !== room.visibility;
        await pushSystemMessage(
          tx,
          roomId,
          'room_updated',
          visibilityChanged
            ? `${operatorBrief.nickname} 把房间设为${
                input.visibility === 'private' ? '私人' : '公开'
              }放映室`
            : `${operatorBrief.nickname} 修改了房间信息`,
          { operator: operatorBrief },
          flush
        );

        flush(() => {
          conn.emitToRoom(roomId, 'room:updated', {
            roomId,
            name: updated!.name,
            announcement: updated!.announcement,
            visibility: updated!.visibility
          });
        });

        // ACK 不回房间整行：密码哈希不该出现在网络载荷里
        return {
          roomId,
          name: updated!.name,
          announcement: updated!.announcement,
          visibility: updated!.visibility
        };
      });
    },

    /**
     * 断线宽限期到期后的房间退出处理（不在任何房间时直接返回）：
     * 房主 → 解散；普通成员 → 退出房间。
     *
     * 注意调用时机：连接断开后不会立刻执行，要等 30s 宽限期结束
     * （见 watch-room-socket.ts），客户端在这段时间内重连即保留席位。
     */
    async disconnectLeave(userId: string) {
      await runExclusive(userId, async (tx, flush) => {
        const membership = await repo.findMembershipByUser(userId, tx);
        if (!membership) return;
        await exitRoomTx(tx, membership, flush, {
          content: '长时间离线，房间已解散',
          reason: 'owner_disconnected'
        });
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
          const membership = await repo.findMembershipByUser(userId, tx);
          if (!membership) return;
          await exitRoomTx(tx, membership, flush, {
            content: '账号已被停用，房间已解散',
            reason: 'owner_disabled'
          });
        });
      } finally {
        // 已建立的连接不会重新握手，必须主动断开；房间清理失败时，
        // 断开触发的离开逻辑也会再兜底一次
        conn.disconnectUser(userId);
      }
    },

    /**
     * 清空全部房间（服务启动时调用）：单实例 + 断线宽限期（计时器在进程内存，
     * 重启即失效），启动时不存在任何连接，上次关闭/崩溃前还没等到宽限期结束的
     * 房间全部解散（成员/消息级联删除）。
     *
     * 只在这一条路径清理：不要在 service 的 onReady 里再调一次——openapi 导出
     * 脚本只跑 ready()，会把线上房间一起删掉。
     */
    async clearAllRooms() {
      return repo.deleteAllRooms();
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
        await pushSystemMessage(
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
            visibility: updated!.visibility
          });
        });

        return updated;
      });
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
          `管理员 ${operator.nickname} 解散了房间`,
          flush,
          { actor: operator, reason: 'admin_delete' }
        );
      });

      return { roomId };
    },

    /**
     * 管理端解除拉黑：被房主移出的用户重新获得加入该房间的资格。
     *
     * 幂等：该用户本来就不在黑名单时也返回成功（管理端列表可能是旧数据，
     * 或房主刚好同时操作过），只有房间不存在才是 404。
     */
    async adminUnban(
      adminUserId: string,
      roomId: string,
      targetUserId: string
    ) {
      await runExclusive(adminUserId, async (tx, flush) => {
        const room = await repo.lockRoomById(tx, roomId);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

        const removed = await repo.deleteBan(tx, roomId, targetUserId);
        if (!removed) return; // 已在黑名单外，无需留痕

        const operator = await getUserBrief(tx, adminUserId);
        const target = await getUserBrief(tx, targetUserId);
        flush(() =>
          auditLog('ban.lift', {
            roomId,
            roomName: room.name,
            operatorId: operator.userId,
            operatorNickname: operator.nickname,
            targetUserId: target.userId,
            targetNickname: target.nickname
          })
        );
      });

      return { roomId, userId: targetUserId };
    }
  };
};

export type WatchRoomLifecycle = ReturnType<typeof createWatchRoomLifecycle>;
