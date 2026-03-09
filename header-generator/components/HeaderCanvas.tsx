"use client";

import {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";
import { CANVAS_DISPLAY_W, CANVAS_DISPLAY_H } from "@/lib/constants";
import { templates } from "@/lib/templates";

export interface SelectedInfo {
  type: "textbox" | "image";
  left: number;
  top: number;
  text?: string;
  fontSize?: number;
  fontWeight?: string;
  textAlign?: string;
  fill?: string;
  opacity?: number;
  scaleX?: number;
  scaleY?: number;
}

export interface CanvasHandle {
  addText: () => void;
  addLogo: (dataUrl: string) => void;
  deleteSelected: () => void;
  updateSelected: (props: Record<string, unknown>) => void;
  toDataURL: () => string;
  getSelectedInfo: () => SelectedInfo | null;
  loadTemplate: (templateId?: string) => void;
  undo: () => void;
  redo: () => void;
}

interface Props {
  onSelectionChange: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FabricModule = typeof import("fabric");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FabricCanvas = any;

const MAX_HISTORY = 50;

const HeaderCanvas = forwardRef<CanvasHandle, Props>(function HeaderCanvas(
  { onSelectionChange },
  ref,
) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas>(null);
  const fabricModRef = useRef<FabricModule | null>(null);
  const onSelRef = useRef(onSelectionChange);
  onSelRef.current = onSelectionChange;

  // ── Undo/redo history ──
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const isRestoringRef = useRef(false);

  const saveState = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || isRestoringRef.current) return;
    const json = JSON.stringify(canvas.toJSON());
    const idx = historyIndexRef.current;
    historyRef.current = historyRef.current.slice(0, idx + 1);
    historyRef.current.push(json);
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    }
    historyIndexRef.current = historyRef.current.length - 1;
  }, []);

  const restoreState = useCallback((json: string) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    isRestoringRef.current = true;
    canvas.loadFromJSON(json).then(() => {
      canvas.requestRenderAll();
      isRestoringRef.current = false;
      onSelRef.current();
    });
  }, []);

  const readSelected = useCallback((): SelectedInfo | null => {
    const canvas = fabricRef.current;
    if (!canvas) return null;
    const obj = canvas.getActiveObject();
    if (!obj) return null;

    const base: SelectedInfo = {
      type: obj.type === "textbox" ? "textbox" : "image",
      left: Math.round(obj.left ?? 0),
      top: Math.round(obj.top ?? 0),
      opacity: obj.opacity ?? 1,
      scaleX: obj.scaleX ?? 1,
      scaleY: obj.scaleY ?? 1,
    };
    if (obj.type === "textbox") {
      base.text = obj.text ?? "";
      base.fontSize = obj.fontSize ?? 24;
      base.fontWeight = obj.fontWeight ?? "normal";
      base.textAlign = obj.textAlign ?? "left";
      base.fill = (obj.fill as string) ?? "#000000";
    }
    return base;
  }, []);

  const notify = useCallback(() => onSelRef.current(), []);

  const notifyAndSave = useCallback(() => {
    onSelRef.current();
    saveState();
  }, [saveState]);

  useEffect(() => {
    let canvas: FabricCanvas;
    let disposed = false;

    import("fabric").then((fabric) => {
      if (disposed) return;
      fabricModRef.current = fabric;

      // fabric.js v7 changed default origin to 'center' — restore v6 behavior
      fabric.FabricObject.ownDefaults.originX = "left";
      fabric.FabricObject.ownDefaults.originY = "top";

      canvas = new fabric.Canvas(canvasElRef.current!, {
        width: CANVAS_DISPLAY_W,
        height: CANVAS_DISPLAY_H,
        backgroundColor: "#ffffff",
        preserveObjectStacking: true,
      });
      fabricRef.current = canvas;

      canvas.on("selection:created", notify);
      canvas.on("selection:updated", notify);
      canvas.on("selection:cleared", notify);
      canvas.on("object:modified", notifyAndSave);
      canvas.on("text:changed", notifyAndSave);
    });

    return () => {
      disposed = true;
      canvas?.dispose();
    };
  }, [notify, notifyAndSave]);

  // Keyboard: delete + undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      // Undo: Ctrl+Z / Cmd+Z
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const idx = historyIndexRef.current;
        if (idx > 0) {
          historyIndexRef.current = idx - 1;
          restoreState(historyRef.current[idx - 1]);
        }
        return;
      }

      // Redo: Ctrl+Shift+Z / Cmd+Shift+Z  or  Ctrl+Y
      if (
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "z") ||
        ((e.ctrlKey || e.metaKey) && e.key === "y")
      ) {
        e.preventDefault();
        const idx = historyIndexRef.current;
        if (idx < historyRef.current.length - 1) {
          historyIndexRef.current = idx + 1;
          restoreState(historyRef.current[idx + 1]);
        }
        return;
      }

      // Delete
      if (e.key === "Delete" || e.key === "Backspace") {
        if (isInput) return;
        const canvas = fabricRef.current;
        if (!canvas) return;
        const active = canvas.getActiveObject();
        if (!active) return;
        if (active.type === "textbox" && active.isEditing) return;
        canvas.remove(active);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        notifyAndSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [notifyAndSave, restoreState]);

  useImperativeHandle(
    ref,
    () => ({
      addText: () => {
        const fabric = fabricModRef.current;
        const canvas = fabricRef.current;
        if (!fabric || !canvas) return;
        const text = new fabric.Textbox("New Text", {
          left: CANVAS_DISPLAY_W / 2 - 150,
          top: CANVAS_DISPLAY_H / 2 - 20,
          width: 300,
          fontSize: 18,
          fontFamily: "Arial, sans-serif",
          fill: "#000000",
          textAlign: "center",
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        canvas.requestRenderAll();
        notifyAndSave();
      },
      addLogo: (dataUrl: string) => {
        const fabric = fabricModRef.current;
        const canvas = fabricRef.current;
        if (!fabric || !canvas) return;
        fabric.FabricImage.fromURL(dataUrl).then(
          (img: InstanceType<typeof fabric.FabricImage>) => {
            img.scaleToHeight(CANVAS_DISPLAY_H * 0.3);
            img.set({ left: 20, top: 20 });
            canvas.add(img);
            canvas.setActiveObject(img);
            canvas.requestRenderAll();
            notifyAndSave();
          },
        );
      },
      deleteSelected: () => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const active = canvas.getActiveObject();
        if (active) {
          canvas.remove(active);
          canvas.discardActiveObject();
          canvas.requestRenderAll();
          notifyAndSave();
        }
      },
      updateSelected: (props: Record<string, unknown>) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const active = canvas.getActiveObject();
        if (active) {
          active.set(props);
          canvas.requestRenderAll();
          notifyAndSave();
        }
      },
      toDataURL: () => {
        return (
          fabricRef.current?.toDataURL({
            format: "png",
            multiplier: 1,
          }) ?? ""
        );
      },
      getSelectedInfo: readSelected,
      loadTemplate: (templateId?: string) => {
        const fabric = fabricModRef.current;
        const canvas = fabricRef.current;
        if (!fabric || !canvas) return;

        const tmpl =
          templates.find((t) => t.id === (templateId ?? "classic")) ??
          templates[0];
        canvas.clear();
        canvas.backgroundColor = "#ffffff";

        for (const cfg of tmpl.objects()) {
          if (cfg.type === "textbox") {
            const { type: _, text, ...rest } = cfg;
            canvas.add(new fabric.Textbox(text ?? "", rest));
          }
        }

        canvas.discardActiveObject();
        canvas.requestRenderAll();

        // Reset history
        historyRef.current = [];
        historyIndexRef.current = -1;
        saveState();
      },
      undo: () => {
        const idx = historyIndexRef.current;
        if (idx > 0) {
          historyIndexRef.current = idx - 1;
          restoreState(historyRef.current[idx - 1]);
        }
      },
      redo: () => {
        const idx = historyIndexRef.current;
        if (idx < historyRef.current.length - 1) {
          historyIndexRef.current = idx + 1;
          restoreState(historyRef.current[idx + 1]);
        }
      },
    }),
    [readSelected, notifyAndSave, saveState, restoreState],
  );

  return (
    <div className="border-2 border-dashed border-gray-300 shadow-sm shrink-0">
      <canvas ref={canvasElRef} />
    </div>
  );
});

export default HeaderCanvas;
