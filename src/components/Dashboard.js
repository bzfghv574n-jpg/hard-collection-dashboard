import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import 'leaflet/dist/leaflet.css';

const API = 'https://web-production-c4605.up.railway.app';


// Определяем мобильный экран
const isMobile = () => window.innerWidth < 768;

const crewIcon = (color) => L.divIcon({
  className: '',
  html: `<div style="width:32px;height:32px;border-radius:50%;background:${color};border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#fff;box-shadow:0 2px 8px ${color}88;">●</div>`,
  iconSize: [32, 32], iconAnchor: [16, 16],
});

const stopIcon = (label) => L.divIcon({
  className: '',
  html: `<div style="width:24px;height:24px;border-radius:6px;background:#1C2030;border:2px solid #3B82F6;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#3B82F6;">${label}</div>`,
  iconSize: [24, 24], iconAnchor: [12, 12],
});

const STATUS = {
  active:   { label: 'НА ЛИНИИ',   color: '#22C55E' },
  break:    { label: 'ПЕРЕРЫВ',    color: '#F59E0B' },
  tech:     { label: 'ТЕХ. СТОП', color: '#A855F7' },
  finished: { label: 'ЗАВЕРШИЛ',   color: '#475569' },
  offline:  { label: 'ОФФЛАЙН',   color: '#374151' },
};

function Tag({ status }) {
  const s = STATUS[status] || STATUS.offline;
  return <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', color: s.color, background: s.color + '22', border: `1px solid ${s.color}44`, borderRadius: 4, padding: '2px 6px' }}>{s.label}</span>;
}

function MapController({ flyTo }) {
  const map = useMap();
  useEffect(() => { if (flyTo) map.flyTo([flyTo.lat, flyTo.lng], 14, { duration: 1.2 }); }, [flyTo, map]);
  return null;
}

function StopTimer({ arrivedAt }) {
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    const calc = () => {
      const diff = Math.floor((Date.now() - new Date(arrivedAt).getTime()) / 1000);
      if (diff < 0) return;
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      if (h > 0) setElapsed(`${h}ч ${m}м`);
      else if (m > 0) setElapsed(`${m}м ${s}с`);
      else setElapsed(`${s}с`);
    };
    calc();
    const interval = setInterval(calc, 1000);
    return () => clearInterval(interval);
  }, [arrivedAt]);
  return <span style={{ color: '#F59E0B', fontSize: 9, fontWeight: 700 }}>⏱ {elapsed}</span>;
}

const VALHALLA = 'https://valhalla-kz.fly.dev/trace_route';

// Valhalla возвращает геометрию как закodированный polyline (precision 1e6),
// а не GeoJSON-координаты — декодируем сами (стандартный алгоритм Google polyline).
function decodePolyline(encoded, precision = 6) {
  const factor = Math.pow(10, precision);
  let index = 0, lat = 0, lng = 0;
  const coordinates = [];
  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Фильтрация GPS шума — убираем точки ближе MIN_DIST метров
function filterTrackPoints(points, minDist = 50) {
  if (points.length < 2) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    if (haversineM(prev.lat, prev.lng, points[i].lat, points[i].lng) >= minDist) {
      result.push(points[i]);
    }
  }
  return result;
}

async function matchToRoads(points) {
  if (points.length < 2) return points.map(p => [p.lat, p.lng]);

  // Фильтруем — минимум 50м между точками
  const filtered = filterTrackPoints(points, 50);
  if (filtered.length < 2) return points.map(p => [p.lat, p.lng]);

  const CHUNK = 80;
  let result = [];

  for (let i = 0; i < filtered.length; i += CHUNK) {
    const start = i === 0 ? 0 : i - 1;
    const chunk = filtered.slice(start, Math.min(start + CHUNK, filtered.length));

    if (chunk.length < 2) {
      if (i > 0) result = result.concat(chunk.slice(1).map(p => [p.lat, p.lng]));
      else result = result.concat(chunk.map(p => [p.lat, p.lng]));
      continue;
    }

    try {
      const res = await axios.post(VALHALLA, {
        shape: chunk.map(p => ({ lat: p.lat, lon: p.lng })),
        costing: 'auto',
        shape_match: 'map_snap',
      }, { timeout: 10000 });

      const shape = res.data?.trip?.legs?.[0]?.shape;
      if (shape) {
        const geo = decodePolyline(shape);
        result = result.concat(i === 0 ? geo : geo.slice(1));
      } else {
        result = result.concat(i === 0 ? chunk.map(p => [p.lat, p.lng]) : chunk.slice(1).map(p => [p.lat, p.lng]));
      }
    } catch (e) {
      // Fallback — прямые линии для этого чанка
      result = result.concat(i === 0 ? chunk.map(p => [p.lat, p.lng]) : chunk.slice(1).map(p => [p.lat, p.lng]));
    }
  }

  return result.length > 1 ? result : filtered.map(p => [p.lat, p.lng]);
}

export default function Dashboard() {
  const [mobile, setMobile] = useState(isMobile());
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile());
  const [crews, setCrews] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tracks, setTracks] = useState({});
  const [matchedTracks, setMatchedTracks] = useState({});
  const [stops, setStops] = useState({});
  const [archiveTab, setArchiveTab] = useState(false);
  const [archiveDate, setArchiveDate] = useState(new Date().toISOString().slice(0,10));
  const [archiveDateTo, setArchiveDateTo] = useState(new Date().toISOString().slice(0,10));
  const [archiveCrew, setArchiveCrew] = useState('');
  const [archiveStats, setArchiveStats] = useState({});
  const [archiveViewDate, setArchiveViewDate] = useState(new Date().toISOString().slice(0,10));
  const [flyTo, setFlyTo] = useState(null);
  const [matchingLoading, setMatchingLoading] = useState(false);

  const [panelHeight, setPanelHeight] = useState(180);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);
  const trackLoadingRef = useRef(false);

  useEffect(() => {
    const onResize = () => {
      setMobile(isMobile());
      if (!isMobile()) setSidebarOpen(true);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get(`${API}/dashboard/live`);
        setCrews(res.data);
        // Функциональная форма — иначе archiveCrew всегда читается из замыкания
        // первого рендера и "устанавливается один раз" превращается в "каждые 10с".
        setArchiveCrew(prev => prev || res.data[0]?.crew?.id || prev);
      } catch(e) {}
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!archiveTab || !crews.length) return;
    const loadArchiveStats = async () => {
      try {
        const res = await axios.get(`${API}/reports/summary`, { params: { date_from: archiveDate, date_to: archiveDateTo } });
        const stats = {};
        for (const shift of res.data) {
          const cid = shift.crew_id;
          if (!stats[cid]) stats[cid] = { total_km: 0, fuel_used: 0, fuel_cost: 0 };
          stats[cid].total_km += parseFloat(shift.total_km || 0);
          stats[cid].fuel_used += parseFloat(shift.fuel_used || 0);
          stats[cid].fuel_cost += parseFloat(shift.fuel_cost || 0);
        }
        setArchiveStats(stats);
      } catch(e) {}
    };
    loadArchiveStats();
  }, [archiveTab, archiveDate, archiveDateTo, crews.length]);

  useEffect(() => {
    if (!selected) return;
    const loadTrack = async () => {
      // Матчинг длинного трека может занять дольше, чем интервал опроса (15с) —
      // без этой защиты параллельные вызовы накапливаются друг на друга.
      if (trackLoadingRef.current) return;
      trackLoadingRef.current = true;
      try {
        const date = archiveTab ? archiveViewDate : new Date().toISOString().slice(0,10);
        const [trackRes, stopRes] = await Promise.all([
          axios.get(`${API}/gps/track/${selected}`, { params: { shift_date: date } }),
          axios.get(`${API}/stops/${selected}`, { params: { shift_date: date } }),
        ]);
        const rawTrack = trackRes.data;
        setTracks(t => ({ ...t, [selected]: rawTrack }));
        setStops(s => ({ ...s, [selected]: stopRes.data }));
        if (rawTrack.length >= 2) {
          setMatchingLoading(true);
          const matched = await matchToRoads(rawTrack);
          setMatchedTracks(m => ({ ...m, [selected]: matched }));
          setMatchingLoading(false);
        }
      } catch(e) { setMatchingLoading(false); }
      finally { trackLoadingRef.current = false; }
    };
    loadTrack();
    if (!archiveTab) {
      const interval = setInterval(loadTrack, 7000);
      return () => clearInterval(interval);
    }
  }, [selected, archiveTab, archiveViewDate]);

  const onDragStart = (e) => {
    isDragging.current = true;
    dragStartY.current = e.clientY || e.touches?.[0]?.clientY;
    dragStartH.current = panelHeight;
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!isDragging.current) return;
      const y = e.clientY || e.touches?.[0]?.clientY;
      const delta = dragStartY.current - y;
      setPanelHeight(Math.min(500, Math.max(60, dragStartH.current + delta)));
    };
    const onUp = () => { isDragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, []);

  const handleSelectCrew = (crewId) => {
    if (selected === crewId) { setSelected(null); setFlyTo(null); return; }
    setSelected(crewId);
    if (mobile) setSidebarOpen(false);
    const crew = crews.find(c => c.crew.id === crewId);
    if (crew?.last_position) setFlyTo({ lat: crew.last_position.lat, lng: crew.last_position.lng });
    else if (tracks[crewId]?.length > 0) {
      const last = tracks[crewId][tracks[crewId].length - 1];
      setFlyTo({ lat: last.lat, lng: last.lng });
    }
  };

  const selCrew = crews.find(c => c.crew.id === selected);
  const selTrack = matchedTracks[selected] || tracks[selected]?.map(p => [p.lat, p.lng]) || [];
  const selStops = stops[selected] || [];

  const getCrewStats = (crewId) => {
    if (archiveTab && archiveStats[crewId]) return archiveStats[crewId];
    const c = crews.find(x => x.crew.id === crewId);
    return { total_km: c?.total_km || 0, fuel_used: c?.total_fuel || 0, fuel_cost: c?.total_cost || 0 };
  };

  const exportExcel = async () => {
    try {
      const res = await axios.get(`${API}/reports/summary`, {
        params: { date_from: archiveDate, date_to: archiveDateTo, ...(archiveCrew ? { crew_id: archiveCrew } : {}) }
      });
      const shifts = res.data;

      // ── ЛИСТ 1: Сводка по экипажам ──────────────────────────────
      const crewMap = {};
      for (const s of shifts) {
        const cid = s.crew_id;
        if (!crewMap[cid]) {
          crewMap[cid] = {
            name: s.crews?.name || '',
            auto: `${s.crews?.car_brand || ''} ${s.crews?.car_model || ''}`.trim(),
            days: new Set(),
            total_km: 0, fuel_used: 0, fuel_cost: 0,
          };
        }
        crewMap[cid].days.add(s.date);
        crewMap[cid].total_km += parseFloat(s.total_km || 0);
        crewMap[cid].fuel_used += parseFloat(s.fuel_used || 0);
        crewMap[cid].fuel_cost += parseFloat(s.fuel_cost || 0);
      }

      const summaryRows = Object.values(crewMap).map(c => ({
        'Экипаж': c.name,
        'Авто': c.auto,
        'Период': `${archiveDate} — ${archiveDateTo}`,
        'Дней работы': c.days.size,
        'Пробег (км)': c.total_km.toFixed(2),
        'Расход (л)': c.fuel_used.toFixed(2),
        'Стоимость (₸)': Math.round(c.fuel_cost),
      }));

      // Итоговая строка
      summaryRows.push({
        'Экипаж': 'ИТОГО',
        'Авто': '',
        'Период': '',
        'Дней работы': '',
        'Пробег (км)': Object.values(crewMap).reduce((s, c) => s + c.total_km, 0).toFixed(2),
        'Расход (л)': Object.values(crewMap).reduce((s, c) => s + c.fuel_used, 0).toFixed(2),
        'Стоимость (₸)': Math.round(Object.values(crewMap).reduce((s, c) => s + c.fuel_cost, 0)),
      });

      // ── ЛИСТ 2: По дням ─────────────────────────────────────────
      // Группируем смены по дате+экипажу (суммируем если несколько сотрудников)
      const dayMap = {};
      for (const s of shifts) {
        const key = `${s.date}_${s.crew_id}`;
        if (!dayMap[key]) {
          dayMap[key] = {
            date: s.date,
            crew: s.crews?.name || '',
            auto: `${s.crews?.car_brand || ''} ${s.crews?.car_model || ''}`.trim(),
            employees: [],
            started_at: s.started_at,
            ended_at: s.ended_at,
            total_km: 0, fuel_used: 0, fuel_cost: 0,
          };
        }
        if (s.employees?.full_name) dayMap[key].employees.push(s.employees.full_name);
        dayMap[key].total_km += parseFloat(s.total_km || 0);
        dayMap[key].fuel_used += parseFloat(s.fuel_used || 0);
        dayMap[key].fuel_cost += parseFloat(s.fuel_cost || 0);
        if (s.started_at && (!dayMap[key].started_at || s.started_at < dayMap[key].started_at)) {
          dayMap[key].started_at = s.started_at;
        }
        if (s.ended_at && s.ended_at > (dayMap[key].ended_at || '')) {
          dayMap[key].ended_at = s.ended_at;
        }
      }

      const dayRows = Object.values(dayMap)
        .sort((a, b) => a.date.localeCompare(b.date) || a.crew.localeCompare(b.crew))
        .map(d => ({
          'Дата': d.date,
          'Экипаж': d.crew,
          'Авто': d.auto,
          'Сотрудники': [...new Set(d.employees)].join(', '),
          'Начало': d.started_at ? new Date(d.started_at).toLocaleTimeString() : '',
          'Конец': d.ended_at ? new Date(d.ended_at).toLocaleTimeString() : '',
          'Пробег (км)': d.total_km.toFixed(2),
          'Расход (л)': d.fuel_used.toFixed(2),
          'Стоимость (₸)': Math.round(d.fuel_cost),
        }));

      // ── ЛИСТ 3: Точки остановок ─────────────────────────────────
      let stopRows = [];
      const crewIds = archiveCrew ? [archiveCrew] : [...new Set(shifts.map(s => s.crew_id))];
      for (const cid of crewIds) {
        const crewName = crewMap[cid]?.name || '';
        // Берём точки за каждый день периода
        const days = archiveCrew
          ? [...(crewMap[cid]?.days || [])]
          : [...new Set(shifts.filter(s => s.crew_id === cid).map(s => s.date))];
        for (const day of days.sort()) {
          try {
            const stopsRes = await axios.get(`${API}/stops/${cid}`, { params: { shift_date: day } });
            stopsRes.data.forEach(st => stopRows.push({
              'Дата': day,
              'Экипаж': crewName,
              'Метка': st.point_label,
              'Адрес': st.address || `${st.lat.toFixed(4)}, ${st.lng.toFixed(4)}`,
              'Время прибытия': new Date(st.arrived_at).toLocaleTimeString(),
              'Длительность (мин)': st.duration_minutes || '',
            }));
          } catch(e) {}
        }
      }

      // ── Создаём Excel ───────────────────────────────────────────
      const wb = XLSX.utils.book_new();

      const ws1 = XLSX.utils.json_to_sheet(summaryRows);
      ws1['!cols'] = [20,20,24,14,14,12,16].map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws1, 'Сводка');

      const ws2 = XLSX.utils.json_to_sheet(dayRows);
      ws2['!cols'] = [12,14,16,24,10,10,13,12,15].map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws2, 'По дням');

      if (stopRows.length > 0) {
        const ws3 = XLSX.utils.json_to_sheet(stopRows);
        ws3['!cols'] = [12,14,8,30,14,16].map(w => ({ wch: w }));
        XLSX.utils.book_append_sheet(wb, ws3, 'Точки остановок');
      }

      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(new Blob([buf]), `hard_collection_${archiveDate}_${archiveDateTo}.xlsx`);
    } catch(e) { alert('Ошибка выгрузки: ' + e.message); }
  };

  const totalKm = archiveTab ? Object.values(archiveStats).reduce((s, c) => s + c.total_km, 0) : crews.reduce((s, c) => s + (c.total_km || 0), 0);
  const totalFuel = archiveTab ? Object.values(archiveStats).reduce((s, c) => s + c.fuel_used, 0) : crews.reduce((s, c) => s + (c.total_fuel || 0), 0);
  const totalCost = archiveTab ? Object.values(archiveStats).reduce((s, c) => s + c.fuel_cost, 0) : crews.reduce((s, c) => s + (c.total_cost || 0), 0);
  const activeCount = crews.filter(c => c.shifts?.some(s => s.status === 'active')).length;

  const sidebarW = mobile ? '100%' : 280;

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: mobile ? 'column' : 'row', height: '100vh' }}>

      {/* Мобильный хедер */}
      {mobile && (
        <div style={{ background: '#0E1117', borderBottom: '1px solid #2A2F42', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { label: `${activeCount}/${crews.length}`, sub: 'актив', color: '#3B82F6' },
              { label: `${totalKm.toFixed(0)} км`, sub: 'пробег', color: '#F1F5F9' },
              { label: `${totalCost.toFixed(0)} ₸`, sub: 'стоим', color: '#F59E0B' },
            ].map((k, i) => (
              <div key={i} style={{ background: '#151820', borderRadius: 6, padding: '4px 8px', border: '1px solid #2A2F42', textAlign: 'center' }}>
                <div style={{ color: k.color, fontSize: 12, fontWeight: 800 }}>{k.label}</div>
                <div style={{ color: '#475569', fontSize: 8 }}>{k.sub}</div>
              </div>
            ))}
          </div>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{
            padding: '6px 12px', borderRadius: 7, background: sidebarOpen ? '#1D3A6E' : '#151820',
            border: `1px solid ${sidebarOpen ? '#3B82F6' : '#2A2F42'}`,
            color: sidebarOpen ? '#3B82F6' : '#475569', fontSize: 11, cursor: 'pointer'
          }}>
            {sidebarOpen ? '✕ Закрыть' : '☰ Экипажи'}
          </button>
        </div>
      )}

      {/* Сайдбар */}
      {(sidebarOpen || !mobile) && (
        <div style={{
          width: sidebarW, flexShrink: 0, background: '#0E1117',
          borderRight: mobile ? 'none' : '1px solid #2A2F42',
          borderBottom: mobile ? '1px solid #2A2F42' : 'none',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          maxHeight: mobile ? '50vh' : '100%',
        }}>
          {/* KPI — только на десктопе */}
          {!mobile && (
            <div style={{ padding: '12px', borderBottom: '1px solid #2A2F42' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { label: 'АКТИВНЫХ', value: archiveTab ? '—' : `${activeCount}/${crews.length}`, color: '#3B82F6' },
                  { label: 'ПРОБЕГ', value: `${totalKm.toFixed(1)} км`, color: '#F1F5F9' },
                  { label: 'РАСХОД', value: `${totalFuel.toFixed(1)} л`, color: '#F59E0B' },
                  { label: 'СТОИМОСТЬ', value: `${totalCost.toFixed(0)} ₸`, color: '#F59E0B' },
                ].map((k, i) => (
                  <div key={i} style={{ background: '#151820', borderRadius: 8, padding: '8px 10px', border: '1px solid #2A2F42' }}>
                    <div style={{ color: '#475569', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em' }}>{k.label}</div>
                    <div style={{ color: k.color, fontSize: 16, fontWeight: 800, marginTop: 2 }}>{k.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Список экипажей */}
          <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
            <div style={{ color: '#475569', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8 }}>ЭКИПАЖИ · {crews.length}</div>
            {crews.map(c => {
              const crewStatus = archiveTab ? 'offline' : (c.shifts?.find(s => ['active','break','tech'].includes(s.status))?.status || 'offline');
              const stats = getCrewStats(c.crew.id);
              const memberCount = c.crew.crew_members?.length || 0;
              const onlineCount = c.shifts?.length || 0;
              const incomplete = !archiveTab && onlineCount > 0 && onlineCount < memberCount;
              return (
                <div key={c.crew.id} onClick={() => handleSelectCrew(c.crew.id)} style={{
                  padding: '9px 11px', borderRadius: 9, cursor: 'pointer', marginBottom: 6,
                  background: selected === c.crew.id ? '#1C2030' : '#151820',
                  border: `1px solid ${selected === c.crew.id ? (c.crew.color || '#3B82F6') + '66' : '#2A2F42'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: c.crew.color || '#3B82F6', boxShadow: crewStatus === 'active' ? `0 0 6px ${c.crew.color}` : 'none' }} />
                    <span style={{ color: '#F1F5F9', fontSize: 12, fontWeight: 700 }}>«{c.crew.name}»</span>
                    {!archiveTab && <Tag status={crewStatus} />}
                  </div>
                  {incomplete && <div style={{ marginLeft: 16, marginBottom: 3 }}><span style={{ fontSize: 9, color: '#F59E0B', fontWeight: 700 }}>⚠ НЕПОЛНЫЙ {onlineCount}/{memberCount}</span></div>}
                  <div style={{ color: '#475569', fontSize: 10, paddingLeft: 16 }}>{c.crew.car_brand} {c.crew.car_model} · {stats.total_km.toFixed(1)} км</div>
                </div>
              );
            })}
          </div>

          {/* Архив */}
          <div style={{ padding: 10, borderTop: '1px solid #2A2F42' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button onClick={() => setArchiveTab(false)} style={{ flex: 1, padding: '6px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: !archiveTab ? '#1D3A6E' : 'transparent', border: `1px solid ${!archiveTab ? '#3B82F6' : '#2A2F42'}`, color: !archiveTab ? '#3B82F6' : '#475569' }}>🔴 Live</button>
              <button onClick={() => setArchiveTab(true)} style={{ flex: 1, padding: '6px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: archiveTab ? '#1D3A6E' : 'transparent', border: `1px solid ${archiveTab ? '#3B82F6' : '#2A2F42'}`, color: archiveTab ? '#3B82F6' : '#475569' }}>📁 Архив</button>
            </div>
            {archiveTab && (
              <>
                {/* Период для Excel */}
                <div style={{ color: '#475569', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>ПЕРИОД ДЛЯ EXCEL</div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6 }}>
                  <input type="date" value={archiveDate} onChange={e => setArchiveDate(e.target.value)}
                    style={{ flex: 1, background: '#151820', border: '1px solid #2A2F42', borderRadius: 7, padding: '5px 6px', color: '#94A3B8', fontSize: 10, boxSizing: 'border-box' }} />
                  <span style={{ color: '#475569', fontSize: 10, flexShrink: 0 }}>—</span>
                  <input type="date" value={archiveDateTo} onChange={e => setArchiveDateTo(e.target.value)}
                    style={{ flex: 1, background: '#151820', border: '1px solid #2A2F42', borderRadius: 7, padding: '5px 6px', color: '#94A3B8', fontSize: 10, boxSizing: 'border-box' }} />
                </div>

                {/* День для просмотра трека */}
                <div style={{ color: '#475569', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>ДЕНЬ ДЛЯ ТРЕКА НА КАРТЕ</div>
                <input type="date" value={archiveViewDate} onChange={e => { setArchiveViewDate(e.target.value); setSelected(null); setTracks({}); setMatchedTracks({}); setStops({}); }}
                  style={{ width: '100%', background: '#151820', border: '1px solid #3B82F644', borderRadius: 7, padding: '6px 8px', color: '#3B82F6', fontSize: 11, marginBottom: 6, boxSizing: 'border-box' }} />

                {/* Экипаж */}
                <select value={archiveCrew} onChange={e => setArchiveCrew(e.target.value)}
                  style={{ width: '100%', background: '#151820', border: '1px solid #2A2F42', borderRadius: 7, padding: '6px 8px', color: '#94A3B8', fontSize: 11, marginBottom: 6, boxSizing: 'border-box' }}>
                  <option value="">— Все экипажи —</option>
                  {crews.map(c => <option key={c.crew.id} value={c.crew.id}>«{c.crew.name}»</option>)}
                </select>
                <button onClick={exportExcel} style={{ width: '100%', padding: '8px', borderRadius: 8, background: '#14532D', border: '1px solid #22C55E44', color: '#22C55E', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>📥 Excel</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Карта + нижняя панель */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', minHeight: 0 }}>


        {matchingLoading && (
          <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: '#0E1117', border: '1px solid #2A2F42', borderRadius: 8, padding: '6px 14px', fontSize: 11, color: '#94A3B8' }}>
            🗺 Привязка к дорогам...
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0 }}>
          <MapContainer center={[48.0, 68.0]} zoom={5} style={{ height: '100%', width: '100%' }} zoomControl={true}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='© OpenStreetMap' />
            <MapController flyTo={flyTo} />
            {!archiveTab && crews.map(c => {
              if (!c.last_position) return null;
              const stats = getCrewStats(c.crew.id);
              return (
                <Marker
                  key={c.crew.id}
                  position={[c.last_position.lat, c.last_position.lng]}
                  icon={crewIcon(c.crew.color || '#3B82F6')}
                  eventHandlers={{ click: () => handleSelectCrew(c.crew.id) }}
                >
                  <Popup>
                    <div style={{ fontFamily: 'Inter, sans-serif', minWidth: 140 }}>
                      <div style={{ fontWeight: 700 }}>«{c.crew.name}»</div>
                      <div style={{ fontSize: 12, color: '#666' }}>{c.crew.car_brand} {c.crew.car_model}</div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>Пробег: {stats.total_km.toFixed(1)} км</div>
                      <div style={{ fontSize: 11, color: '#3B82F6', marginTop: 4, cursor: 'pointer' }}
                        onClick={() => handleSelectCrew(c.crew.id)}>
                        Показать маршрут →
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
            {selTrack.length > 1 && <Polyline positions={selTrack} color={selCrew?.crew?.color || '#3B82F6'} weight={3} opacity={0.8} />}
            {selStops.map((stop, i) => (
              <Marker key={stop.id} position={[stop.lat, stop.lng]} icon={stopIcon(stop.point_label)}>
                <Popup>
                  <div style={{ fontFamily: 'Inter, sans-serif' }}>
                    <div style={{ fontWeight: 700 }}>Точка {stop.point_label}</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>{stop.address || 'Адрес...'}</div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                      {new Date(stop.arrived_at).toLocaleTimeString()}
                      {stop.duration_minutes ? ` · ${stop.duration_minutes} мин` : ''}
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* Нижняя панель */}
        {selCrew && (
          <div style={{ background: '#0E1117', borderTop: '1px solid #2A2F42', flexShrink: 0, height: mobile ? 'auto' : panelHeight, maxHeight: mobile ? '45vh' : undefined, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Ползунок — только на десктопе */}
            {!mobile && (
              <div onMouseDown={onDragStart} onTouchStart={onDragStart}
                style={{ height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'ns-resize', flexShrink: 0, borderBottom: '1px solid #2A2F42', userSelect: 'none' }}>
                <div style={{ width: 40, height: 4, borderRadius: 2, background: '#2A2F42' }} />
              </div>
            )}

            <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '8px 10px' : '8px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ color: '#F1F5F9', fontWeight: 800, fontSize: mobile ? 13 : 14 }}>«{selCrew.crew.name}»</span>
                  <span style={{ color: '#475569', fontSize: 11 }}>{selCrew.crew.car_brand} {selCrew.crew.car_model}</span>
                </div>
                <button onClick={() => { setSelected(null); setFlyTo(null); }} style={{ background: 'transparent', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 16 }}>✕</button>
              </div>

              {/* KPI */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: mobile ? 6 : 8, marginBottom: 10 }}>
                {(() => {
                  const stats = getCrewStats(selCrew.crew.id);
                  return [
                    { label: 'ПРОБЕГ', value: `${stats.total_km.toFixed(1)} км`, color: '#3B82F6' },
                    { label: 'РАСХОД', value: `${stats.fuel_used.toFixed(1)} л`, color: '#F59E0B' },
                    { label: 'СТОИМ', value: `${stats.fuel_cost.toFixed(0)} ₸`, color: '#F59E0B' },
                    { label: 'ТОЧЕК', value: selStops.length, color: '#22C55E' },
                  ].map((s, i) => (
                    <div key={i} style={{ background: '#151820', borderRadius: 7, padding: mobile ? '6px 8px' : '8px 12px', border: '1px solid #2A2F42' }}>
                      <div style={{ color: '#475569', fontSize: 8, fontWeight: 700, letterSpacing: '0.06em' }}>{s.label}</div>
                      <div style={{ color: s.color, fontSize: mobile ? 14 : 18, fontWeight: 800, marginTop: 2 }}>{s.value}</div>
                    </div>
                  ));
                })()}
              </div>

              {/* Точки — дедупликация по координатам+время */}
              {selStops.length > 0 && (() => {
                // Убираем дубли: если координаты совпадают с точностью 3 знака и время прибытия одинаковое
                const seen = new Set();
                const uniqueStops = selStops.filter(stop => {
                  const key = `${stop.lat.toFixed(3)}_${stop.lng.toFixed(3)}_${stop.arrived_at}`;
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                });
                return (
                  <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                    {uniqueStops.map((stop, i) => {
                      const isLast = i === uniqueStops.length - 1;
                      const isActive = isLast && !stop.duration_minutes && !archiveTab;
                      return (
                        <div key={stop.id || i} style={{
                          flexShrink: 0, background: '#151820', borderRadius: 8, padding: '6px 10px',
                          border: `1px solid ${isActive ? '#F59E0B44' : '#2A2F42'}`, minWidth: 120
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                            <div style={{ width: 18, height: 18, borderRadius: 4, background: isActive ? '#F59E0B22' : '#1D3A6E', border: `1px solid ${isActive ? '#F59E0B44' : '#3B82F644'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 800, color: isActive ? '#F59E0B' : '#3B82F6' }}>{stop.point_label}</div>
                            <span style={{ color: '#475569', fontSize: 10 }}>{new Date(stop.arrived_at).toLocaleTimeString()}</span>
                          </div>
                          <div style={{ color: '#94A3B8', fontSize: 10, marginBottom: 3 }}>{stop.address || `${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`}</div>
                          {stop.duration_minutes
                            ? <div style={{ color: '#475569', fontSize: 9 }}>🕐 {stop.duration_minutes} мин</div>
                            : isActive
                              ? <div style={{ marginTop: 2 }}><StopTimer arrivedAt={stop.arrived_at} /></div>
                              : null
                          }
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}