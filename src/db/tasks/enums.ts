import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * 任务状态枚举
 * @enum
 * @member pending 待处理
 * @member completed 已完成
 */
export const taskStatusEnum = pgEnum('task_status', ['pending', 'completed']);
