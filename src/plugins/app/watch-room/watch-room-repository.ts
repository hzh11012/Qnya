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

  /** 房间 active 成员数子查询（大厅与管理端列表共用） */
  const activeMemberCount = sql<number>`(
    select count(*) from ${watchRoomMembersTable}
    where ${watchRoomMembersTable.roomId} = ${watchRoomsTable.id}
      and ${watchRoomMembersTable.status} = 'active'
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
      }
    ) {
      const [room] = await tx.insert(watchRoomsTable).values(data).returning();
      return room;
    },

    /** 按 ID 查找房间 */
    async findRoomById(roomId: string) {
      const [room] = await db
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
      patch: Partial<{ name: string; announcement: string | null }>
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
            memberCount: activeMemberCount
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

      return { items, total: Number(countResult[0]?.count ?? 0) };
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
            memberCount: activeMemberCount
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

      return { items, total: Number(countResult[0]?.count ?? 0) };
    },

    /** 硬删除房间（级联成员/消息） */
    async deleteRoom(tx: DbExecutor, roomId: string) {
      const [deleted] = await tx
        .delete(watchRoomsTable)
        .where(eq(watchRoomsTable.id, roomId))
        .returning();
      return deleted ?? null;
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

    /** 查询用户的全局唯一 active 成员记录（全平台单房间归属；可传事务执行器） */
    async findActiveMembershipByUser(userId: string, executor?: DbExecutor) {
      const runner = executor ?? db;
      const [member] = await runner
        .select()
        .from(watchRoomMembersTable)
        .where(
          and(
            eq(watchRoomMembersTable.userId, userId),
            eq(watchRoomMembersTable.status, 'active')
          )
        )
        .limit(1);
      return member ?? null;
    },

    /** 统计房间 active 成员数 */
    async countActiveMembers(tx: DbExecutor, roomId: string) {
      const [result] = await tx
        .select({ count: count() })
        .from(watchRoomMembersTable)
        .where(
          and(
            eq(watchRoomMembersTable.roomId, roomId),
            eq(watchRoomMembersTable.status, 'active')
          )
        );
      return Number(result?.count ?? 0);
    },

    /** 房间成员列表（含用户昵称头像） */
    async findRoomMembers(roomId: string) {
      return db
        .select({
          id: watchRoomMembersTable.id,
          userId: watchRoomMembersTable.userId,
          nickname: usersTable.name,
          avatar: usersTable.avatar,
          role: watchRoomMembersTable.role,
          joinedAt: watchRoomMembersTable.createdAt
        })
        .from(watchRoomMembersTable)
        .innerJoin(usersTable, eq(watchRoomMembersTable.userId, usersTable.id))
        .where(
          and(
            eq(watchRoomMembersTable.roomId, roomId),
            eq(watchRoomMembersTable.status, 'active')
          )
        )
        .orderBy(
          // 房主排前面，其余按加入时间
          sql`case ${watchRoomMembersTable.role} when 'owner' then 0 else 1 end`,
          asc(watchRoomMembersTable.createdAt)
        );
    },

    /** 房间 active 成员的账号角色（切换视频时校验全员可观看） */
    async findActiveMemberRoles(tx: DbExecutor, roomId: string) {
      const rows = await tx
        .select({ role: usersTable.role })
        .from(watchRoomMembersTable)
        .innerJoin(usersTable, eq(watchRoomMembersTable.userId, usersTable.id))
        .where(
          and(
            eq(watchRoomMembersTable.roomId, roomId),
            eq(watchRoomMembersTable.status, 'active')
          )
        );
      return rows.map(r => r.role);
    },

    /**
     * 结束成员资格（离开/切换/踢人/断开退出）
     * @param finalStatus left（主动离开/切换/断开）或 kicked
     */
    async endMembership(
      tx: DbExecutor,
      memberId: string,
      finalStatus: 'left' | 'kicked'
    ) {
      const [member] = await tx
        .update(watchRoomMembersTable)
        .set({ status: finalStatus })
        .where(
          and(
            eq(watchRoomMembersTable.id, memberId),
            eq(watchRoomMembersTable.status, 'active')
          )
        )
        .returning();
      return member ?? null;
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

    /** 消息历史（分页，按时间倒序） */
    async findMessages(roomId: string, page: number, pageSize: number) {
      const [items, countResult] = await Promise.all([
        db
          .select({
            id: watchRoomMessagesTable.id,
            roomId: watchRoomMessagesTable.roomId,
            userId: watchRoomMessagesTable.userId,
            type: watchRoomMessagesTable.type,
            eventType: watchRoomMessagesTable.eventType,
            content: watchRoomMessagesTable.content,
            metadata: watchRoomMessagesTable.metadata,
            createdAt: watchRoomMessagesTable.createdAt,
            userNickname: usersTable.name,
            userAvatar: usersTable.avatar
          })
          .from(watchRoomMessagesTable)
          .leftJoin(
            usersTable,
            eq(watchRoomMessagesTable.userId, usersTable.id)
          )
          .where(eq(watchRoomMessagesTable.roomId, roomId))
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
          .where(eq(watchRoomMessagesTable.roomId, roomId))
      ]);

      return { items, total: Number(countResult[0]?.count ?? 0) };
    },

    // ============================================
    // 视频 / 用户
    // ============================================

    /**
     * 校验视频可播放（视频存在且所属动漫非 draft；
     * excludeTypes 为操作者无权访问的类型，命中视为不可播放）
     */
    async findPlayableVideo(videoId: string, excludeTypes?: AnimeType[]) {
      const [video] = await db
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

    /** 视频是否可播放（事务内校验用；excludeTypes 同 findPlayableVideo） */
    async isVideoPlayable(
      tx: DbExecutor,
      videoId: string,
      excludeTypes?: AnimeType[]
    ) {
      const [video] = await tx
        .select({
          id: videosTable.id,
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
