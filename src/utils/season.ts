const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 阿拉伯数字转中文数字（支持 1-99，超出回退阿拉伯数字） */
export const toChineseNumber = (n: number): string => {
  if (!Number.isInteger(n) || n <= 0 || n > 99) return String(n);
  if (n < 10) return CN_DIGITS[n];
  if (n === 10) return '十';
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens > 1 ? CN_DIGITS[tens] : ''}十${ones ? CN_DIGITS[ones] : ''}`;
};

/** 季展示后缀：优先季名称，其次第N季（中文数字，第一季不拼），拼接时带前置空格 */
export const buildSeasonSuffix = (
  season: number | null,
  seasonName: string | null
) => {
  if (seasonName) return ` ${seasonName}`;
  if (season !== null && season !== 1) return ` 第${toChineseNumber(season)}季`;
  return '';
};
