import type { LoginOutcome, MeView } from '../types/domain'

export declare class AuthContractError extends Error {
  constructor(message: string)
}

export declare function normalizeLoginOutcome(value: unknown): LoginOutcome
export declare function normalizeMeView(value: unknown): MeView
