import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { auth } from '../services/api';

export default function HomeScreen() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const token = await SecureStore.getItemAsync('auth_token');
      if (token) {
        const res = await auth.me();
        setUser(res.data.data);
      }
    } catch {
      await SecureStore.deleteItemAsync('auth_token');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FF6B00" />
      </View>
    );
  }

  if (user) {
    return <MainApp user={user} onLogout={async () => {
      await SecureStore.deleteItemAsync('auth_token');
      setUser(null);
    }} />;
  }

  return <LoginScreen onLogin={setUser} />;
}

function LoginScreen({ onLogin }: { onLogin: (u: any) => void }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { TextInput } = require('react-native');

  async function handleLogin() {
    setLoading(true);
    setError('');
    try {
      const res = await auth.login(phone, password);
      await SecureStore.setItemAsync('auth_token', res.data.data.token);
      onLogin(res.data.data.user);
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>🍳 RasoiLink</Text>
      <Text style={styles.tagline}>Fair Work. Fair Pay. Real Trust.</Text>
      <TextInput
        style={styles.input}
        placeholder="Phone (+12015550304)"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.btn} onPress={handleLogin} disabled={loading}>
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.btnText}>Login</Text>
        }
      </TouchableOpacity>
    </View>
  );
}

function MainApp({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [tab, setTab] = useState<'jobs' | 'chat' | 'profile'>('jobs');

  return (
    <View style={styles.appContainer}>
      <View style={styles.header}>
        <Text style={styles.headerText}>🍳 RasoiLink</Text>
        <Text style={styles.welcomeText}>Namaste, {user.name.split(' ')[0]}!</Text>
      </View>

      <View style={styles.content}>
        {tab === 'jobs'    && <JobsTab />}
        {tab === 'chat'    && <ChatTab user={user} />}
        {tab === 'profile' && <ProfileTab user={user} onLogout={onLogout} />}
      </View>

      <View style={styles.tabBar}>
        {(['jobs','chat','profile'] as const).map(t => (
          <TouchableOpacity key={t} style={styles.tabBtn} onPress={() => setTab(t)}>
            <Text style={[styles.tabIcon, tab === t && styles.tabActive]}>
              {t === 'jobs' ? '💼' : t === 'chat' ? '💬' : '👤'}
            </Text>
            <Text style={[styles.tabLabel, tab === t && styles.tabActive]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
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
  const { ScrollView } = require('react-native');

  useEffect(() => {
    listings.list().then(r => setJobs(r.data.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <View style={styles.center}><ActivityIndicator color="#FF6B00" /></View>;

  return (
    <ScrollView style={{ flex: 1 }}>
      <Text style={styles.sectionTitle}>Active Jobs</Text>
      {jobs.map((job: any) => (
        <View key={job.listing_id} style={styles.card}>
          <Text style={styles.cardTitle}>{job.title}</Text>
          <Text style={styles.cardSub}>{job.restaurant_name} • {job.city}, {job.state}</Text>
          <Text style={styles.cardPay}>
            ${Math.round(job.pay_min_cents/100)}-${Math.round(job.pay_max_cents/100)}/week
          </Text>
          {job.accommodation_provided &&
            <Text style={styles.badge}>🏠 Accommodation</Text>
          }
        </View>
      ))}
    </ScrollView>
  );
}

function ChatTab({ user }: { user: any }) {
  const [messages, setMessages] = useState<{role:string;text:string}[]>([
    { role: 'assistant', text: `Namaste ${user.name.split(' ')[0]}! 🙏 I'm here to help you find the perfect job. What kind of position are you looking for?` }
  ]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string|undefined>();
  const [loading, setLoading] = useState(false);
  const { ScrollView, TextInput } = require('react-native');

  async function sendMessage() {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(m => [...m, { role: 'user', text: userMsg }]);
    setLoading(true);
    try {
      const res = await chat.message(userMsg, sessionId);
      const data = res.data.data;
      setSessionId(data.session_id);
      setMessages(m => [...m, { role: 'assistant', text: data.message }]);
    } catch {
      setMessages(m => [...m, { role: 'assistant', text: 'Sorry, something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.chatScroll} contentContainerStyle={{ padding: 12 }}>
        {messages.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === 'user' ? styles.userBubble : styles.aiBubble]}>
            <Text style={m.role === 'user' ? styles.userText : styles.aiText}>{m.text}</Text>
          </View>
        ))}
        {loading && <Text style={styles.typing}>Typing...</Text>}
      </ScrollView>
      <View style={styles.chatInput}>
        <TextInput
          style={styles.chatTextInput}
          placeholder="Type a message..."
          value={input}
          onChangeText={setInput}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
        />
        <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ProfileTab({ user, onLogout }: { user: any; onLogout: () => void }) {
  return (
    <View style={styles.profileContainer}>
      <Text style={styles.avatar}>👤</Text>
      <Text style={styles.profileName}>{user.name}</Text>
      <Text style={styles.profilePhone}>{user.phone}</Text>
      <View style={styles.profileRow}>
        <Text style={styles.profileLabel}>Type</Text>
        <Text style={styles.profileValue}>{user.user_type}</Text>
      </View>
      <View style={styles.profileRow}>
        <Text style={styles.profileLabel}>Trust Score</Text>
        <Text style={styles.profileValue}>⭐ {user.trust_score ?? '0.0'}</Text>
      </View>
      <View style={styles.profileRow}>
        <Text style={styles.profileLabel}>Verified</Text>
        <Text style={styles.profileValue}>{user.is_verified ? '✅ Yes' : '❌ No'}</Text>
      </View>
      <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </View>
  );
}

const { listings: listingsService } = require('../services/api');
const { chat: chatService } = require('../services/api');
const listings = listingsService;
const chat = chatService;

const ORANGE = '#FF6B00';
const styles = StyleSheet.create({
  center:          { flex:1, justifyContent:'center', alignItems:'center' },
  container:       { flex:1, padding:24, justifyContent:'center', backgroundColor:'#FFF8F0' },
  logo:            { fontSize:40, textAlign:'center', marginBottom:8 },
  tagline:         { fontSize:14, textAlign:'center', color:'#666', marginBottom:32 },
  input:           { borderWidth:1, borderColor:'#ddd', borderRadius:10, padding:14, marginBottom:12, fontSize:16, backgroundColor:'#fff' },
  btn:             { backgroundColor:ORANGE, padding:16, borderRadius:10, alignItems:'center', marginTop:8 },
  btnText:         { color:'#fff', fontSize:16, fontWeight:'bold' },
  error:           { color:'red', marginBottom:8, textAlign:'center' },
  appContainer:    { flex:1, backgroundColor:'#FFF8F0' },
  header:          { backgroundColor:ORANGE, padding:16, paddingTop:50, flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  headerText:      { color:'#fff', fontSize:20, fontWeight:'bold' },
  welcomeText:     { color:'#fff', fontSize:14 },
  content:         { flex:1 },
  tabBar:          { flexDirection:'row', borderTopWidth:1, borderColor:'#eee', backgroundColor:'#fff', paddingBottom:8 },
  tabBtn:          { flex:1, alignItems:'center', paddingTop:8 },
  tabIcon:         { fontSize:22 },
  tabLabel:        { fontSize:11, color:'#999', marginTop:2 },
  tabActive:       { color:ORANGE },
  sectionTitle:    { fontSize:18, fontWeight:'bold', padding:16, color:'#333' },
  card:            { backgroundColor:'#fff', margin:8, marginHorizontal:16, padding:16, borderRadius:12, shadowColor:'#000', shadowOpacity:0.08, shadowRadius:8, elevation:2 },
  cardTitle:       { fontSize:16, fontWeight:'bold', color:'#333', marginBottom:4 },
  cardSub:         { fontSize:13, color:'#666', marginBottom:4 },
  cardPay:         { fontSize:15, fontWeight:'bold', color:ORANGE },
  badge:           { marginTop:6, fontSize:12, color:'#4CAF50' },
  chatScroll:      { flex:1, backgroundColor:'#f5f5f5' },
  bubble:          { maxWidth:'80%', padding:12, borderRadius:16, marginBottom:8 },
  userBubble:      { backgroundColor:ORANGE, alignSelf:'flex-end', borderBottomRightRadius:4 },
  aiBubble:        { backgroundColor:'#fff', alignSelf:'flex-start', borderBottomLeftRadius:4, shadowColor:'#000', shadowOpacity:0.05, shadowRadius:4, elevation:1 },
  userText:        { color:'#fff', fontSize:14 },
  aiText:          { color:'#333', fontSize:14 },
  typing:          { color:'#999', fontStyle:'italic', marginLeft:8 },
  chatInput:       { flexDirection:'row', padding:8, backgroundColor:'#fff', borderTopWidth:1, borderColor:'#eee' },
  chatTextInput:   { flex:1, borderWidth:1, borderColor:'#ddd', borderRadius:20, paddingHorizontal:14, paddingVertical:8, fontSize:14 },
  sendBtn:         { backgroundColor:ORANGE, borderRadius:20, paddingHorizontal:16, justifyContent:'center', marginLeft:8 },
  profileContainer:{ flex:1, padding:24, alignItems:'center' },
  avatar:          { fontSize:60, marginTop:20 },
  profileName:     { fontSize:22, fontWeight:'bold', marginTop:12, color:'#333' },
  profilePhone:    { fontSize:14, color:'#666', marginBottom:24 },
  profileRow:      { flexDirection:'row', justifyContent:'space-between', width:'100%', paddingVertical:12, borderBottomWidth:1, borderColor:'#eee' },
  profileLabel:    { fontSize:15, color:'#666' },
  profileValue:    { fontSize:15, fontWeight:'600', color:'#333' },
  logoutBtn:       { marginTop:32, backgroundColor:'#ff4444', padding:16, borderRadius:10, width:'100%', alignItems:'center' },
  logoutText:      { color:'#fff', fontSize:16, fontWeight:'bold' },
});
