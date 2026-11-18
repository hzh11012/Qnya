import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * 房间可见性枚举
 * @member public 公开房间（出现在放映室大厅）
 * @member private 私人房间（不在大厅展示，凭密码加入）
 */
export const watchRoomVisibilityEnum = pgEnum('watch_room_visibility', [
  'public',
  'private'
]);

/**
 * 房间成员角色枚举
 * @member owner 房主
 * @member member 普通成员
 */
export const watchRoomMemberRoleEnum = pgEnum('watch_room_member_role', [
  'owner',
  'member'
]);

/**
 * 房间消息类型枚举
 * @member chat 普通聊天消息
 * @member system 房间系统通知
 */
export const watchRoomMessageTypeEnum = pgEnum('watch_room_message_type', [
  'chat',
  'system'
]);
