import { match, pinyin } from 'pinyin-pro';

export function toPinyin(name: string): string {
  return pinyin(name, { toneType: 'none', separator: '' });
}

/** 空格分隔的全拼（按音节切词，供搜索引擎按音节匹配） */
export function toSpacedPinyin(name: string): string {
  return pinyin(name, { toneType: 'none', separator: ' ' });
}

export function toInitials(name: string): string {
  return pinyin(name, { pattern: 'first', toneType: 'none', separator: '' });
}

/** HTML 转义，防止名称/关键词中的字符被当作 HTML 渲染（XSS） */
export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    ch =>
      ({
        '<': '&lt;',
        '>': '&gt;'
      })[ch]!
  );
}

/**
 * 高亮关键词：对名称和关键词都做 HTML 转义后再包裹 <em> 标签，
 * 保证返回的 highlightName 中的 HTML 只来自本函数。
 */
export function highlight(name: string, keyword: string): string {
  const safeName = escapeHtml(name);
  const safeKeyword = escapeHtml(keyword);
  const escaped = safeKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safeName.replace(
    new RegExp(escaped, 'gi'),
    m => `<em class="keyword">${m}</em>`
  );
}

/**
 * 拼音/首字母命中时的局部高亮：
 * 利用 pinyin-pro 的 match 反查关键词命中的字符下标，
 * 只包裹对应的字符（如「海贼王」中命中「haiz」则只高亮「海贼」，
 * 「我独自升级 第二季 -起于暗影-」中命中「anying」只高亮「暗影」）。
 * 同时兼容字面中文命中（如「暗影」直接匹配文本）。
 * 未命中时返回 null，由调用方决定不高亮。
 */
export function highlightByPinyin(
  text: string,
  keyword: string
): string | null {
  const indices = match(text, keyword, {
    precision: 'start',
    continuous: true,
    insensitive: true
  });

  if (!indices || indices.length === 0) {
    return null;
  }

  const matched = new Set(indices);
  return Array.from(text)
    .map((ch, i) =>
      matched.has(i)
        ? `<em class="keyword">${escapeHtml(ch)}</em>`
        : escapeHtml(ch)
    )
    .join('');
}
