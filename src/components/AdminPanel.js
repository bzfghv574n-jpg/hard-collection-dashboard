import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API = 'https://web-production-c4605.up.railway.app';

const inp = {
  width: '100%', background: '#151820', border: '1px solid #2A2F42',
  borderRadius: 8, padding: '9px 12px', color: '#F1F5F9', fontSize: 13, outline: 'none',
  boxSizing: 'border-box'
};

const FUEL_TYPES = ['бензин', 'дизель', 'газ'];
const FUEL_LABELS = { 'бензин': 'Бензин (АИ-92)', 'дизель': 'Дизель', 'газ': 'Газ (LPG)' };

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button onClick={copy} style={{
      padding: '2px 8px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
      background: copied ? '#14532D' : '#1C2030',
      border: `1px solid ${copied ? '#22C55E44' : '#2A2F42'}`,
      color: copied ? '#22C55E' : '#475569', flexShrink: 0
    }}>{copied ? '✓' : '⎘'}</button>
  );
}

export default function AdminPanel() {
  const [tab, setTab] = useState('crews');
  const [crews, setCrews] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [created, setCreated] = useState(null);
  const [members, setMembers] = useState([{ full_name: '' }, { full_name: '' }]);
  const [form, setForm] = useState({
    name: '', car_brand: '', car_model: '', engine_volume: '',
    fuel_type: 'бензин', fuel_consumption_city: '', fuel_consumption_highway: '',
    color: '#3B82F6',
  });
  const [resetPasswords, setResetPasswords] = useState({}); // employee_id -> new password
  const [fuelPrices, setFuelPrices] = useState({});
  const [fuelForm, setFuelForm] = useState({ бензин: 245, дизель: 260, газ: 95 });
  const [fuelSaved, setFuelSaved] = useState(false);

  useEffect(() => {
    axios.get(`${API}/crews`).then(r => setCrews(r.data)).catch(() => {});
    axios.get(`${API}/fuel-prices`).then(r => {
      const prices = {};
      r.data.forEach(p => { if (!prices[p.fuel_type]) prices[p.fuel_type] = p.price_per_liter; });
      setFuelPrices(prices);
      setFuelForm({
        бензин: prices['бензин'] || 245,
        дизель: prices['дизель'] || 260,
        газ: prices['газ'] || 95,
      });
    }).catch(() => {});
  }, []);

  const addMember = () => setMembers([...members, { full_name: '' }]);
  const removeMember = (i) => { if (members.length > 1) setMembers(members.filter((_, idx) => idx !== i)); };
  const updateMember = (i, val) => setMembers(members.map((m, idx) => idx === i ? { full_name: val } : m));

  const submit = async () => {
    if (!form.name || !form.car_brand || !form.car_model || !form.engine_volume) { alert('Заполни все поля'); return; }
    if (members.some(m => !m.full_name.trim())) { alert('Заполни ФИО всех сотрудников'); return; }
    try {
      const res = await axios.post(`${API}/crews`, {
        ...form,
        engine_volume: parseFloat(form.engine_volume),
        fuel_consumption_city: parseFloat(form.fuel_consumption_city),
        fuel_consumption_highway: parseFloat(form.fuel_consumption_highway),
        member_logins: members.map(m => m.full_name.trim()),
      });
      setCreated(res.data);
      setCrews(c => [...c, { ...res.data.crew, crew_members: [] }]);
      setShowForm(false);
      setMembers([{ full_name: '' }, { full_name: '' }]);
      setForm({ name: '', car_brand: '', car_model: '', engine_volume: '', fuel_type: 'бензин', fuel_consumption_city: '', fuel_consumption_highway: '', color: '#3B82F6' });
    } catch(e) { alert('Ошибка: ' + (e.response?.data?.detail || e.message)); }
  };

  const deleteCrew = async (crewId, crewName) => {
    if (!window.confirm(`Удалить экипаж «${crewName}»?`)) return;
    try {
      await axios.delete(`${API}/crews/${crewId}`);
      setCrews(crews.filter(c => c.id !== crewId));
    } catch(e) { alert('Ошибка: ' + (e.response?.data?.detail || e.message)); }
  };

  const resetPassword = async (employeeId) => {
    try {
      const res = await axios.post(`${API}/employees/${employeeId}/reset-password`);
      setResetPasswords(p => ({ ...p, [employeeId]: res.data.password }));
    } catch(e) { alert('Ошибка сброса пароля'); }
  };

  const saveFuelPrices = async () => {
    try {
      for (const fuel_type of FUEL_TYPES) {
        if (fuelForm[fuel_type]) {
          await axios.post(`${API}/fuel-prices`, { fuel_type, price_per_liter: parseFloat(fuelForm[fuel_type]) });
        }
      }
      setFuelSaved(true);
      setTimeout(() => setFuelSaved(false), 3000);
    } catch(e) { alert('Ошибка сохранения цен'); }
  };

  return (
    <div style={{ padding: 20, maxWidth: 860, margin: '0 auto', overflow: 'auto', height: 'calc(100vh - 52px)' }}>

      {/* Табы */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[{ key: 'crews', label: '👥 Экипажи' }, { key: 'fuel', label: '⛽ Цены топлива' }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: tab === t.key ? '#1D3A6E' : 'transparent',
            border: `1px solid ${tab === t.key ? '#3B82F6' : '#2A2F42'}`,
            color: tab === t.key ? '#3B82F6' : '#475569',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ─── ЭКИПАЖИ ─── */}
      {tab === 'crews' && (
        <>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                {[
                  { label: 'Название экипажа', key: 'name', ph: 'Орлы' },
                  { label: 'Марка авто', key: 'car_brand', ph: 'Toyota' },
                  { label: 'Модель авто', key: 'car_model', ph: 'Camry' },
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
                    {FUEL_TYPES.map(f => <option key={f} value={f}>{FUEL_LABELS[f]}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ color: '#475569', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 5 }}>ЦВЕТ ЭКИПАЖА</div>
                  <input type="color" value={form.color} onChange={e => setForm({...form, color: e.target.value})}
                    style={{ ...inp, padding: 4, height: 38, cursor: 'pointer' }} />
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ color: '#475569', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>СОТРУДНИКИ</div>
                  <button onClick={addMember} style={{ padding: '4px 10px', borderRadius: 6, background: '#1D3A6E', border: '1px solid #3B82F644', color: '#3B82F6', fontSize: 11, cursor: 'pointer' }}>+ Добавить</button>
                </div>
                {members.map((m, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <div style={{ width: 22, height: 22, borderRadius: 6, background: '#1C2030', border: '1px solid #2A2F42', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#3B82F6', fontWeight: 800, flexShrink: 0 }}>{i + 1}</div>
                    <input placeholder={`ФИО сотрудника ${i + 1}`} value={m.full_name} onChange={e => updateMember(i, e.target.value)} style={inp} />
                    {members.length > 1 && (
                      <button onClick={() => removeMember(i)} style={{ padding: '6px 10px', borderRadius: 6, background: 'transparent', border: '1px solid #EF444444', color: '#EF4444', fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>✕</button>
                    )}
                  </div>
                ))}
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
              <div style={{ color: '#22C55E', fontWeight: 700, fontSize: 13, marginBottom: 10 }}>✅ Экипаж «{created.crew?.name}» создан!</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {created.members?.map((m, i) => (
                  <div key={i} style={{ background: '#151820', borderRadius: 8, padding: '8px 14px', border: '1px solid #2A2F42' }}>
                    <div style={{ color: '#94A3B8', fontSize: 11, marginBottom: 6 }}>{members[i]?.full_name || `Сотрудник ${i+1}`}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ color: '#22C55E', fontSize: 12, fontWeight: 700, fontFamily: 'monospace' }}>{m.login}</span>
                      <CopyBtn text={m.login} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: '#F59E0B', fontSize: 12, fontWeight: 700, fontFamily: 'monospace' }}>{m.password}</span>
                      <CopyBtn text={m.password} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Список экипажей */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {crews.map(c => (
              <div key={c.id} style={{ background: '#0E1117', border: '1px solid #2A2F42', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: c.color || '#3B82F6', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#F1F5F9', fontWeight: 700, fontSize: 13 }}>«{c.name}»</div>
                    <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>{c.car_brand} {c.car_model} · {FUEL_LABELS[c.fuel_type] || c.fuel_type} · {c.engine_volume}л</div>
                  </div>
                  <div style={{ textAlign: 'right', marginRight: 12 }}>
                    <div style={{ color: '#475569', fontSize: 11 }}>Город: {c.fuel_consumption_city} л/100км</div>
                    <div style={{ color: '#475569', fontSize: 11 }}>Трасса: {c.fuel_consumption_highway} л/100км</div>
                  </div>
                  <button onClick={() => deleteCrew(c.id, c.name)} style={{
                    padding: '6px 12px', borderRadius: 7, background: 'transparent',
                    border: '1px solid #EF444444', color: '#EF4444', fontSize: 12, cursor: 'pointer', flexShrink: 0
                  }}>🗑</button>
                </div>

                {/* Сотрудники с логинами */}
                {c.crew_members && c.crew_members.length > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #2A2F42' }}>
                    <div style={{ color: '#475569', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8 }}>СОТРУДНИКИ</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {c.crew_members.map((cm, i) => {
                        const empId = cm.employees?.id;
                        const newPass = resetPasswords[empId];
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#151820', borderRadius: 8, padding: '7px 10px', border: '1px solid #2A2F42' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ color: '#F1F5F9', fontSize: 12, fontWeight: 600 }}>{cm.employees?.full_name || '—'}</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                                <span style={{ color: '#22C55E', fontSize: 11, fontFamily: 'monospace' }}>
                                  Логин: {cm.employees?.login}
                                </span>
                                <CopyBtn text={cm.employees?.login || ''} />
                              </div>
                              {newPass && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                                  <span style={{ color: '#F59E0B', fontSize: 11, fontFamily: 'monospace' }}>
                                    Новый пароль: {newPass}
                                  </span>
                                  <CopyBtn text={newPass} />
                                </div>
                              )}
                            </div>
                            <button onClick={() => resetPassword(empId)} style={{
                              padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                              background: 'transparent', border: '1px solid #F59E0B44', color: '#F59E0B', flexShrink: 0
                            }}>🔑 Сбросить пароль</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ─── ЦЕНЫ ТОПЛИВА ─── */}
      {tab === 'fuel' && (
        <div style={{ background: '#0E1117', border: '1px solid #2A2F42', borderRadius: 12, padding: 20, maxWidth: 500 }}>
          <div style={{ color: '#F1F5F9', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>⛽ Цены топлива</div>
          <div style={{ color: '#475569', fontSize: 11, marginBottom: 20 }}>
            Используются для расчёта стоимости в отчётах. Обновляй при изменении цен на АЗС.
          </div>
          {FUEL_TYPES.map(ft => (
            <div key={ft} style={{ marginBottom: 14 }}>
              <div style={{ color: '#475569', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 6 }}>
                {FUEL_LABELS[ft].toUpperCase()} (₸/литр)
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="number" value={fuelForm[ft]} onChange={e => setFuelForm({...fuelForm, [ft]: e.target.value})}
                  placeholder="245" style={{ ...inp, maxWidth: 180 }} />
                {fuelPrices[ft] && (
                  <span style={{ color: '#475569', fontSize: 11 }}>Текущая: {fuelPrices[ft]} ₸</span>
                )}
              </div>
            </div>
          ))}
          <button onClick={saveFuelPrices} style={{
            width: '100%', padding: '10px', borderRadius: 8, marginTop: 8,
            background: fuelSaved ? '#14532D' : '#3B82F6',
            border: `1px solid ${fuelSaved ? '#22C55E' : 'transparent'}`,
            color: fuelSaved ? '#22C55E' : '#fff',
            fontSize: 13, fontWeight: 700, cursor: 'pointer'
          }}>{fuelSaved ? '✅ Цены сохранены!' : 'Сохранить цены'}</button>
        </div>
      )}
    </div>
  );
}