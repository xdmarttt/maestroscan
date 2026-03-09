"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import HeaderCanvas from "@/components/HeaderCanvas";
import type { CanvasHandle, SelectedInfo } from "@/components/HeaderCanvas";
import ElementToolbar from "@/components/ElementToolbar";
import PropertiesPanel from "@/components/PropertiesPanel";
import { Button } from "@/components/ui/button";
import { generatePdf } from "@/lib/draw-sheet";

export default function Home() {
  const canvasRef = useRef<CanvasHandle>(null);
  const [selected, setSelected] = useState<SelectedInfo | null>(null);
  // bump version to force re-read of selected info
  const [, setVersion] = useState(0);

  const handleSelectionChange = useCallback(() => {
    const info = canvasRef.current?.getSelectedInfo() ?? null;
    setSelected(info);
    setVersion((v) => v + 1);
  }, []);

  // Load default template on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      canvasRef.current?.loadTemplate();
    }, 300); // wait for fabric.js to init
    return () => clearTimeout(timer);
  }, []);

  const handleExportPng = () => {
    const dataUrl = canvasRef.current?.toDataURL();
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.download = "header.png";
    link.href = dataUrl;
    link.click();
  };

  const handleExportPdf = async () => {
    const headerDataUrl = canvasRef.current?.toPreviewDataURL();
    if (!headerDataUrl) return;
    await generatePdf(headerDataUrl, 50, 4);
  };

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b px-4 py-2 bg-card">
        <h1 className="text-lg font-semibold">Header Generator</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportPng}>
            Export PNG
          </Button>
          <Button size="sm" onClick={handleExportPdf}>
            View PDF
          </Button>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left toolbar */}
        <ElementToolbar canvasRef={canvasRef} />

        {/* Center canvas */}
        <div className="flex-1 flex items-center justify-center bg-muted/50 overflow-auto p-8">
          <HeaderCanvas
            ref={canvasRef}
            onSelectionChange={handleSelectionChange}
          />
        </div>

        {/* Right properties */}
        <PropertiesPanel selected={selected} canvasRef={canvasRef} />
      </div>
    </div>
  );
}
