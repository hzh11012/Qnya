import type { AnimeType } from '../../../../db/index.js';
import type {
  AdminWatchRoomListQuery,
  AdminWatchRoomMessageQuery,
  WatchRoomListQuery
} from '../../../../schemas/watch-room.js';
import { RoomError } from '../../../../utils/watch-room.js';
import type { WatchRoomCore } from './watch-room-core.js';

/** 视频摘要的输入：无论来自联表查询还是 findPlayableVideo，都先归一成这个形状 */
interface VideoBriefSource {
  videoId: string | null;
  title: string | null;
  episode: number | null;
  animeId: string | null;
  animeName: string | null;
  animeCover: string | null;
}

/**
 * 当前播放视频的对外摘要。
 * 大厅列表、房间详情、管理端详情三处都返回同一形状，只在这里维护字段，
 * 加字段时不至于漏掉其中一处（前端共用同一份类型）。
 */
const toVideoBrief = (video: VideoBriefSource | null) =>
  video?.videoId
    ? {
        videoId: video.videoId,
        title: video.title,
        episode: video.episode,
        animeId: video.animeId,
        animeName: video.animeName,
        animeCover: video.animeCover
      }
    : null;

/** 列表条目：房间详情 / 管理端详情 / 大厅列表共用同一份视频信息塑形 */
const toRoomSummary = (item: {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  ownerAvatar: string | null;
  memberCount: number;
  maxMembers: number;
  isPlaying: boolean;
  currentVideoId: string | null;
  videoTitle: string | null;
  videoEpisode: number | null;
  animeId: string | null;
  animeName: string | null;
  animeCover: string | null;
  createdAt: Date;
}) => ({
  id: item.id,
  name: item.name,
  ownerId: item.ownerId,
  owner: {
    userId: item.ownerId,
    nickname: item.ownerName,
    avatar: item.ownerAvatar
  },
  memberCount: item.memberCount,
  maxMembers: item.maxMembers,
  isPlaying: item.isPlaying,
  currentVideo: toVideoBrief({
    videoId: item.currentVideoId,
    title: item.videoTitle,
    episode: item.videoEpisode,
    animeId: item.animeId,
    animeName: item.animeName,
    animeCover: item.animeCover
  }),
  createdAt: item.createdAt
});

/**
 * 房间查询：大厅列表、详情、成员视角状态、消息历史，以及管理端只读接口
 * （房间列表 / 详情 / 成员 / 黑名单 / 消息记录）。
 * 越权一律 403：房间不存在才 404；私人房间对非成员返回 ROOM_PRIVATE（同样是 403，
 * 前端据此落到密码表单，与 room:join 的错误码保持一致）。
 */
export const createWatchRoomQuery = (core: WatchRoomCore) => {
  const { db, repo, computePlayback, toMessagePayload, requireMembership } =
    core;

  /** 管理端只读接口的统一前置：房间不存在 → 404（管理端不做成员校验） */
  const requireRoom = async (roomId: string) => {
    const room = await repo.findRoomById(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');
    return room;
  };

  /** 房间详情（公开房间任何人可见；私人房间对非成员返回 403 ROOM_PRIVATE） */
  const getRoomDetail = async (
    roomId: string,
    viewerId?: string,
    excludeTypes?: AnimeType[]
  ) => {
    const room = await repo.findRoomById(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');

    let isMember = false;
    if (viewerId) {
      const membership = await repo.findMembershipByUser(viewerId);
      isMember = membership?.roomId === roomId;
    }

    // 越权返回 403 而不是伪装成 404：房间 ID 是 UUID，且 room:join 对私人房间
    // 本来就回 ROOM_PRIVATE，继续谎报「不存在」只会让调用方分不清
    // 「房间没了」和「没资格进」
    if (room.visibility === 'private' && !isMember) {
      throw new RoomError('ROOM_PRIVATE', '私人房间需要密码进入');
    }

    const [briefs, memberCount, video] = await Promise.all([
      repo.findUserBriefs([room.ownerId]),
      repo.countMembers(db, roomId),
      room.currentVideoId
        ? repo.findPlayableVideo(db, room.currentVideoId, excludeTypes)
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
      currentVideo: toVideoBrief(video),
      createdAt: room.createdAt
    };
  };

  /** 房间完整状态（成员视角：成员列表 + 我的角色）。单会话模型下在房成员即在线 */
  const getRoomState = async (
    userId: string,
    roomId: string,
    excludeTypes?: AnimeType[]
  ) => {
    const detail = await getRoomDetail(roomId, userId, excludeTypes);
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
        role: members.find(m => m.userId === userId)?.role ?? 'member'
      }
    };
  };

  return {
    /**
     * 公开房间列表（大厅：按创建时间倒序分页，附成员数与当前视频）
     * @param excludeTypes 观看者无权访问的动漫类型（正在播放这些类型的房间不展示）
     */
    async listPublicRooms(
      query: WatchRoomListQuery,
      excludeTypes: AnimeType[] | undefined
    ) {
      const { items, total } = await repo.findPublicRooms(query, excludeTypes);
      return { items: items.map(toRoomSummary), total };
    },

    getRoomDetail,
    getRoomState,

    /** 当前用户所在房间（跨设备状态恢复 / 加入前检查） */
    async getCurrentRoom(userId: string, excludeTypes?: AnimeType[]) {
      const membership = await repo.findMembershipByUser(userId);
      if (!membership) return null;
      return getRoomState(userId, membership.roomId, excludeTypes);
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
      return { items: items.map(toMessagePayload), total };
    },

    /** 管理端房间列表（含私人房间，附成员数） */
    async adminListRooms(query: AdminWatchRoomListQuery) {
      const { items, total } = await repo.findRoomsForAdmin(query);
      return {
        items: items.map(item => ({
          ...toRoomSummary(item),
          announcement: item.announcement,
          visibility: item.visibility
        })),
        total
      };
    },

    /** 管理端房间详情（列表条目结构） */
    async adminGetRoom(roomId: string) {
      const room = await requireRoom(roomId);

      const [briefs, memberCount, video] = await Promise.all([
        repo.findUserBriefs([room.ownerId]),
        repo.countMembers(db, roomId),
        room.currentVideoId
          ? repo.findPlayableVideo(db, room.currentVideoId)
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
        isPlaying: room.isPlaying,
        currentVideo: toVideoBrief(video),
        createdAt: room.createdAt
      };
    },

    /** 管理端房间成员（单会话模型：在房即在线；房主排最前） */
    async adminListMembers(roomId: string) {
      await requireRoom(roomId);
      const members = await repo.findRoomMembers(roomId);
      return {
        items: members.map(m => ({
          userId: m.userId,
          nickname: m.nickname,
          avatar: m.avatar,
          role: m.role,
          joinedAt: m.joinedAt
        })),
        total: members.length
      };
    },

    /** 管理端黑名单（被房主移出、当前无法再加入该房间的用户） */
    async adminListBans(roomId: string) {
      await requireRoom(roomId);
      const bans = await repo.findBans(roomId);
      return {
        items: bans.map(ban => ({
          userId: ban.userId,
          nickname: ban.nickname,
          avatar: ban.avatar,
          bannedAt: ban.bannedAt
        })),
        total: bans.length
      };
    },

    /**
     * 管理端消息记录（聊天 + 系统通知统一分页，可按类型筛选）。
     * 管理端不做成员校验：房间已解散则消息已随房间级联删除，只会是 404。
     */
    async adminListMessages(roomId: string, query: AdminWatchRoomMessageQuery) {
      await requireRoom(roomId);
      const { items, total } = await repo.findMessages(
        roomId,
        query.page,
        query.pageSize,
        query.type
      );
      return { items: items.map(toMessagePayload), total };
    }
  };
};

export type WatchRoomQuery = ReturnType<typeof createWatchRoomQuery>;
