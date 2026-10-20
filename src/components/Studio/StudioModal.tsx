/**
 * AppShots Screenshot Studio Modal (Phase 3)
 *
 * Guided workflow to:
 * 1. Inspect and select captured screens from the analyzed application (Step B)
 * 2. Generate 3-4 visual design variants per selected screen (Step D)
 * 3. Compare variants side-by-side and fine-tune headlines, styling, and 3D device angles (Step E)
 * 4. Open any chosen variant directly in the native AppShots canvas editor (Step E)
 * 5. Export a verified, self-contained ZIP archive with PNGs, native project, and manifest (Section 5)
 */

import { useState, useMemo, useEffect } from "react";
import {
  X,
  Sparkles,
  Check,
  Star,
  Download,
  ArrowUp,
  ArrowDown,
  Eye,
  ExternalLink,
  ChevronRight,
  FolderOpen,
} from "lucide-react";
import { useEditor } from "../../context/EditorContext";
import { devices, gradientPresets, exportSizes } from "../../constants";
import {
  generateVariantsForScreen,
  variantsToProject,
  type DesignVariant,
} from "../../lib/studio/variants";
import { exportScreenshots, getCanonicalPreviewDimensions } from "../../lib/export-utils";
import {
  packageBrowserStudioZip,
  type RenderedVariantAsset,
} from "../../lib/studio/browser-packager";
import type { ObservedScreen } from "../../mcp/ai/schemas";

export interface StudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialScreens?: ObservedScreen[];
}

export const StudioModal = ({
  isOpen,
  onClose,
  initialScreens,
}: StudioModalProps) => {
  const { importProject, activeProject } = useEditor();

  // Step state: 'select' | 'compare'
  const [currentStep, setCurrentStep] = useState<"select" | "compare">("select");
  const [variantCount, setVariantCount] = useState<3 | 4>(4);
  const [targetStore, setTargetStore] = useState<"apple-app-store" | "google-play">("apple-app-store");
  const [storeWarning, setStoreWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setCurrentStep("select");
    }
  }, [isOpen]);

  // Available application screens
  const defaultSampleScreens: ObservedScreen[] = useMemo(() => {
    if (initialScreens && initialScreens.length > 0) return initialScreens;

    // Fallback default screen derived from current active screenshot or sample
    const activeDeviceImg = activeProject.screenshots[0]?.devices[0]?.screenshotSrc || "";
    return [
      {
        id: "screen-1-home",
        route: "/",
        filePath: activeDeviceImg,
        title: "Home Dashboard",
        keyElements: ["Live Analytics", "Task Overview", "Quick Actions"],
        status: "captured",
      },
      {
        id: "screen-2-projects",
        route: "/projects",
        filePath: activeDeviceImg,
        title: "Project Management",
        keyElements: ["Sprint Planning", "Team Milestones", "Priority Kanban"],
        status: "captured",
      },
      {
        id: "screen-3-settings",
        route: "/settings",
        filePath: activeDeviceImg,
        title: "Account & Integrations",
        keyElements: ["API Keys", "Security Center", "Cloud Sync"],
        status: "captured",
      },
    ];
  }, [initialScreens, activeProject]);

  const [screens, setScreens] = useState<ObservedScreen[]>(defaultSampleScreens);
  const [selectedScreenIds, setSelectedScreenIds] = useState<string[]>(() =>
    screens.slice(0, 2).map((s) => s.id),
  );

  // Generated variants per screen ID: { [screenId]: DesignVariant[] }
  const [variantsByScreen, setVariantsByScreen] = useState<Record<string, DesignVariant[]>>({});
  const [activeScreenIndex, setActiveScreenIndex] = useState(0);
  const [favoriteVariantIds, setFavoriteVariantIds] = useState<Record<string, string>>({});
  const [isExporting, setIsExporting] = useState(false);

  if (!isOpen) return null;

  const handleToggleScreen = (id: string) => {
    setSelectedScreenIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleMoveScreen = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= screens.length) return;
    const updated = [...screens];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);
    setScreens(updated);
  };

  const handleStoreChange = (store: "apple-app-store" | "google-play") => {
    setTargetStore(store);
    if (store === "google-play") {
      setStoreWarning(
        "Google Play export is not currently supported: dimensions and presets are not yet implemented. Please select Apple App Store for store-ready exports.",
      );
    } else {
      setStoreWarning(null);
    }
  };

  const handleGenerateVariants = () => {
    const selected = screens.filter((s) => selectedScreenIds.includes(s.id));
    if (selected.length === 0) return;

    const generated: Record<string, DesignVariant[]> = {};
    const initialFavs: Record<string, string> = {};

    for (const screen of selected) {
      const vars = generateVariantsForScreen(screen, {
        variantCount,
        targetDevice: activeProject.selectedDeviceId,
        exportSizeId: activeProject.exportSizeId,
      });
      generated[screen.id] = vars;
      if (vars.length > 0) {
        initialFavs[screen.id] = vars[0].id;
      }
    }

    setVariantsByScreen(generated);
    setFavoriteVariantIds(initialFavs);
    setActiveScreenIndex(0);
    setCurrentStep("compare");
  };

  const currentSelectedScreens = screens.filter((s) => selectedScreenIds.includes(s.id));
  const activeScreen = currentSelectedScreens[activeScreenIndex] || currentSelectedScreens[0];
  const activeVariants = activeScreen ? variantsByScreen[activeScreen.id] || [] : [];

  const handleUpdateVariant = (variantId: string, updates: Partial<DesignVariant>) => {
    if (!activeScreen) return;
    setVariantsByScreen((prev) => {
      const currentList = prev[activeScreen.id] || [];
      const updatedList = currentList.map((v) =>
        v.id === variantId
          ? {
              ...v,
              ...updates,
              copy: { ...v.copy, ...(updates.copy || {}) },
              visualComposition: { ...v.visualComposition, ...(updates.visualComposition || {}) },
            }
          : v,
      );
      return { ...prev, [activeScreen.id]: updatedList };
    });
  };

  const handleSelectFavorite = (variantId: string) => {
    if (!activeScreen) return;
    setFavoriteVariantIds((prev) => ({
      ...prev,
      [activeScreen.id]: variantId,
    }));
  };

  const handleOpenInEditor = (variant: DesignVariant) => {
    const project = variantsToProject([variant], {
      projectName: `${variant.name} - ${variant.sourceScreen.title}`,
      exportSizeId: activeProject.exportSizeId,
      defaultDeviceId: variant.deviceModel,
    });
    importProject(project);
    onClose();
  };

  const handleOpenAllFavoritesInEditor = () => {
    const chosenVariants: DesignVariant[] = [];
    for (const screen of currentSelectedScreens) {
      const screenVariants = variantsByScreen[screen.id] || [];
      const favId = favoriteVariantIds[screen.id];
      const match = screenVariants.find((v) => v.id === favId) || screenVariants[0];
      if (match) chosenVariants.push(match);
    }

    if (chosenVariants.length === 0) return;

    const project = variantsToProject(chosenVariants, {
      projectName: `Studio Set (${chosenVariants.length} Screens)`,
      exportSizeId: activeProject.exportSizeId,
    });
    importProject(project);
    onClose();
  };

  const handleExportZipInBrowser = async () => {
    if (targetStore === "google-play") {
      alert(
        "Google Play export is not currently supported: Google Play screenshot dimensions and presets are not yet implemented or verified. Currently supported export presets are Apple App Store presets: 6.7, 6.5, 5.5, ipad.",
      );
      return;
    }

    setIsExporting(true);
    try {
      const chosenVariants: DesignVariant[] = [];
      for (const screen of currentSelectedScreens) {
        const screenVariants = variantsByScreen[screen.id] || [];
        const favId = favoriteVariantIds[screen.id];
        const match = screenVariants.find((v) => v.id === favId) || screenVariants[0];
        if (match) chosenVariants.push(match);
      }

      if (chosenVariants.length === 0) {
        alert("No variants selected for export.");
        return;
      }

      const project = variantsToProject(chosenVariants, {
        projectName: "AppShots Studio Export",
        exportSizeId: activeProject.exportSizeId,
      });

      const effectiveExportSize =
        exportSizes.find((s) => s.id === (activeProject.exportSizeId || "6.7")) || exportSizes[0];

      // Canonical 1/3 scale preview dimensions guarantee deterministic typography
      // and identical line-wrapping between browser and headless MCP exports.
      const effectivePreviewDims = getCanonicalPreviewDimensions(effectiveExportSize);

      // 1. Render genuine full-resolution PNG screenshots via native canvas pipeline
      const renderedFiles = await exportScreenshots({
        screenshots: project.screenshots,
        exportSize: effectiveExportSize,
        previewDimensions: effectivePreviewDims,
        headlineFontSize: project.headlineFontSize || 72,
        subheadlineFontSize: project.subheadlineFontSize || 38,
        skipDownload: true,
      });

      if (!renderedFiles || renderedFiles.length !== chosenVariants.length) {
        throw new Error(
          `Export rendering failed: expected ${chosenVariants.length} screenshots, got ${renderedFiles?.length ?? 0}.`,
        );
      }

      const renderedAssets: RenderedVariantAsset[] = chosenVariants.map((v, idx) => ({
        variant: v,
        dataUrl: renderedFiles[idx].data,
      }));

      // 2. Package and verify full ZIP archive with genuine PNGs and manifest
      const { blob, archiveFilename } = await packageBrowserStudioZip({
        project,
        renderedAssets,
        archiveName: "appshots-studio-export",
        targetStore: "apple-app-store",
        exportSizeId: activeProject.exportSizeId,
      });

      // 3. Trigger browser download of verified archive
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = archiveFilename;
      a.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-hidden">
      <div className="relative w-full max-w-6xl max-h-[92vh] bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-white">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">AppShots Screenshot Studio</h2>
                <span className="px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-full">
                  Phase 3 • Multi-Variant AI Studio
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Select screens, generate 3-4 styled design variants, compare in-place, and export store assets.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentStep(currentStep === "select" ? "compare" : "select")}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
            >
              {currentStep === "select" ? "View Variants" : "Back to Screens"}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {currentStep === "select" ? (
            /* STEP B: Screen Selection */
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-zinc-950/40 border border-zinc-800">
                <div>
                  <h3 className="text-sm font-semibold text-white">Step B — Select Application Screens</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Choose which captured pages from your inspected web application to include in your design set.
                  </p>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  {/* Variant Count Selector */}
                  <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/80 rounded-lg p-1 text-xs">
                    <span className="text-zinc-400 px-2">Variants per screen:</span>
                    <button
                      onClick={() => setVariantCount(3)}
                      className={`px-2.5 py-1 rounded font-medium transition-colors ${
                        variantCount === 3 ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      3
                    </button>
                    <button
                      onClick={() => setVariantCount(4)}
                      className={`px-2.5 py-1 rounded font-medium transition-colors ${
                        variantCount === 4 ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      4 (Default)
                    </button>
                  </div>

                  {/* Target Store */}
                  <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/80 rounded-lg p-1 text-xs">
                    <span className="text-zinc-400 px-2">Target Store:</span>
                    <button
                      onClick={() => handleStoreChange("apple-app-store")}
                      className={`px-2.5 py-1 rounded font-medium transition-colors ${
                        targetStore === "apple-app-store" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      Apple App Store
                    </button>
                    <button
                      onClick={() => handleStoreChange("google-play")}
                      className={`px-2.5 py-1 rounded font-medium transition-colors ${
                        targetStore === "google-play" ? "bg-amber-600 text-white" : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      Google Play
                    </button>
                  </div>
                </div>
              </div>

              {storeWarning && (
                <div className="p-3 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-lg">
                  {storeWarning}
                </div>
              )}

              {/* Screens Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {screens.map((screen, idx) => {
                  const isSelected = selectedScreenIds.includes(screen.id);
                  return (
                    <div
                      key={screen.id}
                      onClick={() => handleToggleScreen(screen.id)}
                      className={`cursor-pointer rounded-xl border p-4 flex flex-col justify-between transition-all ${
                        isSelected
                          ? "bg-violet-950/20 border-violet-500 shadow-md shadow-violet-900/10"
                          : "bg-zinc-950/40 border-zinc-800 hover:border-zinc-700 opacity-70"
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                            {screen.route}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMoveScreen(idx, "up");
                              }}
                              disabled={idx === 0}
                              className="p-1 hover:bg-zinc-800 rounded text-zinc-400 disabled:opacity-30"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMoveScreen(idx, "down");
                              }}
                              disabled={idx === screens.length - 1}
                              className="p-1 hover:bg-zinc-800 rounded text-zinc-400 disabled:opacity-30"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <div
                              className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                                isSelected
                                  ? "bg-violet-600 border-violet-500 text-white"
                                  : "border-zinc-600 bg-zinc-800"
                              }`}
                            >
                              {isSelected && <Check className="w-3.5 h-3.5" />}
                            </div>
                          </div>
                        </div>

                        <div>
                          <h4 className="text-sm font-semibold text-white">{screen.title}</h4>
                          <p className="text-xs text-zinc-400 mt-1">
                            Observable screen demonstrating real app functionality.
                          </p>
                        </div>

                        {/* Screenshot thumbnail preview */}
                        <div className="h-32 w-full rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden relative">
                          {screen.filePath && screen.filePath.startsWith("data:") ? (
                            <img
                              src={screen.filePath}
                              alt={screen.title}
                              className="h-full w-full object-cover object-top"
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-1 text-zinc-500 text-xs">
                              <Eye className="w-5 h-5 text-zinc-600" />
                              <span>Preview On Disk</span>
                            </div>
                          )}
                        </div>

                        {/* Evidence Tags */}
                        {screen.keyElements && screen.keyElements.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {screen.keyElements.slice(0, 3).map((elem, eIdx) => (
                              <span
                                key={eIdx}
                                className="px-1.5 py-0.5 text-[10px] bg-zinc-800 text-zinc-400 rounded"
                              >
                                {elem}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="pt-3 border-t border-zinc-800/80 mt-3 text-[11px] text-zinc-500 flex justify-between">
                        <span>Position #{idx + 1}</span>
                        <span>{isSelected ? "Selected for Design" : "Unselected"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Step B Action */}
              <div className="flex justify-end pt-4 border-t border-zinc-800">
                <button
                  onClick={handleGenerateVariants}
                  disabled={selectedScreenIds.length === 0}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-medium text-sm transition-colors shadow-lg shadow-violet-900/20"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Generate {variantCount} Variants per Screen</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            /* STEP D & E: Multi-Variant Comparison & Editor */
            <div className="space-y-6">
              {/* Screen Navigator Tabs */}
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3 gap-2 overflow-x-auto">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400 font-medium mr-2">Screen:</span>
                  {currentSelectedScreens.map((s, idx) => (
                    <button
                      key={s.id}
                      onClick={() => setActiveScreenIndex(idx)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                        activeScreenIndex === idx
                          ? "bg-violet-600 text-white"
                          : "bg-zinc-800 text-zinc-400 hover:text-white"
                      }`}
                    >
                      <span>#{idx + 1}</span>
                      <span className="truncate max-w-[120px]">{s.title}</span>
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleOpenAllFavoritesInEditor}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    Open Approved Project in Editor
                  </button>
                  <button
                    onClick={handleExportZipInBrowser}
                    disabled={isExporting}
                    className="flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {isExporting ? "Packaging ZIP…" : "Export ZIP Archive"}
                  </button>
                </div>
              </div>

              {/* Variants Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {activeVariants.map((variant) => {
                  const isFavorite = favoriteVariantIds[activeScreen?.id || ""] === variant.id;
                  const gradient = gradientPresets.find(
                    (p) => p.id === variant.visualComposition.gradientPresetId,
                  );

                  return (
                    <div
                      key={variant.id}
                      className={`rounded-xl border flex flex-col justify-between overflow-hidden transition-all ${
                        isFavorite
                          ? "border-violet-500 bg-zinc-900 shadow-lg shadow-violet-900/15"
                          : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700"
                      }`}
                    >
                      {/* Variant Header */}
                      <div className="p-3 border-b border-zinc-800/80 bg-zinc-950/40 flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-white">{variant.name}</span>
                            {isFavorite && (
                              <span className="px-1.5 py-0.2 text-[9px] bg-violet-600 text-white rounded">
                                Favorite
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-zinc-400 line-clamp-1">{variant.description}</p>
                        </div>
                        <button
                          onClick={() => handleSelectFavorite(variant.id)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            isFavorite ? "text-yellow-400 bg-yellow-400/10" : "text-zinc-500 hover:text-zinc-300"
                          }`}
                          title={isFavorite ? "Selected Favorite" : "Select Favorite"}
                        >
                          <Star className={`w-4 h-4 ${isFavorite ? "fill-yellow-400" : ""}`} />
                        </button>
                      </div>

                      {/* Mini Visual Preview */}
                      <div
                        className="h-44 w-full relative flex flex-col items-center justify-start p-3 overflow-hidden"
                        style={{
                          background:
                            variant.visualComposition.backgroundMode === "gradient" && gradient
                              ? `linear-gradient(135deg, ${gradient.from}, ${gradient.to})`
                              : variant.visualComposition.backgroundColor,
                        }}
                      >
                        {/* Headline Preview */}
                        <div
                          className="text-center font-bold text-xs line-clamp-2 max-w-[90%] z-10 drop-shadow-sm"
                          style={{ color: variant.visualComposition.textColor }}
                          dangerouslySetInnerHTML={{ __html: variant.copy.headline }}
                        />

                        {/* Device Mockup representation */}
                        <div
                          className="mt-3 w-28 h-40 rounded-xl border-2 border-zinc-900 bg-black shadow-2xl relative overflow-hidden transition-transform duration-300"
                          style={{
                            transform: `scale(${variant.visualComposition.deviceScale / 100}) translateY(${variant.visualComposition.deviceOffsetY}px) rotate(${variant.visualComposition.deviceRotation}deg) rotateY(${variant.visualComposition.rotateY}deg) rotateX(${variant.visualComposition.rotateX}deg)`,
                          }}
                        >
                          {variant.sourceScreen.filePath && variant.sourceScreen.filePath.startsWith("data:") ? (
                            <img
                              src={variant.sourceScreen.filePath}
                              alt="screen preview"
                              className="w-full h-full object-cover object-top"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-600">
                              App Screen
                            </div>
                          )}
                        </div>
                      </div>

                      {/* In-Place Controls */}
                      <div className="p-3 space-y-2.5 text-xs bg-zinc-900/70 border-t border-zinc-800">
                        {/* Headline Edit */}
                        <div>
                          <label className="text-[10px] text-zinc-400 font-medium">Headline</label>
                          <input
                            type="text"
                            value={variant.copy.headline}
                            onChange={(e) =>
                              handleUpdateVariant(variant.id, {
                                copy: { ...variant.copy, headline: e.target.value },
                              })
                            }
                            className="w-full mt-0.5 px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-violet-500"
                          />
                        </div>

                        {/* Subheadline Edit */}
                        <div>
                          <label className="text-[10px] text-zinc-400 font-medium">Subheadline</label>
                          <input
                            type="text"
                            value={variant.copy.subheadline}
                            onChange={(e) =>
                              handleUpdateVariant(variant.id, {
                                copy: { ...variant.copy, subheadline: e.target.value },
                              })
                            }
                            className="w-full mt-0.5 px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-violet-500"
                          />
                        </div>

                        {/* Gradient or Background Selector */}
                        <div>
                          <label className="text-[10px] text-zinc-400 font-medium">Gradient Preset</label>
                          <select
                            value={variant.visualComposition.gradientPresetId || "sunset"}
                            onChange={(e) =>
                              handleUpdateVariant(variant.id, {
                                visualComposition: {
                                  ...variant.visualComposition,
                                  backgroundMode: "gradient",
                                  gradientPresetId: e.target.value as any,
                                },
                              })
                            }
                            className="w-full mt-0.5 px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-violet-500"
                          >
                            {gradientPresets.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.label} ({g.from} → {g.to})
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Device Model Selector */}
                        <div>
                          <label className="text-[10px] text-zinc-400 font-medium">Device Model</label>
                          <select
                            value={variant.deviceModel}
                            onChange={(e) =>
                              handleUpdateVariant(variant.id, {
                                deviceModel: e.target.value,
                              })
                            }
                            className="w-full mt-0.5 px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-white focus:outline-none focus:border-violet-500"
                          >
                            {devices.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* 3D Tilt Sliders */}
                        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-zinc-800/60">
                          <div>
                            <span className="text-[10px] text-zinc-500">Yaw: {variant.visualComposition.rotateY}°</span>
                            <input
                              type="range"
                              min="-30"
                              max="30"
                              value={variant.visualComposition.rotateY}
                              onChange={(e) =>
                                handleUpdateVariant(variant.id, {
                                  visualComposition: {
                                    ...variant.visualComposition,
                                    rotateY: Number(e.target.value),
                                  },
                                })
                              }
                              className="w-full h-1 bg-zinc-700 rounded accent-violet-500"
                            />
                          </div>
                          <div>
                            <span className="text-[10px] text-zinc-500">Pitch: {variant.visualComposition.rotateX}°</span>
                            <input
                              type="range"
                              min="-30"
                              max="30"
                              value={variant.visualComposition.rotateX}
                              onChange={(e) =>
                                handleUpdateVariant(variant.id, {
                                  visualComposition: {
                                    ...variant.visualComposition,
                                    rotateX: Number(e.target.value),
                                  },
                                })
                              }
                              className="w-full h-1 bg-zinc-700 rounded accent-violet-500"
                            />
                          </div>
                        </div>

                        {/* Open in Main Editor */}
                        <button
                          onClick={() => handleOpenInEditor(variant)}
                          className="w-full mt-2 py-1.5 px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-medium flex items-center justify-center gap-1.5 transition-colors border border-zinc-700"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Open in AppShots Canvas</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StudioModal;
