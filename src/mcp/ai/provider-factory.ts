/**
 * AI Provider Factory and Dependency Injection for AppShots MCP Server
 *
 * Provides a clean boundary for resolving the active AIProvider instance.
 * Defaults strictly to MockAIProvider for hermetic, offline, zero-cost operation.
 */

import type { AIProvider } from "./provider";
import { MockAIProvider } from "./mock-provider";

let activeProvider: AIProvider = new MockAIProvider();

/**
 * Returns the currently active AI provider (defaults to MockAIProvider).
 */
export function getActiveAIProvider(): AIProvider {
  return activeProvider;
}

/**
 * Injects a custom AI provider (e.g. for testing specific failure modes).
 */
export function setActiveAIProvider(provider: AIProvider): void {
  activeProvider = provider;
}

/**
 * Resets the active provider back to default MockAIProvider.
 */
export function resetAIProvider(): void {
  activeProvider = new MockAIProvider();
}
