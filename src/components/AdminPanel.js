import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API = 'http://127.0.0.1:8000';

const inp = {
  width: '100%', background: '#151820', border: '1px solid #2A2F42',
  borderRadius: 8, padding: '9px 12px', color: '#F1F5F9', fontSize: 13, outline: 'none',
  boxSizing: 'border-box'
};

export default function AdminPanel() {
  const [crews, setCrews] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [created, setCreated] = useState(null);
  const [form, setForm] = useState({
    name: '', car_brand: '', car_model: '', engine_volume: '',
    fuel_type: 'бензин', fuel_consumption_city: '', fuel_consumption_highway: '',
    color: '#3B82F6', member_count: 2
  });

  useEffect(() => {
    axios.get(`${API}/crews`).then(r => setCrews(r.data)).catch(() => {});
  }, []);

  const submit = async () => {
    try {
      const res = await axios.post(`${API}/crews`, {
        ...form,
        engine_volume: parseFloat(form.engine_volume),
        fuel_consumption_city: parseFloat(form.fuel_consumption_city),
        fuel_consumption_highway: parseFloat(form.fuel_consumption_highway),
        member_logins: Array(parseInt(form.member_count)).fill(''),
      });
      setCreated(res.data);
      setCrews(c => [...c, { ...res.data.crew, crew_members: [] }]);
      setShowForm(false);
    } catch(e) { alert('Ошибка создания экипажа'); }
  };

  return (
    <div style={{ padding: 20, maxWidth: 800, margin: '0 auto', overflow: 'auto', height: 'calc(100vh - 52px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ color: '#94A3B8', fontSize: 13 }}>Экипажей: {crews.length}</span>
        <button onClick={() => { setShowForm(!showForm); setCreated(null); }} style={{
          padding: '8px 16px', borderRadius: 8, background: '#3B82F6',
          border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer'
        }}>+ Новый экипаж</button>
      </div>

      {/* Форма создания */}
      {showForm && (
        <div style={{ background: '#0E1117', border: '1px solid #3B82F655', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ color: '#F1F5F9', fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Создать экипаж</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'Название экипажа', key: 'name', ph: 'Орлы' },
              { label: 'Марка авто', key: 'car_brand', ph: 'Toyota' },
              { label: 'Модель авто', key: 'car_model', ph: 'Camry 2.5' },
              { label: 'Объём двигателя (л)', key: 'engine_volume', ph: '2.5' },
              { label: 'Расход город (л/100км)', key: 'fuel_consumption_city', ph: '10.5' },
              { label: 'Расход трасса (л/100км)', key: 'fuel_consumption_highway', ph: '7.5' },
            ].map(f => (
              <div key={f.key}>
                <div style={{ color: '#475569', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 5 }}>{f.label.toUpperCase()}</div>
                <input placeholder={f.ph} value={form[f.key]} onChange={e => setForm({...form, [f.key]: e.target.value})} style={inp} />
              </div>
            ))}
            <div>
              <div style={{ color: '#475569', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 5 }}>ТИП ТОПЛИВА</div>
              <select value={form.fuel_type} onChange={e => setForm({...form, fuel_type: e.target.value})} style={inp}>
                <option value="бензин">Бензин</option>
                <option value="дизель">Дизель</option>
                <option value="газ">Газ (LPG)</option>
              </select>
            </div>
            <div>
              <div style={{ color: '#475569', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 5 }}>КОЛИЧЕСТВО СОТРУДНИКОВ</div>
              <select value={form.member_count} onChange={e => setForm({...form, member_count: e.target.value})} style={inp}>
                <option value={1}>1 сотрудник</option>
                <option value={2}>2 сотрудника</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={submit} style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#3B82F6', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Создать</button>
            <button onClick={() => setShowForm(false)} style={{ padding: '10px 16px', borderRadius: 8, background: 'transparent', border: '1px solid #2A2F42', color: '#475569', fontSize: 13, cursor: 'pointer' }}>Отмена</button>
          </div>
        </div>
      )}

      {/* Логины после создания */}
      {created && (
        <div style={{ background: '#14532D22', border: '1px solid #22C55E44', borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <div style={{ color: '#22C55E', fontWeight: 700, fontSize: 13, marginBottom: 10 }}>✅ Экипаж создан! Логины сотрудников:</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {created.members?.map((m, i) => (
              <div key={i} style={{ background: '#151820', borderRadius: 8, padding: '8px 14px', border: '1px solid #2A2F42' }}>
                <div style={{ color: '#22C55E', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>{m.login}</div>
                <div style={{ color: '#F59E0B', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>{m.password}</div>
                <div style={{ color: '#475569', fontSize: 10, marginTop: 4 }}>Отправь в WhatsApp</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Список экипажей */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {crews.map(c => (
          <div key={c.id} style={{ background: '#0E1117', border: '1px solid #2A2F42', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: c.color || '#3B82F6', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ color: '#F1F5F9', fontWeight: 700, fontSize: 13 }}>«{c.name}»</div>
              <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>{c.car_brand} {c.car_model} · {c.fuel_type} · {c.engine_volume}л</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#475569', fontSize: 11 }}>Город: {c.fuel_consumption_city} л/100км</div>
              <div style={{ color: '#475569', fontSize: 11 }}>Трасса: {c.fuel_consumption_highway} л/100км</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
