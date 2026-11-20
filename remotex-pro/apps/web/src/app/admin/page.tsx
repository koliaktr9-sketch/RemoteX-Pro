"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, token } from "../../lib/api";

type Overview={users:number;devices:number;activeSessions:number|null;auditEvents:number};
export default function AdminPage(){
  const [overview,setOverview]=useState<Overview|null>(null);
  const [users,setUsers]=useState<any[]>([]); const [devices,setDevices]=useState<any[]>([]); const [events,setEvents]=useState<any[]>([]);
  const [tab,setTab]=useState("overview"); const [message,setMessage]=useState("Loading admin data…"); const [busyDevice,setBusyDevice]=useState<string|null>(null);
  async function load(){
    try{
      if(!token())throw new Error("Sign in first using the Account page.");
      const [o,u,d,a]=await Promise.all([api("/admin/overview"),api("/admin/users"),api("/admin/devices"),api("/admin/audit")]);
      setOverview(o);setUsers(u.users);setDevices(d.devices);setEvents(a.events);setMessage("");
    }catch(e:any){setMessage(e.message)}
  }
  async function revokeDevice(id:string){
    if(!window.confirm("Revoke this device now? Its paired device token will stop working immediately."))return;
    setBusyDevice(id);setMessage("");
    try{await api(`/admin/devices/${id}/revoke`,{method:"POST"});await load();setMessage("Device revoked.")}catch(e:any){setMessage(e.message)}finally{setBusyDevice(null)}
  }
  useEffect(()=>{load()},[]);
  return <main className="adminShell">
    <aside className="adminSide"><Link href="/" className="adminBrand"><span className="brandMark">R</span> RemoteX <b>Pro</b></Link><p className="adminCaption">ADMIN CONSOLE</p>
      {["overview","users","devices","audit"].map(t=><button key={t} className={tab===t?"adminNav selected":"adminNav"} onClick={()=>setTab(t)}>{t==="overview"?"▦":t==="users"?"♙":t==="devices"?"▣":"◷"}　{t[0].toUpperCase()+t.slice(1)}</button>)}
      <div className="adminBottom"><Link href="/account">Account security</Link><Link href="/">Back to workspace</Link></div>
    </aside>
    <section className="adminMain"><header className="adminTop"><div><p className="eyebrow">CONTROL CENTER / {tab.toUpperCase()}</p><h1>{tab==="overview"?"System overview":tab==="users"?"User directory":tab==="devices"?"Device registry":"Security audit log"}</h1><p className="muted">Manage RemoteX identities, trusted devices and security activity.</p></div><button className="secondary" onClick={load}>↻ Refresh</button></header>
      {message&&<div className="adminNotice">{message}</div>}
      {tab==="overview"&&overview&&<><div className="metricGrid">{[["Registered users",overview.users,"♙"],["Active devices",overview.devices,"▣"],["Live sessions",overview.activeSessions??"—","↔"],["Audit events",overview.auditEvents,"◷"]].map(([label,value,icon])=><div className="metricCard" key={String(label)}><span>{icon}</span><p>{label}</p><strong>{value}</strong></div>)}</div><section className="adminCard"><h2>Security posture</h2><div className="postureRow"><span className="postureDot good"/> Registration uses bcrypt password hashing and short-lived signed access tokens.</div><div className="postureRow"><span className="postureDot good"/> MFA is available, encrypted at rest, and one-time TOTP steps are replay-protected.</div>
      <div className="postureRow"><span className="postureDot good"/> Device pairing secrets are one-time; paired devices receive short-lived scoped tokens.</div><div className="postureRow"><span className="postureDot warn"/> Live session count is not tracked; signaling remains development-only and unauthenticated.</div><div className="postureRow"><span className="postureDot warn"/> Native Windows/Android agent enforcement is not yet implemented.</div></section></>}
      {tab==="users"&&<section className="adminCard"><h2>Users <span className="muted">({users.length})</span></h2><div className="tableWrap"><table><thead><tr><th>Email</th><th>Role</th><th>MFA</th><th>Created</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td>{u.email}</td><td><span className="tag">{u.role}</span></td><td>{u.mfa_enabled?"Enabled":"Not enabled"}</td><td>{new Date(u.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div></section>}
      {tab==="devices"&&<section className="adminCard"><h2>Registered devices <span className="muted">({devices.length})</span></h2><div className="tableWrap"><table><thead><tr><th>Device</th><th>Owner</th><th>Platform</th><th>Paired</th><th>Unattended</th><th>Last seen</th><th>State / action</th></tr></thead><tbody>{devices.map(d=><tr key={d.id}><td>{d.label}</td><td>{d.owner_email}</td><td>{d.platform}</td><td>{d.paired_at?"Yes":"Awaiting agent"}</td><td>{d.unattended_enabled?"Policy enrolled":"Off"}</td><td>{d.last_seen_at?new Date(d.last_seen_at).toLocaleString():"Never"}</td><td>{d.revoked_at?"Revoked":<><span>Active </span><button className="danger" disabled={busyDevice===d.id} onClick={()=>revokeDevice(d.id)}>{busyDevice===d.id?"Revoking…":"Revoke"}</button></>}</td></tr>)}</tbody></table></div></section>}
      {tab==="audit"&&<section className="adminCard"><h2>Recent security events</h2><div className="tableWrap"><table><thead><tr><th>Event</th><th>Actor</th><th>Details</th><th>Time</th></tr></thead><tbody>{events.map(a=><tr key={a.id}><td><span className="tag">{a.event_type}</span></td><td>{a.actor_email??"System"}</td><td><code>{JSON.stringify(a.metadata_json)}</code></td><td>{new Date(a.created_at).toLocaleString()}</td></tr>)}</tbody></table></div></section>}
      <p className="adminFoot">RemoteX Pro · Admin routes re-check the current database role. Live-session telemetry is intentionally shown as unavailable until signaling is authenticated and persisted.</p>
    </section>
  </main>
}
