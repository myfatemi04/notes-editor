import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Buffer } from "buffer";

type Point = {
  x: number;
  y: number;
  thickness: number;
  time: number;
};

export interface Stroke {
  points: Point[];
  r: number;
  g: number;
  b: number;
  erase: boolean;
  touchIdentifier?: number;
}

const SCALE = 8;
const LITTLE_ENDIAN = true;

function renderTriplet(
  context: CanvasRenderingContext2D,
  p0: Point,
  p1: Point,
  p2: Point,
  r: number,
  g: number,
  b: number,
  erase: boolean
) {
  const cp1x = ((p0.x + p1.x) / 2) * SCALE;
  const cp1y = ((p0.y + p1.y) / 2) * SCALE;
  const cp2x = ((p1.x + p2.x) / 2) * SCALE;
  const cp2y = ((p1.y + p2.y) / 2) * SCALE;

  context.lineWidth = (p0.thickness + p1.thickness + p2.thickness) / 3;
  context.lineCap = "round";
  context.strokeStyle = erase ? "white" : `rgb(${r}, ${g}, ${b})`;

  context.beginPath();
  context.moveTo(cp1x, cp1y);
  context.quadraticCurveTo(p1.x * SCALE, p1.y * SCALE, cp2x, cp2y);
  context.stroke();
}

export const CanvasHostContext = createContext({
  b64: "",
  setB64: (b64: string) => {},
  editing: false,
});

async function serialize(strokes: Stroke[]): Promise<string> {
  const header = [
    // 0. magic number
    0x4e,
    0x4f,
    0x54,
    0x45, // "NOTE"
    // 1. version
    1,
    // 2. number of *additional* colors (max 254, 0 is reserved for eraser, 1 is reserved for black)
    0,
  ];
  const colors = new Map();
  colors.set("eraser", 0);
  colors.set("0,0,0", 1);
  for (const stroke of strokes) {
    const colorKey = stroke.erase
      ? "eraser"
      : `${stroke.r},${stroke.g},${stroke.b}`;
    if (!colors.has(colorKey)) {
      colors.set(colorKey, colors.size);
      header[5]++;
      header.push(stroke.r);
      header.push(stroke.g);
      header.push(stroke.b);
    }
  }

  // 4: number of strokes
  // for each stroke:
  //   4: number of points
  //   1: color index
  //   (2 + 2 + 1) * number of points: x, y, thickness
  let allocationSize = 4;
  for (const stroke of strokes) {
    allocationSize += 4; // number of points
    allocationSize += stroke.points.length * (2 + 2 + 1 + 1);
  }
  const strokeBytes = new Uint8Array(allocationSize);
  const view = new DataView(strokeBytes.buffer);
  let strokeBytesOffset = 0;

  view.setUint32(0, strokes.length, LITTLE_ENDIAN);
  strokeBytesOffset += 4;

  for (const stroke of strokes) {
    view.setUint32(strokeBytesOffset, stroke.points.length, LITTLE_ENDIAN);
    strokeBytesOffset += 4;

    const colorKey = stroke.erase
      ? "eraser"
      : `${stroke.r},${stroke.g},${stroke.b}`;
    view.setUint8(strokeBytesOffset, colors.get(colorKey));
    strokeBytesOffset += 1;

    for (const p of stroke.points) {
      view.setUint16(strokeBytesOffset, Math.round(p.x), LITTLE_ENDIAN);
      strokeBytesOffset += 2;
      view.setUint16(strokeBytesOffset, Math.round(p.y), LITTLE_ENDIAN);
      strokeBytesOffset += 2;
      view.setUint8(strokeBytesOffset, Math.round(p.thickness));
      strokeBytesOffset += 1;
    }
  }

  // @ts-ignore Blob stuff is weird
  const blob = new Blob([new Uint8Array(header), strokeBytes], {
    type: "application/octet-stream",
  });
  return Buffer.from(await blob.arrayBuffer()).toString("base64");
}

function deserialize(b64: string): Stroke[] {
  const buf = Buffer.from(b64, "base64");

  const colors = [
    { r: 0, g: 0, b: 0, erase: true },
    { r: 0, g: 0, b: 0, erase: false },
  ];

  let offset = 0;

  if (
    buf.at(0) != 0x4e ||
    buf.at(1) != 0x4f ||
    buf.at(2) != 0x54 ||
    buf.at(3) != 0x45
  ) {
    throw new Error("Invalid magic number");
  }
  offset += 4;

  const version = buf.at(4);
  if (version !== 1) {
    throw new Error("Unsupported version");
  }
  offset += 1;

  const colorCount = buf.at(5)!;
  offset += 1;

  for (let i = 0; i < colorCount; i++) {
    const r = buf.at(offset)!;
    const g = buf.at(offset + 1)!;
    const b = buf.at(offset + 2)!;
    offset += 3;
    colors.push({ r, g, b, erase: false });
  }

  const strokes: Stroke[] = [];
  const strokeBytes = new DataView(buf.buffer);
  const numStrokes = strokeBytes.getUint32(offset, LITTLE_ENDIAN);
  offset += 4;

  for (let i = 0; i < numStrokes; i++) {
    // number of points (Uint32)
    const numPoints = strokeBytes.getUint32(offset, LITTLE_ENDIAN);
    offset += 4;
    const colorIndex = strokeBytes.getUint8(offset);
    offset += 1;

    const points: Point[] = [];
    for (let j = 0; j < numPoints; j++) {
      const x = strokeBytes.getUint16(offset, LITTLE_ENDIAN);
      offset += 2;
      const y = strokeBytes.getUint16(offset, LITTLE_ENDIAN);
      offset += 2;
      const thickByte = strokeBytes.getUint8(offset);
      offset += 1;
      // Determine color index
      // Each point triple is [x,y,thickness] — color is per stroke,
      // so you may need to pass it separately if needed.
      points.push({
        x,
        y,
        thickness: thickByte,
        time: 0,
      });
    }

    const color = colors[colorIndex];
    strokes.push({
      r: color.r,
      g: color.g,
      b: color.b,
      erase: color.erase,
      points,
    });
  }

  offset += strokeBytes.byteLength;

  return strokes;
}

const COLOR_PALETTE = [
  { r: 0, g: 0, b: 0, erase: true },
  { r: 0, g: 0, b: 0, erase: false },
  // r, g, b
  { r: 255, g: 0, b: 0, erase: false },
  { r: 0, g: 255, b: 0, erase: false },
  { r: 0, g: 0, b: 255, erase: false },
  // gold
  { r: 255, g: 215, b: 0, erase: false },
  // orange
  { r: 255, g: 165, b: 0, erase: false },
  // purple
  { r: 128, g: 0, b: 128, erase: false },
  // pink
  { r: 255, g: 192, b: 203, erase: false },
];

export default function Canvas() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStroke = useRef<Stroke | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const [fakeConsole, setFakeConsole] = useState<string>("");
  const [colorPaletteIndex, setColorPaletteIndex] = useState(1);

  const { b64, setB64, editing } = useContext(CanvasHostContext);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    contextRef.current = context;

    if (!context) {
      alert("Canvas is not supported on your browser.");
      return;
    }

    const translateCoordinates = (clientX: number, clientY: number) => {
      const boundingRect = canvas.getBoundingClientRect();
      const x0 = boundingRect.left;
      const y0 = boundingRect.top;

      const x = (((clientX - x0) / boundingRect.width) * canvas.width) / SCALE;
      const y =
        (((clientY - y0) / boundingRect.height) * canvas.height) / SCALE;
      return { x, y };
    };

    const startStroke = (
      clientX: number,
      clientY: number,
      force: number,
      identifier: number
    ) => {
      const { x, y } = translateCoordinates(clientX, clientY);
      const point = {
        x,
        y,
        thickness: 8 * (force / (window.visualViewport?.scale ?? 1)) + 2,
        time: Date.now(),
      };

      const { r, g, b, erase } = COLOR_PALETTE[colorPaletteIndex];

      activeStroke.current = {
        points: [point],
        touchIdentifier: identifier,
        r,
        g,
        b,
        erase,
      };

      context.fillStyle = erase ? "white" : `rgb(${r}, ${g}, ${b})`;
      context.beginPath();
      context.ellipse(
        point.x * SCALE,
        point.y * SCALE,
        point.thickness / 2,
        point.thickness / 2,
        0,
        0,
        2 * Math.PI
      );
      context.fill();
    };

    const moveStroke = (clientX: number, clientY: number, force: number) => {
      if (!activeStroke.current) return;

      const { x, y } = translateCoordinates(clientX, clientY);

      activeStroke.current.points.push({
        x,
        y,
        thickness: 8 * (force / (window.visualViewport?.scale ?? 1)) + 2,
        time: Date.now(),
      });

      const { r, g, b, erase } = activeStroke.current;

      const len = activeStroke.current.points.length;
      const p0 = activeStroke.current.points.at(Math.max(0, len - 3))!;
      const p1 = activeStroke.current.points.at(Math.max(0, len - 2))!;
      const p2 = activeStroke.current.points.at(Math.max(0, len - 1))!;
      renderTriplet(context, p0, p1, p2, r, g, b, erase);
    };

    const endStroke = () => {
      if (!activeStroke.current) return;
      if (activeStroke.current.points.length > 0) {
        const currentStroke = activeStroke.current;
        setStrokes((strokes) => {
          serialize([...strokes, currentStroke]).then((b64) => {
            setB64(b64);
          });

          return [...strokes, currentStroke];
        });
      }
      activeStroke.current = null;
    };

    const onTouchStart = (e: TouchEvent) => {
      // Only supported by Safari.
      // @ts-expect-error `touchType` not declared.
      const touchType = e.changedTouches[0].touchType ?? "direct";
      if (touchType !== "stylus") {
        return;
      }

      e.preventDefault();

      const touch = e.changedTouches[0];
      startStroke(touch.clientX, touch.clientY, touch.force, touch.identifier);
    };

    const onTouchEnd = (e: TouchEvent) => {
      const touch = [...e.changedTouches].filter(
        (t) => t.identifier === activeStroke.current?.touchIdentifier
      )[0];
      if (!touch) return;
      endStroke();
    };

    const onTouchMove = (e: TouchEvent) => {
      const touch = [...e.changedTouches].filter(
        (t) => t.identifier === activeStroke.current?.touchIdentifier
      )[0];
      if (!touch) return;
      moveStroke(touch.clientX, touch.clientY, touch.force);
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      // Assume a mouse has no pressure sensitivity.
      startStroke(e.clientX, e.clientY, 1, -1);
    };

    const onMouseMove = (e: MouseEvent) => {
      moveStroke(e.clientX, e.clientY, 1);
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      endStroke();
    };

    canvas.addEventListener("touchstart", onTouchStart);
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("touchmove", onTouchMove);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", onMouseUp);

    if (b64) {
      const strokes = deserialize(b64);
      setStrokes(strokes);
      render(strokes);
    }

    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mouseleave", onMouseUp);
    };
  }, [colorPaletteIndex, b64]);

  const render = useCallback(
    (strokes: Stroke[]) => {
      const context = contextRef.current;
      const canvas = canvasRef.current;

      if (!context || !canvas) {
        return;
      }

      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);

      for (const stroke of strokes) {
        for (let i = 0; i < stroke.points.length - 2; i++) {
          const [p0, p1, p2] = stroke.points.slice(i, i + 3);
          renderTriplet(
            context,
            p0,
            p1,
            p2,
            stroke.r,
            stroke.g,
            stroke.b,
            stroke.erase
          );
        }
      }
    },
    [strokes]
  );

  const undo = useCallback(() => {
    const newStrokes = strokes.slice(0, -1);
    setStrokes(newStrokes);
    render(newStrokes);
    serialize(newStrokes).then(setB64);
  }, [strokes, render]);

  return (
    <div
      style={{
        marginTop: 4,
        marginBottom: 4,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: editing ? "flex" : "none",
          flexDirection: "row",
          paddingBottom: 4,
          paddingTop: 4,
        }}
      >
        <button onClick={undo} style={{ marginRight: 4 }} className="button">
          Undo
        </button>
        {COLOR_PALETTE.map((color, i) => {
          const selected = i === colorPaletteIndex;
          return (
            <div
              key={i}
              onClick={() => setColorPaletteIndex(i)}
              className="button"
              style={{
                backgroundColor: color.erase
                  ? "white"
                  : `rgb(${color.r}, ${color.g}, ${color.b})`,
                borderBottom: selected ? "4px solid white" : "1px solid gray",
                borderTop: selected ? "1px solid gray" : 0,
                borderLeft: selected ? "1px solid gray" : 0,
                borderRight: selected ? "1px solid gray" : 0,
                marginRight: 4,
                cursor: "pointer",
                width: "32px",
              }}
            >
              {color.erase ? "X" : ""}
            </div>
          );
        })}

        <button
          onClick={() => {
            if (confirm("Are you sure you want to remove this block?")) {
              setB64("");
            }
          }}
          style={{ marginRight: 4 }}
          className="button"
        >
          Remove canvas
        </button>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          border: "1px solid black",
          aspectRatio: "4 / 3",
          width: "calc(max(600px, calc(100% - 24px)))",
        }}
        width={800 * SCALE}
        height={600 * SCALE}
      />
      {strokes.length}
      {fakeConsole}
    </div>
  );
}
