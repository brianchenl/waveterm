import { productionTerminalAIContextAdapters } from "./production-adapters";
import { createTerminalAIContextCapture } from "./terminal-ai-context";

export type { CaptureTerminalAIContext, TerminalAIContextSnapshot } from "./terminal-ai-context";

export const capture = createTerminalAIContextCapture(productionTerminalAIContextAdapters);
