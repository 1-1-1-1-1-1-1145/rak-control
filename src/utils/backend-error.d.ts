export declare const BACKEND_ERROR_CODES: readonly string[]

export declare class BackendError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly details?: Record<string, unknown>
  constructor(code: string, message?: string, details?: Record<string, unknown>)
}

export declare function isBackendError(value: unknown): value is BackendError
export declare function toBackendError(value: unknown): BackendError
export declare function backendUserMessage(code: string): string
