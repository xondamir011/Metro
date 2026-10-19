import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  TrainFront,
  Search,
  MapPin,
  Clock3,
  RefreshCw,
  X,
  CircleCheck,
  CircleX,
  Info,
  Sun,
  Moon,
  Crosshair,
  Gauge,
  Menu,
  ChevronDown,
} from "lucide-react";

const DATA_URL = "https://raw.githubusercontent.com/JamshidSod/tashkent-metro-accessibility/main/data/stations.geojson";

const DAY = 86400;
const DWELL = 25;
const TERM_DWELL = 20;
const TZ = 5 * 3600 * 1000;

const baseLines = [
  {
    id: "chilonzor",
    name: "Chilonzor liniyasi",
    color: "#ff4057",
    start: "05:00",
    end: "00:00",
    peak: "2–3 daqiqa",
    offPeak: "4–5 daqiqa",
    runMin: 33,
    peakMin: 2.5,
    offMin: 4.5,
    stations: [
      "Buyuk Ipak Yo‘li",
      "Pushkin",
      "Hamid Olimjon",
      "Amir Temur Xiyoboni",
      "Mustaqillik Maydoni",
      "Paxtakor",
      "Xalqlar Do‘stligi",
      "Milliy Bog",
      "Novza",
      "Mirzo Ulugbek",
      "Chilonzor",
      "Olmazor",
      "Choshtepa",
      "O‘zgarish",
      "Sergeli",
      "Yangihayot",
      "Chinor",
    ],
  },
  {
    id: "uzbekiston",
    name: "O‘zbekiston liniyasi",
    color: "#3987ff",
    start: "05:00",
    end: "00:00",
    peak: "3–4 daqiqa",
    offPeak: "6–7 daqiqa",
    runMin: 21,
    peakMin: 3.5,
    offMin: 6.5,
    stations: [
      "Beruniy",
      "Tinchlik",
      "Chorsu",
      "G‘afur G‘ulom",
      "Alisher Navoiy",
      "O‘zbekiston",
      "Kosmonavtlar",
      "Oybek",
      "Toshkent",
      "Mashinasozlar",
      "Do‘stlik",
    ],
  },
  {
    id: "yunusobod",
    name: "Yunusobod liniyasi",
    color: "#27d99a",
    start: "05:00",
    end: "00:00",
    peak: "4–5 daqiqa",
    offPeak: "7–8 daqiqa",
    runMin: 15,
    peakMin: 4.5,
    offMin: 7.5,
    stations: [
      "Turkiston",
      "Yunusobod",
      "Shahriston",
      "Bodomzor",
      "Minor",
      "Abdulla Qodiriy",
      "Yunus Rajabiy",
      "Ming O‘rik",
    ],
  },
  {
    id: "halqa",
    name: "Halqa liniyasi",
    color: "#f6c945",
    start: "05:00",
    end: "23:00",
    peak: "7–8 daqiqa",
    offPeak: "10–11 daqiqa",
    runMin: 39,
    peakMin: 7.5,
    offMin: 10.5,
    stations: [
      "Texnopark",
      "Yashnobod",
      "Tuzel",
      "Olmos",
      "Rohat",
      "Yangiobod",
      "Qo‘yliq",
      "Matonat",
      "Qiyot",
      "Tolariq",
      "Xonobod",
      "Quruvchilar",
      "Turon",
      "Qipchoq",
    ],
  },
];

const toSec = (value) => {
  const [h, m] = value.split(":").map(Number);
  return h * 3600 + m * 60;
};

const lines = baseLines.map((line) => {
  const startSec = toSec(line.start);
  let endSec = toSec(line.end);

  if (endSec <= startSec) endSec += DAY;

  return { ...line, startSec, endSec };
});

const PEAKS = [
  [7.5 * 3600, 9.5 * 3600],
  [17 * 3600, 19 * 3600],
];

const headwaySec = (line, time) =>
  Math.round(
    (PEAKS.some(([a, b]) => time >= a && time < b)
      ? line.peakMin
      : line.offMin) * 60
  );

const rad = (degrees) => (degrees * Math.PI) / 180;

function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) *
      Math.cos(rad(b.lat)) *
      Math.sin(dLng / 2) ** 2;

  return 6371 * 2 * Math.asin(Math.sqrt(x));
}

function bearing(a, b) {
  const dLng = rad(b.lng - a.lng);

  const y = Math.sin(dLng) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) *
      Math.cos(rad(b.lat)) *
      Math.cos(dLng);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function makeDir(line, points, offset = 0) {
  const n = points.length;

  if (n < 2) return null;

  const distances = [];

  for (let i = 0; i < n - 1; i++) {
    distances.push(haversine(points[i], points[i + 1]));
  }

  const totalDistance = distances.reduce((sum, value) => sum + value, 0) || 1;

  const movingTime = Math.max(
    60,
    line.runMin * 60 - DWELL * Math.max(0, n - 2)
  );

  const travel = distances.map(
    (distance) => (movingTime * distance) / totalDistance
  );

  const arrivals = [0];
  const departures = [0];

  for (let i = 0; i < n - 1; i++) {
    arrivals[i + 1] = departures[i] + travel[i];

    departures[i + 1] =
      arrivals[i + 1] + (i + 1 < n - 1 ? DWELL : TERM_DWELL);
  }

  const deps = [];

  for (
    let time = line.startSec + offset;
    time < line.endSec;
    time += headwaySec(line, time)
  ) {
    deps.push(Math.round(time));
  }

  return {
    points,
    distances,
    travel,
    arrivals,
    departures,
    deps,
    total: departures[n - 1],
    bearings: points
      .slice(0, -1)
      .map((point, i) => bearing(point, points[i + 1])),
  };
}

function stateAt(direction, elapsed) {
  const {
    points,
    travel,
    arrivals,
    departures,
    distances,
    bearings,
  } = direction;

  const n = points.length;

  for (let i = 0; i < n - 1; i++) {
    if (elapsed >= departures[i] && elapsed < arrivals[i + 1]) {
      const fraction = (elapsed - departures[i]) / travel[i];
      const smooth = fraction * fraction * (3 - 2 * fraction);

      const a = points[i];
      const b = points[i + 1];

      return {
        moving: true,
        from: a,
        to: b,
        lat: a.lat + (b.lat - a.lat) * smooth,
        lng: a.lng + (b.lng - a.lng) * smooth,
        bearing: bearings[i],
        eta: arrivals[i + 1] - elapsed,
        nextArrivalEta: arrivals[i + 1] - elapsed,
        speed: distances[i] / (travel[i] / 3600),
      };
    }

    if (
      elapsed >= arrivals[i + 1] &&
      elapsed < departures[i + 1]
    ) {
      const last = i + 1 === n - 1;
      const point = points[i + 1];

      return {
        moving: false,
        from: point,
        to: last ? null : points[i + 2],
        lat: point.lat,
        lng: point.lng,
        bearing: last ? bearings[n - 2] : bearings[i + 1],
        eta: departures[i + 1] - elapsed,
        nextArrivalEta: last
          ? null
          : departures[i + 1] - elapsed + travel[i + 1],
        speed: 0,
      };
    }
  }

  return null;
}

function buildEngine(routes) {
  const items = routes
    .filter((route) => route.pts.length >= 2)
    .map(({ line, pts }) => ({
      line,
      dirs: {
        fwd: makeDir(line, pts, 0),
        back: makeDir(line, [...pts].reverse(), 60),
      },
    }));

  return {
    getTrains(time) {
      const result = [];

      for (const { line, dirs } of items) {
        for (const dir of ["fwd", "back"]) {
          const model = dirs[dir];
          const terminal = model.points[model.points.length - 1];

          for (const dep of model.deps) {
            let elapsed = time - dep;

            if (elapsed < 0) elapsed += DAY;
            if (elapsed > model.total) continue;

            const state = stateAt(model, elapsed);

            if (!state) continue;

            result.push({
              ...state,
              id: `${line.id}-${dir}-${dep}`,
              lineId: line.id,
              line,
              color: line.color,
              dir,
              dep,
              terminal: terminal.name,
            });
          }
        }
      }

      return result;
    },

    getArrivals(lineId, stationId, time, count = 2) {
      const item = items.find((x) => x.line.id === lineId);
      const result = {};

      if (!item) return result;

      for (const dir of ["fwd", "back"]) {
        const model = item.dirs[dir];
        const index = model.points.findIndex(
          (point) => point.id === stationId
        );

        if (index < 0) continue;

        const list = [];

        for (const dep of model.deps) {
          const arrival = dep + model.arrivals[index];

          const options = [
            arrival - time,
            arrival - time - DAY,
            arrival - time + DAY,
          ].filter((value) => value >= -5);

          if (!options.length) continue;

          list.push({
            eta: Math.max(0, Math.min(...options)),
            at: ((arrival % DAY) + DAY) % DAY,
          });
        }

        list.sort((a, b) => a.eta - b.eta);

        result[dir] = {
          list: list.slice(0, count),
          terminal: model.points[model.points.length - 1].name,
        };
      }

      return result;
    },
  };
}

const p2 = (n) => String(Math.floor(n)).padStart(2, "0");

const fmtClock = (seconds) => {
  const value = ((seconds % DAY) + DAY) % DAY;

  return `${p2(value / 3600)}:${p2((value % 3600) / 60)}`;
};

const fmtHMS = (seconds) =>
  `${fmtClock(seconds)}:${p2(seconds % 60)}`;

const fmtMS = (seconds) =>
  `${p2(Math.max(0, seconds) / 60)}:${p2(Math.max(0, seconds) % 60)}`;

const fmtDur = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  return h ? `${h} soat ${m} daq` : `${m} daq`;
};

function lineStatus(line, time, activeCount) {
  if (time >= line.startSec && time < line.endSec) {
    return { key: "open", label: "Jadval bo‘yicha ochiq" };
  }

  if (activeCount > 0) {
    return { key: "finishing", label: "Oxirgi poyezdlar yo‘lda" };
  }

  const until =
    time < line.startSec
      ? line.startSec - time
      : line.startSec + DAY - time;

  return {
    key: "closed",
    label: `Yopiq · ochilishiga ${fmtDur(until)}`,
  };
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

  return (
    p.name_uz ||
    p.name ||
    p.station_name ||
    p.name_ru ||
    "Nomsiz bekat"
  );
}

function getLine(feature) {
  const p = feature.properties || {};

  const raw = [
    p.line,
    p.line_name,
    p.line_id,
    p.route,
    p.route_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (raw.includes("yunus") || raw.includes("green")) return lines[2];

  if (
    raw.includes("circle") ||
    raw.includes("ring") ||
    raw.includes("halqa") ||
    raw.includes("independence")
  ) {
    return lines[3];
  }

  if (
    raw.includes("uzbekiston") ||
    raw.includes("o'zbekiston") ||
    raw.includes("o‘zbekiston") ||
    raw.includes("uzbekistan") ||
    raw.includes("blue")
  ) {
    return lines[1];
  }

  if (raw.includes("chilonzor") || raw.includes("red")) {
    return lines[0];
  }

  return null;
}

function findLineByStationName(name) {
  const normalized = normalize(name);

  const matches = lines.filter((line) =>
    line.stations.some((station) => {
      const expected = normalize(station);

      return (
        expected === normalized ||
        (expected.length >= 6 &&
          normalized.length >= 6 &&
          (expected.includes(normalized) ||
            normalized.includes(expected)))
      );
    })
  );

  return matches.length === 1 ? matches[0] : null;
}

function matchPoints(line, stations) {
  return line.stations
    .map((stationName) => {
      const expected = normalize(stationName);

      const exact = stations.find(
        (station) =>
          station.line?.id === line.id &&
          normalize(station.name) === expected
      );

      if (exact) return exact;
      if (expected.length < 7) return null;

      const matches = stations.filter((station) => {
        const name = normalize(station.name);

        return (
          station.line?.id === line.id &&
          name.length >= 7 &&
          (name.includes(expected) || expected.includes(name))
        );
      });

      return matches.length === 1 ? matches[0] : null;
    })
    .filter((station, i, arr) => station && arr.indexOf(station) === i);
}

function stationIcon(color, selected) {
  const size = selected ? 18 : 12;

  return L.divIcon({
    className: "metro-station-icon",
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 0 8px ${color}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function trainIcon(color, selected = false) {
  return L.divIcon({
    className: `metro-train-icon ${selected ? "train-selected" : ""}`,
    html: `
      <div class="train-hitbox">
        <svg class="train-svg" width="34" height="34" viewBox="0 0 34 34">
          <circle cx="17" cy="17" r="14" fill="${color}" stroke="#fff" stroke-width="2.5"/>
          <rect x="10.5" y="10" width="13" height="14" rx="3" fill="#fff"/>
          <rect x="12.5" y="12" width="4" height="4" rx="1" fill="${color}"/>
          <rect x="18" y="12" width="3.5" height="4" rx="1" fill="${color}"/>
          <path d="M12 21h10" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

function FocusMap({ station }) {
  const map = useMap();

  useEffect(() => {
    if (station) {
      map.flyTo([station.lat, station.lng], 15, { duration: 0.6 });
    }
  }, [station, map]);

  return null;
}

function useSimClock() {
  const ref = useRef({
    real: Date.now(),
    sim: Date.now() + TZ,
    speed: 1,
  });

  const [ui, setUi] = useState({ speed: 1, shifted: false });

  const getMs = useCallback(() => {
    const clock = ref.current;

    return clock.sim + (Date.now() - clock.real) * clock.speed;
  }, []);

  const getSec = useCallback(
    () => ((getMs() / 1000) % DAY + DAY) % DAY,
    [getMs]
  );

  const setSpeed = (speed) => {
    ref.current = {
      real: Date.now(),
      sim: getMs(),
      speed,
    };

    setUi((state) => ({ ...state, speed }));
  };

  const jump = (seconds) => {
    const day = Math.floor(getMs() / 86400000) * 86400000;

    ref.current = {
      real: Date.now(),
      sim: day + seconds * 1000,
      speed: ref.current.speed,
    };

    setUi((state) => ({ ...state, shifted: true }));
  };

  const reset = () => {
    ref.current = {
      real: Date.now(),
      sim: Date.now() + TZ,
      speed: 1,
    };

    setUi({ speed: 1, shifted: false });
  };

  return { getSec, ui, setSpeed, jump, reset };
}

function TrainsLayer({
  engineRef,
  getSec,
  lineFilterRef,
  selectedRef,
  followRef,
  onPickRef,
  onStopFollowRef,
}) {
  const map = useMap();

  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const markers = new Map();
    let frameId;

    const render = () => {
      const engine = engineRef.current;

      if (engine) {
        const visible = new Set();

        for (const train of engine.getTrains(getSec())) {
          const filter = lineFilterRef.current;

          if (filter !== "all" && filter !== train.lineId) continue;

          visible.add(train.id);

          let marker = markers.get(train.id);

          if (!marker) {
            marker = L.marker([train.lat, train.lng], {
              icon: trainIcon(train.color, selectedRef.current === train.id),
              zIndexOffset: 1200,
              keyboard: false,
              bubblingMouseEvents: false,
            });

            const trainId = train.id;

            marker.on("click", (event) => {
              L.DomEvent.stopPropagation(event);

              onPickRef.current(trainId);

              const position = marker.getLatLng();

              if (map.getZoom() < 14) {
                map.setView(position, 14, { animate: true });
              }
            });

            marker.addTo(group);
            markers.set(train.id, marker);
          } else {
            marker.setLatLng([train.lat, train.lng]);

            const selected = selectedRef.current === train.id;

            if (marker.options.icon.options.className !==
              `metro-train-icon ${selected ? "train-selected" : ""}`) {
              marker.setIcon(trainIcon(train.color, selected));
            }
          }

          const element = marker.getElement();
          const svg = element?.querySelector(".train-svg");

          if (svg) {
            svg.style.transform = `rotate(${train.bearing}deg)`;
          }
        }

        for (const [id, marker] of markers) {
          if (!visible.has(id)) {
            group.removeLayer(marker);
            markers.delete(id);
          }
        }

        const followId = followRef.current;

        if (followId && markers.has(followId)) {
          map.panTo(markers.get(followId).getLatLng(), {
            animate: false,
          });
        }
      }

      frameId = requestAnimationFrame(render);
    };

    const stopFollowing = () => onStopFollowRef.current();

    map.on("dragstart", stopFollowing);
    render();

    return () => {
      cancelAnimationFrame(frameId);
      map.off("dragstart", stopFollowing);
      group.remove();
    };
  }, [map, engineRef, getSec, lineFilterRef, selectedRef, followRef, onPickRef, onStopFollowRef]);

  return null;
}

const panelCls =
  "absolute bottom-2 left-2 right-2 z-[1000] max-h-[46%] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--border)] bg-[var(--panel)]/95 p-3 text-[var(--text)] shadow-2xl backdrop-blur sm:bottom-4 sm:left-4 sm:right-4 sm:max-h-[55%] sm:p-5 md:left-auto md:right-4 md:w-[380px] md:max-h-[70%]";

function StationPanel({ station, simSec, engine, trainsOnLine, onClose }) {
  const line = station.line;

  const status = line
    ? lineStatus(line, simSec, trainsOnLine)
    : null;

  const arrivals = line
    ? engine.getArrivals(line.id, station.id, simSec, 2)
    : {};

  const has = arrivals.fwd || arrivals.back;

  return (
    <section className={panelCls}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-widest text-[var(--accent)]">
            TANLANGAN BEKAT
          </p>

          <h2 className="mt-1 break-words text-lg font-bold sm:text-xl">
            {station.name}
          </h2>

          <p className="mt-1 text-xs text-[var(--muted)]">
            {line?.name || "Liniya aniqlanmagan"}
          </p>
        </div>

        <button
          onClick={onClose}
          className="shrink-0 rounded-lg p-2 hover:bg-[var(--soft)]"
          aria-label="Yopish"
        >
          <X size={19} />
        </button>
      </div>

      {line && status ? (
        <div className="mt-3 rounded-xl bg-[var(--soft)] p-3 sm:p-4">
          <div className="flex items-center gap-2">
            {status.key === "closed" ? (
              <CircleX size={18} className="shrink-0 text-red-500" />
            ) : (
              <CircleCheck
                size={18}
                className={`shrink-0 ${
                  status.key === "open"
                    ? "text-[var(--accent)]"
                    : "text-amber-500"
                }`}
              />
            )}

            <span className="text-xs font-semibold sm:text-sm">
              {status.label}
            </span>
          </div>

          <div className="mt-3 flex justify-between gap-2 text-xs sm:text-sm">
            <span className="text-[var(--muted)]">Ish vaqti</span>
            <span>{line.start}–{line.end}</span>
          </div>

          <div className="mt-2 flex justify-between gap-2 text-xs sm:text-sm">
            <span className="text-[var(--muted)]">Poyezd intervali</span>
            <span className="text-right">
              {line.peak} / {line.offPeak}
            </span>
          </div>

          <div className="mt-4 border-t border-[var(--border)] pt-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Clock3 size={17} className="text-amber-500" />
              Keyingi poyezdlar
            </div>

            {!has ? (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Bu bekat marshrut modelida topilmadi.
              </p>
            ) : (
              ["fwd", "back"].map((direction) => {
                const arrival = arrivals[direction];

                if (!arrival) return null;

                return (
                  <div
                    key={direction}
                    className="mt-3 rounded-lg border border-[var(--border)] p-3"
                  >
                    <p className="text-xs text-[var(--muted)]">
                      → {arrival.terminal}
                    </p>

                    {arrival.list.length === 0 ? (
                      <p className="mt-2 text-sm">Poyezd yo‘q</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                        {arrival.list.map((item, index) => (
                          <div key={index}>
                            <div
                              className={`font-mono text-lg font-bold ${
                                index === 0
                                  ? "text-[var(--accent)]"
                                  : ""
                              }`}
                            >
                              {item.eta > 1800
                                ? fmtClock(item.at)
                                : fmtMS(item.eta)}
                            </div>

                            <div className="text-[10px] text-[var(--muted)]">
                              {item.eta > 1800
                                ? "Kelish vaqti"
                                : fmtClock(item.at)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            <p className="mt-3 text-[10px] leading-4 text-[var(--muted)]">
              Kelish vaqtlari simulyatsiya modeli bo‘yicha taxminiy.
              Bu real vaqt ma’lumoti emas.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-xl bg-[var(--soft)] p-3 text-sm text-[var(--muted)]">
          Ushbu bekat uchun liniya aniqlanmadi.
        </div>
      )}
    </section>
  );
}

function TrainPanel({ train, simSec, follow, onFollow, onClose }) {
  return (
    <section className={panelCls}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className="flex items-center gap-2 text-[10px] font-bold tracking-widest"
            style={{ color: train?.color || "var(--accent)" }}
          >
            <TrainFront size={15} />
            POYEZD MA’LUMOTI
          </p>

          <h2 className="mt-1 text-lg font-bold sm:text-xl">
            {train ? train.line.name : "Poyezd"}
          </h2>

          {train && (
            <p className="mt-1 text-xs text-[var(--muted)]">
              → {train.terminal} tomon
            </p>
          )}
        </div>

        <button
          onClick={onClose}
          className="shrink-0 rounded-lg p-2 hover:bg-[var(--soft)]"
          aria-label="Yopish"
        >
          <X size={19} />
        </button>
      </div>

      {!train ? (
        <p className="mt-3 rounded-xl bg-[var(--soft)] p-4 text-sm">
          Poyezd marshrutni tugatdi.
        </p>
      ) : (
        <div className="mt-3 rounded-xl bg-[var(--soft)] p-3 text-xs sm:p-4 sm:text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-[var(--muted)]">Holati</span>

            <span className="max-w-[65%] text-right font-semibold">
              {train.moving
                ? `${train.from.name} → ${train.to.name}`
                : `Bekatda: ${train.from.name}`}
            </span>
          </div>

          <div className="mt-3 flex justify-between gap-3">
            <span className="text-[var(--muted)]">
              {train.moving ? "Keyingi bekatgacha" : "Jo‘nashgacha"}
            </span>

            <span className="font-mono font-bold text-[var(--accent)]">
              {fmtMS(train.eta)}
            </span>
          </div>

          {train.to && (
            <>
              <div className="mt-3 flex justify-between gap-3">
                <span className="text-[var(--muted)]">Keyingi bekat</span>
                <span className="max-w-[65%] text-right font-semibold">
                  {train.to.name}
                </span>
              </div>

              {train.nextArrivalEta != null && (
                <div className="mt-3 rounded-lg border border-[var(--border)] p-3">
                  <div className="text-[10px] text-[var(--muted)] sm:text-xs">
                    Keyingi bekatga yetib borish
                  </div>

                  <div className="mt-1 text-xl font-black tabular-nums">
                    {fmtClock(simSec + train.nextArrivalEta)}
                  </div>

                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    Qolgan vaqt: {fmtDur(train.nextArrivalEta)}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="mt-3 flex justify-between gap-3">
            <span className="text-[var(--muted)]">Tezlik</span>

            <span>
              {train.moving
                ? `~${Math.round(train.speed)} km/soat`
                : "To‘xtagan"}
            </span>
          </div>

          <div className="mt-3 flex justify-between gap-3">
            <span className="text-[var(--muted)]">Jo‘nash vaqti</span>
            <span>{fmtClock(train.dep)}</span>
          </div>

          <button
            onClick={onFollow}
            className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl border py-3 font-semibold transition ${
              follow
                ? "border-transparent bg-green-500 text-black"
                : "border-[var(--border)] hover:bg-[var(--soft)]"
            }`}
          >
            <Crosshair size={17} />
            {follow ? "Kuzatish yoqilgan" : "Poyezdni kuzatish"}
          </button>
        </div>
      )}
    </section>
  );
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("metro-theme");

      if (saved === "dark" || saved === "light") return saved;
    } catch {}

    return "dark";
  });

  const [stations, setStations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedTrain, setSelectedTrain] = useState(null);
  const [follow, setFollow] = useState(false);
  const [search, setSearch] = useState("");
  const [activeLine, setActiveLine] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showStations, setShowStations] = useState(false);
  const [, setTick] = useState(0);

  const clock = useSimClock();
  const simSec = clock.getSec();

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 500);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("metro-theme", theme);
    } catch {}
  }, [theme]);

  const loadStations = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(DATA_URL);

      if (!response.ok) {
        throw new Error("Bekatlar yuklanmadi. Internetni tekshiring.");
      }

      const geojson = await response.json();

      if (!Array.isArray(geojson.features)) {
        throw new Error("GeoJSON ma’lumot formati noto‘g‘ri.");
      }

      const parsed = geojson.features
        .filter((feature) => feature.geometry?.type === "Point")
        .map((feature, index) => {
          const [lng, lat] = feature.geometry.coordinates;
          const name = getName(feature);

          return {
            id: String(
              feature.properties?.station_id ??
                feature.properties?.id ??
                index
            ),
            name,
            lat: Number(lat),
            lng: Number(lng),
            line:
              getLine(feature) || findLineByStationName(name),
            properties: feature.properties || {},
          };
        })
        .filter(
          (station) =>
            Number.isFinite(station.lat) &&
            Number.isFinite(station.lng) &&
            Math.abs(station.lat) <= 90 &&
            Math.abs(station.lng) <= 180
        );

      if (!parsed.length) {
        throw new Error("Bekatlar topilmadi.");
      }

      setStations(parsed);

      setSelected((previous) =>
        previous
          ? parsed.find((station) => station.id === previous.id) || null
          : null
      );
    } catch (err) {
      setError(err.message || "Ma’lumot yuklashda xato.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStations();
  }, [loadStations]);

  const visibleStations = useMemo(
    () =>
      stations.filter((station) => {
        const matchesSearch = normalize(station.name).includes(
          normalize(search)
        );

        const matchesLine =
          activeLine === "all" ||
          station.line?.id === activeLine;

        return matchesSearch && matchesLine;
      }),
    [stations, search, activeLine]
  );

  const routes = useMemo(
    () =>
      lines.map((line) => ({
        line,
        pts: matchPoints(line, stations),
      })),
    [stations]
  );

  const engine = useMemo(() => buildEngine(routes), [routes]);
  const trains = engine.getTrains(simSec);

  const trainsByLine = {};

  for (const train of trains) {
    trainsByLine[train.lineId] =
      (trainsByLine[train.lineId] || 0) + 1;
  }

  const shownTrains = trains.filter(
    (train) =>
      activeLine === "all" || train.lineId === activeLine
  );

  const trainObj = selectedTrain
    ? trains.find((train) => train.id === selectedTrain) || null
    : null;

  const engineRef = useRef(engine);
  const lineFilterRef = useRef(activeLine);
  const selectedRef = useRef(selectedTrain);
  const followRef = useRef(null);
  const onPickRef = useRef(() => {});
  const onStopFollowRef = useRef(() => {});

  engineRef.current = engine;
  lineFilterRef.current = activeLine;
  selectedRef.current = selectedTrain;

  followRef.current =
    follow && selectedTrain ? selectedTrain : null;

  onPickRef.current = (id) => {
    setSelectedTrain(id);
    setSelected(null);
    setFollow(false);
  };

  onStopFollowRef.current = () => setFollow(false);

  const routeLines = routes.filter(
    (route) =>
      activeLine === "all" || activeLine === route.line.id
  );

  const selectStation = (station) => {
    setSelected(station);
    setSelectedTrain(null);
    setFollow(false);
    setShowStations(false);
  };

  const selectLine = (id) => {
    setActiveLine(id);
    setSelected(null);
    setSelectedTrain(null);
    setFollow(false);
  };

  return (
    <div
      data-theme={theme}
      className="min-h-screen overflow-x-hidden bg-[var(--bg)] text-[var(--text)]"
    >
      <style>{`
        :root {
          --bg: #080b12;
          --panel: #0c111c;
          --card: #151c29;
          --soft: rgba(255,255,255,.06);
          --border: rgba(255,255,255,.12);
          --text: #fff;
          --muted: #94a3b8;
          --accent: #4ade80;
          --accent-bg: rgba(34,197,94,.15);
        }

        [data-theme="light"] {
          --bg: #f3f5f9;
          --panel: #fff;
          --card: #eef1f6;
          --soft: rgba(15,23,42,.06);
          --border: rgba(15,23,42,.14);
          --text: #0f172a;
          --muted: #475569;
          --accent: #15803d;
          --accent-bg: rgba(22,163,74,.12);
        }

        .metro-train-icon {
          background: transparent;
          border: 0;
          overflow: visible;
          cursor: pointer !important;
          pointer-events: auto !important;
        }

        .metro-train-icon .train-hitbox {
          display: flex;
          width: 44px;
          height: 44px;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          border-radius: 50%;
          transition: transform .15s ease;
        }

        .metro-train-icon .train-svg {
          display: block;
          overflow: visible;
          transform-origin: 50% 50%;
          filter: drop-shadow(0 2px 5px rgba(0,0,0,.55));
          transition: filter .15s ease;
        }

        .metro-train-icon:hover .train-hitbox {
          transform: scale(1.18);
        }

        .metro-train-icon.train-selected .train-svg {
          filter: drop-shadow(0 0 8px #fff);
        }

        .leaflet-container {
          background: #e5e7eb;
          font-family: inherit;
          z-index: 0;
        }

        .leaflet-control-attribution {
          font-size: 9px !important;
        }

        button, input {
          -webkit-tap-highlight-color: transparent;
        }

        .safe-bottom {
          padding-bottom: max(12px, env(safe-area-inset-bottom));
        }
      `}</style>

      <header className="relative z-[1100] flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-3 py-3 sm:px-5 sm:py-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="rounded-xl bg-[var(--accent-bg)] p-2 text-[var(--accent)] sm:p-3">
            <TrainFront size={25} />
          </div>

          <div className="min-w-0">
            <h1 className="truncate text-sm font-black tracking-wide sm:text-xl">
              TASHKENT METRO
            </h1>

            <p className="hidden text-xs text-[var(--muted)] sm:block">
              Metro xaritasi · poyezdlar simulyatsiyasi
            </p>

            <p className="text-[10px] text-[var(--muted)] sm:hidden">
              Metro xaritasi
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="text-right">
            <p className="hidden text-[10px] text-[var(--muted)] sm:block">
              Toshkent vaqti
            </p>

            <p className="font-mono text-xs font-semibold tabular-nums sm:text-base">
              {fmtHMS(simSec)}
            </p>
          </div>

          <button onClick={() => setTheme((value) => value === "dark" ? "light" : "dark") }
            className="rounded-xl cursor-pointer border border-[var(--border)] p-2.5 hover:bg-[var(--soft)]"
            aria-label="Mavzuni almashtirish"
            title="Mavzuni almashtirish">
              
            {theme === "dark" ? (
              <Sun size={18} />
            ) : (
              <Moon size={18} />
            )}
          </button>

          <button
            onClick={loadStations}
            disabled={loading}
            className="rounded-xl border border-[var(--border)] p-2.5 hover:bg-[var(--soft)] disabled:opacity-50"
            aria-label="Yangilash"
            title="Bekatlarni yangilash"
          >
            <RefreshCw
              size={18}
              className={loading ? "animate-spin" : ""}
            />
          </button>
        </div>
      </header>

      <main className="relative">
        {/* MAP */}
        <section className="relative h-[calc(100dvh-65px)] min-h-[430px] w-full sm:h-[calc(100dvh-76px)] lg:h-[calc(100dvh-76px)]">
          <MapContainer
            center={[41.3111, 69.2797]}
            zoom={12}
            zoomControl={false}
            preferCanvas
            className="h-full w-full"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {routeLines.map(({ line, pts }) =>
              pts.length > 1 ? (
                <Polyline
                  key={line.id}
                  positions={pts.map((station) => [
                    station.lat,
                    station.lng,
                  ])}
                  pathOptions={{
                    color: line.color,
                    weight: 5,
                    opacity: 0.9,
                  }}
                />
              ) : null
            )}

            {visibleStations.map((station) => (
              <Marker
                key={station.id}
                position={[station.lat, station.lng]}
                icon={stationIcon(
                  station.line?.color || "#94a3b8",
                  selected?.id === station.id
                )}
                eventHandlers={{
                  click: () => selectStation(station),
                }}
              >
                <Popup>
                  <strong>{station.name}</strong>
                  <br />
                  {station.line?.name || "Liniya aniqlanmagan"}
                  <br />
                  {station.line
                    ? `Ish vaqti: ${station.line.start}–${station.line.end}`
                    : "Ish vaqti aniqlanmagan"}
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

          {/* LEFT: LINE FILTERS */}
          <div className="absolute left-2 top-2 z-[500] w-[min(205px,54vw)] sm:left-4 sm:top-4 sm:w-[245px]">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)]/95 p-2.5 shadow-xl backdrop-blur sm:p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-black tracking-wider sm:text-xs">
                  METRO LINIYALARI
                </span>

                <span className="rounded-md bg-[var(--accent-bg)] px-2 py-1 text-[10px] font-bold text-[var(--accent)]">
                  {shownTrains.length} poyezd
                </span>
              </div>

              <button
                onClick={() => selectLine("all")}
                className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition sm:text-sm ${
                  activeLine === "all"
                    ? "bg-[var(--accent-bg)] text-[var(--accent)]"
                    : "hover:bg-[var(--soft)]"
                }`}
              >
                <MapPin size={15} />
                Barcha liniyalar
              </button>

              {lines.map((line) => {
                const status = lineStatus(
                  line,
                  simSec,
                  trainsByLine[line.id] || 0
                );

                return (
                  <button
                    key={line.id}
                    onClick={() => selectLine(line.id)}
                    className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition ${
                      activeLine === line.id
                        ? "bg-[var(--soft)]"
                        : "hover:bg-[var(--soft)]"
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: line.color }}
                    />

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[10px] font-semibold sm:text-xs">
                        {line.name}
                      </span>

                      <span className="block text-[9px] text-[var(--muted)] sm:text-[10px]">
                        {line.start}–{line.end}
                      </span>
                    </span>

                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        status.key === "open"
                          ? "bg-green-400"
                          : status.key === "finishing"
                            ? "bg-amber-400"
                            : "bg-red-400"
                      }`}
                      title={status.label}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* BOTTOM LEFT: SEARCH */}
          <div className="absolute bottom-3 left-2 z-[500] w-[min(240px,62vw)] sm:bottom-4 sm:left-4 sm:w-[280px]">
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)]/95 p-2.5 shadow-xl backdrop-blur">
              <Search
                size={17}
                className="shrink-0 text-[var(--muted)]"
              />

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Bekatni qidiring..."
                className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted)] sm:text-sm"
              />

              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="rounded-md p-1 hover:bg-[var(--soft)]"
                  aria-label="Qidiruvni tozalash"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            <button
              onClick={() => setShowStations((value) => !value)}
              className="mt-2 flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)]/95 p-2.5 text-xs shadow-lg backdrop-blur"
            >
              <span className="flex items-center gap-2">
                <Menu size={16} />
                Bekatlar: {visibleStations.length} ta
              </span>

              <ChevronDown
                size={16}
                className={`transition-transform ${
                  showStations ? "rotate-180" : ""
                }`}
              />
            </button>

            {showStations && (
              <div className="mt-2 max-h-[35dvh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-2 shadow-2xl">
                {visibleStations.map((station) => (
                  <button
                    key={station.id}
                    onClick={() => selectStation(station)}
                    className={`flex w-full items-center gap-2 rounded-lg p-2.5 text-left text-xs ${
                      selected?.id === station.id
                        ? "bg-[var(--accent-bg)] text-[var(--accent)]"
                        : "hover:bg-[var(--soft)]"
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          station.line?.color || "#94a3b8",
                      }}
                    />

                    <span className="min-w-0 flex-1">
                      {station.name}
                    </span>
                  </button>
                ))}

                {visibleStations.length === 0 && (
                  <p className="p-3 text-xs text-[var(--muted)]">
                    Bekat topilmadi.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* LOADING / ERROR */}
          {loading && (
            <div className="absolute left-1/2 top-1/2 z-[600] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--border)] bg-[var(--panel)]/95 px-4 py-3 text-xs shadow-xl sm:text-sm">
              <RefreshCw
                size={16}
                className="mr-2 inline animate-spin"
              />
              Bekatlar yuklanmoqda...
            </div>
          )}

          {error && (
            <div className="absolute left-2 right-2 top-1/2 z-[600] mx-auto max-w-sm -translate-y-1/2 rounded-xl border border-red-400/40 bg-[var(--panel)] p-4 shadow-xl sm:left-4 sm:right-4">
              <p className="text-sm text-red-500">{error}</p>

              <button
                onClick={loadStations}
                className="mt-3 rounded-lg bg-[var(--accent-bg)] px-3 py-2 text-xs font-semibold text-[var(--accent)]"
              >
                Qayta urinish
              </button>
            </div>
          )}

          {/* SELECTED TRAIN / STATION PANEL */}
          {selectedTrain ? (
            <TrainPanel
              train={trainObj}
              simSec={simSec}
              follow={follow}
              onFollow={() => setFollow((value) => !value)}
              onClose={() => {
                setSelectedTrain(null);
                setFollow(false);
              }}
            />
          ) : selected ? (
            <StationPanel
              station={selected}
              simSec={simSec}
              engine={engine}
              trainsOnLine={
                selected.line
                  ? trainsByLine[selected.line.id] || 0
                  : 0
              }
              onClose={() => setSelected(null)}
            />
          ) : null}

          {/* INFO */}
          {!selected && !selectedTrain && (
            <div className="pointer-events-none absolute bottom-[104px] right-2 z-[400] max-w-[145px] rounded-xl border border-[var(--border)] bg-[var(--panel)]/90 p-2.5 text-[10px] leading-4 text-[var(--muted)] shadow-lg backdrop-blur sm:bottom-4 sm:right-4 sm:max-w-[205px] sm:p-3 sm:text-xs">
              <div className="mb-1 flex items-center gap-1.5 font-bold text-[var(--text)]">
                <Info size={14} className="text-amber-500" />
                Qanday ishlaydi?
              </div>

              Poyezdni bosing — ma’lumotlari ochiladi. Bekatni bosing —
              kelish vaqtlarini ko‘ring.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
