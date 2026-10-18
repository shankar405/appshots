import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { loadGoogleFonts } from "../lib/google-fonts";
import { EditorProvider } from "../context/EditorContext";
import { EditorLayout } from "../components/EditorLayout";

import { useEditor } from "../context/EditorContext";
import { exportScreenshots } from "../lib/export-utils";

const HeadlessBridge = () => {
  const editor = useEditor();
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as { __APPSHOTS_EDITOR__?: unknown }).__APPSHOTS_EDITOR__ = editor;
      (window as unknown as { __APPSHOTS_EXPORT__?: unknown }).__APPSHOTS_EXPORT__ = exportScreenshots;
    }
  }, [editor]);
  return null;
};

const RouteComponent = () => {
  useEffect(() => {
    loadGoogleFonts();
  }, []);

  return (
    <EditorProvider>
      <HeadlessBridge />
      <EditorLayout />
    </EditorProvider>
  );
};

export const Route = createFileRoute("/")({
  component: RouteComponent,
});
