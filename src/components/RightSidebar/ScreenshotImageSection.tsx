/**
 * ScreenshotImageSection Component
 *
 * Screenshot image upload control in its own sidebar section.
 */

import type { RefObject } from "react";
import type { DeviceInstance } from "../../types";
import { SidebarSection } from "./SidebarSection";
import { STYLES } from "./constants";
import { AlertCircle, X } from "lucide-react";

interface ScreenshotImageSectionProps {
  device: DeviceInstance;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string | null;
  onClearError?: () => void;
}

export const ScreenshotImageSection = ({
  device,
  fileInputRef,
  onFileUpload,
  error,
  onClearError,
}: ScreenshotImageSectionProps) => (
  <SidebarSection title="Device Screen Image">
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      onChange={onFileUpload}
      className="hidden"
    />
    <button
      onClick={() => fileInputRef.current?.click()}
      className={STYLES.uploadButton}
    >
      {device.screenshotSrc ? "Change Image" : "Upload Image"}
    </button>
    {error && (
      <div
        role="alert"
        aria-live="assertive"
        className="mt-2 flex items-start gap-1.5 rounded bg-red-950/40 p-2 text-xs text-red-400 border border-red-900/40"
      >
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-400" />
        <span className="flex-1">{error}</span>
        {onClearError && (
          <button
            onClick={onClearError}
            aria-label="Dismiss error"
            className="text-red-400/70 hover:text-red-300 transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </div>
    )}
  </SidebarSection>
);
