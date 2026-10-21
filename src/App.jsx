import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  TrainFront, Search, MapPin, Clock3, RefreshCw, X, CircleCheck, CircleX,
  Sun, Moon, Crosshair,
} from "lucide-react";

const DWELL = 25;
const TERM_DWELL = 20;
const DAY = 86400;

const toSec = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 3600 + m * 60;
};

const baseLines = [
  {
    id: "chilonzor", name: "Chilonzor liniyasi", color: "#ff4057",
    start: "05:00", end: "00:00", peak: "2–3 daqiqa", offPeak: "4–5 daqiqa",
    runMin: 33, peakMin: 2.5, offMin: 4.5,
    stations: [
      "Buyuk Ipak Yo‘li", "Pushkin", "Hamid Olimjon", "Amir Temur Xiyoboni",
      "Mustaqillik Maydoni", "Paxtakor", "Xalqlar Do‘stligi", "Milliy Bog‘",
      "Novza", "Mirzo Ulug‘bek", "Chilonzor", "Olmazor", "Choshtepa",
      "O‘zgarish", "Sergeli", "Yangihayot", "Chinor",
    ],
  },
  {
    id: "uzbekiston", name: "O‘zbekiston liniyasi", color: "#3987ff",
    start: "05:00", end: "00:00", peak: "3–4 daqiqa", offPeak: "6–7 daqiqa",
    runMin: 21, peakMin: 3.5, offMin: 6.5,
    stations: [
      "Beruniy", "Tinchlik", "Chorsu", "G'afur G'ulom", "Alisher Navoiy",
      "O'zbekiston", "Kosmonavtlar", "Oybek", "Toshkent", "Mashinasozlar", "Do‘stlik",
    ],
  },
  {
    id: "yunusobod", name: "Yunusobod liniyasi", color: "#27d99a",
    start: "05:00", end: "00:00", peak: "4–5 daqiqa", offPeak: "7–8 daqiqa",
    runMin: 15, peakMin: 4.5, offMin: 7.5,
    stations: [
      "Turkiston", "Yunusobod", "Shahriston", "Bodomzor", "Minor",
      "Abdulla Qodiriy", "Yunus Rajabiy", "Ming O'rik",
    ],
  },
  {
    id: "halqa", name: "Halqa liniyasi", color: "#f6c945",
    start: "05:00", end: "23:00", peak: "7–8 daqiqa", offPeak: "10–11 daqiqa",
    runMin: 39, peakMin: 7.5, offMin: 10.5,
    stations: [
      "Texnopark", "Yashnobod", "Tuzel", "Olmos", "Rohat", "Yangiobod",
      "Qo‘yliq", "Matonat", "Qiyot", "Tolariq", "Xonobod", "Quruvchilar",
      "Turon", "Qipchoq",
    ],
  },
];

const lines = baseLines.map((l) => {
  const startSec = toSec(l.start);
  let endSec = toSec(l.end);
  if (endSec <= startSec) endSec += DAY;
  return { ...l, startSec, endSec };
});

const PEAKS = [[7.5 * 3600, 9.5 * 3600], [17 * 3600, 19 * 3600]];
const headwaySec = (line, t) =>
  Math.round((PEAKS.some(([a, b]) => t >= a && t < b) ? line.peakMin : line.offMin) * 60);

const rad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
}
function bearing(a, b) {
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const TRANSFER_STATIONS = new Set([
  "paxtakor", "alishernavoiy", "oybek", "mingorik",
  "yunusrajabiy", "amirtemurxiyoboni", "chinor", "qipchoq",
  "dostlik", "texnopark",
]);

function isPeakTime(t) {
  const local = ((t % DAY) + DAY) % DAY;
  return PEAKS.some(([a, b]) => local >= a && local < b);
}

function stationDwellSec(stationName, peak) {
  const key = normalize(stationName);
  if (!TRANSFER_STATIONS.has(key)) return DWELL;
  // Almashuv bekatlarida yo‘lovchi oqimi sababli poyezd ko‘proq kutadi.
  return peak ? 115 : 65;
}

function makeDir(line, pts, offsetSec, departureAt = null, singleDeparture = false) {
  const n = pts.length;
  const peak = isPeakTime(departureAt ?? (line.startSec + offsetSec));
  const dist = [];
  for (let i = 0; i < n - 1; i++) dist.push(haversine(pts[i], pts[i + 1]));
  const sum = dist.reduce((s, x) => s + x, 0) || 1;

  const dwell = pts.map((p, i) =>
    i === 0 ? 0 : stationDwellSec(p.name, peak)
  );
  // Tig‘iz vaqtda almashuv bekatlari oldidagi segmentlarda tezlik pasayadi.
  const segmentWeights = dist.map((d, i) => {
    const nextKey = normalize(pts[i + 1]?.name);
    const nearTransfer = TRANSFER_STATIONS.has(nextKey);
    return d * (nearTransfer ? (peak ? 1.8 : 1.35) : 1);
  });
  const weightedSum = segmentWeights.reduce((a, b) => a + b, 0) || 1;
  const baseMoveTotal = Math.max(60, line.runMin * 60 - DWELL * Math.max(0, n - 2));
  const moveTotal = baseMoveTotal * (peak ? 1.12 : 1);
  const travel = segmentWeights.map((w) => (moveTotal * w) / weightedSum);

  const a = [0];
  const d = [0];
  for (let i = 0; i < n - 1; i++) {
    a[i + 1] = d[i] + travel[i];
    d[i + 1] = a[i + 1] + (i + 1 < n - 1 ? dwell[i + 1] : TERM_DWELL);
  }

  const deps = [];
  if (singleDeparture && departureAt != null) {
    deps.push(Math.round(departureAt));
  } else {
    for (let t = line.startSec + offsetSec; t < line.endSec; t += headwaySec(line, t)) deps.push(Math.round(t));
  }

  return {
    pts, dist, travel, a, d, deps,
    total: d[n - 1],
    bearings: pts.slice(0, -1).map((p, i) => bearing(p, pts[i + 1])),
  };
}

function stateAt(D, e) {
  const { pts, travel, a, d, dist, bearings } = D;
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    if (e >= d[i] && e < a[i + 1]) {
      const f = (e - d[i]) / travel[i];
      const k = f * f * (3 - 2 * f);
      const A = pts[i];
      const B = pts[i + 1];
      return {
        moving: true, seg: i, from: A, to: B,
        lat: A.lat + (B.lat - A.lat) * k,
        lng: A.lng + (B.lng - A.lng) * k,
        bearing: bearings[i],
        eta: a[i + 1] - e,
        nextArrivalEta: a[i + 1] - e,
        speed: dist[i] / (travel[i] / 3600),
      };
    }
    if (e >= a[i + 1] && e < d[i + 1]) {
      const last = i + 1 === n - 1;
      const P = pts[i + 1];
      return {
        moving: false, seg: i + 1, from: P, to: last ? null : pts[i + 2],
        lat: P.lat, lng: P.lng,
        bearing: last ? bearings[n - 2] : bearings[i + 1],
        eta: d[i + 1] - e,
        nextArrivalEta: last ? null : (d[i + 1] - e) + travel[i + 1],
        speed: 0,
      };
    }
  }
  return null;
}

function buildEngine(routes) {
  const items = routes
    .filter((r) => r.pts.length >= 2)
    .map(({ line, pts }) => {
      const dirs = {};
      for (const dir of ["fwd", "back"]) {
        const dirPts = dir === "fwd" ? pts : [...pts].reverse();
        const offset = dir === "fwd" ? 0 : 60;
        const departures = [];
        for (let t = line.startSec + offset; t < line.endSec; t += headwaySec(line, t)) {
          departures.push(Math.round(t));
        }
        // Har bir qatnov o‘z jo‘nash vaqtidagi tig‘izlikka mos alohida jadval oladi.
        dirs[dir] = departures.map((dep) => ({
          dep,
          D: makeDir(line, dirPts, offset, dep, true),
        }));
      }
      return { line, dirs };
    });

  return {
    getTrains(t) {
      const out = [];
      for (const { line, dirs } of items) {
        for (const dir of ["fwd", "back"]) {
          for (const trip of dirs[dir]) {
            const { dep, D } = trip;
            let e = t - dep;
            // Yarim tundan keyin oldingi kunning oxirgi qatnovlari yo‘lda qolishi mumkin.
            if (e < 0) e += DAY;
            if (e > D.total) continue;
            const s = stateAt(D, e);
            if (!s) continue;
            const last = D.pts[D.pts.length - 1];
            out.push({
              ...s, id: `${line.id}-${dir}-${dep}`, lineId: line.id, line,
              color: line.color, dir, dep, terminal: last.name,
            });
          }
        }
      }
      return out;
    },

    getArrivals(lineId, stationId, t, count = 2) {
      const it = items.find((x) => x.line.id === lineId);
      const res = {};
      if (!it) return res;
      for (const dir of ["fwd", "back"]) {
        const list = [];
        for (const trip of it.dirs[dir]) {
          const { dep, D } = trip;
          const idx = D.pts.findIndex((p) => p.id === stationId);
          if (idx < 0) continue;
          const arr = dep + D.a[idx];
          const etas = [arr - t, arr - t - DAY, arr - t + DAY].filter((x) => x >= -5);
          if (!etas.length) continue;
          list.push({ eta: Math.max(0, Math.min(...etas)), at: ((arr % DAY) + DAY) % DAY });
        }
        list.sort((x, y) => x.eta - y.eta);
        const first = it.dirs[dir][0];
        if (first) {
          const D = first.D;
          const idx = D.pts.findIndex((p) => p.id === stationId);
          if (idx >= 0) res[dir] = {
            list: list.slice(0, count),
            terminal: D.pts[D.pts.length - 1].name,
            atEnd: idx === D.pts.length - 1,
          };
        }
      }
      return res;
    },
  };
}

function lineStatus(line, t, activeCount) {
  if (t >= line.startSec && t < line.endSec) return { key: "open", label: "Jadval bo‘yicha ochiq" };
  if (activeCount > 0) return { key: "finishing", label: "Oxirgi poyezdlar yo‘lda" };
  const until = t < line.startSec ? line.startSec - t : line.startSec + DAY - t;
  return { key: "closed", label: `Yopiq · ochilishiga ${fmtDur(until)}` };
}

const p2 = (n) => String(Math.floor(n)).padStart(2, "0");
const fmtClock = (s) => `${p2((s % DAY) / 3600)}:${p2(((s % DAY) % 3600) / 60)}`;
const fmtHMS = (s) => `${fmtClock(s)}:${p2(s % 60)}`;
const fmtMS = (s) => `${p2(Math.max(0, s) / 60)}:${p2(Math.max(0, s) % 60)}`;
const fmtDur = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} s ${m} daq` : `${m} daq`;
};

const DATA_URL =
  "https://raw.githubusercontent.com/JamshidSod/tashkent-metro-accessibility/main/data/stations.geojson";

const TZ = 5 * 3600 * 1000;

const THEME_CSS = `
[data-theme="dark"]{--bg:#080b12;--panel:#0c111c;--card:#151c29;--soft:rgba(255,255,255,.05);--border:rgba(255,255,255,.1);--text:#fff;--muted:#94a3b8;--accent:#4ade80;--accent-bg:rgba(34,197,94,.15)}
[data-theme="light"]{--bg:#f3f5f9;--panel:#ffffff;--card:#eef1f6;--soft:rgba(15,23,42,.06);--border:rgba(15,23,42,.14);--text:#0f172a;--muted:#475569;--accent:#15803d;--accent-bg:rgba(22,163,74,.12)}
.metro-train-icon{overflow:visible}
.metro-train-icon .t-svg{transform-origin:50% 50%;filter:drop-shadow(0 0 5px rgba(0,0,0,.45))}
.metro-train-icon.t-sel .t-svg{filter:drop-shadow(0 0 9px #fff)}
.metro-train-icon.t-sel::before{content:"";position:absolute;inset:-7px;border-radius:50%;border:2px solid #fff;animation:metroPing 1.4s ease-out infinite}
@keyframes metroPing{0%{transform:scale(.6);opacity:.9}100%{transform:scale(1.5);opacity:0}}
`;

const TILES = {
  dark: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  light: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
};

function initialTheme() {
  try {
    const s = localStorage.getItem("metro-theme");
    if (s === "dark" || s === "light") return s;
  } catch {}
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

const normalize = (value = "") =>
  value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ʻ’‘`']/g, "")
    .replace(/[^a-z0-9]/g, "");

function getName(feature) {
  const p = feature.properties || {};
  return p.name_uz || p.name || p.station_name || p.name_ru || "Nomsiz bekat";
}

function getLine(feature) {
  const p = feature.properties || {};
  const raw = [p.line, p.line_name, p.line_id, p.route, p.route_name]
    .filter(Boolean).join(" ").toLowerCase();
  if (raw.includes("yunus") || raw.includes("green")) return lines[2];
  if (raw.includes("circle") || raw.includes("ring") || raw.includes("halqa") || raw.includes("independence")) return lines[3];
  if (raw.includes("uzbekiston") || raw.includes("o'zbekiston") || raw.includes("o‘zbekiston") || raw.includes("uzbekistan") || raw.includes("blue")) return lines[1];
  if (raw.includes("chilonzor") || raw.includes("red")) return lines[0];
  return null;
}

function findLineByStationName(name) {
  const n = normalize(name);
  const matches = lines.filter((line) =>
    line.stations.some((expectedName) => {
      const e = normalize(expectedName);
      return e === n || (e.length >= 6 && n.length >= 6 && (e.includes(n) || n.includes(e)));
    })
  );
  return matches.length === 1 ? matches[0] : null;
}

function matchPoints(line, stations) {
  const used = new Set();
  return line.stations
    .map((expectedName) => {
      const expected = normalize(expectedName);
      const eligible = stations.filter((s) => !used.has(s.id));
      let found = eligible.find((s) => s.line?.id === line.id && normalize(s.name) === expected);
      if (!found) found = eligible.find((s) => normalize(s.name) === expected);
      if (!found && expected.length >= 6) {
        let candidates = eligible.filter((s) => {
          const n = normalize(s.name);
          return s.line?.id === line.id && n.length >= 6 && (n.includes(expected) || expected.includes(n));
        });
        if (candidates.length !== 1) {
          candidates = eligible.filter((s) => {
            const n = normalize(s.name);
            return n.length >= 6 && (n.includes(expected) || expected.includes(n));
          });
        }
        if (candidates.length === 1) found = candidates[0];
      }
      if (found) used.add(found.id);
      return found || null;
    })
    .filter(Boolean);
}

function stationIcon(color, selected) {
  const size = selected ? 18 : 12;
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 0 9px ${color};"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const trainIcon = (color) =>
  L.divIcon({
    className: "metro-train-icon",
    html: `<svg class="t-svg" width="30" height="30" viewBox="0 0 30 30" style="overflow:visible">
      <path d="M15 0.5 L22 10.5 L8 10.5 Z" fill="${color}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
      <circle cx="15" cy="16" r="9" fill="${color}" stroke="#fff" stroke-width="2.5"/>
      <rect x="11.5" y="12" width="7" height="8.5" rx="1.8" fill="#fff"/>
    </svg>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

function FocusMap({ station }) {
  const map = useMap();
  useEffect(() => {
    if (station) map.flyTo([station.lat, station.lng], 15, { duration: 0.7 });
  }, [station, map]);
  return null;
}

function useTashkentClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const getSec = useCallback(() => ((now + TZ) / 1000) % DAY, [now]);
  return { now, getSec };
}

function TrainsLayer({ engineRef, getSec, lineFilterRef, selectedRef, followRef, onPickRef, onStopFollowRef }) {
  const map = useMap();
  // useEffect bir marta ishga tushadi; vaqt funksiyasini ref orqali yangilab turamiz,
  // aks holda animatsiya birinchi render vaqtidan qotib qoladi.
  const getSecRef = useRef(getSec);
  getSecRef.current = getSec;

  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const markers = new Map();
    let raf;

    const frame = () => {
      const engine = engineRef.current;
      if (engine) {
        const seen = new Set();
        for (const tr of engine.getTrains(getSecRef.current())) {
          const f = lineFilterRef.current;
          if (f !== "all" && f !== tr.lineId) continue;
          seen.add(tr.id);

          let m = markers.get(tr.id);
          if (!m) {
            m = L.marker([tr.lat, tr.lng], { icon: trainIcon(tr.color), zIndexOffset: 1000, keyboard: false });
            const id = tr.id;
            m.on("click", () => {
              onPickRef.current(id);
              if (map.getZoom() < 14) map.setView(m.getLatLng(), 14, { animate: true });
            });
            m.addTo(group);
            markers.set(tr.id, m);
          } else {
            m.setLatLng([tr.lat, tr.lng]);
          }

          const el = m.getElement();
          if (el) {
            const svg = el.querySelector(".t-svg");
            if (svg) svg.style.transform = `rotate(${tr.bearing.toFixed(1)}deg)`;
            el.classList.toggle("t-sel", selectedRef.current === tr.id);
          }
        }
        markers.forEach((m, id) => {
          if (!seen.has(id)) {
            group.removeLayer(m);
            markers.delete(id);
          }
        });

        const fid = followRef.current;
        if (fid && markers.has(fid)) map.panTo(markers.get(fid).getLatLng(), { animate: false });
      }
      raf = requestAnimationFrame(frame);
    };
    frame();

    const stop = () => onStopFollowRef.current();
    map.on("dragstart", stop);

    return () => {
      cancelAnimationFrame(raf);
      map.off("dragstart", stop);
      group.remove();
    };
  }, [map]);

  return null;
}

const panelCls =
  "absolute bottom-2 left-2 right-2 top-auto z-[1300] max-h-[42dvh] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--border)] bg-[var(--panel)]/95 p-3 text-[var(--text)] shadow-2xl backdrop-blur sm:bottom-auto sm:left-auto sm:right-4 sm:top-4 sm:max-h-[65vh] sm:w-[390px] sm:p-5";

function StationPanel({ station, currentSec, engine, trainsOnLine, onClose }) {
  const line = station.line;
  const status = line ? lineStatus(line, currentSec, trainsOnLine) : null;
  const arrivals = line ? engine.getArrivals(line.id, station.id, currentSec, 2) : {};
  const has = arrivals.fwd || arrivals.back;

  return (
    <section className={panelCls}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-widest text-[var(--accent)]">TANLANGAN BEKAT</p>
          <h2 className="mt-2 text-xl font-bold">{station.name}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{line?.name || "Liniya aniqlanmagan"}</p>
        </div>
        <button onClick={onClose} className="cursor-pointer rounded-lg p-2 hover:bg-[var(--soft)]" aria-label="Yopish">
          <X size={18} />
        </button>
      </div>

      {line && status ? (
        <div className="mt-4 rounded-xl bg-[var(--soft)] p-4">
          <div className="flex items-center gap-2">
            {status.key === "closed" ? (
              <CircleX size={20} className="text-red-500" />
            ) : (
              <CircleCheck size={20} className={status.key === "open" ? "text-[var(--accent)]" : "text-amber-500"} />
            )}
            <span className="text-sm font-semibold">{status.label}</span>
          </div>

          <div className="mt-3 flex justify-between text-sm">
            <span className="text-[var(--muted)]">Ish vaqti</span>
            <span>{line.start}–{line.end}</span>
          </div>
          <div className="mt-1 flex justify-between text-sm">
            <span className="text-[var(--muted)]">Interval (tig‘iz / boshqa)</span>
            <span>{line.peak} / {line.offPeak}</span>
          </div>

          <div className="mt-4 border-t border-[var(--border)] pt-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Clock3 size={17} className="text-amber-500" /> Keyingi poyezdlar
            </div>

            {!has ? (
              <p className="mt-2 text-xs text-[var(--muted)]">Bu bekat marshrut modelida topilmadi.</p>
            ) : (
              ["fwd", "back"].map((d) => {
                const a = arrivals[d];
                if (!a) return null;
                return (
                  <div key={d} className="mt-3 rounded-lg border border-[var(--border)] p-3">
                    <p className="text-xs text-[var(--muted)]">→ {a.terminal}</p>
                    {a.list.length === 0 ? (
                      <p className="mt-1 text-sm">Poyezd yo‘q</p>
                    ) : (
                      <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                        {a.list.map((x, i) =>
                          x.eta > 1800 ? (
                            <span key={i} className="text-sm">
                              Birinchi poyezd: <b>{fmtClock(x.at)}</b>
                            </span>
                          ) : (
                            <span key={i} className={`font-mono text-lg font-bold ${i === 0 ? "text-[var(--accent)]" : ""}`}>
                              {fmtMS(x.eta)}
                              <span className="ml-1 text-xs font-normal text-[var(--muted)]">{fmtClock(x.at)}</span>
                            </span>
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl bg-[var(--soft)] p-4 text-sm text-[var(--muted)]">
          Ushbu bekat uchun liniya ma’lumoti manbadan aniqlanmadi.
        </div>
      )}
    </section>
  );
}

function TrainPanel({ train, currentSec, follow, onFollow, onClose }) {
  const lineColor = train?.color || "#ff4057";

  return (
    <section className="absolute bottom-2 left-2 right-2 top-auto z-[1300] max-h-[46dvh] overflow-y-auto overscroll-contain rounded-[22px] border border-white/15 bg-[#101522]/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-white shadow-[0_24px_80px_rgba(0,0,0,.6)] backdrop-blur-xl sm:bottom-auto sm:left-auto sm:right-5 sm:top-5 sm:max-h-[80vh] sm:w-[410px] sm:p-5">
      <div className="absolute inset-x-0 top-0 h-[5px] rounded-t-[24px]" style={{ background: `linear-gradient(90deg, ${lineColor}, #ff4057 55%, transparent)` }} />
      <div className="flex items-start justify-between gap-3 pt-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[.22em]" style={{ color: lineColor }}>
            <span className="h-2.5 w-2.5 animate-pulse rounded-full" style={{ backgroundColor: lineColor, boxShadow: `0 0 14px ${lineColor}` }} />
            Poyezd simulyatsiyasi
          </p>
          <h2 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">{train ? train.line.name : "Poyezd"}</h2>
          <p className="mt-1 text-sm text-slate-300">{train ? `Yo‘nalish: ${train.terminal} tomon` : "Marshrut yakunlandi"}</p>
        </div>
        <button onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-slate-300 transition hover:bg-white/10 hover:text-white" aria-label="Yopish">
          <X size={18} />
        </button>
      </div>

      {!train ? (
        <p className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">Poyezd marshrutni tugatdi.</p>
      ) : (
        <>
          <div className="mt-3 rounded-[18px] border border-emerald-400/30 bg-gradient-to-br from-emerald-950/70 via-[#101c27] to-[#101522] p-3 shadow-[inset_0_0_35px_rgba(16,185,129,.08)] sm:mt-5 sm:rounded-[20px] sm:p-5">
            <div className="flex items-center gap-2 text-[11px] font-black tracking-[.2em] text-emerald-300">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" />
              POEZD HOLATI
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-200">{train.moving ? "Keyingi bekatga yaqinlashmoqda" : "Bekatda to‘xtab turibdi"}</p>
            <div className="mt-1 flex items-end gap-2">
              <span className="font-mono text-[clamp(2.25rem,11vw,3.1rem)] font-black leading-none tracking-[-.07em] text-emerald-300 drop-shadow-[0_0_18px_rgba(52,211,153,.45)] sm:text-[64px]">{fmtMS(train.eta)}</span>
              <span className="mb-1 text-sm font-bold text-emerald-100">daq:son</span>
            </div>
            <div className="mt-3 flex items-start gap-2 text-xs font-semibold text-rose-300 sm:mt-4 sm:text-sm">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-rose-400 shadow-[0_0_10px_#fb7185]" />
              <span>{train.moving ? "Harakatda: keyingi bekatga yo‘l olmoqda" : "Poyezd bekatda, jo‘nashni kutmoqda"}</span>
            </div>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-700/80">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-green-300 to-emerald-400 shadow-[0_0_15px_rgba(52,211,153,.65)] transition-all duration-500" style={{ width: `${train.moving ? 72 : 38}%` }} />
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 sm:mt-4">
              <span className="text-sm font-semibold text-slate-300">Vagonlar</span>
              <div className="flex items-center gap-2" aria-label="Vagonlar indikatori">
                {["#facc15", "#fb7185", "#facc15", "#6ee7b7"].map((color, i) => (
                  <span key={i} className="h-3.5 w-6 rounded-md shadow-[0_0_9px_rgba(255,255,255,.08)]" style={{ backgroundColor: color }} />
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.045] px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
              <Clock3 size={17} className="text-emerald-300" />
              Keyingi bekat
            </div>
            <span className="max-w-[55%] truncate text-right text-sm font-bold">{train.to?.name || "Oxirgi bekat"}</span>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2 sm:mt-3">
            <div className="rounded-2xl border border-white/10 bg-white/[.045] p-3">
              <p className="text-xs text-slate-400">Taxminiy tezlik</p>
              <p className="mt-1 text-xl font-black">{train.moving ? `~${Math.round(train.speed)}` : "0"} <span className="text-xs font-semibold text-slate-400">km/soat</span></p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[.045] p-3">
              <p className="text-xs text-slate-400">Jo‘nash vaqti</p>
              <p className="mt-1 font-mono text-xl font-black">{fmtClock(train.dep)}</p>
            </div>
          </div>

          {train.to && train.nextArrivalEta != null && (
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[.045] p-4">
              <div className="text-xs text-slate-400">Bekatga yetib borish vaqti (taxminiy)</div>
              <div className="mt-1 text-2xl font-black tabular-nums">{fmtClock(currentSec + train.nextArrivalEta)}</div>
              <div className="mt-1 text-xs text-slate-400">Qolgan vaqt: {fmtDur(train.nextArrivalEta)}</div>
            </div>
          )}

          <button onClick={onFollow} className={`mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border py-3 text-sm font-black transition ${follow ? "border-emerald-300 bg-emerald-400 text-slate-950 shadow-[0_0_25px_rgba(52,211,153,.2)]" : "border-emerald-400/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"}`}>
            <Crosshair size={17} /> {follow ? "Poyezd kuzatilmoqda" : "Poyezdni kuzatish"}
          </button>
        </>
      )}
    </section>
  );
}

export default function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [stations, setStations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedTrain, setSelectedTrain] = useState(null);
  const [follow, setFollow] = useState(false);
  const [search, setSearch] = useState("");
  const [activeLine, setActiveLine] = useState("all");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const clock = useTashkentClock();
  const currentSec = clock.getSec();

  useEffect(() => {
    try { localStorage.setItem("metro-theme", theme); } catch {}
  }, [theme]);

  async function loadStations() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(DATA_URL);
      if (!response.ok) throw new Error("Bekatlar manbasini yuklab bo‘lmadi. Internetni tekshiring.");
      const geojson = await response.json();
      if (!Array.isArray(geojson.features)) throw new Error("GeoJSON ma’lumot formati noto‘g‘ri.");

      const parsed = geojson.features
        .filter((f) => f.geometry?.type === "Point")
        .map((f, index) => {
          const [lng, lat] = f.geometry.coordinates;
          return {
            id: String(f.properties?.station_id ?? f.properties?.id ?? index),
            name: getName(f),
            lat: Number(lat),
            lng: Number(lng),
            line: getLine(f) || findLineByStationName(getName(f)),
            properties: f.properties || {},
          };
        })
        .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && Math.abs(s.lat) <= 90 && Math.abs(s.lng) <= 180);

      if (!parsed.length) throw new Error("Ma’lumot ichidan bekatlar topilmadi.");
      setStations(parsed);
      setSelected((prev) => (prev ? parsed.find((s) => s.id === prev.id) || null : null));
    } catch (e) {
      setError(e.message || "Ma’lumot yuklashda xato yuz berdi.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStations();
  }, []);

  const visibleStations = useMemo(
    () =>
      stations.filter((s) => {
        const okSearch = normalize(s.name).includes(normalize(search));
        const okLine = activeLine === "all" || s.line?.id === activeLine;
        return okSearch && okLine;
      }),
    [stations, search, activeLine]
  );

  const routes = useMemo(
    () => lines.map((line) => ({ line, pts: matchPoints(line, stations) })),
    [stations]
  );
  const engine = useMemo(() => buildEngine(routes), [routes]);

  const trains = engine.getTrains(currentSec);
  const trainsByLine = {};
  for (const t of trains) trainsByLine[t.lineId] = (trainsByLine[t.lineId] || 0) + 1;
  const shownTrains = trains.filter((t) => activeLine === "all" || t.lineId === activeLine);
  const trainObj = selectedTrain ? trains.find((t) => t.id === selectedTrain) || null : null;

  const engineRef = useRef(engine);
  const lineFilterRef = useRef(activeLine);
  const selectedRef = useRef(selectedTrain);
  const followRef = useRef(null);
  const onPickRef = useRef(() => {});
  const onStopFollowRef = useRef(() => {});
  engineRef.current = engine;
  lineFilterRef.current = activeLine;
  selectedRef.current = selectedTrain;
  followRef.current = follow && selectedTrain ? selectedTrain : null;
  onPickRef.current = (id) => {
    setSelectedTrain(id);
    setSelected(null);
    setFollow(true);
  };
  onStopFollowRef.current = () => setFollow(false);

  const routeLines = routes.filter((r) => activeLine === "all" || activeLine === r.line.id);

  return (
    <div data-theme={theme} className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <style>{THEME_CSS}</style>

      <header className="flex flex-col gap-3 border-b border-[var(--border)] bg-[var(--panel)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4 sm:py-4 md:px-7">
        <div className="flex w-full min-w-0 items-center justify-between gap-3 sm:w-auto sm:justify-start sm:gap-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="shrink-0 rounded-xl bg-[var(--accent-bg)] p-2.5 text-[var(--accent)] sm:p-3">
              <TrainFront size={27} />
            </div>
            <div className="min-w-0">
              <h1 className="whitespace-nowrap text-sm font-black tracking-wide sm:text-lg md:text-2xl">TASHKENT METRO</h1>
              <p className="hidden text-xs text-[var(--muted)] sm:block">Metro xaritasi</p>
            </div>
          </div>
          <div className="shrink-0 border-l border-[var(--border)] pl-3 text-right sm:ml-2 sm:pl-4">
            <p className="text-[9px] uppercase tracking-wide text-[var(--muted)] sm:text-[10px]">Toshkent vaqti</p>
            <p className="font-mono text-lg font-bold tabular-nums sm:text-xl md:text-2xl">{fmtHMS(currentSec)}</p>
          </div>
        </div>

        <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:gap-3">
          <button
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2.5 text-sm hover:bg-[var(--soft)] sm:flex-none"
            aria-label="Mavzuni almashtirish"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            {theme === "dark" ? "Yorug‘" : "Qorong‘i"}
          </button>

          <button
            onClick={loadStations}
            disabled={loading}
            className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2.5 text-sm hover:bg-[var(--soft)] disabled:opacity-50 sm:flex-none"
            aria-label="Bekatlarni yangilash"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Yangilash
          </button>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-85px)] grid-cols-1 lg:grid-cols-[330px_minmax(0,1fr)]">
        {sidebarOpen && <button aria-label="Menyuni yopish" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-[1900] bg-black/50 lg:hidden" />}
        <aside className={`fixed inset-y-0 left-0 z-[2000] w-[min(88vw,360px)] overflow-y-auto border-r border-[var(--border)] bg-[var(--panel)] p-3 shadow-2xl transition-transform duration-200 sm:p-4 lg:static lg:order-1 lg:z-auto lg:block lg:w-auto lg:translate-x-0 lg:overflow-visible lg:shadow-none ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="mb-3 flex items-center justify-between lg:hidden">
            <span className="font-bold">Metro menyusi</span>
            <button onClick={() => setSidebarOpen(false)} aria-label="Menyuni yopish" className="rounded-lg border border-[var(--border)] p-2"><X size={18} /></button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-3 text-[var(--muted)]" size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Bekat nomini qidiring..."
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] py-3 pl-10 pr-3 text-sm text-[var(--text)] outline-none focus:border-green-500"
            />
          </div>

          <div className="my-5 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-[var(--soft)] p-3">
              <p className="text-xs text-[var(--muted)]">Yuklangan bekatlar</p>
              <p className="mt-1 text-2xl font-bold">{stations.length}</p>
            </div>
            <div className="rounded-xl bg-[var(--soft)] p-3">
              <p className="text-xs text-[var(--muted)]">Yo‘ldagi poyezdlar</p>
              <p className="mt-1 text-2xl font-bold">{shownTrains.length}</p>
            </div>
          </div>

          <h2 className="mb-3 text-xs font-bold tracking-widest text-[var(--muted)]">METRO LINIYALARI</h2>

          <button
            onClick={() => { setActiveLine("all"); setSidebarOpen(false); }}
            className={`mb-2 flex w-full cursor-pointer items-center gap-3 rounded-xl p-3 text-left text-sm ${activeLine === "all" ? "bg-[var(--soft)]" : "hover:bg-[var(--soft)]"}`}
          >
            <MapPin size={18} /> Barcha liniyalar
          </button>

          {lines.map((line) => {
            const st = lineStatus(line, currentSec, trainsByLine[line.id] || 0);
            const dot = st.key === "open" ? "bg-green-400" : st.key === "finishing" ? "bg-amber-400" : "bg-red-400";
            return (
              <button
                key={line.id}
                onClick={() => { setActiveLine(line.id); setSidebarOpen(false); }}
                className={`mb-2 flex w-full cursor-pointer items-center gap-3 rounded-xl p-3 text-left text-sm ${activeLine === line.id ? "bg-[var(--soft)]" : "hover:bg-[var(--soft)]"}`}
              >
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: line.color }} />
                <div className="min-w-0 flex-1">
                  <div>{line.name}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    {line.start}–{line.end} · {trainsByLine[line.id] || 0} ta poyezd
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--muted)]">{st.label}</div>
                </div>
                <span title={st.label} className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
              </button>
            );
          })}

          <div className="mb-3 mt-6 flex items-center justify-between">
            <h2 className="text-xs font-bold tracking-widest text-[var(--muted)]">BEKATLAR</h2>
            <span className="text-xs text-[var(--muted)]">{visibleStations.length} ta</span>
          </div>

          <div className="max-h-[34vh] space-y-1 overflow-y-auto overscroll-contain sm:max-h-[420px]">
            {visibleStations.map((s) => (
              <button
                key={s.id}
                onClick={() => { setSelected(s); setSelectedTrain(null); setFollow(false); setSidebarOpen(false); }}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-lg p-3 text-left text-sm ${
                  selected?.id === s.id ? "bg-[var(--accent-bg)] text-[var(--accent)]" : "hover:bg-[var(--soft)]"
                }`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.line?.color || "#94a3b8" }} />
                <span>{s.name}</span>
              </button>
            ))}
            {!loading && visibleStations.length === 0 && !error && (
              <p className="p-3 text-sm text-[var(--muted)]">Bekat topilmadi.</p>
            )}
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-500">
              {error}
              <button onClick={loadStations} className="mt-2 block underline">Qayta urinish</button>
            </div>
          )}

        </aside>

        <main className="relative order-1 min-h-[55vh] min-w-0 lg:order-2">
          <button onClick={() => setSidebarOpen(true)} aria-label="Metro menyusini ochish" className="absolute left-3 top-3 z-[1200] flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)]/95 px-3 py-2 text-sm font-semibold text-[var(--text)] shadow-lg backdrop-blur lg:hidden">☰ Liniyalar</button>
          <MapContainer center={[41.3111, 69.2797]} zoom={12} className="h-full min-h-0 w-full">
            <TileLayer
              key={theme}
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url={TILES[theme]}
            />

            {routeLines.map(({ line, pts }) => {
              const segments = [];
              let segment = [];
              for (const station of pts) {
                if (segment.length) {
                  const prev = segment[segment.length - 1];
                  if (haversine(prev, station) > 4.5) {
                    if (segment.length > 1) segments.push(segment);
                    segment = [];
                  }
                }
                segment.push(station);
              }
              if (segment.length > 1) segments.push(segment);
              return segments.map((part, i) => (
                <Polyline
                  key={`${line.id}-${i}`}
                  positions={part.map((station) => [station.lat, station.lng])}
                  pathOptions={{ color: line.color, weight: 5, opacity: 0.95, lineCap: "round", lineJoin: "round" }}
                />
              ));
            })}

            {visibleStations.map((s) => (
              <Marker
                key={s.id}
                position={[s.lat, s.lng]}
                icon={stationIcon(s.line?.color || "#94a3b8", selected?.id === s.id)}
                eventHandlers={{
                  click: () => { setSelected(s); setSelectedTrain(null); setFollow(false); },
                }}
              >
                <Popup>
                  <strong>{s.name}</strong>
                  <br />
                  {s.line?.name || "Liniya aniqlanmagan"}
                  <br />
                  {s.line ? `Ish vaqti: ${s.line.start}–${s.line.end}` : "Ish vaqti aniqlanmagan"}
                </Popup>
              </Marker>
            ))}

            <TrainsLayer
              engineRef={engineRef}
              getSec={clock.getSec}
              lineFilterRef={lineFilterRef}
              selectedRef={selectedRef}
              followRef={followRef}
              onPickRef={onPickRef}
              onStopFollowRef={onStopFollowRef}
            />
            <FocusMap station={selected} />
          </MapContainer>

          {loading && (
            <div className="absolute left-14 top-4 z-[1000] rounded-xl bg-[var(--panel)]/95 px-4 py-3 text-sm shadow-lg">
              <RefreshCw size={16} className="mr-2 inline animate-spin" />
              Bekatlar yuklanmoqda...
            </div>
          )}

          {selectedTrain ? (
            <TrainPanel
              train={trainObj}
              currentSec={currentSec}
              follow={follow}
              onFollow={() => setFollow((f) => !f)}
              onClose={() => { setSelectedTrain(null); setFollow(false); }}
            />
          ) : selected ? (
            <StationPanel
              station={selected}
              currentSec={currentSec}
              engine={engine}
              trainsOnLine={selected.line ? trainsByLine[selected.line.id] || 0 : 0}
              onClose={() => setSelected(null)}
            />
          ) : null}
        </main>
      </div>

      <footer className="border-t border-[var(--border)] bg-[var(--panel)] px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-screen-2xl flex-col items-center justify-between gap-2 text-center sm:flex-row sm:text-left">
          <div className="flex items-center gap-2 font-bold tracking-wide">
            <TrainFront size={23} className="text-[var(--accent)]" />
            <span>TASHKENT METRO</span>
          </div>
          <p className="leading-5 text-white text-[var(--muted)]">
            Barcha huquqlar ximoyalangan!
          </p>
          <p className="text-[var(--muted)] text-white">© 2026 Tashkent Metro</p>
        </div>
      </footer>
    </div>
  );
}