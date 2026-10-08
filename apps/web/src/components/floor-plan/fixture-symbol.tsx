import { memo } from "react";
import { DEFAULT_STAIR_STEPS } from "@/lib/floor-plan/model";

// Symbols share a 100 × 100 local coordinate system; physical dimensions live in the model.
const SymbolArtwork = memo(function SymbolArtwork({ symbol, steps = DEFAULT_STAIR_STEPS, dark = false, monochrome = false }: { symbol: string; steps?: number; dark?: boolean; monochrome?: boolean }) {
  const fill = (night: string, paper: string) => monochrome ? "#fff" : dark ? night : paper;
  const rect = <rect x="2" y="2" width="96" height="96" rx="5" fill={fill("#22242c", "#fdfdfa")} />;
  switch (symbol) {
    case "stairs": return <g data-stair-steps={steps}><rect width="100" height="100" fill={fill("#22242c", "#fdfdfa")} />{Array.from({ length: steps }, (_, i) => <path key={i} data-stair-step={i + 1} d={`M0 ${(i + 1) * 100 / steps}H100`} />)}<path d="M50 88V12M40 22L50 12L60 22" strokeWidth="2.5" /></g>;
    case "bed": return <>{rect}<rect x="8" y="10" width="39" height="18" rx="4" /><rect x="53" y="10" width="39" height="18" rx="4" /><path d="M3 34H97M3 40H97" /><rect x="8" y="42" width="84" height="51" rx="2" fill={fill("#303440", "#e6ebe7")} /></>;
    case "sofa": return <>{rect}<rect x="12" y="8" width="76" height="19" rx="4" fill={fill("#303440", "#dee6e2")} /><rect x="3" y="12" width="11" height="80" rx="3" /><rect x="86" y="12" width="11" height="80" rx="3" /><path d="M15 78H85M50 28V77" /><path d="M10 98V100M90 98V100" /></>;
    case "table": return <><rect x="3" y="3" width="94" height="94" rx="10" fill={fill("#36302e", "#ece3d6")} /><circle cx="10" cy="10" r="3" /><circle cx="90" cy="10" r="3" /><circle cx="10" cy="90" r="3" /><circle cx="90" cy="90" r="3" /></>;
    case "chair": return <><rect x="9" y="10" width="82" height="83" rx="6" fill={fill("#22242c", "#fdfdfa")} /><rect x="5" y="2" width="90" height="19" rx="5" fill={fill("#303440", "#dee6e2")} /><path d="M12 90V100M88 90V100" /></>;
    case "desk": return <>{rect}<path d="M72 4V96M73 35H96M73 66H96" /><rect x="14" y="16" width="43" height="30" rx="2" fill={fill("#303440", "#e1e7e5")} /></>;
    case "cabinet": return <>{rect}<path d="M50 3V97M3 87H97M45 43V57M55 43V57" /></>;
    case "tub": return <>{rect}<rect x="9" y="12" width="82" height="76" rx="23" fill={fill("#26343a", "#e6f0ef")} /><circle cx="20" cy="50" r="3" /><path d="M4 41H13M4 59H13" /></>;
    case "toilet": return <><rect x="12" y="2" width="76" height="23" rx="5" fill={fill("#22242c", "#fdfdfa")} /><ellipse cx="50" cy="61" rx="35" ry="37" fill={fill("#22242c", "#fdfdfa")} /><ellipse cx="50" cy="60" rx="25" ry="27" fill={fill("#26343a", "#e6f0ef")} /><circle cx="70" cy="13" r="3" /></>;
    case "shower": return <>{rect}<path d="M5 5L95 95M95 5L5 95" strokeDasharray="3 3" /><circle cx="50" cy="50" r="6" fill={fill("#26343a", "#e6f0ef")} /><path d="M27 2V13H40M98 4V96" /></>;
    case "sink": return <>{rect}<rect x="15" y="22" width="70" height="66" rx="14" fill={fill("#26343a", "#e6f0ef")} /><circle cx="50" cy="60" r="4" /><path d="M50 8V31M36 13H64" /></>;
    case "bar": return <><rect x="2" y="22" width="96" height="56" rx="10" fill={fill("#22242c", "#fdfdfa")} /><path d="M12 0V100M88 0V100" /></>;
    case "range": return <>{rect}<path d="M3 12H97" /><circle cx="27" cy="35" r="17" /><circle cx="73" cy="35" r="17" /><circle cx="27" cy="77" r="17" /><circle cx="73" cy="77" r="17" /></>;
    case "fridge": return <>{rect}<path d="M3 26H97M17 15H40M17 38H40" /><text x="50" y="68" textAnchor="middle" fontSize="18" stroke="none" fill="currentColor">REF</text></>;
    case "appliance": return <>{rect}<path d="M3 15H97M26 8H74" /><text x="50" y="60" textAnchor="middle" fontSize="16" stroke="none" fill="currentColor">DW</text></>;
    case "washer": return <>{rect}<path d="M3 17H97" /><circle cx="50" cy="58" r="31" fill={fill("#26343a", "#e6f0ef")} /><circle cx="50" cy="58" r="24" /><circle cx="83" cy="10" r="3" /></>;
    case "heater": return <><circle cx="50" cy="50" r="46" fill={fill("#22242c", "#fdfdfa")} /><circle cx="50" cy="50" r="37" /><text x="50" y="58" textAnchor="middle" fontSize="22" stroke="none" fill="currentColor">WH</text></>;
    case "outlet": case "gfci": return <><circle cx="50" cy="50" r="43" fill={fill("#22242c", "#fdfdfa")} /><path d="M36 12V88M64 12V88" />{symbol === "gfci" ? <text x="50" y="130" textAnchor="middle" fontSize="42" stroke="none" fill="currentColor">G</text> : null}</>;
    case "switch": return <text x="50" y="82" textAnchor="middle" fontFamily="serif" fontSize="100" stroke="none" fill="currentColor">S</text>;
    case "light": return <><circle cx="50" cy="50" r="44" fill={fill("#22242c", "#fdfdfa")} /><path d="M18 18L82 82M82 18L18 82" /></>;
    case "fan": return <><circle cx="50" cy="50" r="9" fill={fill("#22242c", "#fdfdfa")} />{[0, 120, 240].map(a => <path key={a} transform={`rotate(${a} 50 50)`} d="M46 40L28 5Q50 -4 56 17L56 40Z" fill={fill("#303440", "#e6ebe7")} />)}</>;
    case "panel": return <>{rect}<path d="M10 10L90 90M90 10L10 90" /></>;
    case "smoke": return <><circle cx="50" cy="50" r="43" fill={fill("#22242c", "#fdfdfa")} /><text x="50" y="66" textAnchor="middle" fontSize="43" stroke="none" fill="currentColor">SD</text></>;
    case "drain": return <><circle cx="50" cy="50" r="44" fill={fill("#22242c", "#fdfdfa")} /><path d="M20 27H80M10 42H90M10 57H90M20 72H80" /></>;
    default: return rect;
  }
});

// Fit each physical silhouette to the model dimensions. Decorative padding in
// the library symbol must not become a visible gap when an object meets a wall.
const SYMBOL_BOUNDS: Record<string, [number, number, number, number]> = {
  stairs: [0, 0, 100, 100],
  sofa: [2, 2, 96, 98], table: [3, 3, 94, 94], chair: [5, 2, 90, 98],
  toilet: [12, 2, 76, 96], bar: [2, 0, 96, 100], heater: [4, 4, 92, 92],
  outlet: [7, 7, 86, 86], gfci: [7, 7, 86, 86], light: [6, 6, 88, 88],
  smoke: [7, 7, 86, 86], drain: [6, 6, 88, 88], fan: [0, 0, 100, 100], switch: [0, 0, 100, 100],
};
export const FixtureSymbol = memo(function FixtureSymbol(props: { symbol: string; steps?: number; dark?: boolean; monochrome?: boolean }) {
  const [x, y, width, height] = SYMBOL_BOUNDS[props.symbol] ?? [2, 2, 96, 96];
  return <g transform={`scale(${100 / width} ${100 / height}) translate(${-x} ${-y})`}><SymbolArtwork {...props} /></g>;
});
