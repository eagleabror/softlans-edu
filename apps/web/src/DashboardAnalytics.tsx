import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AttendanceSummary, FinancialReport } from '@softlans/contracts';
import { api } from './api';
import { reportDates } from './FinancialReports';
import { uzs } from './Billing';

/** Read-only visualizations of existing authorized analytics; never synthesize metrics. */
export function DashboardAnalytics({ financial, attendance }: { financial: boolean; attendance?: AttendanceSummary }) {
 const [report,setReport]=useState<FinancialReport|null>(null);
 const [error,setError]=useState('');
 const [retry,setRetry]=useState(0);
 useEffect(()=>{ if(!financial) return; let active=true; setError('');
 const dates=reportDates(6);
 api<FinancialReport>(`/analytics/dashboard?${new URLSearchParams(dates)}`).then(d=>{if(active)setReport(d)}).catch(e=>{if(active)setError(e.message)});
 return ()=>{active=false}; },[financial,retry]);
 const rows=attendance ? [{name:'Kelgan',value:attendance.present},{name:'Kelmagan',value:attendance.absent},{name:'Kechikkan',value:attendance.late},{name:'Sababli',value:attendance.excused}] : [];
 const colors=['#5932ea','#c2aff4','#ed5eb9','#9197b3'];
 return <div className="dashboard-analytics">
 {financial && <section className="panel"><div className="section-heading"><h2>To‘lovlar dinamikasi</h2><span className="small-tag">Oxirgi 6 oy · UZS</span></div><p className="muted small">Markazingizdagi haqiqiy oylik tushumlar</p>
 {error ? <div className="notice" role="alert">{error} <button className="text-button" onClick={()=>setRetry(retry+1)}>Qayta urinish</button></div> : !report ? <p className="loading-panel" role="status">Grafik yuklanmoqda…</p> : <><div className="chart-container" role="img" aria-label="Oylik to‘lovlar ustunli grafigi"><ResponsiveContainer width="100%" height="100%"><BarChart data={report.monthly} accessibilityLayer><CartesianGrid vertical={false} stroke="#eceef5"/><XAxis dataKey="month" tick={{fontSize:11}} axisLine={false} tickLine={false}/><YAxis width={55} tick={{fontSize:11}} tickFormatter={v=>new Intl.NumberFormat('uz-UZ',{notation:'compact'}).format(v)} axisLine={false} tickLine={false}/><Tooltip formatter={v=>uzs(Number(v))}/><Bar name="To‘lovlar" dataKey="payments" fill="#5932ea" radius={[8,8,0,0]} maxBarSize={36}/></BarChart></ResponsiveContainer></div><details><summary className="muted small">Grafik ma’lumotlari</summary><div className="table-scroll"><table><thead><tr><th scope="col">Oy</th><th scope="col">To‘lovlar</th></tr></thead><tbody>{report.monthly.map(r=><tr key={r.month}><td>{r.month}</td><td>{uzs(r.payments)}</td></tr>)}</tbody></table></div></details></>}
 </section>}
 {attendance && <section className="panel"><h2>Davomat taqsimoti</h2><p className="muted small">Belgilangan davomat bo‘yicha</p>{attendance.marked ? <div className="chart-container" role="img" aria-label={`Davomat: ${attendance.attendancePercentage ?? 0}%`}><ResponsiveContainer width="100%" height="100%"><PieChart accessibilityLayer><Pie data={rows} dataKey="value" nameKey="name" innerRadius="65%" outerRadius="85%" paddingAngle={3}>{rows.map((r,i)=><Cell key={r.name} fill={colors[i]}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer></div> : <p className="empty-state">Hali davomat belgilanmagan.</p>}<div className="chart-legend">{rows.map((r,i)=><span key={r.name} style={{'--legend-color':colors[i]} as React.CSSProperties}>{r.name}: {r.value}</span>)}</div></section>}
 </div>;
}
