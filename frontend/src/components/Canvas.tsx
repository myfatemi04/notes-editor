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

function renderTriplet(context, p0, p1, p2) {
  const cp1x = ((p0.x + p1.x) / 2) * SCALE;
  const cp1y = ((p0.y + p1.y) / 2) * SCALE;
  const cp2x = ((p1.x + p2.x) / 2) * SCALE;
  const cp2y = ((p1.y + p2.y) / 2) * SCALE;

  context.lineWidth = ((8 * (p0.force + p1.force + p2.force)) / 3 + 2) * SCALE;
  context.lineCap = "round";
  context.strokeStyle = "black";

  context.beginPath();
  context.moveTo(cp1x, cp1y);
  context.quadraticCurveTo(p1.x * SCALE, p1.y * SCALE, cp2x, cp2y);
  context.stroke();
}

export const CanvasHostContext = createContext({
  b64: "",
  setB64: (b64: string) => {},
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
  const colors = { eraser: 0, "0,0,0": 1 };
  for (const stroke of strokes) {
    const colorKey = stroke.erase
      ? "eraser"
      : `${stroke.r},${stroke.g},${stroke.b}`;
    if (!colors[colorKey]) {
      colors[colorKey] = Object.keys(colors).length + 1;
    }
    header.push(stroke.r);
    header.push(stroke.g);
    header.push(stroke.b);
    header[5]++;
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
    view.setUint8(strokeBytesOffset, colors[colorKey]);
    strokeBytesOffset += 1;

    for (const p of stroke.points) {
      view.setUint16(strokeBytesOffset, Math.round(p.x), LITTLE_ENDIAN);
      strokeBytesOffset += 2;
      view.setUint16(strokeBytesOffset, Math.round(p.y), LITTLE_ENDIAN);
      strokeBytesOffset += 2;
      view.setUint8(strokeBytesOffset, Math.round(p.thickness * 255));
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
  const strokeBytes = new DataView(buf.buffer, offset);
  const numStrokes = strokeBytes.getUint32(0);

  for (let i = 0; i < numStrokes; i++) {
    // number of points (Uint32)
    const numPoints = strokeBytes.getUint32(4 + i * 4, LITTLE_ENDIAN);
    const colorIndex = strokeBytes.getUint8(4 + numStrokes * 4 + i);
    offset += 4;

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
        thickness: thickByte / 255,
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

  const { b64, setB64 } = useContext(CanvasHostContext);

  useEffect(() => {
    if (!b64) {
      return;
    }

    setStrokes(deserialize(b64));
  }, [b64]);

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

    const onTouchStart = (e: TouchEvent) => {
      // Only supported by Safari.
      // @ts-expect-error `touchType` not declared.
      const touchType = e.changedTouches[0].touchType ?? "direct";
      if (touchType !== "stylus") {
        return;
      }

      e.preventDefault();

      const touch = e.changedTouches[0];
      const boundingRect = canvas.getBoundingClientRect();
      const x0 = boundingRect.left;
      const y0 = boundingRect.top;

      const point = {
        x: touch.clientX - x0,
        y: touch.clientY - y0,
        thickness: 8 * (touch.force / (window.visualViewport?.scale ?? 1)) + 2,
        time: Date.now(),
      };

      const { r, g, b, erase } = COLOR_PALETTE[colorPaletteIndex];

      activeStroke.current = {
        points: [point],
        touchIdentifier: touch.identifier,
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
        ((8 * point.thickness + 2) * SCALE) / 2,
        ((8 * point.thickness + 2) * SCALE) / 2,
        0,
        0,
        2 * Math.PI
      );
      context.fill();
    };

    const onTouchEnd = (e: TouchEvent) => {
      // e.preventDefault();

      if (!activeStroke.current) {
        return;
      }

      for (const touch of e.changedTouches) {
        if (activeStroke.current?.touchIdentifier === touch.identifier) {
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
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!activeStroke.current) {
        return;
      }

      for (const touch of e.touches) {
        if (touch.identifier !== activeStroke.current?.touchIdentifier) {
          continue;
        }

        e.preventDefault();

        const boundingRect = canvas.getBoundingClientRect();

        const x = touch.clientX - boundingRect.left;
        const y = touch.clientY - boundingRect.top;

        if (activeStroke.current.points.length > 0) {
          const lastPoint =
            activeStroke.current.points[activeStroke.current.points.length - 1];
          const dx = touch.clientX - boundingRect.left - lastPoint.x;
          const dy = touch.clientY - boundingRect.top - lastPoint.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          // if (
          //   (dist < 3 && Date.now() - lastPoint.time < 200) ||
          //   Date.now() - lastPoint.time < 20
          // ) {
          //   // don't add point if too close to last point
          //   return;
          // }
        }

        activeStroke.current.points.push({
          x,
          y,
          thickness: touch.force / window.visualViewport!.scale,
          time: Date.now(),
        });

        if (activeStroke.current.points.length >= 3) {
          const [p0, p1, p2] = activeStroke.current.points.slice(-3);
          renderTriplet(context, p0, p1, p2);
        }
      }
    };

    canvas.addEventListener("touchstart", onTouchStart);
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("touchmove", onTouchMove);
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }, [colorPaletteIndex]);

  const undo = useCallback(() => {
    setStrokes(strokes.slice(0, -1));

    const context = contextRef.current!;
    const canvas = canvasRef.current!;

    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (const stroke of strokes.slice(0, -1)) {
      for (let i = 0; i < stroke.points.length - 2; i++) {
        const [p0, p1, p2] = stroke.points.slice(i, i + 3);
        renderTriplet(context, p0, p1, p2);
      }
    }
  }, [strokes]);

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "row" }}>
        {COLOR_PALETTE.map((color, i) => {
          const selected = i === colorPaletteIndex;
          return (
            <div
              key={i}
              onClick={() => setColorPaletteIndex(i)}
              style={{
                width: 24,
                height: 24,
                backgroundColor: color.erase
                  ? "white"
                  : `rgb(${color.r}, ${color.g}, ${color.b})`,
                borderBottom: selected ? "2px solid blue" : "1px solid gray",
                borderTop: selected ? "1px solid gray" : 0,
                borderLeft: selected ? "1px solid gray" : 0,
                borderRight: selected ? "1px solid gray" : 0,
                marginRight: 4,
                cursor: "pointer",
              }}
            >
              {color.erase ? "Eraser" : ""}
            </div>
          );
        })}
      </div>
      <button onClick={undo}>Undo</button>
      <canvas
        ref={canvasRef}
        style={{ border: "1px solid black", width: 800, height: 600 }}
        width={800 * SCALE}
        height={600 * SCALE}
      />
      {strokes.length}
      {fakeConsole}
    </div>
  );
}
