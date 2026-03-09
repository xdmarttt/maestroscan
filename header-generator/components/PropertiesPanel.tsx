"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { CanvasHandle, SelectedInfo } from "./HeaderCanvas";

interface PropertiesPanelProps {
  selected: SelectedInfo | null;
  canvasRef: React.RefObject<CanvasHandle | null>;
}

export default function PropertiesPanel({
  selected,
  canvasRef,
}: PropertiesPanelProps) {
  if (!selected) {
    return (
      <div className="w-64 border-l p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Select an element to edit its properties
        </p>
      </div>
    );
  }

  const update = (props: Record<string, unknown>) => {
    canvasRef.current?.updateSelected(props);
  };

  return (
    <div className="w-64 border-l p-4 overflow-y-auto flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {selected.type === "textbox" ? "Text" : "Image"}
        </h2>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => canvasRef.current?.deleteSelected()}
        >
          Delete
        </Button>
      </div>
      <Separator />

      {/* Position */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">X</Label>
          <Input
            type="number"
            value={selected.left}
            onChange={(e) => update({ left: Number(e.target.value) })}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-xs">Y</Label>
          <Input
            type="number"
            value={selected.top}
            onChange={(e) => update({ top: Number(e.target.value) })}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <Separator />

      {selected.type === "textbox" && (
        <TextProps selected={selected} update={update} />
      )}
      {selected.type === "image" && (
        <ImageProps selected={selected} update={update} />
      )}
    </div>
  );
}

function TextProps({
  selected,
  update,
}: {
  selected: SelectedInfo;
  update: (props: Record<string, unknown>) => void;
}) {
  return (
    <>
      <div>
        <Label className="text-xs">Content</Label>
        <textarea
          className="w-full border rounded p-2 text-sm min-h-[60px] resize-y bg-background"
          value={selected.text ?? ""}
          onChange={(e) => update({ text: e.target.value })}
        />
      </div>

      <div>
        <Label className="text-xs">
          Font Size ({selected.fontSize ?? 24})
        </Label>
        <Slider
          min={12}
          max={120}
          step={1}
          value={[selected.fontSize ?? 24]}
          onValueChange={(v) =>
            update({ fontSize: Array.isArray(v) ? v[0] : v })
          }
        />
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={selected.fontWeight === "bold"}
          onCheckedChange={(checked) =>
            update({ fontWeight: checked ? "bold" : "normal" })
          }
        />
        <Label className="text-xs">Bold</Label>
      </div>

      <div>
        <Label className="text-xs">Alignment</Label>
        <Select
          value={selected.textAlign ?? "left"}
          onValueChange={(v) => update({ textAlign: v })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="left">Left</SelectItem>
            <SelectItem value="center">Center</SelectItem>
            <SelectItem value="right">Right</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Color</Label>
        <Input
          type="color"
          value={selected.fill ?? "#000000"}
          onChange={(e) => update({ fill: e.target.value })}
          className="h-8 w-16 p-1"
        />
      </div>
    </>
  );
}

function ImageProps({
  selected,
  update,
}: {
  selected: SelectedInfo;
  update: (props: Record<string, unknown>) => void;
}) {
  const opacityPct = Math.round((selected.opacity ?? 1) * 100);
  return (
    <>
      <div>
        <Label className="text-xs">Opacity ({opacityPct}%)</Label>
        <Slider
          min={10}
          max={100}
          step={5}
          value={[opacityPct]}
          onValueChange={(v) =>
            update({ opacity: (Array.isArray(v) ? v[0] : v) / 100 })
          }
        />
      </div>
    </>
  );
}
