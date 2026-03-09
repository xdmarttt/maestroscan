"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { CanvasHandle } from "./HeaderCanvas";
import { templates } from "@/lib/templates";

interface ElementToolbarProps {
  canvasRef: React.RefObject<CanvasHandle | null>;
}

export default function ElementToolbar({ canvasRef }: ElementToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      canvasRef.current?.addLogo(reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div className="flex flex-col gap-2 p-4 w-56 border-r bg-card overflow-y-auto">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Elements
      </h2>
      <Separator />
      <Button
        variant="outline"
        size="sm"
        onClick={() => canvasRef.current?.addText()}
      >
        + Add Text
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => fileRef.current?.click()}
      >
        + Add Logo
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <Separator className="mt-2" />

      <div className="flex gap-1">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs"
          onClick={() => canvasRef.current?.undo()}
        >
          Undo
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs"
          onClick={() => canvasRef.current?.redo()}
        >
          Redo
        </Button>
      </div>

      <Separator className="mt-2" />

      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Templates
      </h2>
      <div className="flex flex-col gap-1.5">
        {templates.map((t) => (
          <button
            key={t.id}
            className="text-left p-2 rounded border border-border hover:bg-muted/80 transition-colors"
            onClick={() => canvasRef.current?.loadTemplate(t.id)}
          >
            <div className="text-sm font-medium">{t.name}</div>
            <div className="text-xs text-muted-foreground">{t.description}</div>
          </button>
        ))}
      </div>

      <Separator className="mt-2" />
      <p className="text-xs text-muted-foreground">
        Ctrl+Z to undo. Ctrl+Shift+Z to redo. Double-click text to edit inline.
      </p>
    </div>
  );
}
