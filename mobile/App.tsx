import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView, TextInput
} from 'react-native';
import { Platform } from 'react-native';

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
import axios from 'axios';

const API_URL = 'https://turbo-memory-x5jr77jv5j4j3rw4-3000.app.github.dev';
const ORANGE = '#FF6B00';

const api = axios.create({ baseURL: API_URL });

async function getToken() { return await TokenStore.get(); }
async function setToken(t: string) { await TokenStore.set(t); }
async function clearToken() { await TokenStore.clear(); }

api.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default function App() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    api.get('/auth/me')
      .then(r => setUser(r.data.data))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={ORANGE}/></View>;
  if (!user) return <LoginScreen onLogin={setUser}/>;
  return <MainApp user={user} onLogout={async () => { await clearToken(); setUser(null); }}/>;
}

function LoginScreen({ onLogin }: { onLogin: (u: any) => void }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true); setError('');
    try {
      const res = await api.post('/auth/login', { phone, password });
      await setToken(res.data.data.token);
      onLogin(res.data.data.user);
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Login failed');
    } finally { setLoading(false); }
  }

  return (
    <View style={s.container}>
      <Text style={s.logo}>🍳</Text>
      <Text style={s.appName}>RasoiLink</Text>
      <Text style={s.tagline}>Fair Work. Fair Pay. Real Trust.</Text>
      <TextInput style={s.input} placeholder="Phone (+12015550304)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoCapitalize="none"/>
      <TextInput style={s.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry/>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <TouchableOpacity style={s.btn} onPress={handleLogin} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff"/> : <Text style={s.btnText}>Login</Text>}
      </TouchableOpacity>
    </View>
  );
}

function MainApp({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [tab, setTab] = useState<'jobs'|'chat'|'profile'>('jobs');
  return (
    <View style={s.appContainer}>
      <View style={s.header}>
        <Text style={s.headerText}>🍳 RasoiLink</Text>
        <Text style={s.welcomeText}>Namaste, {user.name.split(' ')[0]}!</Text>
      </View>
      <View style={{flex:1}}>
        {tab === 'jobs'    && <JobsTab/>}
        {tab === 'chat'    && <ChatTab user={user}/>}
        {tab === 'profile' && <ProfileTab user={user} onLogout={onLogout}/>}
      </View>
      <View style={s.tabBar}>
        {(['jobs','chat','profile'] as const).map(t => (
          <TouchableOpacity key={t} style={s.tabBtn} onPress={() => setTab(t)}>
            <Text style={[s.tabIcon, tab===t && s.tabActive]}>
              {t==='jobs'?'💼':t==='chat'?'💬':'👤'}
            </Text>
            <Text style={[s.tabLabel, tab===t && s.tabActive]}>
              {t.charAt(0).toUpperCase()+t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function JobsTab() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/listings').then(r => setJobs(r.data.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <View style={s.center}><ActivityIndicator color={ORANGE}/></View>;

  return (
    <ScrollView style={{flex:1}}>
      <Text style={s.sectionTitle}>Active Jobs</Text>
      {jobs.map((job: any) => (
        <View key={job.listing_id} style={s.card}>
          <Text style={s.cardTitle}>{job.title}</Text>
          <Text style={s.cardSub}>{job.restaurant_name} • {job.city}, {job.state}</Text>
          <Text style={s.cardPay}>${Math.round(job.pay_min_cents/100)}–${Math.round(job.pay_max_cents/100)}/week</Text>
          {job.accommodation_provided && <Text style={s.badge}>🏠 Accommodation included</Text>}
        </View>
      ))}
    </ScrollView>
  );
}

function ChatTab({ user }: { user: any }) {
  const [messages, setMessages] = useState([
    { role:'assistant', text:`Namaste ${user.name.split(' ')[0]}! 🙏 I'm here to help you find the perfect job. What kind of position are you looking for?` }
  ]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string|undefined>();
  const [loading, setLoading] = useState(false);

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
          <View key={i} style={[s.bubble, m.role==='user' ? s.userBubble : s.aiBubble]}>
            <Text style={m.role==='user' ? s.userText : s.aiText}>{m.text}</Text>
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

function ProfileTab({ user, onLogout }: { user: any; onLogout: () => void }) {
  return (
    <View style={s.profileContainer}>
      <Text style={{fontSize:60,marginTop:20}}>👤</Text>
      <Text style={s.profileName}>{user.name}</Text>
      <Text style={{fontSize:14,color:'#666',marginBottom:24}}>{user.phone}</Text>
      {[['Type', user.user_type], ['Trust Score', `⭐ ${user.trust_score??'0.0'}`], ['Verified', user.is_verified?'✅ Yes':'❌ No']].map(([k,v]) => (
        <View key={k} style={s.profileRow}>
          <Text style={s.profileLabel}>{k}</Text>
          <Text style={s.profileValue}>{v}</Text>
        </View>
      ))}
      <TouchableOpacity style={s.logoutBtn} onPress={onLogout}>
        <Text style={{color:'#fff',fontSize:16,fontWeight:'bold'}}>Logout</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  center:         {flex:1,justifyContent:'center',alignItems:'center'},
  container:      {flex:1,padding:24,justifyContent:'center',backgroundColor:'#FFF8F0'},
  logo:           {fontSize:60,textAlign:'center'},
  appName:        {fontSize:32,fontWeight:'bold',textAlign:'center',color:ORANGE,marginBottom:4},
  tagline:        {fontSize:13,textAlign:'center',color:'#888',marginBottom:32},
  input:          {borderWidth:1,borderColor:'#ddd',borderRadius:10,padding:14,marginBottom:12,fontSize:16,backgroundColor:'#fff'},
  btn:            {backgroundColor:ORANGE,padding:16,borderRadius:10,alignItems:'center',marginTop:8},
  btnText:        {color:'#fff',fontSize:16,fontWeight:'bold'},
  error:          {color:'red',marginBottom:8,textAlign:'center'},
  appContainer:   {flex:1,backgroundColor:'#FFF8F0'},
  header:         {backgroundColor:ORANGE,padding:16,paddingTop:50,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  headerText:     {color:'#fff',fontSize:20,fontWeight:'bold'},
  welcomeText:    {color:'#fff',fontSize:14},
  tabBar:         {flexDirection:'row',borderTopWidth:1,borderColor:'#eee',backgroundColor:'#fff',paddingBottom:8},
  tabBtn:         {flex:1,alignItems:'center',paddingTop:8},
  tabIcon:        {fontSize:22},
  tabLabel:       {fontSize:11,color:'#999',marginTop:2},
  tabActive:      {color:ORANGE},
  sectionTitle:   {fontSize:18,fontWeight:'bold',padding:16,color:'#333'},
  card:           {backgroundColor:'#fff',margin:8,marginHorizontal:16,padding:16,borderRadius:12,shadowColor:'#000',shadowOpacity:0.08,shadowRadius:8,elevation:2},
  cardTitle:      {fontSize:16,fontWeight:'bold',color:'#333',marginBottom:4},
  cardSub:        {fontSize:13,color:'#666',marginBottom:4},
  cardPay:        {fontSize:15,fontWeight:'bold',color:ORANGE},
  badge:          {marginTop:6,fontSize:12,color:'#4CAF50'},
  chatScroll:     {flex:1,backgroundColor:'#f5f5f5'},
  bubble:         {maxWidth:'80%',padding:12,borderRadius:16,marginBottom:8},
  userBubble:     {backgroundColor:ORANGE,alignSelf:'flex-end',borderBottomRightRadius:4},
  aiBubble:       {backgroundColor:'#fff',alignSelf:'flex-start',borderBottomLeftRadius:4},
  userText:       {color:'#fff',fontSize:14},
  aiText:         {color:'#333',fontSize:14},
  typing:         {color:'#999',fontStyle:'italic',marginLeft:8},
  chatInputRow:   {flexDirection:'row',padding:8,backgroundColor:'#fff',borderTopWidth:1,borderColor:'#eee'},
  chatTextInput:  {flex:1,borderWidth:1,borderColor:'#ddd',borderRadius:20,paddingHorizontal:14,paddingVertical:8,fontSize:14},
  sendBtn:        {backgroundColor:ORANGE,borderRadius:20,paddingHorizontal:16,justifyContent:'center',marginLeft:8},
  profileContainer:{flex:1,padding:24,alignItems:'center'},
  profileName:    {fontSize:22,fontWeight:'bold',marginTop:12,color:'#333'},
  profileRow:     {flexDirection:'row',justifyContent:'space-between',width:'100%',paddingVertical:12,borderBottomWidth:1,borderColor:'#eee'},
  profileLabel:   {fontSize:15,color:'#666'},
  profileValue:   {fontSize:15,fontWeight:'600',color:'#333'},
  logoutBtn:      {marginTop:32,backgroundColor:'#ff4444',padding:16,borderRadius:10,width:'100%',alignItems:'center'},
});
