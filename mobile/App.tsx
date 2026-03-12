import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView, TextInput, Alert
} from 'react-native';
import { Platform } from 'react-native';
import axios from 'axios';

const API_URL = 'https://turbo-memory-x5jr77jv5j4j3rw4-3000.app.github.dev';
const ORANGE = '#FF6B00';
const GREEN  = '#2ECC71';
const DARK   = '#1A1A2E';

const TokenStore = {
  async get(): Promise<string|null> {
    if (Platform.OS === 'web') return localStorage.getItem('auth_token');
    const { default: S } = await import('expo-secure-store');
    return S.getItemAsync('auth_token');
  },
  async set(t: string) {
    if (Platform.OS === 'web') { localStorage.setItem('auth_token', t); return; }
    const { default: S } = await import('expo-secure-store');
    return S.setItemAsync('auth_token', t);
  },
  async clear() {
    if (Platform.OS === 'web') { localStorage.removeItem('auth_token'); return; }
    const { default: S } = await import('expo-secure-store');
    return S.deleteItemAsync('auth_token');
  }
};

const api = axios.create({ baseURL: API_URL });
api.interceptors.request.use(async (config) => {
  const token = await TokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── App Root ────────────────────────────────────────────────────────────────
export default function App() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    api.get('/auth/me')
      .then(r => setUser(r.data.data))
      .catch(() => TokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={ORANGE}/></View>;
  if (!user)   return <AuthScreen onLogin={setUser}/>;
  if (user.user_type === 'owner') return <OwnerApp user={user} onLogout={async () => { await TokenStore.clear(); setUser(null); }}/>;
  return <WorkerApp user={user} onLogout={async () => { await TokenStore.clear(); setUser(null); }}/>;
}

// ─── Auth Screen (Login + Register) ──────────────────────────────────────────
function AuthScreen({ onLogin }: { onLogin: (u: any) => void }) {
  const [mode, setMode] = useState<'login'|'register'>('login');
  const [phone, setPhone]       = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]         = useState('');
  const [userType, setUserType] = useState<'worker'|'owner'>('worker');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit() {
    setLoading(true); setError('');
    try {
      let res;
      if (mode === 'login') {
        res = await api.post('/auth/login', { phone, password });
      } else {
        res = await api.post('/auth/register', { phone, password, name, user_type: userType, language_code: 'en' });
      }
      await TokenStore.set(res.data.data.token);
      onLogin(res.data.data.user);
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Something went wrong');
    } finally { setLoading(false); }
  }

  return (
    <ScrollView contentContainerStyle={s.authContainer}>
      <Text style={s.logo}>🍳</Text>
      <Text style={s.appName}>RasoiLink</Text>
      <Text style={s.tagline}>Fair Work. Fair Pay. Real Trust.</Text>

      <View style={s.modeToggle}>
        <TouchableOpacity style={[s.modeBtn, mode==='login' && s.modeBtnActive]} onPress={() => setMode('login')}>
          <Text style={[s.modeBtnText, mode==='login' && s.modeBtnTextActive]}>Login</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.modeBtn, mode==='register' && s.modeBtnActive]} onPress={() => setMode('register')}>
          <Text style={[s.modeBtnText, mode==='register' && s.modeBtnTextActive]}>Register</Text>
        </TouchableOpacity>
      </View>

      {mode === 'register' && (
        <>
          <TextInput style={s.input} placeholder="Full Name" value={name} onChangeText={setName}/>
          <View style={s.typeToggle}>
            <TouchableOpacity style={[s.typeBtn, userType==='worker' && s.typeBtnActive]} onPress={() => setUserType('worker')}>
              <Text style={[s.typeBtnText, userType==='worker' && s.typeBtnTextActive]}>👨‍🍳 Worker</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.typeBtn, userType==='owner' && s.typeBtnActive]} onPress={() => setUserType('owner')}>
              <Text style={[s.typeBtnText, userType==='owner' && s.typeBtnTextActive]}>🏪 Owner</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <TextInput style={s.input} placeholder="Phone (+12015550304)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoCapitalize="none"/>
      <TextInput style={s.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry/>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <TouchableOpacity style={s.btn} onPress={handleSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff"/> : <Text style={s.btnText}>{mode === 'login' ? 'Login' : 'Create Account'}</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Worker App ───────────────────────────────────────────────────────────────
function WorkerApp({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [tab, setTab] = useState<'jobs'|'chat'|'profile'>('jobs');
  return (
    <View style={s.appContainer}>
      <View style={s.header}>
        <Text style={s.headerText}>🍳 RasoiLink</Text>
        <Text style={s.welcomeText}>Namaste, {user.name.split(' ')[0]}!</Text>
      </View>
      <View style={{flex:1}}>
        {tab === 'jobs'    && <JobsTab user={user}/>}
        {tab === 'chat'    && <ChatTab user={user}/>}
        {tab === 'profile' && <ProfileTab user={user} onLogout={onLogout}/>}
      </View>
      <TabBar tabs={[
        {key:'jobs',    icon:'💼', label:'Jobs'},
        {key:'chat',    icon:'💬', label:'Chat'},
        {key:'profile', icon:'👤', label:'Profile'},
      ]} active={tab} onChange={(t:any) => setTab(t)}/>
    </View>
  );
}

// ─── Owner App ────────────────────────────────────────────────────────────────
function OwnerApp({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [tab, setTab] = useState<'dashboard'|'listings'|'applicants'|'profile'>('dashboard');
  return (
    <View style={s.appContainer}>
      <View style={[s.header, {backgroundColor: DARK}]}>
        <Text style={s.headerText}>🏪 RasoiLink</Text>
        <Text style={s.welcomeText}>Owner: {user.name.split(' ')[0]}</Text>
      </View>
      <View style={{flex:1}}>
        {tab === 'dashboard'   && <OwnerDashboard user={user}/>}
        {tab === 'listings'    && <OwnerListings user={user}/>}
        {tab === 'applicants'  && <OwnerApplicants user={user}/>}
        {tab === 'profile'     && <ProfileTab user={user} onLogout={onLogout}/>}
      </View>
      <TabBar tabs={[
        {key:'dashboard',  icon:'📊', label:'Dashboard'},
        {key:'listings',   icon:'📋', label:'Listings'},
        {key:'applicants', icon:'👥', label:'Applicants'},
        {key:'profile',    icon:'👤', label:'Profile'},
      ]} active={tab} onChange={(t:any) => setTab(t)} color={DARK}/>
    </View>
  );
}

// ─── Owner Dashboard ──────────────────────────────────────────────────────────
function OwnerDashboard({ user }: { user: any }) {
  const [listings, setListings] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get(`/owners/${user.user_id}/listings`),
      api.get(`/owners/${user.user_id}/applications`),
    ]).then(([l, a]) => {
      setListings(l.data.data ?? []);
      setApplications(a.data.data ?? []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <View style={s.center}><ActivityIndicator color={DARK}/></View>;

  const activeListings = listings.filter((l:any) => l.status === 'active').length;
  const pendingApps    = applications.filter((a:any) => a.status === 'pending').length;

  return (
    <ScrollView style={{flex:1, padding:16}}>
      <Text style={s.sectionTitle}>Dashboard</Text>

      <View style={s.statsRow}>
        <View style={[s.statCard, {borderLeftColor: ORANGE}]}>
          <Text style={s.statNum}>{activeListings}</Text>
          <Text style={s.statLabel}>Active Jobs</Text>
        </View>
        <View style={[s.statCard, {borderLeftColor: GREEN}]}>
          <Text style={s.statNum}>{pendingApps}</Text>
          <Text style={s.statLabel}>Pending Apps</Text>
        </View>
        <View style={[s.statCard, {borderLeftColor: DARK}]}>
          <Text style={s.statNum}>{applications.length}</Text>
          <Text style={s.statLabel}>Total Apps</Text>
        </View>
      </View>

      <Text style={[s.sectionTitle, {marginTop:16}]}>Recent Applications</Text>
      {applications.slice(0,3).map((app:any) => (
        <View key={app.offer_id} style={s.card}>
          <Text style={s.cardTitle}>{app.worker_name}</Text>
          <Text style={s.cardSub}>{app.listing_title}</Text>
          <View style={{flexDirection:'row', justifyContent:'space-between', marginTop:4}}>
            <Text style={s.cardSub}>⭐ {app.trust_score} trust • {app.years_experience}yr exp</Text>
            <View style={[s.statusBadge, {backgroundColor: app.status==='pending'?'#FFF3E0': app.status==='accepted'?'#E8F5E9':'#FFEBEE'}]}>
              <Text style={{fontSize:11, color: app.status==='pending'?ORANGE: app.status==='accepted'?GREEN:'#f44336'}}>{app.status.toUpperCase()}</Text>
            </View>
          </View>
        </View>
      ))}
      {applications.length === 0 && <Text style={s.emptyText}>No applications yet. Post a job to get started!</Text>}
    </ScrollView>
  );
}

// ─── Owner Listings ───────────────────────────────────────────────────────────
function OwnerListings({ user }: { user: any }) {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: '', role_code: 'line_cook', city: '', state: 'NJ',
    pay_min: '500', pay_max: '700', hours: '40',
    description_en: '', accommodation_provided: false,
  });
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    api.get(`/owners/${user.user_id}/listings`)
      .then(r => setListings(r.data.data ?? []))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function postJob() {
    setSubmitting(true);
    try {
      await api.post('/listings', {
        title: form.title,
        role_code: form.role_code,
        city: form.city,
        state: form.state,
        pay_min_cents: Math.round(parseFloat(form.pay_min) * 100),
        pay_max_cents: Math.round(parseFloat(form.pay_max) * 100),
        hours_per_week: parseInt(form.hours),
        description_en: form.description_en,
        accommodation_provided: form.accommodation_provided,
        pay_frequency: 'weekly',
        cuisine_required: [],
        years_exp_required: 0,
        notice_period_weeks: 2,
      });
      setShowForm(false);
      load();
    } catch (e: any) {
      alert(e.response?.data?.error ?? 'Failed to post job');
    } finally { setSubmitting(false); }
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={DARK}/></View>;

  if (showForm) return (
    <ScrollView style={{flex:1}} contentContainerStyle={{padding:16}}>
      <Text style={s.sectionTitle}>Post a New Job</Text>
      {[
        {key:'title',          label:'Job Title',        placeholder:'e.g. Tandoor Chef'},
        {key:'city',           label:'City',             placeholder:'e.g. Edison'},
        {key:'state',          label:'State',            placeholder:'e.g. NJ'},
        {key:'pay_min',        label:'Min Pay ($/week)', placeholder:'500'},
        {key:'pay_max',        label:'Max Pay ($/week)', placeholder:'700'},
        {key:'hours',          label:'Hours/Week',       placeholder:'40'},
        {key:'description_en', label:'Job Description',  placeholder:'Describe the role...'},
      ].map(f => (
        <View key={f.key} style={{marginBottom:12}}>
          <Text style={s.formLabel}>{f.label}</Text>
          <TextInput
            style={[s.input, f.key==='description_en' && {height:80, textAlignVertical:'top'}]}
            placeholder={f.placeholder}
            value={(form as any)[f.key]}
            onChangeText={v => setForm(p => ({...p, [f.key]: v}))}
            multiline={f.key==='description_en'}
          />
        </View>
      ))}
      <View style={{flexDirection:'row', gap:8}}>
        <TouchableOpacity style={[s.btn, {flex:1, backgroundColor:'#ccc'}]} onPress={() => setShowForm(false)}>
          <Text style={[s.btnText, {color:'#333'}]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.btn, {flex:1, backgroundColor:DARK}]} onPress={postJob} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff"/> : <Text style={s.btnText}>Post Job</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  return (
    <ScrollView style={{flex:1}}>
      <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16}}>
        <Text style={s.sectionTitle}>My Listings</Text>
        <TouchableOpacity style={[s.btn, {backgroundColor:DARK, paddingVertical:8, paddingHorizontal:14}]} onPress={() => setShowForm(true)}>
          <Text style={s.btnText}>+ Post Job</Text>
        </TouchableOpacity>
      </View>
      {listings.map((job:any) => (
        <View key={job.listing_id} style={s.card}>
          <View style={{flexDirection:'row', justifyContent:'space-between'}}>
            <Text style={s.cardTitle}>{job.title}</Text>
            <View style={[s.statusBadge, {backgroundColor: job.status==='active'?'#E8F5E9':'#F5F5F5'}]}>
              <Text style={{fontSize:11, color: job.status==='active'?GREEN:'#999'}}>{job.status.toUpperCase()}</Text>
            </View>
          </View>
          <Text style={s.cardSub}>{job.city}, {job.state}</Text>
          <Text style={s.cardPay}>${Math.round(job.pay_min_cents/100)}–${Math.round(job.pay_max_cents/100)}/week</Text>
        </View>
      ))}
      {listings.length === 0 && <Text style={s.emptyText}>No listings yet. Post your first job!</Text>}
    </ScrollView>
  );
}

// ─── Owner Applicants ─────────────────────────────────────────────────────────
function OwnerApplicants({ user }: { user: any }) {
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api.get(`/owners/${user.user_id}/applications`)
      .then(r => setApplications(r.data.data ?? []))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function updateStatus(offer_id: string, status: string) {
    await api.patch(`/offers/${offer_id}`, { status });
    load();
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={DARK}/></View>;

  return (
    <ScrollView style={{flex:1}}>
      <Text style={s.sectionTitle}>Applicants</Text>
      {applications.map((app:any) => (
        <View key={app.offer_id} style={s.card}>
          <Text style={s.cardTitle}>{app.worker_name}</Text>
          <Text style={s.cardSub}>Applied for: {app.listing_title}</Text>
          <Text style={s.cardSub}>📞 {app.worker_phone}</Text>
          <Text style={s.cardSub}>⭐ Trust: {app.trust_score} • {app.years_experience} yrs exp</Text>
          <Text style={s.cardSub}>🍴 {(app.cuisine_specializations??[]).join(', ') || 'Not specified'}</Text>
          <Text style={s.cardSub}>💰 ${Math.round(app.salary_min_cents/100)}–${Math.round(app.salary_max_cents/100)}/week expected</Text>

          {app.status === 'pending' && (
            <View style={{flexDirection:'row', gap:8, marginTop:10}}>
              <TouchableOpacity style={[s.btn, {flex:1, backgroundColor:GREEN, paddingVertical:8}]} onPress={() => updateStatus(app.offer_id, 'accepted')}>
                <Text style={s.btnText}>✓ Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btn, {flex:1, backgroundColor:'#f44336', paddingVertical:8}]} onPress={() => updateStatus(app.offer_id, 'rejected')}>
                <Text style={s.btnText}>✗ Reject</Text>
              </TouchableOpacity>
            </View>
          )}
          {app.status !== 'pending' && (
            <View style={[s.statusBadge, {marginTop:8, alignSelf:'flex-start', backgroundColor: app.status==='accepted'?'#E8F5E9':'#FFEBEE'}]}>
              <Text style={{color: app.status==='accepted'?GREEN:'#f44336', fontSize:12, fontWeight:'600'}}>{app.status.toUpperCase()}</Text>
            </View>
          )}
        </View>
      ))}
      {applications.length === 0 && <Text style={s.emptyText}>No applications yet.</Text>}
    </ScrollView>
  );
}

// ─── Worker: Jobs Tab ─────────────────────────────────────────────────────────
function JobsTab({ user }: { user: any }) {
  const [jobs, setJobs]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string|null>(null);
  const [applied, setApplied]   = useState<Set<string>>(new Set());

  useEffect(() => {
    api.get('/listings').then(r => setJobs(r.data.data ?? [])).finally(() => setLoading(false));
  }, []);

  async function apply(listing_id: string) {
    setApplying(listing_id);
    try {
      await api.post(`/listings/${listing_id}/apply`, {});
      setApplied(s => new Set([...s, listing_id]));
    } catch (e: any) {
      alert(e.response?.data?.error ?? 'Failed to apply');
    } finally { setApplying(null); }
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={ORANGE}/></View>;

  return (
    <ScrollView style={{flex:1}}>
      <Text style={s.sectionTitle}>Active Jobs</Text>
      {jobs.map((job:any) => (
        <View key={job.listing_id} style={s.card}>
          <Text style={s.cardTitle}>{job.title}</Text>
          <Text style={s.cardSub}>{job.restaurant_name} • {job.city}, {job.state}</Text>
          <Text style={s.cardPay}>${Math.round(job.pay_min_cents/100)}–${Math.round(job.pay_max_cents/100)}/week</Text>
          {job.accommodation_provided && <Text style={s.badge}>🏠 Accommodation included</Text>}
          <Text style={s.cardSub}>⭐ Owner trust: {job.owner_trust_score}</Text>
          <TouchableOpacity
            style={[s.btn, {marginTop:10, paddingVertical:8, backgroundColor: applied.has(job.listing_id)?GREEN:ORANGE}]}
            onPress={() => apply(job.listing_id)}
            disabled={!!applying || applied.has(job.listing_id)}
          >
            {applying === job.listing_id
              ? <ActivityIndicator color="#fff"/>
              : <Text style={s.btnText}>{applied.has(job.listing_id) ? '✓ Applied' : 'Apply Now'}</Text>
            }
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Worker: Chat Tab ─────────────────────────────────────────────────────────
function ChatTab({ user }: { user: any }) {
  const [messages, setMessages] = useState([
    { role:'assistant', text:`Namaste ${user.name.split(' ')[0]}! 🙏 I'm here to help you find the perfect job. What kind of position are you looking for?` }
  ]);
  const [input, setInput]       = useState('');
  const [sessionId, setSessionId] = useState<string|undefined>();
  const [loading, setLoading]   = useState(false);

  async function send() {
    if (!input.trim() || loading) return;
    const msg = input.trim(); setInput('');
    setMessages(m => [...m, {role:'user', text:msg}]);
    setLoading(true);
    try {
      const res = await api.post('/chat/message', { message: msg, session_id: sessionId });
      setSessionId(res.data.data.session_id);
      setMessages(m => [...m, {role:'assistant', text:res.data.data.message}]);
    } catch {
      setMessages(m => [...m, {role:'assistant', text:'Sorry, something went wrong.'}]);
    } finally { setLoading(false); }
  }

  return (
    <View style={{flex:1}}>
      <ScrollView style={s.chatScroll} contentContainerStyle={{padding:12}}>
        {messages.map((m,i) => (
          <View key={i} style={[s.bubble, m.role==='user'?s.userBubble:s.aiBubble]}>
            <Text style={m.role==='user'?s.userText:s.aiText}>{m.text}</Text>
          </View>
        ))}
        {loading && <Text style={s.typing}>Typing...</Text>}
      </ScrollView>
      <View style={s.chatInputRow}>
        <TextInput style={s.chatTextInput} placeholder="Type a message..." value={input} onChangeText={setInput} onSubmitEditing={send} returnKeyType="send"/>
        <TouchableOpacity style={s.sendBtn} onPress={send}>
          <Text style={{color:'#fff',fontWeight:'bold'}}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Shared: Profile Tab ──────────────────────────────────────────────────────
function ProfileTab({ user, onLogout }: { user: any; onLogout: () => void }) {
  const isOwner = user.user_type === 'owner';
  return (
    <ScrollView contentContainerStyle={s.profileContainer}>
      <Text style={{fontSize:60,marginTop:20}}>{isOwner?'🏪':'👤'}</Text>
      <Text style={s.profileName}>{user.name}</Text>
      <Text style={{fontSize:14,color:'#666',marginBottom:24}}>{user.phone}</Text>
      {[
        ['Account Type', isOwner ? '🏪 Owner' : '👨‍🍳 Worker'],
        ['Trust Score',  `⭐ ${user.trust_score??'0.0'}`],
        ['Verified',     user.is_verified?'✅ Yes':'❌ No'],
        ['Member Since', new Date(user.created_at).toLocaleDateString()],
      ].map(([k,v]) => (
        <View key={k} style={s.profileRow}>
          <Text style={s.profileLabel}>{k}</Text>
          <Text style={s.profileValue}>{v}</Text>
        </View>
      ))}
      <TouchableOpacity style={s.logoutBtn} onPress={onLogout}>
        <Text style={{color:'#fff',fontSize:16,fontWeight:'bold'}}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Shared: Tab Bar ──────────────────────────────────────────────────────────
function TabBar({ tabs, active, onChange, color=ORANGE }: { tabs:{key:string;icon:string;label:string}[]; active:string; onChange:(k:string)=>void; color?:string }) {
  return (
    <View style={s.tabBar}>
      {tabs.map(t => (
        <TouchableOpacity key={t.key} style={s.tabBtn} onPress={() => onChange(t.key)}>
          <Text style={[s.tabIcon, active===t.key && {color}]}>{t.icon}</Text>
          <Text style={[s.tabLabel, active===t.key && {color}]}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  center:           {flex:1,justifyContent:'center',alignItems:'center'},
  authContainer:    {flexGrow:1,padding:24,justifyContent:'center',backgroundColor:'#FFF8F0'},
  logo:             {fontSize:60,textAlign:'center'},
  appName:          {fontSize:32,fontWeight:'bold',textAlign:'center',color:ORANGE,marginBottom:4},
  tagline:          {fontSize:13,textAlign:'center',color:'#888',marginBottom:24},
  modeToggle:       {flexDirection:'row',backgroundColor:'#eee',borderRadius:10,padding:4,marginBottom:20},
  modeBtn:          {flex:1,padding:10,borderRadius:8,alignItems:'center'},
  modeBtnActive:    {backgroundColor:'#fff'},
  modeBtnText:      {color:'#999',fontWeight:'600'},
  modeBtnTextActive:{color:DARK},
  typeToggle:       {flexDirection:'row',gap:8,marginBottom:12},
  typeBtn:          {flex:1,padding:12,borderRadius:10,alignItems:'center',borderWidth:2,borderColor:'#eee'},
  typeBtnActive:    {borderColor:ORANGE,backgroundColor:'#FFF3E0'},
  typeBtnText:      {color:'#999',fontWeight:'600'},
  typeBtnTextActive:{color:ORANGE},
  input:            {borderWidth:1,borderColor:'#ddd',borderRadius:10,padding:14,marginBottom:12,fontSize:16,backgroundColor:'#fff'},
  btn:              {backgroundColor:ORANGE,padding:14,borderRadius:10,alignItems:'center'},
  btnText:          {color:'#fff',fontSize:15,fontWeight:'bold'},
  error:            {color:'red',marginBottom:8,textAlign:'center'},
  appContainer:     {flex:1,backgroundColor:'#F8F9FA'},
  header:           {backgroundColor:ORANGE,padding:16,paddingTop:50,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  headerText:       {color:'#fff',fontSize:20,fontWeight:'bold'},
  welcomeText:      {color:'#fff',fontSize:14},
  tabBar:           {flexDirection:'row',borderTopWidth:1,borderColor:'#eee',backgroundColor:'#fff',paddingBottom:8},
  tabBtn:           {flex:1,alignItems:'center',paddingTop:8},
  tabIcon:          {fontSize:22,color:'#bbb'},
  tabLabel:         {fontSize:11,color:'#bbb',marginTop:2},
  sectionTitle:     {fontSize:18,fontWeight:'bold',paddingHorizontal:16,paddingTop:16,paddingBottom:8,color:'#333'},
  card:             {backgroundColor:'#fff',margin:8,marginHorizontal:16,padding:16,borderRadius:12,borderWidth:1,borderColor:'#F0F0F0'},
  cardTitle:        {fontSize:16,fontWeight:'bold',color:'#333',marginBottom:4},
  cardSub:          {fontSize:13,color:'#666',marginBottom:2},
  cardPay:          {fontSize:15,fontWeight:'bold',color:ORANGE,marginTop:2},
  badge:            {marginTop:6,fontSize:12,color:GREEN},
  statsRow:         {flexDirection:'row',gap:8},
  statCard:         {flex:1,backgroundColor:'#fff',padding:14,borderRadius:12,borderLeftWidth:4,borderWidth:1,borderColor:'#F0F0F0'},
  statNum:          {fontSize:28,fontWeight:'bold',color:DARK},
  statLabel:        {fontSize:12,color:'#666',marginTop:2},
  statusBadge:      {paddingHorizontal:8,paddingVertical:3,borderRadius:6},
  emptyText:        {textAlign:'center',color:'#999',marginTop:40,fontSize:15},
  formLabel:        {fontSize:13,fontWeight:'600',color:'#555',marginBottom:4},
  chatScroll:       {flex:1,backgroundColor:'#F8F9FA'},
  bubble:           {maxWidth:'80%',padding:12,borderRadius:16,marginBottom:8},
  userBubble:       {backgroundColor:ORANGE,alignSelf:'flex-end',borderBottomRightRadius:4},
  aiBubble:         {backgroundColor:'#fff',alignSelf:'flex-start',borderBottomLeftRadius:4,borderWidth:1,borderColor:'#eee'},
  userText:         {color:'#fff',fontSize:14},
  aiText:           {color:'#333',fontSize:14},
  typing:           {color:'#999',fontStyle:'italic',marginLeft:8},
  chatInputRow:     {flexDirection:'row',padding:8,backgroundColor:'#fff',borderTopWidth:1,borderColor:'#eee'},
  chatTextInput:    {flex:1,borderWidth:1,borderColor:'#ddd',borderRadius:20,paddingHorizontal:14,paddingVertical:8,fontSize:14},
  sendBtn:          {backgroundColor:ORANGE,borderRadius:20,paddingHorizontal:16,justifyContent:'center',marginLeft:8},
  profileContainer: {padding:24,alignItems:'center'},
  profileName:      {fontSize:22,fontWeight:'bold',marginTop:12,color:'#333'},
  profileRow:       {flexDirection:'row',justifyContent:'space-between',width:'100%',paddingVertical:12,borderBottomWidth:1,borderColor:'#eee'},
  profileLabel:     {fontSize:15,color:'#666'},
  profileValue:     {fontSize:15,fontWeight:'600',color:'#333'},
  logoutBtn:        {marginTop:32,backgroundColor:'#f44336',padding:16,borderRadius:10,width:'100%',alignItems:'center'},
});
