import { timingSafeEqual } from 'node:crypto';
import { scrypt as scryptCb, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply } from 'fastify';
import {
  WATCH_ROOM_ERROR_STATUS,
  type WatchRoomErrorCode
} from '../schemas/watch-room.js';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

const KEY_LENGTH = 64;

/**
 * 放映室业务错误：携带机器可读错误码，HTTP 与 Socket ACK 共用
 */
export class RoomError extends Error {
  constructor(
    public code: WatchRoomErrorCode,
    message: string,
    public statusCode = WATCH_ROOM_ERROR_STATUS[code]
  ) {
    super(message);
  }
}

/**
 * 将 RoomError 转换为统一错误响应
 * 响应结构：{ code, message, errorCode }
 */
export const replyRoomError = (reply: FastifyReply, error: RoomError) =>
  reply.status(error.statusCode).send({
    code: error.statusCode,
    message: error.message,
    errorCode: error.code
  });

/**
 * 房间密码哈希（scrypt + 随机盐）
 * @returns `salt:hash` 十六进制字符串
 */
export const hashRoomPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
};

/**
 * 校验房间密码（timingSafeEqual 防时序攻击）
 */
export const verifyRoomPassword = async (
  password: string,
  stored: string
): Promise<boolean> => {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const storedHash = Buffer.from(hashHex, 'hex');
  const derived = await scrypt(password, salt, storedHash.length);

  if (storedHash.length !== derived.length) return false;
  return timingSafeEqual(storedHash, derived);
};
