import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import type {StudentsView} from '@softlans/contracts';
import {api} from './api';
import {DataTable,EmptyState,ErrorState,LoadingSkeleton,StatusBadge} from './ui';
export function DashboardStudents(){
 const [data,setData]=useState<StudentsView|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setError('');api<StudentsView>('/students?pageSize=5&page=1').then(d=>{if(active)setData(d)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[retry]);
 return <section className="panel dashboard-students"><div className="section-heading"><h2>O‘quvchilar</h2><Link className="button light" to="/students">Barchasini ko‘rish</Link></div><p className="muted small">Markazingizdagi so‘nggi yozuvlar</p>{error?<ErrorState message={error} onRetry={()=>setRetry(retry+1)}/>:!data?<LoadingSkeleton/>:!data.students.length?<EmptyState title="O‘quvchilar hali yo‘q"/>:<DataTable caption="So‘nggi o‘quvchilar" headings={['O‘quvchi','Holat','Profil']}>{data.students.map(s=><tr key={s.id}><td><div className="table-name"><span className="avatar">{s.firstName.slice(0,1)}</span><strong>{s.firstName} {s.lastName}</strong></div></td><td><StatusBadge>{s.status==='active'?'Faol':s.status==='paused'?'To‘xtatilgan':'Arxivlangan'}</StatusBadge></td><td><Link className="text-button" to={`/students/${s.id}`}>Ko‘rish</Link></td></tr>)}</DataTable>}</section>
}
