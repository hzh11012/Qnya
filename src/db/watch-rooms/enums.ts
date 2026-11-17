import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * 房间可见性枚举
 * @member public 公开房间（出现在放映室大厅）
 * @member private 私人房间（仅邀请加入）
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
 * 房间成员状态枚举
 * @member active 在房（单会话模型：在房即连接中）
 * @member left 主动离开/切换房间/房间解散/断开退出
 * @member kicked 被房主移出
 */
export const watchRoomMemberStatusEnum = pgEnum('watch_room_member_status', [
  'active',
  'left',
  'kicked'
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
