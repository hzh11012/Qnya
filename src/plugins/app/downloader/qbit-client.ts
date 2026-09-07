import bencode from 'bencode';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';

interface TorrentInfo {
  hash: string;
  name: string;
  progress: number;
  state: string;
  save_path: string;
  content_path: string;
  size: number;
  dlspeed: number;
  eta: number;
  tags: string;
  added_on: number;
  completion_on: number;
}

interface TorrentFile {
  index: number;
  name: string;
  size: number;
  progress: number;
  priority: number;
  is_seed: boolean;
  piece_range: number[];
  availability: number;
}

type TorrentUriType = 'torrent' | 'magnet';

interface TorrentQueryParams {
  /** 标签过滤，默认 'qnya' */
  tag?: string;
  /** 状态过滤 */
  filter?:
    | 'downloading'
    | 'metaDL'
    | 'forcedDL'
    | 'stalledDL'
    | 'checkingDL'
    | 'queuedDL'
    | 'pausedDL'
    | 'allocating'
    | 'uploading'
    | 'forcedUP'
    | 'stalledUP'
    | 'checkingUP'
    | 'queuedUP'
    | 'pausedUP'
    | 'error'
    | 'missingFiles'
    | 'moving'
    | 'checkingResumeData'
    | 'unknown';
  /** 排序字段 */
  sort?: 'size' | 'added_on' | 'completion_on';
  /** 是否倒序 */
  reverse?: boolean;
  /** 每页数量 */
  limit?: number;
  /** 偏移量 */
  offset?: number;
}

/** 默认标签，用于标识本系统添加的种子 */
const DEFAULT_TAG = 'qnya';

export class QBitClient {
  private cookie: string | null = null;
  private cookieExpiry = 0;
  private loginPromise: Promise<void> | null = null;

  constructor(private readonly fastify: FastifyInstance) {}

  private get baseUrl() {
    return this.fastify.config.QBIT_HOST;
  }

  private get username() {
    return this.fastify.config.QBIT_USERNAME;
  }

  private get password() {
    return this.fastify.config.QBIT_PASSWORD;
  }

  private get downloadPath() {
    return this.fastify.config.QBIT_DOWNLOAD_PATH;
  }

  private async login(): Promise<void> {
    if (this.loginPromise) return this.loginPromise;

    this.loginPromise = (async () => {
      const response = await fetch(`${this.baseUrl}/api/v2/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          username: this.username,
          password: this.password
        }).toString()
      });

      if (!response.ok) {
        throw new Error(`qBittorrent login failed: ${response.status}`);
      }

      const text = await response.text();
      if (text.trim() !== 'Ok.') {
        throw new Error(`qBittorrent login failed: ${text}`);
      }

      const setCookie = response.headers.get('set-cookie');
      if (!setCookie) {
        throw new Error('qBittorrent login failed: no cookie returned');
      }

      this.cookie = setCookie
        .split(',')
        .map(c => c.split(';')[0])
        .join('; ');

      this.cookieExpiry = Date.now() + 60 * 60 * 1000;
    })();

    try {
      await this.loginPromise;
    } finally {
      this.loginPromise = null;
    }
  }

  private async ensureLoggedIn() {
    if (!this.cookie || Date.now() > this.cookieExpiry) {
      await this.login();
    }
  }

  private async fetchWithAuth<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    await this.ensureLoggedIn();

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Cookie: this.cookie!
      }
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`qBittorrent API error ${response.status}: ${text}`);
    }

    const contentType = response.headers.get('content-type');
    return contentType?.includes('application/json')
      ? (response.json() as Promise<T>)
      : ((await response.text()) as unknown as T);
  }

  /** 判断链接类型 */
  getUriType(uri: string): TorrentUriType {
    return uri.startsWith('magnet:') ? 'magnet' : 'torrent';
  }

  /** Base32 转 Hex */
  private base32ToHex(base32: string): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';

    for (const char of base32.toUpperCase()) {
      const val = alphabet.indexOf(char);
      if (val === -1) throw new Error('Invalid base32 character');
      bits += val.toString(2).padStart(5, '0');
    }

    let hex = '';
    for (let i = 0; i + 4 <= bits.length; i += 4) {
      hex += parseInt(bits.substring(i, i + 4), 2).toString(16);
    }

    return hex;
  }

  /** 从磁力链接提取 info hash */
  private extractMagnetHash(magnetUri: string): string {
    const match = magnetUri.match(
      /xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i
    );
    if (!match) {
      throw new Error('无效的磁力链接：无法提取 info hash');
    }

    let hash = match[1];
    if (hash.length === 32) {
      hash = this.base32ToHex(hash);
    }

    return hash.toLowerCase();
  }

  /** 从 .torrent URL 计算 info hash */
  private async calculateTorrentHash(uri: string): Promise<string> {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`下载种子文件失败: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const torrent = bencode.decode(buffer) as { info?: unknown };

    if (!torrent.info) {
      throw new Error('无效的种子文件：缺少 info 字典');
    }

    const infoBuffer = bencode.encode(torrent.info);
    return crypto.createHash('sha1').update(infoBuffer).digest('hex');
  }

  /** 获取 info hash（支持两种类型） */
  async getInfoHash(uri: string): Promise<string> {
    const type = this.getUriType(uri);
    return type === 'magnet'
      ? this.extractMagnetHash(uri)
      : this.calculateTorrentHash(uri);
  }

  /** 获取种子信息 */
  async getTorrentInfo(hash: string): Promise<TorrentInfo | null> {
    const torrents = await this.fetchWithAuth<TorrentInfo[]>(
      `/api/v2/torrents/info?hashes=${hash}`
    );
    return torrents[0] ?? null;
  }

  /** 获取种子文件列表 */
  async getTorrentFiles(hash: string): Promise<TorrentFile[]> {
    return this.fetchWithAuth<TorrentFile[]>(
      `/api/v2/torrents/files?hash=${hash}`
    );
  }

  /**
   * 设置文件优先级
   * @param priority 0=不下载, 1=正常, 6=高, 7=最高
   */
  async setFilePriority(
    hash: string,
    fileIndexes: number[],
    priority: number
  ): Promise<void> {
    await this.fetchWithAuth<void>('/api/v2/torrents/filePrio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        hash: hash.toLowerCase(),
        id: fileIndexes.join('|'),
        priority: String(priority)
      }).toString()
    });
  }

  /**
   * 添加下载（带标签）
   * @param uri 种子链接
   * @param tag 标签，默认 'qnya'
   */
  async addTorrent(uri: string, tag = DEFAULT_TAG): Promise<string> {
    return this.fetchWithAuth<string>('/api/v2/torrents/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        urls: uri,
        savepath: this.downloadPath,
        tags: tag,
        ratioLimit: '0',
        seedingTimeLimit: '0'
      }).toString()
    });
  }

  /**
   * 获取种子列表（支持分页）
   */
  async getTorrents(
    params: TorrentQueryParams = {}
  ): Promise<{ items: TorrentInfo[]; total: number }> {
    const {
      tag = DEFAULT_TAG,
      filter,
      sort = 'added_on',
      reverse = true,
      limit = 10,
      offset = 0
    } = params;

    const queryParams = new URLSearchParams();
    if (tag) queryParams.set('tag', tag);
    if (filter) queryParams.set('filter', filter);
    if (sort) queryParams.set('sort', sort);
    if (reverse) queryParams.set('reverse', 'true');

    const all = await this.fetchWithAuth<TorrentInfo[]>(
      `/api/v2/torrents/info?${queryParams.toString()}`
    );

    const items = all.slice(offset, offset + limit);
    const total = all.length;

    return { items, total };
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<string> {
    await this.login();
    return '连接成功';
  }
}
