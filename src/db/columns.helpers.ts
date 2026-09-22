import { timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
};

/**
 * 主键列：UUIDv7，由应用层在插入前生成
 * （时间有序，对 B-tree 索引友好；不可枚举，不泄露业务规模）
 */
const idColumn = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => uuidv7());

export { timestamps, idColumn };
