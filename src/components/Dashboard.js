import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import 'leaflet/dist/leaflet.css';

const API = 'https://web-production-c4605.up.railway.app';

const crewIcon = (color) => L.divIcon({
  className: '',
  html: `<div style="
    width:32px;height:32px;border-radius:50%;
    background:${color};border:3px solid #fff;
    display:flex;align-items:center;justify-content:center;
    font-size:11px;font-weight:800;color:#fff;
    box-shadow:0 2px 8px ${color}88;
  ">●</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const stopIcon = (label) => L.divIcon({
  className: '',
  html: `<div style="
    width:24px;height:24px;border-radius:6px;
    background:#1C2030;border:2px solid #3B82F6;
    display:flex;align-items:center;justify-content:center;
    font-size:9px;font-weight:800;color:#3B82F6;
  ">${label}</div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const STATUS = {
  active:   { label: 'НА ЛИНИИ',    color: '#22C55E' },
  break:    { label: 'ПЕРЕРЫВ',     color: '#F59E0B' },
  tech:     { label: 'ТЕХ. СТОП',  color: '#A855F7' },
  finished: { label: 'ЗАВЕРШИЛ',    color: '#475569' },
  offline:  { label: 'ОФФЛАЙН',    color: '#374151' },
};

function Tag({ status }) {
  const s = STATUS[status] || STATUS.offline;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.07em',
      color: s.color, background: s.color + '22',
      border: `1px solid ${s.color}44`,
      borderRadius: 4, padding: '2px 6px'
    }}>{s.label}</span>
  );
}

export default function Dashboard() {
  const [crews, setCrews] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tracks, setTracks] = useState({});
  const [stops, setStops] = useState({});
  const [archiveTab, setArchiveTab] = useState(false);
  const [archiveDate, setArchiveDate] = useState(new Date().toISOString().slice(0,10));
  const [archiveCrew, setArchiveCrew] = useState('');
  const [archiveStats, setArchiveStats] = useState({}); // stats per crew for archive date

  // Загрузка живых данных
  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get(`${API}/dashboard/live`);
        setCrews(res.data);
        if (!archiveCrew && res.data.length) setArchiveCrew(res.data[0].crew.id);
      } catch(e) {}
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  // Загрузка архивных статов при смене даты
  useEffect(() => {
    if (!archiveTab || !crews.length) return;
    const loadArchiveStats = async () => {
      try {
        const res = await axios.get(`${API}/reports/summary`, {
          params: { date_from: archiveDate, date_to: archiveDate }
        });
        // Группируем по crew_id
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
  }, [archiveTab, archiveDate, crews.length]);

  // Загрузка треков при выборе экипажа
  useEffect(() => {
    if (!selected) return;
    const loadTrack = async () => {
      try {
        const date = archiveTab ? archiveDate : new Date().toISOString().slice(0,10);
        const [trackRes, stopRes] = await Promise.all([
          axios.get(`${API}/gps/track/${selected}`, { params: { shift_date: date } }),
          axios.get(`${API}/stops/${selected}`, { params: { shift_date: date } }),
        ]);
        setTracks(t => ({ ...t, [selected]: trackRes.data }));
        setStops(s => ({ ...s, [selected]: stopRes.data }));
      } catch(e) {}
    };
    loadTrack();
    if (!archiveTab) {
      const interval = setInterval(loadTrack, 15000);
      return () => clearInterval(interval);
    }
  }, [selected, archiveTab, archiveDate]);

  const selCrew = crews.find(c => c.crew.id === selected);
  const selTrack = tracks[selected] || [];
  const selStops = stops[selected] || [];

  // Получаем stats для выбранного экипажа (архив или live)
  const getCrewStats = (crewId) => {
    if (archiveTab && archiveStats[crewId]) {
      return archiveStats[crewId];
    }
    const c = crews.find(x => x.crew.id === crewId);
    return { total_km: c?.total_km || 0, fuel_used: c?.total_fuel || 0, fuel_cost: c?.total_cost || 0 };
  };

  // Excel выгрузка
  const exportExcel = async () => {
    try {
      const res = await axios.get(`${API}/reports/summary`, {
        params: { date_from: archiveDate, date_to: archiveDate, crew_id: archiveCrew }
      });

      // Получаем точки остановок для экипажа
      const stopsRes = await axios.get(`${API}/stops/${archiveCrew}`, {
        params: { shift_date: archiveDate }
      });

      const rows = res.data.map(s => ({
        'Дата': s.date,
        'Экипаж': s.crews?.name || '',
        'Авто': `${s.crews?.car_brand || ''} ${s.crews?.car_model || ''}`,
        'Сотрудник': s.employees?.full_name || '',
        'Начало смены': s.started_at ? new Date(s.started_at).toLocaleTimeString() : '',
        'Конец смены': s.ended_at ? new Date(s.ended_at).toLocaleTimeString() : '',
        'Пробег (км)': parseFloat(s.total_km || 0).toFixed(2),
        'Расход (л)': parseFloat(s.fuel_used || 0).toFixed(2),
        'Стоимость (₸)': parseFloat(s.fuel_cost || 0).toFixed(0),
      }));

      const stopRows = stopsRes.data.map(st => ({
        'Метка': st.point_label,
        'Адрес': st.address || `${st.lat.toFixed(4)}, ${st.lng.toFixed(4)}`,
        'Время прибытия': new Date(st.arrived_at).toLocaleTimeString(),
        'Длительность (мин)': st.duration_minutes || '',
      }));

      const ws1 = XLSX.utils.json_to_sheet(rows);
      const ws2 = XLSX.utils.json_to_sheet(stopRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'Смены');
      XLSX.utils.book_append_sheet(wb, ws2, 'Точки остановок');
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(new Blob([buf]), `hard_collection_${archiveDate}.xlsx`);
    } catch(e) { alert('Ошибка выгрузки'); }
  };

  // KPI — для архива суммируем из archiveStats, для live из crews
  const totalKm = archiveTab
    ? Object.values(archiveStats).reduce((s, c) => s + c.total_km, 0)
    : crews.reduce((s, c) => s + (c.total_km || 0), 0);
  const totalFuel = archiveTab
    ? Object.values(archiveStats).reduce((s, c) => s + c.fuel_used, 0)
    : crews.reduce((s, c) => s + (c.total_fuel || 0), 0);
  const totalCost = archiveTab
    ? Object.values(archiveStats).reduce((s, c) => s + c.fuel_cost, 0)
    : crews.reduce((s, c) => s + (c.total_cost || 0), 0);
  const activeCount = crews.filter(c => c.shifts?.some(s => s.status === 'active')).length;

  const mapCenter = [48.0, 68.0];

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Левая панель */}
      <div style={{
        width: 280, flexShrink: 0, background: '#0E1117',
        borderRight: '1px solid #2A2F42',
        display: 'flex', flexDirection: 'column', overflow: 'hidden'
      }}>
        {/* KPI */}
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

        {/* Список экипажей */}
        <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
          <div style={{ color: '#475569', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 8 }}>
            ЭКИПАЖИ · {crews.length}
          </div>
          {crews.map(c => {
            const crewStatus = archiveTab ? 'offline' : (c.shifts?.find(s => ['active','break','tech'].includes(s.status))?.status || 'offline');
            const stats = getCrewStats(c.crew.id);
            const memberCount = c.crew.crew_members?.length || 0;
            const onlineCount = c.shifts?.length || 0;
            const incomplete = !archiveTab && onlineCount > 0 && onlineCount < memberCount;
            return (
              <div
                key={c.crew.id}
                onClick={() => setSelected(selected === c.crew.id ? null : c.crew.id)}
                style={{
                  padding: '9px 11px', borderRadius: 9, cursor: 'pointer', marginBottom: 6,
                  background: selected === c.crew.id ? '#1C2030' : '#151820',
                  border: `1px solid ${selected === c.crew.id ? (c.crew.color || '#3B82F6') + '66' : '#2A2F42'}`,
                  transition: 'all 0.15s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                  <div style={{
                    width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                    background: c.crew.color || '#3B82F6',
                    boxShadow: crewStatus === 'active' ? `0 0 6px ${c.crew.color}` : 'none'
                  }} />
                  <span style={{ color: '#F1F5F9', fontSize: 12, fontWeight: 700 }}>«{c.crew.name}»</span>
                  {!archiveTab && <Tag status={crewStatus} />}
                </div>
                {incomplete && (
                  <div style={{ marginLeft: 16, marginBottom: 3 }}>
                    <span style={{ fontSize: 9, color: '#F59E0B', fontWeight: 700 }}>⚠ НЕПОЛНЫЙ СОСТАВ {onlineCount}/{memberCount}</span>
                  </div>
                )}
                <div style={{ color: '#475569', fontSize: 10, paddingLeft: 16 }}>
                  {c.crew.car_brand} {c.crew.car_model} · {stats.total_km.toFixed(1)} км
                </div>
              </div>
            );
          })}
        </div>

        {/* Архив */}
        <div style={{ padding: 10, borderTop: '1px solid #2A2F42' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={() => setArchiveTab(false)} style={{
              flex: 1, padding: '6px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: !archiveTab ? '#1D3A6E' : 'transparent',
              border: `1px solid ${!archiveTab ? '#3B82F6' : '#2A2F42'}`,
              color: !archiveTab ? '#3B82F6' : '#475569'
            }}>🔴 Live</button>
            <button onClick={() => setArchiveTab(true)} style={{
              flex: 1, padding: '6px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: archiveTab ? '#1D3A6E' : 'transparent',
              border: `1px solid ${archiveTab ? '#3B82F6' : '#2A2F42'}`,
              color: archiveTab ? '#3B82F6' : '#475569'
            }}>📁 Архив</button>
          </div>
          {archiveTab && (
            <>
              <input type="date" value={archiveDate}
                onChange={e => { setArchiveDate(e.target.value); setSelected(null); setTracks({}); setStops({}); }}
                style={{ width: '100%', background: '#151820', border: '1px solid #2A2F42', borderRadius: 7, padding: '6px 8px', color: '#94A3B8', fontSize: 11, marginBottom: 6, boxSizing: 'border-box' }}
              />
              <select value={archiveCrew} onChange={e => setArchiveCrew(e.target.value)}
                style={{ width: '100%', background: '#151820', border: '1px solid #2A2F42', borderRadius: 7, padding: '6px 8px', color: '#94A3B8', fontSize: 11, marginBottom: 6, boxSizing: 'border-box' }}>
                {crews.map(c => <option key={c.crew.id} value={c.crew.id}>«{c.crew.name}»</option>)}
              </select>
              <button onClick={exportExcel} style={{
                width: '100%', padding: '8px', borderRadius: 8,
                background: '#14532D', border: '1px solid #22C55E44',
                color: '#22C55E', fontSize: 12, fontWeight: 700, cursor: 'pointer'
              }}>📥 Выгрузить Excel</button>
            </>
          )}
        </div>
      </div>

      {/* Карта */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <MapContainer center={mapCenter} zoom={5} style={{ flex: 1, minHeight: 0 }} zoomControl={true}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='© OpenStreetMap' />

          {/* Маркеры экипажей (только в live режиме) */}
          {!archiveTab && crews.map(c => {
            if (!c.last_position) return null;
            const stats = getCrewStats(c.crew.id);
            return (
              <Marker key={c.crew.id} position={[c.last_position.lat, c.last_position.lng]} icon={crewIcon(c.crew.color || '#3B82F6')}>
                <Popup>
                  <div style={{ fontFamily: 'Inter, sans-serif', minWidth: 160 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>«{c.crew.name}»</div>
                    <div style={{ fontSize: 12, color: '#666' }}>{c.crew.car_brand} {c.crew.car_model}</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>Пробег: {stats.total_km.toFixed(1)} км</div>
                    <div style={{ fontSize: 12 }}>Расход: {stats.fuel_used.toFixed(1)} л</div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* Маршрут */}
          {selTrack.length > 1 && (
            <Polyline positions={selTrack.map(p => [p.lat, p.lng])} color={selCrew?.crew?.color || '#3B82F6'} weight={3} opacity={0.8} />
          )}

          {/* Точки остановок */}
          {selStops.map((stop, i) => (
            <Marker key={stop.id} position={[stop.lat, stop.lng]} icon={stopIcon(stop.point_label)}>
              <Popup>
                <div style={{ fontFamily: 'Inter, sans-serif' }}>
                  <div style={{ fontWeight: 700 }}>Точка {stop.point_label}</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>{stop.address || 'Адрес определяется'}</div>
                  <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                    {new Date(stop.arrived_at).toLocaleTimeString()}
                    {stop.duration_minutes ? ` · ${stop.duration_minutes} мин` : ''}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {/* Детали выбранного экипажа */}
        {selCrew && (
          <div style={{ background: '#0E1117', borderTop: '1px solid #2A2F42', padding: '12px 16px', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#F1F5F9', fontWeight: 800, fontSize: 14 }}>«{selCrew.crew.name}»</span>
                <span style={{ color: '#475569', fontSize: 12 }}>{selCrew.crew.car_brand} {selCrew.crew.car_model}</span>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'transparent', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {(() => {
                const stats = getCrewStats(selCrew.crew.id);
                return [
                  { label: 'ПРОБЕГ', value: `${stats.total_km.toFixed(1)} км`, color: '#3B82F6' },
                  { label: 'РАСХОД', value: `${stats.fuel_used.toFixed(1)} л`, color: '#F59E0B' },
                  { label: 'СТОИМОСТЬ', value: `${stats.fuel_cost.toFixed(0)} ₸`, color: '#F59E0B' },
                  { label: 'ТОЧЕК', value: selStops.length, color: '#22C55E' },
                ].map((s, i) => (
                  <div key={i} style={{ background: '#151820', borderRadius: 8, padding: '8px 12px', border: '1px solid #2A2F42' }}>
                    <div style={{ color: '#475569', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em' }}>{s.label}</div>
                    <div style={{ color: s.color, fontSize: 18, fontWeight: 800, marginTop: 2 }}>{s.value}</div>
                  </div>
                ));
              })()}
            </div>
            {selStops.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 10, overflowX: 'auto', paddingBottom: 2 }}>
                {selStops.map((stop, i) => (
                  <div key={i} style={{ flexShrink: 0, background: '#151820', borderRadius: 8, padding: '6px 10px', border: '1px solid #2A2F42', minWidth: 110 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                      <div style={{ width: 18, height: 18, borderRadius: 4, background: '#1D3A6E', border: '1px solid #3B82F644', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 800, color: '#3B82F6' }}>{stop.point_label}</div>
                      <span style={{ color: '#475569', fontSize: 10 }}>{new Date(stop.arrived_at).toLocaleTimeString()}</span>
                    </div>
                    <div style={{ color: '#94A3B8', fontSize: 10 }}>{stop.address || `${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`}</div>
                    {stop.duration_minutes ? <div style={{ color: '#F59E0B', fontSize: 9, marginTop: 2 }}>{stop.duration_minutes} мин</div> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}