/** 两端共用的请求契约；不包含后台领域模型或任何身份策略。 */
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }
export interface ApiRequestOptions { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; bodyText?: string; bearerToken?: string; signal?: AbortSignal }
export type ApiClient = <T>(path: string, options?: ApiRequestOptions) => Promise<T>;

export class ApiError extends Error {
  constructor(message: string, readonly code: number, readonly requestId?: string, readonly data?: unknown, readonly httpStatus?: number) {
    super(message);
    this.name = 'ApiError';
  }
}
