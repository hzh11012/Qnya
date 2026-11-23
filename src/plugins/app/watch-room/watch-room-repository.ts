import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  notInArray,
  or,
  sql
} from 'drizzle-orm';
import {
  usersTable,
  videosTable,
  animeTable,
  watchRoomMembersTable,
  watchRoomBansTable,
  watchRoomMessagesTable,
  watchRoomsTable,
  type AnimeType
} from '../../../db/index.js';
import type {
  AdminWatchRoomListQuery,
  WatchRoomEventType,
  WatchRoomListQuery
} from '../../../schemas/watch-room.js';
import { calcOffset, buildOrderBy } from '../../../utils/paginated-query.js';
import { escapeLike } from '../../../utils/like.js';
import { t2s } from '../../../utils/t2s.js';

declare module 'fastify' {
  interface FastifyInstance {
    watchRoomRepository: ReturnType<typeof createWatchRoomRepository>;
  }
}

/** 支持事务/连接两种执行器 */
type Tx = PgTransaction<
  NodePgQueryResultHKT,
  typeof import('../../../db/index.js'),
  ExtractTablesWithRelations<typeof import('../../../db/index.js')>
>;
type DbExecutor = NodePgDatabase<typeof import('../../../db/index.js')> | Tx;

const createWatchRoomRepository = (fastify: FastifyInstance) => {
  const db = fastify.db;

  /** 房间成员数子查询（大厅与管理端列表共用） */
  const memberCount = sql<number>`(
    select count(*)::int from ${watchRoomMembersTable}
    where ${watchRoomMembersTable.roomId} = ${watchRoomsTable.id}
  )`;

  return {
    // ============================================
    // 房间
    // ============================================

    /** 创建房间 */
    async createRoom(
      tx: DbExecutor,
      data: {
        ownerId: string;
        name: string;
        announcement: string | null;
        visibility: 'public' | 'private';
        passwordHash: string | null;
        currentVideoId: string | null;
        maxMembers: number;
      }
    ) {
      const [room] = await tx.insert(watchRoomsTable).values(data).returning();
      return room;
    },

    /**
     * 按 ID 查找房间。
     * 只读场景（聊天/查询）传普通的 db 即可；已在事务里时传 tx，复用同一连接。
     * 需要串行化的写操作请用 lockRoomById（行锁）。
     */
    async findRoomById(roomId: string, tx: DbExecutor = db) {
      const [room] = await tx
        .select()
        .from(watchRoomsTable)
        .where(eq(watchRoomsTable.id, roomId))
        .limit(1);
      return room ?? null;
    },

    /** 事务内锁定房间行（串行化加入/解散并发） */
    async lockRoomById(tx: DbExecutor, roomId: string) {
      const [room] = await tx
        .select()
        .from(watchRoomsTable)
        .where(eq(watchRoomsTable.id, roomId))
        .for('update')
        .limit(1);
      return room ?? null;
    },

    /**
     * 事务内按 id 顺序锁定多个房间行（跨房间操作统一加锁顺序：
     * 两个事务以相反顺序锁同一对房间会被数据库判定死锁并回滚其一）
     */
    async lockRoomsByIds(tx: DbExecutor, roomIds: string[]) {
      const rooms = await tx
        .select()
        .from(watchRoomsTable)
        .where(inArray(watchRoomsTable.id, roomIds))
        .orderBy(asc(watchRoomsTable.id))
        .for('update');
      return new Map(rooms.map(room => [room.id, room]));
    },

    /**
     * 更新房间信息（必须传入持有房间行锁的事务：用 db 另开连接会等待
     * 本事务的 FOR UPDATE 锁，而事务又在等它返回，形成数据库检测不到的死锁）
     */
    async updateRoomInfo(
      tx: DbExecutor,
      roomId: string,
      patch: Partial<{
        name: string;
        announcement: string | null;
        visibility: 'public' | 'private';
        /** null = 清除密码（房间转为公开时） */
        passwordHash: string | null;
      }>
    ) {
      const [room] = await tx
        .update(watchRoomsTable)
        .set(patch)
        .where(eq(watchRoomsTable.id, roomId))
        .returning();
      return room ?? null;
    },

    /** 公开房间列表（分页，按创建时间倒序；excludeTypes 过滤当前视频所属动漫类型） */
    async findPublicRooms(
      params: WatchRoomListQuery,
      excludeTypes: AnimeType[] | undefined
    ) {
      const { page, pageSize } = params;

      const conditions = [eq(watchRoomsTable.visibility, 'public')];

      // 观看者无权访问的类型（如 adult）：当前视频属于该类型的房间不出现在大厅
      if (excludeTypes?.length) {
        conditions.push(
          or(
            isNull(watchRoomsTable.currentVideoId),
            notInArray(
              watchRoomsTable.currentVideoId,
              db
                .select({ id: videosTable.id })
                .from(videosTable)
                .innerJoin(animeTable, eq(videosTable.animeId, animeTable.id))
                .where(inArray(animeTable.type, excludeTypes))
            )
          )!
        );
      }

      const whereClause = and(...conditions);

      const [items, countResult] = await Promise.all([
        db
          .select({
            id: watchRoomsTable.id,
            name: watchRoomsTable.name,
            ownerId: watchRoomsTable.ownerId,
            ownerName: usersTable.name,
            ownerAvatar: usersTable.avatar,
            maxMembers: watchRoomsTable.maxMembers,
            isPlaying: watchRoomsTable.isPlaying,
            currentVideoId: watchRoomsTable.currentVideoId,
            videoTitle: videosTable.title,
            videoEpisode: videosTable.episode,
            animeId: animeTable.id,
            animeName: animeTable.name,
            animeCover: animeTable.cover,
            createdAt: watchRoomsTable.createdAt,
            memberCount
          })
          .from(watchRoomsTable)
          .innerJoin(usersTable, eq(watchRoomsTable.ownerId, usersTable.id))
          .leftJoin(
            videosTable,
            eq(watchRoomsTable.currentVideoId, videosTable.id)
          )
          .leftJoin(animeTable, eq(videosTable.animeId, animeTable.id))
          .where(whereClause)
          .orderBy(
            ...buildOrderBy(
              watchRoomsTable.createdAt,
              'desc',
              watchRoomsTable.id
            )
          )
          .limit(pageSize)
          .offset(calcOffset(page, pageSize)),
        db.select({ count: count() }).from(watchRoomsTable).where(whereClause)
      ]);

      return { items, total: countResult[0]?.count ?? 0 };
    },

    /** 管理端房间列表（含私人房间，按房名或房主昵称搜索） */
    async findRoomsForAdmin(params: AdminWatchRoomListQuery) {
      const { page, pageSize, visibility, keyword } = params;

      const conditions = [];
      if (visibility) {
        conditions.push(eq(watchRoomsTable.visibility, visibility));
      }
      if (keyword) {
        const escaped = `%${escapeLike(t2s(keyword))}%`;
        conditions.push(
          or(
            ilike(watchRoomsTable.name, escaped),
            ilike(usersTable.name, escaped)
          )!
        );
      }
      const whereClause = conditions.length ? and(...conditions) : undefined;

      const [items, countResult] = await Promise.all([
        db
          .select({
            id: watchRoomsTable.id,
            name: watchRoomsTable.name,
            announcement: watchRoomsTable.announcement,
            visibility: watchRoomsTable.visibility,
            ownerId: watchRoomsTable.ownerId,
            ownerName: usersTable.name,
            ownerAvatar: usersTable.avatar,
            maxMembers: watchRoomsTable.maxMembers,
            isPlaying: watchRoomsTable.isPlaying,
            currentVideoId: watchRoomsTable.currentVideoId,
            videoTitle: videosTable.title,
            videoEpisode: videosTable.episode,
            animeId: animeTable.id,
            animeName: animeTable.name,
            animeCover: animeTable.cover,
            createdAt: watchRoomsTable.createdAt,
            memberCount
          })
          .from(watchRoomsTable)
          .innerJoin(usersTable, eq(watchRoomsTable.ownerId, usersTable.id))
          .leftJoin(
            videosTable,
            eq(watchRoomsTable.currentVideoId, videosTable.id)
          )
          .leftJoin(animeTable, eq(videosTable.animeId, animeTable.id))
          .where(whereClause)
          .orderBy(
            ...buildOrderBy(
              watchRoomsTable.createdAt,
              'desc',
              watchRoomsTable.id
            )
          )
          .limit(pageSize)
          .offset(calcOffset(page, pageSize)),
        db
          .select({ count: count() })
          .from(watchRoomsTable)
          .innerJoin(usersTable, eq(watchRoomsTable.ownerId, usersTable.id))
          .where(whereClause)
      ]);

      return { items, total: countResult[0]?.count ?? 0 };
    },

    /** 硬删除房间（级联成员/消息） */
    async deleteRoom(tx: DbExecutor, roomId: string) {
      const [deleted] = await tx
        .delete(watchRoomsTable)
        .where(eq(watchRoomsTable.id, roomId))
        .returning();
      return deleted ?? null;
    },

    /**
     * 清空所有房间（级联成员/消息），返回删除数量。
     *
     * 房间的存在性依赖进程内的 Socket 连接：进程一重启，库里的房间就是死的，
     * 却会继续出现在大厅列表里（点进去房主早没了）。启动时统一清掉。
     */
    async deleteAllRooms() {
      const deleted = await db
        .delete(watchRoomsTable)
        .returning({ id: watchRoomsTable.id });
      return deleted.length;
    },

    // ============================================
    // 成员
    // ============================================

    /** 创建成员记录 */
    async insertMember(
      tx: DbExecutor,
      data: { roomId: string; userId: string; role: 'owner' | 'member' }
    ) {
      const [member] = await tx
        .insert(watchRoomMembersTable)
        .values(data)
        .returning();
      return member;
    },

    /** 查询用户的成员记录（全平台单房间：最多一条；可传事务执行器） */
    async findMembershipByUser(userId: string, executor?: DbExecutor) {
      const runner = executor ?? db;
      const [member] = await runner
        .select()
        .from(watchRoomMembersTable)
        .where(eq(watchRoomMembersTable.userId, userId))
        .limit(1);
      return member ?? null;
    },

    /** 统计房间成员数 */
    async countMembers(tx: DbExecutor, roomId: string) {
      const [result] = await tx
        .select({ count: count() })
        .from(watchRoomMembersTable)
        .where(eq(watchRoomMembersTable.roomId, roomId));
      return result?.count ?? 0;
    },

    /** 房间成员列表（含用户昵称头像） */
    async findRoomMembers(roomId: string) {
      return db
        .select({
          userId: watchRoomMembersTable.userId,
          nickname: usersTable.name,
          avatar: usersTable.avatar,
          role: watchRoomMembersTable.role,
          joinedAt: watchRoomMembersTable.createdAt
        })
        .from(watchRoomMembersTable)
        .innerJoin(usersTable, eq(watchRoomMembersTable.userId, usersTable.id))
        .where(eq(watchRoomMembersTable.roomId, roomId))
        .orderBy(
          // 房主排前面，其余按加入时间
          sql`case ${watchRoomMembersTable.role} when 'owner' then 0 else 1 end`,
          asc(watchRoomMembersTable.createdAt)
        );
    },

    /** 房间成员的账号角色（切换视频时校验全员可观看） */
    async findMemberRoles(tx: DbExecutor, roomId: string) {
      const rows = await tx
        .select({ role: usersTable.role })
        .from(watchRoomMembersTable)
        .innerJoin(usersTable, eq(watchRoomMembersTable.userId, usersTable.id))
        .where(eq(watchRoomMembersTable.roomId, roomId));
      return rows.map(r => r.role);
    },

    /** 删除成员记录（离开/切换/踢人/断开退出）；已被并发删除时返回 null */
    async deleteMembership(tx: DbExecutor, memberId: string) {
      const [member] = await tx
        .delete(watchRoomMembersTable)
        .where(eq(watchRoomMembersTable.id, memberId))
        .returning();
      return member ?? null;
    },

    // ============================================
    // 黑名单（被移出的成员）
    // ============================================

    /** 拉黑用户（重复移出幂等，不报唯一键冲突） */
    async banMember(tx: DbExecutor, roomId: string, userId: string) {
      await tx
        .insert(watchRoomBansTable)
        .values({ roomId, userId })
        .onConflictDoNothing();
    },

    /** 黑名单列表（含被移出用户的昵称头像，按移出时间倒序） */
    async findBans(roomId: string) {
      return db
        .select({
          userId: watchRoomBansTable.userId,
          nickname: usersTable.name,
          avatar: usersTable.avatar,
          bannedAt: watchRoomBansTable.createdAt
        })
        .from(watchRoomBansTable)
        .innerJoin(usersTable, eq(watchRoomBansTable.userId, usersTable.id))
        .where(eq(watchRoomBansTable.roomId, roomId))
        .orderBy(desc(watchRoomBansTable.createdAt));
    },

    /** 解除拉黑；该用户本来不在黑名单时返回 null（调用方按幂等处理） */
    async deleteBan(tx: DbExecutor, roomId: string, userId: string) {
      const [row] = await tx
        .delete(watchRoomBansTable)
        .where(
          and(
            eq(watchRoomBansTable.roomId, roomId),
            eq(watchRoomBansTable.userId, userId)
          )
        )
        .returning();
      return row ?? null;
    },

    /** 该用户是否已被这个房间拉黑 */
    async isBanned(tx: DbExecutor, roomId: string, userId: string) {
      const [row] = await tx
        .select({ id: watchRoomBansTable.id })
        .from(watchRoomBansTable)
        .where(
          and(
            eq(watchRoomBansTable.roomId, roomId),
            eq(watchRoomBansTable.userId, userId)
          )
        )
        .limit(1);
      return !!row;
    },

    // ============================================
    // 消息（聊天 + 系统通知）
    // ============================================

    /** 写入消息（事务内调用，保证业务操作与通知一致） */
    async insertMessage(
      tx: DbExecutor,
      data: {
        roomId: string;
        userId: string | null;
        type: 'chat' | 'system';
        eventType: WatchRoomEventType | null;
        content: string;
        metadata: Record<string, unknown> | null;
      }
    ) {
      const [message] = await tx
        .insert(watchRoomMessagesTable)
        .values(data)
        .returning();
      return message;
    },

    /**
     * 消息历史（分页，按时间倒序；聊天发送者信息在 metadata 中）。
     * type 供管理端单独筛聊天 / 系统通知，成员端不传即全部
     */
    async findMessages(
      roomId: string,
      page: number,
      pageSize: number,
      type?: 'chat' | 'system'
    ) {
      const whereClause = type
        ? and(
            eq(watchRoomMessagesTable.roomId, roomId),
            eq(watchRoomMessagesTable.type, type)
          )
        : eq(watchRoomMessagesTable.roomId, roomId);

      const [items, countResult] = await Promise.all([
        db
          .select()
          .from(watchRoomMessagesTable)
          .where(whereClause)
          // id（uuidv7）作稳定 tiebreaker，同一时间戳的消息翻页不重复/不遗漏
          .orderBy(
            desc(watchRoomMessagesTable.createdAt),
            desc(watchRoomMessagesTable.id)
          )
          .limit(pageSize)
          .offset(calcOffset(page, pageSize)),
        db
          .select({ count: count() })
          .from(watchRoomMessagesTable)
          .where(whereClause)
      ]);

      return { items, total: countResult[0]?.count ?? 0 };
    },

    // ============================================
    // 视频 / 用户
    // ============================================

    /**
     * 查找可播放视频（视频存在且所属动漫非 draft；
     * excludeTypes 为操作者无权访问的类型，命中视为不可播放）
     */
    async findPlayableVideo(
      executor: DbExecutor,
      videoId: string,
      excludeTypes?: AnimeType[]
    ) {
      const [video] = await executor
        .select({
          videoId: videosTable.id,
          title: videosTable.title,
          episode: videosTable.episode,
          animeId: animeTable.id,
          animeName: animeTable.name,
          animeCover: animeTable.cover,
          animeStatus: animeTable.status,
          animeType: animeTable.type
        })
        .from(videosTable)
        .innerJoin(animeTable, eq(videosTable.animeId, animeTable.id))
        .where(eq(videosTable.id, videoId))
        .limit(1);

      if (!video) return null;
      if (video.animeStatus === 'draft') return null;
      if (excludeTypes?.includes(video.animeType)) return null;
      return video;
    },

    /**
     * 用户简要信息（系统通知 / 状态展示用）。
     * 事务内调用必须传入事务执行器：用 db 会再占一条连接，高并发时可能耗尽连接池
     */
    async findUserBriefs(userIds: string[], executor?: DbExecutor) {
      if (userIds.length === 0)
        return new Map<string, { nickname: string; avatar: string | null }>();
      const runner = executor ?? db;
      const rows = await runner
        .select({
          id: usersTable.id,
          nickname: usersTable.name,
          avatar: usersTable.avatar
        })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds));
      return new Map(
        rows.map(r => [r.id, { nickname: r.nickname, avatar: r.avatar }])
      );
    }
  };
};

export default fp(
  async (fastify: FastifyInstance) => {
    fastify.decorate('watchRoomRepository', createWatchRoomRepository(fastify));
  },
  {
    name: 'watch-room-repository',
    dependencies: ['db']
  }
);
