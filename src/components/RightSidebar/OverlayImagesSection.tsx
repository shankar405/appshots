/**
 * OverlayImagesSection Component
 *
 * Overlay images management section.
 */

import type { RefObject } from "react";
import type { Screenshot, ShadowConfig } from "../../types";
import { SidebarSection } from "./SidebarSection";
import { OverlayImageItem } from "./OverlayImageItem";
import { OverlayImageProperties } from "./OverlayImageProperties";
import { STYLES } from "./constants";
import type { SelectedElement } from "./types";
import { AlertCircle, X } from "lucide-react";

interface OverlayImagesSectionProps {
  /** Active screenshot data */
  screenshot: Screenshot;
  /** Currently selected element */
  selectedElement: SelectedElement | null;
  /** Overlay image input ref */
  overlayImageInputRef: RefObject<HTMLInputElement | null>;
  /** Set selected element handler */
  onSelectElement: (element: SelectedElement | null) => void;
  /** Add overlay image handler */
  onAddImage: (file: File) => void;
  /** Remove overlay image handler */
  onRemoveImage: (id: string) => void;
  /** Update image size handler */
  onUpdateSize: (id: string, size: number) => void;
  /** Update image layer handler */
  onUpdateLayer: (id: string, layer: "behind" | "front") => void;
  /** Update image rotation handler */
  onUpdateRotation: (id: string, rotation: number) => void;
  /** Update image shadow handler */
  onUpdateShadow: (id: string, shadow: Partial<ShadowConfig>) => void;
  /** Bring image forward handler */
  onBringForward: (id: string) => void;
  /** Send image backward handler */
  onSendBackward: (id: string) => void;
  /** Optional upload error message */
  error?: string | null;
  /** Optional error dismissal handler */
  onClearError?: () => void;
}

/**
 * OverlayImagesSection - Overlay images management
 *
 * Add, remove, and configure overlay images.
 *
 * @param props - Component props
 */
export const OverlayImagesSection = ({
  screenshot,
  selectedElement,
  overlayImageInputRef,
  onSelectElement,
  onAddImage,
  onRemoveImage,
  onUpdateSize,
  onUpdateLayer,
  onUpdateRotation,
  onUpdateShadow,
  onBringForward,
  onSendBackward,
  error,
  onClearError,
}: OverlayImagesSectionProps) => {
  const selectedImage =
    selectedElement?.type === "image" &&
    selectedElement.screenshotId === screenshot.id &&
    selectedElement.id
      ? screenshot.overlayImages.find((img) => img.id === selectedElement.id)
      : null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onAddImage(file);
    e.target.value = "";
  };

  return (
    <SidebarSection title="Overlay Images">
      <div className="space-y-2">
        <input
          ref={overlayImageInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          onClick={() => overlayImageInputRef.current?.click()}
          className={STYLES.uploadButton}
        >
          + Add Image
        </button>

        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-1.5 rounded bg-red-950/40 p-2 text-xs text-red-400 border border-red-900/40"
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

        {screenshot.overlayImages.length > 0 && (
          <div className="space-y-2 mt-3">
            {screenshot.overlayImages.map((img, index) => (
              <OverlayImageItem
                key={img.id}
                image={img}
                index={index}
                totalCount={screenshot.overlayImages.length}
                isSelected={
                  selectedElement?.type === "image" &&
                  selectedElement?.screenshotId === screenshot.id &&
                  selectedElement?.id === img.id
                }
                onSelect={() =>
                  onSelectElement({
                    type: "image",
                    id: img.id,
                    screenshotId: screenshot.id,
                  })
                }
                onRemove={() => onRemoveImage(img.id)}
                onMoveForward={() => onBringForward(img.id)}
                onMoveBackward={() => onSendBackward(img.id)}
              />
            ))}

            {selectedImage && (
              <OverlayImageProperties
                image={selectedImage}
                onSizeChange={(size) => onUpdateSize(selectedImage.id, size)}
                onRotationChange={(rotation) =>
                  onUpdateRotation(selectedImage.id, rotation)
                }
                onLayerChange={(layer) =>
                  onUpdateLayer(selectedImage.id, layer)
                }
                onShadowToggle={() =>
                  onUpdateShadow(selectedImage.id, {
                    enabled: !selectedImage.shadow?.enabled,
                  })
                }
                onShadowColorChange={(color) =>
                  onUpdateShadow(selectedImage.id, { color })
                }
                onShadowBlurChange={(blur) =>
                  onUpdateShadow(selectedImage.id, { blur })
                }
                onShadowOffsetYChange={(offsetY) =>
                  onUpdateShadow(selectedImage.id, { offsetY })
                }
              />
            )}
          </div>
        )}
      </div>
    </SidebarSection>
  );
};
