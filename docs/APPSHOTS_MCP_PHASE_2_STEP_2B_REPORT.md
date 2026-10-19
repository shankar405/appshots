# AppShots MCP — Phase 2, Step 2B: AI Provider Abstraction & Mock Provider Report

**Document Version**: 1.0.0  
**Date**: October 19, 2026  
**Status**: Step 2B Implementation Complete  
**Target Environment**: Node.js / Bun MCP Runtime, Offline Testing  

---

## 1. Executive Summary

Phase 2, Step 2B implements a **vendor-neutral AI provider abstraction**, central **Zod schemas for app analysis and screenshot planning**, and a **deterministic mock provider** for hermetic, offline testing without paid API keys or external network dependencies.

All schemas enforce strict evidence-attribution rules (`EvidenceSourceEnum`), string and array bounds, and 1:1 compatibility with AppShots' project-builder format. A typed error hierarchy handles timeouts, schema validation failures, rate limits, and service outages, with automatic secret redaction (`sk-[REDACTED]`, `AIza[REDACTED]`, `Bearer [REDACTED]`) protecting user credentials from leaking into logs or tool outputs.

---

## 2. Created & Modified Files

| File | Status | Description |
| :--- | :---: | :--- |
| [`src/mcp/ai/schemas.ts`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/ai/schemas.ts) | **Created** | Central Zod schemas and inferred TypeScript types for `AnalyzeAppOutputSchema`, `GenerateScreenshotPlanOutputSchema`, `ObservedScreenSchema`, `VerifiedFeatureSchema`, and `PlannedSlideSchema`. |
| [`src/mcp/ai/provider.ts`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/ai/provider.ts) | **Created** | Provider-neutral `AIProvider` interface, multimodal message types, structured request/response types, error hierarchy, and `sanitizeSecrets()`. |
| [`src/mcp/ai/mock-provider.ts`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/ai/mock-provider.ts) | **Created** | Deterministic `MockAIProvider` returning schema-valid analysis and plan fixtures, with configurable error and timeout simulation. |
| [`src/mcp/ai/provider.test.ts`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/ai/provider.test.ts) | **Created** | Unit test suite (18 tests) verifying schema validation, rejection of unsupported/fabricated claims, secret redaction, and deterministic mock behavior. |
| [`docs/APPSHOTS_MCP_PHASE_2_STEP_2B_REPORT.md`](file:///c:/Users/shank/OneDrive/Desktop/appshots/docs/APPSHOTS_MCP_PHASE_2_STEP_2B_REPORT.md) | **Created** | This report. |

---

## 3. Schema Names & Key Validation Rules

### 3.1 `EvidenceSourceEnum`
```typescript
export const EvidenceSourceEnum = z.enum([
  "observed_dom",
  "observed_visual",
  "user_provided",
  "inferred",
]);
```

### 3.2 `AnalyzeAppOutputSchema`
- **Product Identity**: `product.name`, `product.category`, `product.tagline` (nullable), `product.summary` (10-1000 chars), with mandatory `nameSource` and `categorySource`.
- **Observed Screens**: `screens` (1-10 items). Each screen requires `id`, `route`, `filePath`, `title`, and `status` (`"captured"` | `"auth_required"` | `"failed"`).
- **Verified Features**: `features` (1-15 items). Every feature strictly requires `evidence` (5-500 chars), `evidenceSource`, and `screenId`.
- **Target Audience**: `targetAudience.description`, `source`, `confidence` (`"high"` | `"medium"` | `"low"`), and `rationale`.
- **Unverified Claims & Ambiguities**: Explicit `assumptionsAndUnknowns` section containing `unverifiedClaims`, `authRequiredRoutes`, and `areasRequiringUserConfirmation`.
- **Anti-Hallucination Rejection**: Features missing concrete evidence strings or evidence source tags are rejected by the schema.

### 3.3 `GenerateScreenshotPlanOutputSchema`
- **Project Alignment**: `deviceModel` (`VALID_DEVICE_IDS`), `deviceColor`, `exportSizeId` (`VALID_EXPORT_SIZE_IDS`), `targetStore` (`"apple-app-store"` | `"google-play"`).
- **Ordered Slides**: `slides` (1-7 items). Each planned slide specifies:
  - `slideNumber` (1-based sequence index)
  - `screenshotRef` (`screenId`, `filePath`, `route`)
  - `marketingAngle` (`mainMessage`, `userBenefit`, `supportingEvidence`)
  - `copy` (`headline` with rich-text HTML `<b>` support, `subheadline`)
  - `visualComposition` (`deviceStyle`: `"flat"` | `"3d"`, `deviceScale`, `deviceOffsetY`, `deviceRotation`, `rotateY`, `rotateX`, `backgroundMode`, `gradientPresetId`, `backgroundColor`, `textColor`)
- **Direct Conversion**: The slide layout fields map 1:1 into `BuildProjectInputSchema` in [`src/mcp/project-builder.ts`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/project-builder.ts).

---

## 4. Provider Interface Signatures

### 4.1 Interface Contract
```typescript
export interface AIProvider {
  readonly id: string;
  readonly name: string;
  generateStructured<T>(
    options: StructuredGenerateOptions<T>,
  ): Promise<StructuredGenerateResult<T>>;
}
```

### 4.2 Request & Response Types
```typescript
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
```

### 4.3 Error Hierarchy
- `AIProviderError`: Base class with `code`, `providerId`, and `isRetryable`.
- `AITimeoutError`: Thrown on request timeout or `AbortSignal` cancellation (`isRetryable: true`).
- `AIInvalidOutputError`: Thrown on malformed JSON or Zod schema validation failure (`isRetryable: false`). Contains `rawText` and `validationErrors`.
- `AIUnavailableError`: Thrown on provider network outage or missing credentials (`isRetryable: false/true`).
- `AIRateLimitError`: Thrown on HTTP 429 rate limit exceeded (`isRetryable: true`, with optional `retryAfterSeconds`).

### 4.4 Secret Redaction
All error messages and log strings pass through `sanitizeSecrets()`, replacing:
- OpenAI / general keys (`sk-...` -> `sk-[REDACTED]`)
- Google API keys (`AIza...` -> `AIza[REDACTED]`)
- Anthropic keys (`sk-ant-...` -> `sk-ant-[REDACTED]`)
- Bearer tokens (`Bearer ...` -> `Bearer [REDACTED]`)
- Sensitive query parameters (`token=...`, `key=...`, `secret=...` -> `[REDACTED]`)

---

## 5. Mock Provider Behavior & Limitations

- **Determinism**: Calling `MockAIProvider` with identical inputs generates bit-for-bit identical results.
- **Evidence-Driven Fixture Generation**:
  - `AnalyzeAppOutput`: Parses candidate titles and headings from input prompt messages, binding features to observed screen IDs. Unknowns are explicitly logged under `unverifiedClaims`.
  - `GenerateScreenshotPlanOutput`: Formats 3-slide plans with rich-text HTML `<b>` emphasis tags, flat and 3D device angles, and AppShots gradient presets (`sunset`, `ocean`, `royal`).
- **Simulations for Test Coverage**: Configurable flags simulate timeouts (`simulateTimeout`), malformed output (`simulateMalformedOutput`), rate limits (`simulateRateLimit`), and provider outages (`simulateProviderError`).
- **Zero API Dependency**: Does not make network calls, require API keys, or attempt live web requests.

---

## 6. Test Results & Build Verification

### 6.1 AI Provider & Schemas Test Suite
Command: `npx vitest run src/mcp/ai/provider.test.ts`
```
 ✓ src/mcp/ai/provider.test.ts (18 tests) 18ms
   ✓ AppShots AI Schemas & Validation > AnalyzeAppOutputSchema > accepts valid, fully populated analysis output
   ✓ AppShots AI Schemas & Validation > AnalyzeAppOutputSchema > rejects analysis with missing evidenceSource
   ✓ AppShots AI Schemas & Validation > AnalyzeAppOutputSchema > rejects analysis with missing required evidence in features
   ✓ AppShots AI Schemas & Validation > AnalyzeAppOutputSchema > rejects analysis with empty screens array
   ✓ AppShots AI Schemas & Validation > GenerateScreenshotPlanOutputSchema > accepts valid screenshot plan output
   ✓ AppShots AI Schemas & Validation > GenerateScreenshotPlanOutputSchema > rejects plan with 0 slides
   ✓ AppShots AI Schemas & Validation > GenerateScreenshotPlanOutputSchema > rejects plan with more than 7 slides
   ✓ AppShots AI Schemas & Validation > GenerateScreenshotPlanOutputSchema > rejects invalid hex colors
   ✓ Secret Redaction > masks OpenAI sk- tokens, Google AIza keys, and Anthropic keys
   ✓ Secret Redaction > masks bearer authorization headers and sensitive query parameters
   ✓ MockAIProvider > generates deterministic, schema-valid AnalyzeAppOutput
   ✓ MockAIProvider > produces identical output for identical requests (determinism)
   ✓ MockAIProvider > generates deterministic, schema-valid GenerateScreenshotPlanOutput
   ✓ MockAIProvider > handles cancellation via AbortSignal
   ✓ MockAIProvider > simulates timeout errors when configured
   ✓ MockAIProvider > simulates rate limit errors when configured
   ✓ MockAIProvider > simulates provider unavailable errors when configured
   ✓ MockAIProvider > simulates malformed output and schema validation errors

Test Files  1 passed (1)
     Tests  18 passed (18)
  Duration  462ms
```

### 6.2 Full Repository Test Suite
Command: `npx vitest run --fileParallelism=false`
```
Test Files  14 passed (14)
     Tests  133 passed (133)
  Duration  25.42s
```

### 6.3 Production Build & TypeScript Check
Command: `bun run build`
```
vite v7.3.1 building client environment for production...
✓ 1851 modules transformed.
dist/index.html                  11.52 kB │ gzip:  3.11 kB
dist/assets/index-DSWBU8Zv.css   40.82 kB │ gzip:  8.02 kB
dist/assets/index-TzKP-035.js   202.95 kB │ gzip: 61.42 kB
dist/assets/index-3Hw7DzYI.js   277.55 kB │ gzip: 89.24 kB
✓ built in 2.84s
```

---

## 7. Remaining Design Questions

1. **Prompt Engineering for Headline Highlighting**: What system instructions should guide the AI model to selectively wrap 1-2 key words in `<b>` tags without over-highlighting?
2. **Provider Resolution**: When live AI is enabled, how should the provider factory prioritize multiple available keys (e.g. Gemini vs. Claude vs. OpenAI)?

---

## 8. Recommended Next Implementation Task

**Phase 2, Step 2C: Implement `analyze_app_for_store` & `generate_screenshot_plan` Tools**
- Connect `captureApplicationScreens` from Step 2A with `AIProvider` from Step 2B.
- Implement tool handlers for `analyze_app_for_store` and `generate_screenshot_plan` in the MCP server.
- Register tools in `src/mcp/server.ts`.
- Add integration tests using `MockAIProvider` to verify the end-to-end tool execution over stdio.
