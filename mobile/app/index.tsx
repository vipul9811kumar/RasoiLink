import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView, TextInput, Modal, Linking,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { auth, listings, workers, chat, billing, isPlanGateError, getPlanGateMessage } from '../services/api';
import UpgradeModal from '../components/UpgradeModal';

const ORANGE = '#FF6B00';
const DARK   = '#1A1A1A';

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const [loading, setLoading] = useState(true);
  const [user, setUser]       = useState<any>(null);

  useEffect(() => { checkAuth(); }, []);

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
    return <View style={s.center}><ActivityIndicator size="large" color={ORANGE} /></View>;
  }

  if (user) {
    return <MainApp user={user} onLogout={async () => {
      await SecureStore.deleteItemAsync('auth_token');
      setUser(null);
    }} />;
  }

  return <LoginScreen onLogin={setUser} />;
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (u: any) => void }) {
  const [phone, setPhone]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

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
    <View style={s.container}>
      <Text style={s.logo}>🍳 RasoiLink</Text>
      <Text style={s.tagline}>Fair Work. Fair Pay. Real Trust.</Text>
      <TextInput
        style={s.input}
        placeholder="Phone (+12015550304)"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoCapitalize="none"
      />
      <TextInput
        style={s.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      {error ? <Text style={s.error}>{error}</Text> : null}
      <TouchableOpacity style={s.btn} onPress={handleLogin} disabled={loading}>
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={s.btnText}>Login</Text>
        }
      </TouchableOpacity>
    </View>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function MainApp({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [tab, setTab] = useState<'jobs' | 'workers' | 'chat' | 'profile'>('jobs');

  return (
    <View style={s.appContainer}>
      <View style={s.header}>
        <Text style={s.headerText}>🍳 RasoiLink</Text>
        <Text style={s.welcomeText}>Namaste, {user.name.split(' ')[0]}!</Text>
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'jobs'    && <JobsTab user={user} />}
        {tab === 'workers' && <WorkersTab user={user} />}
        {tab === 'chat'    && <ChatTab user={user} />}
        {tab === 'profile' && <ProfileTab user={user} onLogout={onLogout} />}
      </View>

      <View style={s.tabBar}>
        {([
          { key: 'jobs',    icon: '💼', label: 'Jobs' },
          { key: 'workers', icon: '👨‍🍳', label: 'Workers' },
          { key: 'chat',    icon: '💬', label: 'Chat' },
          { key: 'profile', icon: '👤', label: 'Profile' },
        ] as const).map(t => (
          <TouchableOpacity key={t.key} style={s.tabBtn} onPress={() => setTab(t.key)}>
            <Text style={[s.tabIcon, tab === t.key && s.tabActive]}>{t.icon}</Text>
            <Text style={[s.tabLabel, tab === t.key && s.tabActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ─── Jobs Tab ─────────────────────────────────────────────────────────────────
// ── GATE: POST /listings — free owners limited to 1 post ─────────────────────
function JobsTab({ user }: { user: any }) {
  const [jobs, setJobs]             = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState('');
  const [showPostForm, setShowPostForm]     = useState(false);

  useEffect(() => { loadJobs(); }, []);

  function loadJobs() {
    setLoading(true);
    listings.list()
      .then(r => setJobs(r.data.data))
      .finally(() => setLoading(false));
  }

  async function handlePostJob(data: object) {
    try {
      await listings.create(data);
      setShowPostForm(false);
      loadJobs();
    } catch (e: any) {
      if (isPlanGateError(e)) {
        setUpgradeMessage(getPlanGateMessage(e));
        setShowPostForm(false);
        setShowUpgrade(true);
      } else {
        // re-throw so the form can show a normal error
        throw e;
      }
    }
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={ORANGE} /></View>;

  if (showPostForm) {
    return (
      <PostJobForm
        onSubmit={handlePostJob}
        onCancel={() => setShowPostForm(false)}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }}>
        {/* Owner: post job CTA */}
        {user.user_type === 'owner' && (
          <TouchableOpacity
            style={s.postJobBtn}
            onPress={() => setShowPostForm(true)}
          >
            <Text style={s.postJobBtnText}>＋ Post a Job</Text>
          </TouchableOpacity>
        )}

        <Text style={s.sectionTitle}>Active Jobs</Text>
        {jobs.length === 0 && (
          <Text style={{ textAlign: 'center', color: '#999', marginTop: 40 }}>
            No active listings yet.
          </Text>
        )}
        {jobs.map((job: any) => (
          <View key={job.listing_id} style={s.card}>
            <Text style={s.cardTitle}>{job.title}</Text>
            <Text style={s.cardSub}>{job.restaurant_name} · {job.city}, {job.state}</Text>
            <Text style={s.cardPay}>
              ${Math.round(job.pay_min_cents / 100)}–${Math.round(job.pay_max_cents / 100)}/week
            </Text>
            {job.accommodation_provided && (
              <Text style={s.badge}>🏠 Accommodation provided</Text>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Upgrade modal — fires when 402 hit on POST /listings */}
      <UpgradeModal
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        userType="owner"
        feature="unlimited job posts"
        message={upgradeMessage}
      />
    </View>
  );
}

// ─── Post Job Form ────────────────────────────────────────────────────────────
function PostJobForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: object) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle]   = useState('');
  const [city, setCity]     = useState('');
  const [state, setState]   = useState('NJ');
  const [payMin, setPayMin] = useState('');
  const [payMax, setPayMax] = useState('');
  const [desc, setDesc]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');

  async function submit() {
    if (!title || !city || !payMin || !payMax || !desc) {
      setError('Please fill in all required fields');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onSubmit({
        title,
        city,
        state,
        role_code:       'general',
        cuisine_required: [],
        pay_min_cents:   Math.round(parseFloat(payMin) * 100),
        pay_max_cents:   Math.round(parseFloat(payMax) * 100),
        description_en:  desc,
        pay_frequency:   'weekly',
      });
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Failed to post job');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20 }}>
      <Text style={s.sectionTitle}>Post a Job</Text>
      {error ? <Text style={s.error}>{error}</Text> : null}

      <Text style={s.label}>Job title *</Text>
      <TextInput style={s.input} placeholder="e.g. Tandoor Chef" value={title} onChangeText={setTitle} />

      <Text style={s.label}>City *</Text>
      <TextInput style={s.input} placeholder="e.g. Edison" value={city} onChangeText={setCity} />

      <Text style={s.label}>State *</Text>
      <TextInput style={s.input} placeholder="NJ" value={state} onChangeText={setState} maxLength={2} autoCapitalize="characters" />

      <Text style={s.label}>Pay min ($/week) *</Text>
      <TextInput style={s.input} placeholder="500" value={payMin} onChangeText={setPayMin} keyboardType="numeric" />

      <Text style={s.label}>Pay max ($/week) *</Text>
      <TextInput style={s.input} placeholder="700" value={payMax} onChangeText={setPayMax} keyboardType="numeric" />

      <Text style={s.label}>Description *</Text>
      <TextInput
        style={[s.input, { height: 100, textAlignVertical: 'top' }]}
        placeholder="Describe the role, requirements, and restaurant..."
        value={desc}
        onChangeText={setDesc}
        multiline
      />

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
        <TouchableOpacity style={[s.btn, { flex: 1, backgroundColor: '#ccc' }]} onPress={onCancel}>
          <Text style={[s.btnText, { color: '#333' }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.btn, { flex: 2 }]} onPress={submit} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>Post Job</Text>
          }
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ─── Workers Tab ──────────────────────────────────────────────────────────────
// ── GATE: GET /workers/search — free owners see masked contacts ───────────────
function WorkersTab({ user }: { user: any }) {
  const [workerList, setWorkerList] = useState<any[]>([]);
  const [meta, setMeta]             = useState<any>(null);
  const [loading, setLoading]       = useState(true);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState('');

  useEffect(() => { loadWorkers(); }, []);

  function loadWorkers() {
    if (user.user_type !== 'owner') return setLoading(false);
    setLoading(true);
    workers.search({ limit: 20 })
      .then(r => {
        setWorkerList(r.data.data ?? []);
        setMeta(r.data.meta ?? null);
      })
      .finally(() => setLoading(false));
  }

  if (user.user_type !== 'owner') {
    return (
      <View style={s.center}>
        <Text style={{ color: '#999', fontSize: 15 }}>Workers tab is for restaurant owners.</Text>
      </View>
    );
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={ORANGE} /></View>;

  return (
    <View style={{ flex: 1 }}>
      {/* Plan gate banner — shown for free owners */}
      {meta && !meta.contacts_visible && (
        <TouchableOpacity
          style={s.gateBanner}
          onPress={() => {
            setUpgradeMessage(meta.upgrade_message ?? '');
            setShowUpgrade(true);
          }}
        >
          <Text style={s.gateBannerText}>
            🔒 Upgrade to Starter to contact workers directly
          </Text>
          <Text style={s.gateBannerCta}>Upgrade →</Text>
        </TouchableOpacity>
      )}

      <ScrollView style={{ flex: 1 }}>
        <Text style={s.sectionTitle}>Available Workers ({workerList.length})</Text>
        {workerList.map((w: any) => (
          <View key={w.user_id} style={s.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{w.name}</Text>
                <Text style={s.cardSub}>
                  {w.role_code} · {w.years_experience}yr exp · {w.current_state}
                </Text>
                <Text style={s.cardPay}>
                  ${Math.round((w.salary_min_cents ?? 0) / 100)}–${Math.round((w.salary_max_cents ?? 0) / 100)}/wk
                </Text>
              </View>
              {w.is_verified && (
                <View style={s.verifiedBadge}>
                  <Text style={s.verifiedText}>✓ Verified</Text>
                </View>
              )}
            </View>

            {/* Contact masked for free plan */}
            {w.contact_masked ? (
              <TouchableOpacity
                style={s.maskedContact}
                onPress={() => {
                  setUpgradeMessage(w.upgrade_hint ?? '');
                  setShowUpgrade(true);
                }}
              >
                <Text style={s.maskedContactText}>
                  🔒 Upgrade to view contact details
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={s.contactText}>📞 Contact available</Text>
            )}
          </View>
        ))}
      </ScrollView>

      <UpgradeModal
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        userType="owner"
        feature="worker contact details"
        message={upgradeMessage}
      />
    </View>
  );
}

// ─── Chat Tab ─────────────────────────────────────────────────────────────────
function ChatTab({ user }: { user: any }) {
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([
    { role: 'assistant', text: `Namaste ${user.name.split(' ')[0]}! 🙏 I'm here to help you find the perfect job. What kind of position are you looking for?` }
  ]);
  const [input, setInput]       = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [loading, setLoading]   = useState(false);

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
      <ScrollView style={s.chatScroll} contentContainerStyle={{ padding: 12 }}>
        {messages.map((m, i) => (
          <View key={i} style={[s.bubble, m.role === 'user' ? s.userBubble : s.aiBubble]}>
            <Text style={m.role === 'user' ? s.userText : s.aiText}>{m.text}</Text>
          </View>
        ))}
        {loading && <Text style={s.typing}>Typing...</Text>}
      </ScrollView>
      <View style={s.chatInput}>
        <TextInput
          style={s.chatTextInput}
          placeholder="Type a message..."
          value={input}
          onChangeText={setInput}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
        />
        <TouchableOpacity style={s.sendBtn} onPress={sendMessage}>
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────
function ProfileTab({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [plan, setPlan]           = useState<any>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  useEffect(() => {
    billing.subscription()
      .then(r => setPlan(r.data.data))
      .catch((e) => console.log("PLAN ERROR:", e?.message, e?.response?.status, e?.response?.data));
  }, []);

  async function openBillingPortal() {
    try {
      const res = await billing.portal('https://rasoilink.com/profile');
      const url = res.data?.data?.url;
      if (url) await Linking.openURL(url);
    } catch (e: any) {
      if (e?.response?.status === 400) {
        // No billing account yet — show upgrade modal
        setShowUpgrade(true);
      }
    }
  }

  return (
    <ScrollView contentContainerStyle={s.profileContainer}>
      <Text style={{ fontSize: 60, marginTop: 20 }}>👤</Text>
      <Text style={s.profileName}>{user.name}</Text>
      <Text style={s.profilePhone}>{user.phone}</Text>

      <View style={s.profileRow}>
        <Text style={s.profileLabel}>Account type</Text>
        <Text style={s.profileValue}>{user.user_type}</Text>
      </View>
      <View style={s.profileRow}>
        <Text style={s.profileLabel}>Trust score</Text>
        <Text style={s.profileValue}>⭐ {user.trust_score ?? '0.0'}</Text>
      </View>
      <View style={s.profileRow}>
        <Text style={s.profileLabel}>Verified</Text>
        <Text style={s.profileValue}>{user.is_verified ? '✅ Yes' : '❌ No'}</Text>
      </View>

      {/* Plan card */}
      {plan && (
        <View style={s.planBadgeCard}>
          <View>
            <Text style={s.planBadgeLabel}>Current plan</Text>
            <Text style={s.planBadgeName}>
              {plan.plan_id === 'free' ? '🆓 Free' :
               plan.plan_id === 'starter' ? '⭐ Starter' :
               plan.plan_id === 'growth' ? '🚀 Growth' :
               plan.plan_id === 'worker_boost' ? '🔥 Boosted' : plan.plan_id}
            </Text>
          </View>
          {plan.plan_id !== 'free' ? (
            <TouchableOpacity style={s.manageBtn} onPress={openBillingPortal}>
              <Text style={s.manageBtnText}>Manage</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={s.upgradeSmallBtn} onPress={() => setShowUpgrade(true)}>
              <Text style={s.upgradeSmallBtnText}>Upgrade</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <TouchableOpacity style={s.logoutBtn} onPress={onLogout}>
        <Text style={s.logoutText}>Logout</Text>
      </TouchableOpacity>

      <UpgradeModal
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        userType={user.user_type}
        feature="full platform access"
      />
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container:        { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#FFF8F0' },
  logo:             { fontSize: 40, textAlign: 'center', marginBottom: 8 },
  tagline:          { fontSize: 14, textAlign: 'center', color: '#666', marginBottom: 32 },
  input:            { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 16, backgroundColor: '#fff' },
  label:            { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 4 },
  btn:              { backgroundColor: ORANGE, padding: 14, borderRadius: 10, alignItems: 'center' },
  btnText:          { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  error:            { color: 'red', marginBottom: 8, textAlign: 'center' },
  appContainer:     { flex: 1, backgroundColor: '#F8F9FA' },
  header:           { backgroundColor: ORANGE, padding: 16, paddingTop: 50, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerText:       { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  welcomeText:      { color: '#fff', fontSize: 14 },
  tabBar:           { flexDirection: 'row', borderTopWidth: 1, borderColor: '#eee', backgroundColor: '#fff', paddingBottom: 8 },
  tabBtn:           { flex: 1, alignItems: 'center', paddingTop: 8 },
  tabIcon:          { fontSize: 22 },
  tabLabel:         { fontSize: 11, color: '#999', marginTop: 2 },
  tabActive:        { color: ORANGE },
  sectionTitle:     { fontSize: 18, fontWeight: 'bold', padding: 16, color: '#333' },
  card:             { backgroundColor: '#fff', margin: 8, marginHorizontal: 16, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#F0F0F0' },
  cardTitle:        { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 4 },
  cardSub:          { fontSize: 13, color: '#666', marginBottom: 4 },
  cardPay:          { fontSize: 15, fontWeight: 'bold', color: ORANGE },
  badge:            { marginTop: 6, fontSize: 12, color: '#4CAF50' },
  postJobBtn:       { margin: 16, backgroundColor: DARK, padding: 14, borderRadius: 12, alignItems: 'center' },
  postJobBtnText:   { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  gateBanner:       { backgroundColor: '#FFF3E0', padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderColor: '#FFE0B2' },
  gateBannerText:   { color: '#E65100', fontSize: 13, flex: 1 },
  gateBannerCta:    { color: ORANGE, fontWeight: 'bold', fontSize: 13, marginLeft: 8 },
  maskedContact:    { marginTop: 10, backgroundColor: '#FFF3E0', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#FFE0B2' },
  maskedContactText:{ color: '#E65100', fontSize: 13, fontWeight: '600' },
  contactText:      { marginTop: 8, fontSize: 13, color: '#4CAF50' },
  verifiedBadge:    { backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  verifiedText:     { color: '#2E7D32', fontSize: 11, fontWeight: '700' },
  chatScroll:       { flex: 1, backgroundColor: '#f5f5f5' },
  bubble:           { maxWidth: '80%', padding: 12, borderRadius: 16, marginBottom: 8 },
  userBubble:       { backgroundColor: ORANGE, alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  aiBubble:         { backgroundColor: '#fff', alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  userText:         { color: '#fff', fontSize: 14 },
  aiText:           { color: '#333', fontSize: 14 },
  typing:           { color: '#999', fontStyle: 'italic', marginLeft: 8 },
  chatInput:        { flexDirection: 'row', padding: 8, backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#eee' },
  chatTextInput:    { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14 },
  sendBtn:          { backgroundColor: ORANGE, borderRadius: 20, paddingHorizontal: 16, justifyContent: 'center', marginLeft: 8 },
  profileContainer: { padding: 24, alignItems: 'center' },
  profileName:      { fontSize: 22, fontWeight: 'bold', marginTop: 12, color: '#333' },
  profilePhone:     { fontSize: 14, color: '#666', marginBottom: 24 },
  profileRow:       { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 12, borderBottomWidth: 1, borderColor: '#eee' },
  profileLabel:     { fontSize: 15, color: '#666' },
  profileValue:     { fontSize: 15, fontWeight: '600', color: '#333' },
  planBadgeCard:    { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF8F0', borderRadius: 12, padding: 16, marginTop: 16, borderWidth: 1, borderColor: '#FFE0B2' },
  planBadgeLabel:   { fontSize: 12, color: '#888', marginBottom: 4 },
  planBadgeName:    { fontSize: 16, fontWeight: 'bold', color: DARK },
  manageBtn:        { backgroundColor: DARK, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  manageBtnText:    { color: '#fff', fontSize: 13, fontWeight: '600' },
  upgradeSmallBtn:  { backgroundColor: ORANGE, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  upgradeSmallBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  logoutBtn:        { marginTop: 32, backgroundColor: '#ff4444', padding: 16, borderRadius: 10, width: '100%', alignItems: 'center' },
  logoutText:       { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
