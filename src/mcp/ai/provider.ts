/**
 * AppShots AI Provider Abstraction
 *
 * Defines vendor-neutral multimodal messaging, structured output generation,
 * typed error contracts, cancellation handling, and secret redaction.
 */

import type { z } from "zod";

/**
 * Text or Base64 image payload part for multimodal model messages.
 */
export type MultimodalContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      mediaType: "image/png" | "image/jpeg" | "image/webp";
      data: string; // Base64 encoded image data
    };

/**
 * Unified multimodal message format across providers.
 */
export interface MultimodalMessage {
  role: "system" | "user" | "assistant";
  content: string | MultimodalContentPart[];
}

/**
 * Request options for structured model generation.
 */
export interface StructuredGenerateOptions<T> {
  systemPrompt?: string;
  messages: MultimodalMessage[];
  schema: z.ZodType<T>;
  schemaName: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Result returned by a structured model generation call.
 */
export interface StructuredGenerateResult<T> {
  data: T;
  rawText: string;
  providerId: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/**
 * Sanitizes sensitive credentials, API keys, and bearer tokens from error strings and logs.
 */
export function sanitizeSecrets(text: string): string {
  if (!text || typeof text !== "string") return "";

  return text
    // Anthropic keys (sk-ant-...)
    .replace(/\bsk-ant-[a-zA-Z0-9_-]{15,}\b/gi, "sk-ant-[REDACTED]")
    // OpenAI / general sk-... tokens
    .replace(/\bsk-[a-zA-Z0-9_-]{15,}\b/gi, "sk-[REDACTED]")
    // Google API keys (AIza...)
    .replace(/\bAIza[0-9A-Za-z-_]{20,}\b/g, "AIza[REDACTED]")
    // Bearer authorization headers
    .replace(/Bearer\s+[a-zA-Z0-9_.-]{15,}/gi, "Bearer [REDACTED]")
    // Common sensitive query params
    .replace(/((?:token|api_?key|auth|password|secret)=)([^&\s]+)/gi, "$1[REDACTED]");
}

/**
 * Base error class for all AI provider exceptions.
 */
export class AIProviderError extends Error {
  public readonly code: string;
  public readonly providerId: string;
  public readonly isRetryable: boolean;

  constructor(
    message: string,
    options?: {
      code?: string;
      providerId?: string;
      isRetryable?: boolean;
      cause?: unknown;
    },
  ) {
    super(sanitizeSecrets(message));
    this.name = "AIProviderError";
    this.code = options?.code || "PROVIDER_ERROR";
    this.providerId = options?.providerId || "unknown";
    this.isRetryable = options?.isRetryable ?? false;
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

/**
 * Thrown when a model generation call times out or is aborted.
 */
export class AITimeoutError extends AIProviderError {
  constructor(message: string, providerId = "unknown", cause?: unknown) {
    super(message, {
      code: "TIMEOUT",
      providerId,
      isRetryable: true,
      cause,
    });
    this.name = "AITimeoutError";
  }
}

/**
 * Thrown when the model output fails schema validation or is malformed JSON.
 */
export class AIInvalidOutputError extends AIProviderError {
  public readonly rawText: string;
  public readonly validationErrors: string[];

  constructor(
    message: string,
    rawText: string,
    validationErrors: string[] = [],
    providerId = "unknown",
  ) {
    super(message, {
      code: "INVALID_OUTPUT",
      providerId,
      isRetryable: false,
    });
    this.name = "AIInvalidOutputError";
    this.rawText = sanitizeSecrets(rawText);
    this.validationErrors = validationErrors;
  }
}

/**
 * Thrown when an AI provider is unreachable or missing required configuration.
 */
export class AIUnavailableError extends AIProviderError {
  constructor(message: string, providerId = "unknown", isRetryable = false, cause?: unknown) {
    super(message, {
      code: "UNAVAILABLE",
      providerId,
      isRetryable,
      cause,
    });
    this.name = "AIUnavailableError";
  }
}

/**
 * Thrown when provider rate limits are exceeded (HTTP 429).
 */
export class AIRateLimitError extends AIProviderError {
  public readonly retryAfterSeconds?: number;

  constructor(message: string, providerId = "unknown", retryAfterSeconds?: number) {
    super(message, {
      code: "RATE_LIMIT",
      providerId,
      isRetryable: true,
    });
    this.name = "AIRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Generic provider-neutral interface for structured multimodal AI models.
 */
export interface AIProvider {
  readonly id: string;
  readonly name: string;

  /**
   * Generates a strongly typed, schema-validated structured response.
   */
  generateStructured<T>(
    options: StructuredGenerateOptions<T>,
  ): Promise<StructuredGenerateResult<T>>;
}
