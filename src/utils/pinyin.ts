import { match, pinyin } from 'pinyin-pro';

export function toPinyin(name: string): string {
  return pinyin(name, { toneType: 'none', separator: '' });
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

/** 未命中名称时的高亮兑底：整名包裹 */
export function highlightWhole(name: string): string {
  return `<em class="keyword">${escapeHtml(name)}</em>`;
}

/**
 * 拼音/首字母命中时的局部高亮：
 * 利用 pinyin-pro 的 match 反查关键词命中的汉字下标，
 * 只包裹对应的字符（如「海贼王」中命中「haiz」则只高亮「海贼」）。
 * 找不到精确映射时兑底为整名包裹。
 */
export function highlightByPinyin(name: string, keyword: string): string {
  const indices = match(name, keyword, {
    precision: 'start',
    continuous: true,
    insensitive: true
  });

  if (!indices || indices.length === 0) {
    return highlightWhole(name);
  }

  const matched = new Set(indices);
  return Array.from(name)
    .map((ch, i) =>
      matched.has(i)
        ? `<em class="keyword">${escapeHtml(ch)}</em>`
        : escapeHtml(ch)
    )
    .join('');
}
