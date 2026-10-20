/**
 * Toolbar Component
 *
 * Top toolbar for the canvas preview area with screenshot management controls and autosave status.
 */

import { Plus, Check, Loader2, AlertCircle, Sparkles } from "lucide-react";
import { useEditor } from "../../context/EditorContext";

interface ToolbarProps {
  /** Callback to add a new screenshot */
  onAddScreenshot: () => void;
  /** Total number of screenshots */
  screenshotCount: number;
}

/**
 * Toolbar - Canvas top toolbar with controls
 *
 * Displays the "Add Screenshot" button, autosave status, and screenshot count.
 *
 * @param props - Component props
 * @param props.onAddScreenshot - Handler for adding new screenshot
 * @param props.screenshotCount - Current number of screenshots
 *
 * @example
 * <Toolbar onAddScreenshot={addScreenshot} screenshotCount={3} />
 */
export const Toolbar = ({ onAddScreenshot, screenshotCount }: ToolbarProps) => {
  const { autosaveStatus, setIsStudioOpen } = useEditor();

  return (
    <div className="h-14 border-b border-white/10 bg-[#141414] flex items-center px-4 gap-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onAddScreenshot}
          className="flex items-center gap-1.5 bg-white hover:bg-neutral-200 text-black text-sm font-medium px-3 py-1.5 rounded-md transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Screenshot
        </button>
        <button
          onClick={() => setIsStudioOpen(true)}
          className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-3 py-1.5 rounded-md transition-colors shadow-sm"
          title="Open AI Screenshot Studio (Phase 3)"
        >
          <Sparkles className="w-4 h-4 text-violet-200" />
          <span>Screenshot Studio</span>
        </button>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        {/* Autosave status indicator */}
        <div
          data-testid="autosave-status"
          aria-live="polite"
          className="flex items-center gap-1.5 text-xs select-none"
        >
          {autosaveStatus === "saving" && (
            <span className="flex items-center gap-1 text-zinc-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
              <span>Saving…</span>
            </span>
          )}
          {autosaveStatus === "saved" && (
            <span className="flex items-center gap-1 text-zinc-500">
              <Check className="w-3.5 h-3.5 text-zinc-500" />
              <span>Saved</span>
            </span>
          )}
          {autosaveStatus === "error" && (
            <span
              className="flex items-center gap-1 text-red-400"
              title="The latest changes could not be saved and may be lost on reload"
            >
              <AlertCircle className="w-3.5 h-3.5 text-red-400" />
              <span className="font-medium">Save failed</span>
              <span className="text-red-400/80">(unsaved changes)</span>
            </span>
          )}
        </div>

        <div className="w-px h-3.5 bg-zinc-800" />

        <span className="text-xs text-gray-400">
          {screenshotCount} screenshot{screenshotCount !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
};
