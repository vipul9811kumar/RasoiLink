import { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Modal, ScrollView, TextInput, KeyboardAvoidingView
} from 'react-native';
import { Platform, Linking } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';

const API_URL = 'https://rasoilink-production.up.railway.app';
const ORANGE = '#FF6B00';
const GREEN  = '#2ECC71';
const DARK   = '#1A1A2E';

const LANGUAGES = [
  { code: 'en', name: 'English',    native: 'English',    flag: '🇺🇸' },
  { code: 'hi', name: 'Hindi',      native: 'हिंदी',       flag: '🇮🇳' },
  { code: 'pa', name: 'Punjabi',    native: 'ਪੰਜਾਬੀ',      flag: '🇮🇳' },
  { code: 'gu', name: 'Gujarati',   native: 'ગુજરાતી',     flag: '🇮🇳' },
  { code: 'te', name: 'Telugu',     native: 'తెలుగు',      flag: '🇮🇳' },
  { code: 'ta', name: 'Tamil',      native: 'தமிழ்',       flag: '🇮🇳' },
  { code: 'ml', name: 'Malayalam',  native: 'മലയാളം',     flag: '🇮🇳' },
  { code: 'kn', name: 'Kannada',    native: 'ಕನ್ನಡ',       flag: '🇮🇳' },
  { code: 'bn', name: 'Bengali',    native: 'বাংলা',       flag: '🇮🇳' },
];

const TokenStore = {
  async get(key: string): Promise<string|null> {
    if (Platform.OS === 'web') return localStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string) {
    if (Platform.OS === 'web') { localStorage.setItem(key, value); return; }
    return SecureStore.setItemAsync(key, value);
  },
  async clear(key: string) {
    if (Platform.OS === 'web') { localStorage.removeItem(key); return; }
    return SecureStore.deleteItemAsync(key);
  }
};

const api = axios.create({ baseURL: API_URL });
// ── Billing helpers ──────────────────────────────────────────────────────────
const billing = {
  subscription: () => api.get('/billing/subscription'),
  checkout: (price_id: string, tx_type: string, success_url: string, cancel_url: string, metadata?: object) =>
    api.post('/billing/checkout', { price_id, tx_type, success_url, cancel_url, metadata }),
  portal: (return_url: string) => api.post('/billing/portal', { return_url }),
};

// Price IDs are fetched from the server at runtime (see UpgradeModal)
// so they never need to be hardcoded in the APK.

function isPlanGateError(e: any) {
  return e?.response?.status === 402 && e?.response?.data?.upgrade_required === true;
}

api.interceptors.request.use(async (config) => {
  const token = await TokenStore.get('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── App Root ────────────────────────────────────────────────────────────────
export default function App() {
  const [loading, setLoading]             = useState(true);
  const [user, setUser]                   = useState<any>(null);
  const [language, setLanguage]           = useState<string|null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    Promise.all([
      TokenStore.get('auth_token'),
      TokenStore.get('language'),
    ]).then(async ([token, lang]) => {
      setLanguage(lang);
      if (token) {
        try {
          const r = await api.get('/auth/me');
          setUser(r.data.data);
        } catch {
          await TokenStore.clear('auth_token');
        }
      }
    }).finally(() => setLoading(false));
  }, []);

  async function handleLanguageSelect(code: string) {
    try { await TokenStore.set('language', code); } catch(e) {}
    setLanguage(code);
  }

  function handleLogin(u: any, is_new: boolean) {
    setUser(u);
    setNeedsOnboarding(is_new);
  }

  async function handleLogout() {
    await TokenStore.clear('auth_token');
    setUser(null);
    setNeedsOnboarding(false);
    // keep user_type in storage so returning users skip name/type fields
  }

  let content;
  if (loading) content = <View style={s.center}><ActivityIndicator size="large" color={ORANGE}/></View>;
  else if (!language) content = <LanguageSelector onSelect={handleLanguageSelect}/>;
  else if (!user) content = <AuthScreen onLogin={handleLogin} language={language}/>;
  else if (needsOnboarding) content = <OnboardingScreen user={user} onComplete={() => setNeedsOnboarding(false)}/>;
  else if (user.user_type === 'owner') content = <OwnerApp user={user} language={language} onLogout={handleLogout} onLanguageChange={handleLanguageSelect}/>;
  else content = <WorkerApp user={user} language={language} onLogout={handleLogout} onLanguageChange={handleLanguageSelect}/>;

  return <SafeAreaProvider>{content}</SafeAreaProvider>;
}

// ─── Language Selector ────────────────────────────────────────────────────────
function LanguageSelector({ onSelect }: { onSelect: (code: string) => void }) {
  const [selected, setSelected] = useState<string|null>(null);

  return (
    <View style={s.langContainer}>
      <Text style={s.langLogo}>🍳</Text>
      <Text style={s.langAppName}>RasoiLink</Text>
      <Text style={s.langTitle}>Choose your language</Text>
      <Text style={s.langSubtitle}>अपनी भाषा चुनें • ਆਪਣੀ ਭਾਸ਼ਾ ਚੁਣੋ</Text>
      <ScrollView style={{width:'100%'}} contentContainerStyle={{paddingHorizontal:16, paddingBottom:40}}>
        {LANGUAGES.map(lang => (
          <TouchableOpacity
            key={lang.code}
            style={[s.langBtn, selected===lang.code && s.langBtnSelected]}
            onPress={() => setSelected(lang.code)}
            activeOpacity={0.7}
          >
            <Text style={s.langFlag}>{lang.flag}</Text>
            <View style={{flex:1, marginLeft:16}}>
              <Text style={[s.langNative, selected===lang.code && {color:'#fff'}]}>{lang.native}</Text>
              <Text style={[s.langEnglish, selected===lang.code && {color:'rgba(255,255,255,0.8)'}]}>{lang.name}</Text>
            </View>
            {selected===lang.code && <Text style={{color:'#fff', fontSize:20}}>✓</Text>}
          </TouchableOpacity>
        ))}
      </ScrollView>
      <TouchableOpacity
        style={{
          backgroundColor: selected ? ORANGE : '#ccc',
          borderRadius:12, paddingVertical:16, marginHorizontal:24,
          marginBottom:32, alignItems:'center',
        }}
        onPress={() => { if (selected) onSelect(selected); }}
        disabled={!selected}
      >
        <Text style={{color:'#fff', fontSize:18, fontWeight:'700'}}>
          {selected ? 'Continue →' : 'Select a language'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Auth Screen — Phone → OTP → JWT ─────────────────────────────────────────
function AuthScreen({ onLogin, language }: { onLogin: (u: any, is_new: boolean) => void; language: string }) {
  const [step, setStep]           = useState<'phone'|'otp'>('phone');
  const [phone, setPhone]         = useState('');
  const [name, setName]           = useState('');
  const [userType, setUserType]   = useState<'worker'|'owner'>('worker');
  const [otp, setOtp]             = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [devCode, setDevCode]     = useState('');
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    TokenStore.get('user_type').then(t => {
      if (t === 'worker' || t === 'owner') { setUserType(t); setReturning(true); }
    });
  }, []);

  function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (raw.startsWith('+')) return raw;
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return `+${digits}`;
  }

  async function sendOtp() {
    if (!phone || phone.replace(/[^0-9]/g,'').length < 10) {
      setError('Enter a valid phone number (e.g. +1 2125550000)'); return;
    }
    if (!returning && !name.trim()) { setError('Enter your name'); return; }
    const normalizedPhone = normalizePhone(phone);
    setLoading(true); setError('');
    try {
      const res = await api.post('/auth/send-otp', { phone: normalizedPhone, purpose: 'login' });
      if (res.data.data?.login_code) setDevCode(res.data.data.login_code);
      setStep('otp');
    } catch(e: any) {
      setError(e.response?.data?.error ?? 'Failed to send code. Try again.');
    } finally { setLoading(false); }
  }

  async function verifyOtp() {
    if (otp.length !== 6) { setError('Enter the 6-digit code'); return; }
    setLoading(true); setError('');
    try {
      const res = await api.post('/auth/otp-login', {
        phone: normalizePhone(phone), code: otp, name: name.trim(), user_type: userType, language_code: language,
      });
      await TokenStore.set('auth_token', res.data.data.token);
      await TokenStore.set('user_type', res.data.data.user.user_type);
      onLogin(res.data.data.user, res.data.data.is_new);
    } catch(e: any) {
      setError(e.response?.data?.error ?? 'Invalid code. Try again.');
    } finally { setLoading(false); }
  }

  if (step === 'otp') {
    return (
      <ScrollView contentContainerStyle={s.authContainer}>
        <Text style={s.logo}>📱</Text>
        <Text style={s.appName}>Enter Your Code</Text>
        <Text style={s.tagline}>Use the login code below to sign in</Text>

        {devCode ? (
          <View style={{backgroundColor:'#E8F5E9',borderRadius:8,padding:12,marginBottom:16,width:'100%'}}>
            <Text style={{color:'#2E7D32',textAlign:'center',fontWeight:'700',fontSize:15}}>
              Your login code: {devCode}
            </Text>
          </View>
        ) : null}

        <TextInput
          style={[s.input,{textAlign:'center',fontSize:28,letterSpacing:10,fontWeight:'700'}]}
          placeholder="000000"
          value={otp}
          onChangeText={v => { setOtp(v.replace(/[^0-9]/g,'')); setError(''); }}
          keyboardType="numeric"
          maxLength={6}
          autoFocus
        />

        {error ? <Text style={s.error}>{error}</Text> : null}

        <TouchableOpacity style={s.btn} onPress={verifyOtp} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff"/> : <Text style={s.btnText}>Verify & Continue →</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={sendOtp} style={{marginTop:16}}>
          <Text style={{color:ORANGE,fontSize:13,textAlign:'center'}}>Resend code</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setStep('phone'); setOtp(''); setError(''); setDevCode(''); }} style={{marginTop:8}}>
          <Text style={{color:'#999',fontSize:13,textAlign:'center'}}>← Change phone number</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex:1}}>
    <ScrollView contentContainerStyle={s.authContainer} keyboardShouldPersistTaps="handled">
      <Text style={s.logo}>🍳</Text>
      <Text style={s.appName}>RasoiLink</Text>
      <Text style={s.tagline}>{returning ? 'Welcome back!' : 'Fair Work. Fair Pay. Real Trust.'}</Text>

      {!returning && <>
        <Text style={s.fieldLabel}>Your Name</Text>
        <TextInput
          style={s.input}
          placeholder="Full name"
          value={name}
          onChangeText={v => { setName(v); setError(''); }}
          autoCapitalize="words"
        />
        <View style={s.typeToggle}>
          {(['worker','owner'] as const).map(t => (
            <TouchableOpacity key={t} style={[s.typeBtn, userType===t && s.typeBtnActive]} onPress={() => setUserType(t)}>
              <Text style={[s.typeBtnText, userType===t && s.typeBtnTextActive]}>
                {t==='worker' ? '👨‍🍳 I\'m a Worker' : '🏪 I\'m an Owner'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </>}

      <Text style={s.fieldLabel}>Phone Number</Text>
      <TextInput
        style={s.input}
        placeholder="+1 (555) 000-0000"
        value={phone}
        onChangeText={v => { setPhone(v.replace(/[^0-9+()\s-]/g,'')); setError(''); }}
        keyboardType="phone-pad"
        autoCapitalize="none"
      />

      {error ? (
        error.includes('rasoilink.com') ? (
          <Text style={s.error}>
            {error.split('rasoilink.com')[0]}
            <Text style={{color:ORANGE, textDecorationLine:'underline', fontWeight:'700'}} onPress={() => Linking.openURL('https://rasoilink.com')}>rasoilink.com</Text>
            {error.split('rasoilink.com')[1]}
          </Text>
        ) : (
          <Text style={s.error}>{error}</Text>
        )
      ) : null}

      <TouchableOpacity style={s.btn} onPress={sendOtp} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff"/> : <Text style={s.btnText}>Get Login Code →</Text>}
      </TouchableOpacity>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Onboarding Screen ───────────────────────────────────────────────────────
const WORKER_ROLES = [
  { label: 'Head Chef / Executive Chef', value: 'head_chef' },
  { label: 'Tandoor Chef',               value: 'tandoor_chef' },
  { label: 'Biryani Chef',               value: 'biryani_chef' },
  { label: 'Line Cook',                  value: 'line_cook' },
  { label: 'Prep Cook',                  value: 'prep_cook' },
  { label: 'Pastry / Mithai Cook',       value: 'pastry_cook' },
  { label: 'Kitchen Helper / Dishwasher',value: 'kitchen_helper' },
  { label: 'Server / Waiter',            value: 'server' },
  { label: 'Manager / Supervisor',       value: 'manager' },
];

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

const CUISINE_TYPES = ['North Indian','South Indian','Mughlai','Punjabi','Gujarati','Bengali','Street Food / Chaat','Biryani Specialist','Pan-Indian / Multi-cuisine'];

function OnboardingScreen({ user, onComplete }: { user: any; onComplete: () => void }) {
  const isWorker = user.user_type === 'worker';
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [step, setStep]       = useState(0);

  // Worker fields
  const [role, setRole]           = useState('');
  const [years, setYears]         = useState('');
  const [prefStates, setPrefStates] = useState<string[]>([]);

  // Owner fields
  const [restaurantName, setRestaurantName] = useState('');
  const [city, setCity]                     = useState('');
  const [ownerState, setOwnerState]         = useState('');
  const [cuisine, setCuisine]               = useState('');

  function toggleState(s: string) {
    setPrefStates(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : prev.length < 3 ? [...prev, s] : prev,
    );
  }

  async function save() {
    setLoading(true); setError('');
    try {
      if (isWorker) {
        await api.patch(`/workers/${user.user_id}`, {
          role_code: role || 'kitchen_helper',
          years_experience: parseInt(years) || 0,
          preferred_states: prefStates.length ? prefStates : ['NJ'],
        });
      } else {
        await api.patch(`/owners/${user.user_id}`, {
          restaurant_name: restaurantName || 'My Restaurant',
          city: city || 'Edison',
          state: ownerState || 'NJ',
          cuisine_types: cuisine ? [cuisine] : [],
        });
      }
      onComplete();
    } catch(e: any) {
      setError(e.response?.data?.error ?? 'Failed to save. Please try again.');
    } finally { setLoading(false); }
  }

  return (
    <ScrollView contentContainerStyle={[s.authContainer,{paddingTop:60}]}>
      <Text style={{fontSize:36,textAlign:'center',marginBottom:8}}>{isWorker ? '👨‍🍳' : '🏪'}</Text>
      <Text style={s.appName}>{isWorker ? 'Your Worker Profile' : 'Your Restaurant'}</Text>
      <Text style={s.tagline}>A few quick details to get you started</Text>

      {isWorker ? (
        <>
          {/* Role */}
          <Text style={[s.formLabel,{marginTop:16}]}>Your Role *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:12}}>
            {WORKER_ROLES.map(r => (
              <TouchableOpacity
                key={r.value}
                onPress={() => setRole(r.value)}
                style={[
                  {paddingHorizontal:14,paddingVertical:8,borderRadius:20,borderWidth:1.5,
                   borderColor: role===r.value ? ORANGE : '#ddd',
                   backgroundColor: role===r.value ? '#FFF3E0' : '#fff',
                   marginRight:8},
                ]}
              >
                <Text style={{color: role===r.value ? ORANGE : '#666', fontSize:13, fontWeight: role===r.value?'700':'400'}}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Years */}
          <Text style={s.formLabel}>Years of Experience</Text>
          <TextInput
            style={s.input}
            placeholder="e.g. 3"
            value={years}
            onChangeText={setYears}
            keyboardType="numeric"
          />

          {/* Preferred States */}
          <Text style={s.formLabel}>Preferred States (pick up to 3)</Text>
          <View style={{flexDirection:'row',flexWrap:'wrap',gap:6,marginBottom:16}}>
            {US_STATES.map(st => (
              <TouchableOpacity
                key={st}
                onPress={() => toggleState(st)}
                style={{
                  paddingHorizontal:10,paddingVertical:5,borderRadius:12,borderWidth:1.5,
                  borderColor: prefStates.includes(st) ? ORANGE : '#ddd',
                  backgroundColor: prefStates.includes(st) ? '#FFF3E0' : '#fff',
                }}
              >
                <Text style={{fontSize:12,color: prefStates.includes(st)?ORANGE:'#666',fontWeight:prefStates.includes(st)?'700':'400'}}>
                  {st}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : (
        <>
          <Text style={[s.formLabel,{marginTop:16}]}>Restaurant Name *</Text>
          <TextInput style={s.input} placeholder="e.g. Spice Route Kitchen" value={restaurantName} onChangeText={setRestaurantName}/>

          <Text style={s.formLabel}>City *</Text>
          <TextInput style={s.input} placeholder="e.g. Edison" value={city} onChangeText={setCity}/>

          <Text style={s.formLabel}>State *</Text>
          <View style={{flexDirection:'row',flexWrap:'wrap',gap:6,marginBottom:16}}>
            {US_STATES.map(st => (
              <TouchableOpacity
                key={st}
                onPress={() => setOwnerState(st)}
                style={{
                  paddingHorizontal:10,paddingVertical:5,borderRadius:12,borderWidth:1.5,
                  borderColor: ownerState===st ? DARK : '#ddd',
                  backgroundColor: ownerState===st ? DARK : '#fff',
                }}
              >
                <Text style={{fontSize:12,color:ownerState===st?'#fff':'#666',fontWeight:ownerState===st?'700':'400'}}>
                  {st}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.formLabel}>Cuisine Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:16}}>
            {CUISINE_TYPES.map(c => (
              <TouchableOpacity
                key={c}
                onPress={() => setCuisine(c)}
                style={{
                  paddingHorizontal:14,paddingVertical:8,borderRadius:20,borderWidth:1.5,
                  borderColor: cuisine===c ? DARK : '#ddd',
                  backgroundColor: cuisine===c ? DARK : '#fff',
                  marginRight:8,
                }}
              >
                <Text style={{color:cuisine===c?'#fff':'#666',fontSize:13,fontWeight:cuisine===c?'700':'400'}}>
                  {c}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}

      {error ? <Text style={s.error}>{error}</Text> : null}

      <TouchableOpacity style={[s.btn,{marginTop:8}]} onPress={save} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff"/> : <Text style={s.btnText}>Complete Profile →</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={onComplete} style={{marginTop:16,marginBottom:32}}>
        <Text style={{color:'#bbb',fontSize:13,textAlign:'center'}}>Skip for now</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Worker App ───────────────────────────────────────────────────────────────
function WorkerApp({ user, language, onLogout, onLanguageChange }: { user: any; language: string; onLogout: () => void; onLanguageChange: (c: string) => void }) {
  const [tab, setTab] = useState<'jobs'|'offers'|'pay'|'chat'|'profile'>('jobs');
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  return (
    <SafeAreaView style={s.appContainer} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerText}>🍳 RasoiLink</Text>
        <View style={{flexDirection:'row', alignItems:'center', gap:12}}>
          <Text style={s.welcomeText}>Namaste, {user.name.split(' ')[0]}!</Text>
          <NotificationBell user={user}/>
        </View>
      </View>
      <View style={{flex:1}}>
        {tab === 'jobs'    && <JobsTab user={user} key={tab}/>}
        {tab === 'offers'  && <OffersTab user={user} key={tab}/>}
        {tab === 'pay'     && <PayTrustTab user={user} key={tab}/>}
        {tab === 'chat'    && <ChatTab user={user} language={language}/>}
        {tab === 'profile' && <ProfileTab user={user} language={language} onLogout={onLogout} onLanguageChange={onLanguageChange}/>}
      </View>
      <TabBar tabs={[{key:'jobs',icon:'💼',label:'Jobs'},{key:'offers',icon:'📩',label:'Offers'},{key:'pay',icon:'💰',label:'Pay'},{key:'chat',icon:'💬',label:'Chat'},{key:'profile',icon:'👤',label:'Profile'}]} active={tab} onChange={(t:any)=>setTab(t)}/>
    </SafeAreaView>
  );
}

// ─── Owner App ────────────────────────────────────────────────────────────────
function OwnerApp({ user, language, onLogout, onLanguageChange }: { user: any; language: string; onLogout: () => void; onLanguageChange: (c: string) => void }) {
  const [tab, setTab] = useState<'dashboard'|'listings'|'applicants'|'workers'|'agreements'|'pay'|'profile'>('dashboard');
  return (
    <SafeAreaView style={s.appContainer} edges={['top']}>
      <View style={[s.header, {backgroundColor:DARK}]}>
        <Text style={s.headerText}>🏪 RasoiLink</Text>
        <View style={{flexDirection:'row', alignItems:'center', gap:12}}>
          <Text style={s.welcomeText}>Owner: {user.name.split(' ')[0]}</Text>
          <NotificationBell user={user}/>
        </View>
      </View>
      <View style={{flex:1}}>
        {tab === 'dashboard'  && <OwnerDashboard user={user} key={tab}/>}
        {tab === 'listings'   && <OwnerListings user={user}/>}
        {tab === 'applicants' && <OwnerApplicants user={user} key={tab}/>}
        {tab === 'workers'     && <BrowseWorkersTab user={user}/>}
        {tab === 'agreements'  && <OwnerAgreementsTab user={user} key={tab}/>}
        {tab === 'pay'         && <OwnerPayTab user={user} key={tab}/>}
        {tab === 'profile'    && <ProfileTab user={user} language={language} onLogout={onLogout} onLanguageChange={onLanguageChange}/>}
      </View>
      <TabBar tabs={[{key:'dashboard',icon:'📊',label:'Dashboard'},{key:'listings',icon:'📋',label:'Jobs'},{key:'workers',icon:'🔍',label:'Workers'},{key:'applicants',icon:'👥',label:'Applicants'},{key:'agreements',icon:'📄',label:'Agreements'},{key:'pay',icon:'💸',label:'Pay'},{key:'profile',icon:'👤',label:'Profile'}]} active={tab} onChange={(t:any)=>setTab(t)} color={DARK}/>
    </SafeAreaView>
  );
}

// ─── Language Picker (inline, for profile) ────────────────────────────────────
function LanguagePicker({ current, onSelect }: { current: string; onSelect: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  const lang = LANGUAGES.find(l => l.code === current);
  return (
    <View>
      <TouchableOpacity style={s.langPickerBtn} onPress={() => setOpen(o => !o)}>
        <Text style={{fontSize:16}}>{lang?.flag} {lang?.native}</Text>
        <Text style={{color:'#999'}}>▾</Text>
      </TouchableOpacity>
      {open && (
        <View style={s.langPickerDropdown}>
          {LANGUAGES.map(l => (
            <TouchableOpacity key={l.code} style={[s.langPickerItem, current===l.code && {backgroundColor:'#FFF3E0'}]}
              onPress={() => { onSelect(l.code); setOpen(false); }}>
              <Text>{l.flag} {l.native}</Text>
              {current===l.code && <Text style={{color:ORANGE}}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Owner Dashboard ──────────────────────────────────────────────────────────
function OwnerDashboard({ user }: { user: any }) {
  const [listings, setListings]       = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);

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

  const activeListings = listings.filter((l:any) => l.status==='active').length;
  const pendingApps    = applications.filter((a:any) => a.status==='pending').length;

  return (
    <ScrollView style={{flex:1, padding:16}}>
      <Text style={s.sectionTitle}>Dashboard</Text>
      <View style={s.statsRow}>
        {[[activeListings,'Active Jobs',ORANGE],[pendingApps,'Pending',GREEN],[applications.length,'Total Apps',DARK]].map(([n,l,c]:any) => (
          <View key={l} style={[s.statCard, {borderLeftColor:c}]}>
            <Text style={s.statNum}>{n}</Text>
            <Text style={s.statLabel}>{l}</Text>
          </View>
        ))}
      </View>
      <Text style={[s.sectionTitle,{marginTop:16}]}>Recent Applications</Text>
      {applications.slice(0,3).map((app:any) => (
        <View key={app.offer_id} style={s.card}>
          <Text style={s.cardTitle}>{app.worker_name}</Text>
          <Text style={s.cardSub}>{app.listing_title}</Text>
          <View style={{flexDirection:'row',justifyContent:'space-between',marginTop:4}}>
            <Text style={s.cardSub}>⭐ {app.trust_score} • {app.years_experience}yr exp</Text>
            <View style={[s.statusBadge,{backgroundColor:app.status==='pending'?'#FFF3E0':app.status==='accepted'?'#E8F5E9':'#FFEBEE'}]}>
              <Text style={{fontSize:11,color:app.status==='pending'?ORANGE:app.status==='accepted'?GREEN:'#f44336'}}>{app.status.toUpperCase()}</Text>
            </View>
          </View>
        </View>
      ))}
      {applications.length===0 && <Text style={s.emptyText}>No applications yet. Post a job to get started!</Text>}
    </ScrollView>
  );
}

// ─── Owner Listings ───────────────────────────────────────────────────────────
function OwnerListings({ user }: { user: any }) {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title:'', city:'', state:'NJ', pay_min:'500', pay_max:'700', hours:'40', description_en:'' });
  const [submitting, setSubmitting] = useState(false);
  const [boosting, setBoosting] = useState<string|null>(null);
  const [editingListing, setEditingListing] = useState<any|null>(null);
  const [editForm, setEditForm] = useState({ title:'', city:'', state:'', pay_min:'', pay_max:'', hours:'', description_en:'' });

  async function boostListing(listing_id: string) {
    setBoosting(listing_id);
    try {
      const res = await api.post('/listings/' + listing_id + '/boost', {
        success_url: 'https://rasoilink-production.up.railway.app/health',
        cancel_url: 'https://rasoilink-production.up.railway.app/health',
      });
      const url = res.data?.data?.url;
      if (url) await Linking.openURL(url);
    } catch(e: any) {
      console.log('BOOST ERROR:', JSON.stringify(e?.response?.data ?? e?.message));
      alert(e.response?.data?.error ?? e?.message ?? 'Could not start boost checkout');
    } finally { setBoosting(null); }
  }

  function load() {
    setLoading(true);
    api.get(`/owners/${user.user_id}/listings`).then(r => setListings(r.data.data??[])).finally(()=>setLoading(false));
  }
  useEffect(()=>{load();},[]);

  function openEdit(job: any) {
    setEditForm({
      title: job.title ?? '',
      city: job.city ?? '',
      state: job.state ?? '',
      pay_min: String(Math.round(job.pay_min_cents / 100)),
      pay_max: String(Math.round(job.pay_max_cents / 100)),
      hours: String(job.hours_per_week ?? ''),
      description_en: job.description_en ?? '',
    });
    setEditingListing(job);
  }

  async function saveEdit() {
    if (!editingListing) return;
    setSubmitting(true);
    try {
      await api.patch(`/listings/${editingListing.listing_id}`, {
        title: editForm.title,
        city: editForm.city,
        state: editForm.state,
        pay_min_cents: Math.round(parseFloat(editForm.pay_min) * 100),
        pay_max_cents: Math.round(parseFloat(editForm.pay_max) * 100),
        hours_per_week: parseInt(editForm.hours),
        description_en: editForm.description_en,
      });
      setEditingListing(null);
      load();
    } catch (e: any) { alert(e.response?.data?.error ?? 'Failed to update listing'); }
    finally { setSubmitting(false); }
  }

  async function postJob() {
    setSubmitting(true);
    try {
      await api.post('/listings', {
        title: form.title, city: form.city, state: form.state,
        role_code: 'line_cook',
        pay_min_cents: Math.round(parseFloat(form.pay_min)*100),
        pay_max_cents: Math.round(parseFloat(form.pay_max)*100),
        hours_per_week: parseInt(form.hours),
        description_en: form.description_en,
        accommodation_provided: false, pay_frequency: 'weekly',
        cuisine_required: [], years_exp_required: 0, notice_period_weeks: 2,
      });
      setShowForm(false); load();
    } catch(e:any) { alert(e.response?.data?.error??'Failed to post job'); }
    finally { setSubmitting(false); }
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={DARK}/></View>;

  if (editingListing) return (
    <ScrollView style={{flex:1}} contentContainerStyle={{padding:16}}>
      <Text style={s.sectionTitle}>Edit Listing</Text>
      {([
        {key:'title',label:'Job Title',placeholder:'e.g. Tandoor Chef'},
        {key:'city',label:'City',placeholder:'e.g. Edison'},
        {key:'state',label:'State',placeholder:'NJ'},
        {key:'pay_min',label:'Min Pay ($/week)',placeholder:'500'},
        {key:'pay_max',label:'Max Pay ($/week)',placeholder:'700'},
        {key:'hours',label:'Hours/Week',placeholder:'40'},
        {key:'description_en',label:'Description',placeholder:'Describe the role...'},
      ] as const).map(f => (
        <View key={f.key} style={{marginBottom:12}}>
          <Text style={s.formLabel}>{f.label}</Text>
          <TextInput
            style={[s.input, f.key==='description_en' && {height:80,textAlignVertical:'top'}]}
            placeholder={f.placeholder}
            value={editForm[f.key]}
            onChangeText={v => setEditForm(p => ({...p,[f.key]:v}))}
            multiline={f.key==='description_en'}
          />
        </View>
      ))}
      <View style={{flexDirection:'row',gap:8}}>
        <TouchableOpacity style={[s.btn,{flex:1,backgroundColor:'#ccc'}]} onPress={()=>setEditingListing(null)}>
          <Text style={[s.btnText,{color:'#333'}]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.btn,{flex:1,backgroundColor:DARK}]} onPress={saveEdit} disabled={submitting}>
          {submitting?<ActivityIndicator color="#fff"/>:<Text style={s.btnText}>Save Changes</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  if (showForm) return (
    <ScrollView style={{flex:1}} contentContainerStyle={{padding:16}}>
      <Text style={s.sectionTitle}>Post a New Job</Text>
      {([
        {key:'title',label:'Job Title',placeholder:'e.g. Tandoor Chef'},
        {key:'city',label:'City',placeholder:'e.g. Edison'},
        {key:'state',label:'State',placeholder:'NJ'},
        {key:'pay_min',label:'Min Pay ($/week)',placeholder:'500'},
        {key:'pay_max',label:'Max Pay ($/week)',placeholder:'700'},
        {key:'hours',label:'Hours/Week',placeholder:'40'},
        {key:'description_en',label:'Description',placeholder:'Describe the role...'},
      ] as const).map(f => (
        <View key={f.key} style={{marginBottom:12}}>
          <Text style={s.formLabel}>{f.label}</Text>
          <TextInput style={[s.input,f.key==='description_en'&&{height:80,textAlignVertical:'top'}]}
            placeholder={f.placeholder} value={form[f.key]} onChangeText={v=>setForm(p=>({...p,[f.key]:v}))} multiline={f.key==='description_en'}/>
        </View>
      ))}
      <View style={{flexDirection:'row',gap:8}}>
        <TouchableOpacity style={[s.btn,{flex:1,backgroundColor:'#ccc'}]} onPress={()=>setShowForm(false)}>
          <Text style={[s.btnText,{color:'#333'}]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.btn,{flex:1,backgroundColor:DARK}]} onPress={postJob} disabled={submitting}>
          {submitting?<ActivityIndicator color="#fff"/>:<Text style={s.btnText}>Post Job</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  return (
    <ScrollView style={{flex:1}}>
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:16}}>
        <Text style={s.sectionTitle}>My Listings</Text>
        <TouchableOpacity style={[s.btn,{backgroundColor:DARK,paddingVertical:8,paddingHorizontal:14}]} onPress={()=>setShowForm(true)}>
          <Text style={s.btnText}>+ Post Job</Text>
        </TouchableOpacity>
      </View>
      {listings.map((job:any) => (
        <View key={job.listing_id} style={s.card}>
          <View style={{flexDirection:'row',justifyContent:'space-between'}}>
            <Text style={s.cardTitle}>{job.title}</Text>
            <View style={[s.statusBadge,{backgroundColor:job.status==='active'?'#E8F5E9':'#F5F5F5'}]}>
              <Text style={{fontSize:11,color:job.status==='active'?GREEN:'#999'}}>{job.status.toUpperCase()}</Text>
            </View>
          </View>
          <Text style={s.cardSub}>{job.city}, {job.state}</Text>
          <Text style={s.cardPay}>${Math.round(job.pay_min_cents/100)}–${Math.round(job.pay_max_cents/100)}/week</Text>
          {job.is_boosted && job.boosted_until && (
            <View style={{backgroundColor:'#FFF3E0',borderRadius:6,padding:6,marginTop:6}}>
              <Text style={{fontSize:12,color:'#E65100',fontWeight:'600'}}>🚀 Boosted until {new Date(job.boosted_until).toLocaleDateString()}</Text>
            </View>
          )}
          {job.status === 'active' && !job.is_boosted && (
            <TouchableOpacity
              style={{marginTop:10,backgroundColor:'#FFF3E0',borderWidth:1,borderColor:'#FFE0B2',borderRadius:8,padding:10,alignItems:'center'}}
              onPress={() => boostListing(job.listing_id)}
              disabled={boosting === job.listing_id}
            >
              {boosting === job.listing_id
                ? <ActivityIndicator color="#FF6B00"/>
                : <Text style={{color:'#E65100',fontWeight:'700',fontSize:13}}>🚀 Boost this listing — $29 / 7 days</Text>
              }
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={{marginTop:8,borderWidth:1,borderColor:'#ccc',borderRadius:8,padding:8,alignItems:'center'}}
            onPress={() => openEdit(job)}
          >
            <Text style={{color:'#555',fontWeight:'600',fontSize:13}}>Edit Listing</Text>
          </TouchableOpacity>
        </View>
      ))}
      {listings.length===0 && <Text style={s.emptyText}>No listings yet. Post your first job!</Text>}
    </ScrollView>
  );
}

// ─── Owner Applicants ─────────────────────────────────────────────────────────
function OwnerApplicants({ user }: { user: any }) {
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [agreement, setAgreement] = useState<any>(null);
  const [offerToSetup, setOfferToSetup] = useState<any>(null);
  const [setupForm, setSetupForm] = useState({
    start_date: '', pay: '', hours: '',
    pay_frequency: 'weekly', pay_day: 'friday',
    notice_period_weeks: '2',
    accommodation_provided: false, accommodation_address: '',
    accommodation_cost: '0', end_date: '',
  });
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    api.get(`/owners/${user.user_id}/applications`).then(r=>setApplications(r.data.data??[])).finally(()=>setLoading(false));
  }
  useEffect(()=>{load();},[]);

  // Open the employment terms form pre-filled from the applicant's offer
  function openSetup(app: any) {
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() + 7);
    setSetupForm({
      start_date: defaultStart.toISOString().split('T')[0],
      pay: String(Math.round((app.offered_pay_cents ?? app.salary_min_cents ?? 0) / 100)),
      hours: String(app.offered_hours_pw ?? app.hours_per_week ?? 40),
      pay_frequency: 'weekly',
      pay_day: 'friday',
      notice_period_weeks: '2',
      accommodation_provided: false,
      accommodation_address: '',
      accommodation_cost: '0',
      end_date: '',
    });
    setOfferToSetup(app);
  }

  async function createAgreement() {
    if (!offerToSetup) return;
    setSubmitting(true);
    try {
      await api.post(`/offers/${offerToSetup.offer_id}/agreement`, {
        start_date:              setupForm.start_date || undefined,
        agreed_pay_cents:        Math.round(parseFloat(setupForm.pay) * 100),
        agreed_hours_pw:         parseInt(setupForm.hours),
        pay_frequency:           setupForm.pay_frequency,
        pay_day:                 setupForm.pay_day,
        notice_period_weeks:     parseInt(setupForm.notice_period_weeks),
        accommodation_provided:  setupForm.accommodation_provided,
        accommodation_address:   setupForm.accommodation_provided ? setupForm.accommodation_address : undefined,
        accommodation_cost_cents: setupForm.accommodation_provided ? Math.round(parseFloat(setupForm.accommodation_cost) * 100) : 0,
        end_date:                setupForm.end_date || undefined,
      });
      const agRes = await api.get(`/offers/${offerToSetup.offer_id}/agreement`);
      setOfferToSetup(null);
      setAgreement(agRes.data.data);
      load();
    } catch(e: any) { alert(e.response?.data?.error ?? 'Failed to create agreement'); }
    finally { setSubmitting(false); }
  }

  async function rejectOffer(offer_id: string) {
    await api.patch(`/offers/${offer_id}`, { status: 'rejected' });
    load();
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={DARK}/></View>;

  if (agreement) return (
    <AgreementScreen
      agreement={agreement}
      userType="owner"
      onSign={async () => {
        const res = await api.get(`/offers/${agreement.offer_id}/agreement`);
        setAgreement(res.data.data);
      }}
      onClose={() => setAgreement(null)}
    />
  );

  // Employment terms setup form
  if (offerToSetup) return (
    <ScrollView style={{flex:1}} contentContainerStyle={{padding:16}}>
      <Text style={s.sectionTitle}>Setup Employment Terms</Text>
      <Text style={[s.cardSub,{marginBottom:16}]}>
        For {offerToSetup.worker_name} — {offerToSetup.listing_title}
      </Text>

      {/* Start Date */}
      <View style={{marginBottom:12}}>
        <Text style={s.formLabel}>Start Date (YYYY-MM-DD)</Text>
        <TextInput style={s.input} value={setupForm.start_date}
          onChangeText={v=>setSetupForm(p=>({...p,start_date:v}))}
          placeholder="e.g. 2026-04-07" keyboardType="numeric"/>
      </View>

      {/* Final Salary */}
      <View style={{marginBottom:12}}>
        <Text style={s.formLabel}>Final Agreed Salary ($/week)</Text>
        <TextInput style={s.input} value={setupForm.pay}
          onChangeText={v=>setSetupForm(p=>({...p,pay:v}))}
          placeholder="e.g. 650" keyboardType="numeric"/>
      </View>

      {/* Hours */}
      <View style={{marginBottom:12}}>
        <Text style={s.formLabel}>Hours per Week</Text>
        <TextInput style={s.input} value={setupForm.hours}
          onChangeText={v=>setSetupForm(p=>({...p,hours:v}))}
          placeholder="40" keyboardType="numeric"/>
      </View>

      {/* Pay Frequency */}
      <View style={{marginBottom:12}}>
        <Text style={s.formLabel}>Pay Frequency</Text>
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
          {(['weekly','biweekly','semimonthly','monthly'] as const).map(f=>(
            <TouchableOpacity key={f}
              style={{paddingVertical:6,paddingHorizontal:12,borderRadius:20,borderWidth:1,
                borderColor: setupForm.pay_frequency===f ? DARK : '#ccc',
                backgroundColor: setupForm.pay_frequency===f ? DARK : '#fff'}}
              onPress={()=>setSetupForm(p=>({...p,pay_frequency:f}))}>
              <Text style={{color: setupForm.pay_frequency===f ? '#fff':'#333',fontSize:12}}>{f}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Pay Day */}
      <View style={{marginBottom:12}}>
        <Text style={s.formLabel}>Pay Day</Text>
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
          {(['monday','tuesday','wednesday','thursday','friday'] as const).map(d=>(
            <TouchableOpacity key={d}
              style={{paddingVertical:6,paddingHorizontal:10,borderRadius:20,borderWidth:1,
                borderColor: setupForm.pay_day===d ? DARK : '#ccc',
                backgroundColor: setupForm.pay_day===d ? DARK : '#fff'}}
              onPress={()=>setSetupForm(p=>({...p,pay_day:d}))}>
              <Text style={{color: setupForm.pay_day===d ? '#fff':'#333',fontSize:12,textTransform:'capitalize'}}>{d}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Notice Period */}
      <View style={{marginBottom:12}}>
        <Text style={s.formLabel}>Notice Period (weeks)</Text>
        <TextInput style={s.input} value={setupForm.notice_period_weeks}
          onChangeText={v=>setSetupForm(p=>({...p,notice_period_weeks:v}))}
          placeholder="2" keyboardType="numeric"/>
      </View>

      {/* Contract End Date (optional) */}
      <View style={{marginBottom:12}}>
        <Text style={s.formLabel}>Contract End Date (optional, YYYY-MM-DD)</Text>
        <TextInput style={s.input} value={setupForm.end_date}
          onChangeText={v=>setSetupForm(p=>({...p,end_date:v}))}
          placeholder="Leave blank for open-ended"/>
      </View>

      {/* Accommodation Toggle */}
      <View style={{marginBottom:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
        <Text style={s.formLabel}>Accommodation Provided?</Text>
        <TouchableOpacity
          style={{paddingVertical:6,paddingHorizontal:16,borderRadius:20,
            backgroundColor: setupForm.accommodation_provided ? GREEN : '#ccc'}}
          onPress={()=>setSetupForm(p=>({...p,accommodation_provided:!p.accommodation_provided}))}>
          <Text style={{color:'#fff',fontWeight:'700'}}>{setupForm.accommodation_provided ? 'Yes' : 'No'}</Text>
        </TouchableOpacity>
      </View>
      {setupForm.accommodation_provided && (<>
        <View style={{marginBottom:12}}>
          <Text style={s.formLabel}>Accommodation Address</Text>
          <TextInput style={s.input} value={setupForm.accommodation_address}
            onChangeText={v=>setSetupForm(p=>({...p,accommodation_address:v}))}
            placeholder="Full address"/>
        </View>
        <View style={{marginBottom:12}}>
          <Text style={s.formLabel}>Accommodation Cost Deducted ($/week)</Text>
          <TextInput style={s.input} value={setupForm.accommodation_cost}
            onChangeText={v=>setSetupForm(p=>({...p,accommodation_cost:v}))}
            placeholder="0" keyboardType="numeric"/>
        </View>
      </>)}

      <View style={{flexDirection:'row',gap:8,marginTop:8}}>
        <TouchableOpacity style={[s.btn,{flex:1,backgroundColor:'#ccc'}]} onPress={()=>setOfferToSetup(null)}>
          <Text style={[s.btnText,{color:'#333'}]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.btn,{flex:1,backgroundColor:DARK}]} onPress={createAgreement} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff"/> : <Text style={s.btnText}>Create Agreement</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  return (
    <ScrollView style={{flex:1}}>
      <Text style={s.sectionTitle}>Applicants</Text>
      {applications.map((app:any) => (
        <View key={app.offer_id} style={s.card}>
          <Text style={s.cardTitle}>{app.worker_name}</Text>
          <Text style={s.cardSub}>Applied for: {app.listing_title}</Text>
          <Text style={s.cardSub}>📞 {app.worker_phone}</Text>
          <Text style={s.cardSub}>⭐ Trust: {app.trust_score} • {app.years_experience}yr exp</Text>
          <Text style={s.cardSub}>🍴 {(app.cuisine_specializations??[]).join(', ')||'Not specified'}</Text>
          <Text style={s.cardSub}>💰 ${Math.round(app.salary_min_cents/100)}–${Math.round(app.salary_max_cents/100)}/week</Text>
          {app.status==='pending'?(
            <View style={{flexDirection:'row',gap:8,marginTop:10}}>
              <TouchableOpacity style={[s.btn,{flex:1,backgroundColor:GREEN,paddingVertical:8}]} onPress={()=>openSetup(app)}>
                <Text style={s.btnText}>✓ Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btn,{flex:1,backgroundColor:'#f44336',paddingVertical:8}]} onPress={()=>rejectOffer(app.offer_id)}>
                <Text style={s.btnText}>✗ Reject</Text>
              </TouchableOpacity>
            </View>
          ) : app.status==='accepted' ? (
            <View style={{marginTop:8}}>
              <View style={[s.statusBadge,{alignSelf:'flex-start',backgroundColor:'#FFF3E0',marginBottom:4}]}>
                <Text style={{color:ORANGE,fontSize:12,fontWeight:'600'}}>⏳ AGREEMENT PENDING WORKER SIGNATURE</Text>
              </View>
            </View>
          ):(
            <View style={[s.statusBadge,{marginTop:8,alignSelf:'flex-start',backgroundColor:'#FFEBEE'}]}>
              <Text style={{color:'#f44336',fontSize:12,fontWeight:'600'}}>{app.status.toUpperCase()}</Text>
            </View>
          )}
        </View>
      ))}
      {applications.length===0 && <Text style={s.emptyText}>No applications yet.</Text>}
    </ScrollView>
  );
}

// ─── Worker: Jobs Tab ─────────────────────────────────────────────────────────

// ─── Upgrade Modal ───────────────────────────────────────────────────────────
function UpgradeModal({ visible, onClose, userType, message, currentPlan }: { visible: boolean; onClose: ()=>void; userType: string; message?: string; currentPlan?: string }) {
  const [loading, setLoading]   = useState<string|null>(null);
  const [prices, setPrices]     = useState<Record<string,string>>({});

  useEffect(() => {
    if (visible) {
      api.get('/billing/prices')
        .then(r => setPrices(r.data.data ?? {}))
        .catch(() => {});
    }
  }, [visible]);

  const allPlans = userType === 'owner' ? [
    { id:'starter', name:'Starter', price:'$39/mo', price_id: prices.owner_starter ?? '',
      features:['5 active job posts','View worker contacts','AI match engine'], highlight:false },
    { id:'growth', name:'Growth', price:'$99/mo', price_id: prices.owner_growth ?? '',
      features:['Unlimited posts','Everything in Starter','WhatsApp alerts'], highlight:true },
  ] : [
    { id:'worker_boost', name:'Boost', price:'$7/mo', price_id: prices.worker_boost ?? '',
      features:['Priority in search','Verified badge','WhatsApp job alerts'], highlight:true },
  ];
  // Filter out plans the user already has (e.g. Starter owner only sees Growth)
  const plans = currentPlan ? allPlans.filter(p => p.id !== currentPlan) : allPlans;

  async function handleUpgrade(plan: any) {
    if (!plan.price_id) { alert('Prices still loading. Please try again.'); return; }
    setLoading(plan.id);
    try {
      const res = await billing.checkout(
        plan.price_id, 'subscription',
        'https://rasoilink-production.up.railway.app/health',
        'https://rasoilink-production.up.railway.app/health',
      );
      const url = res.data?.data?.url;
      if (url) { await Linking.openURL(url); onClose(); }
    } catch(e:any) { 
      console.log('Checkout error:', JSON.stringify(e?.response?.data ?? e?.message));
      alert('Could not start checkout: ' + (e?.response?.data?.error ?? e?.message ?? 'Unknown error')); 
    }
    finally { setLoading(null); }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.55)',justifyContent:'flex-end'}}>
        <View style={{backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,maxHeight:'88%'}}>
          <View style={{backgroundColor:DARK,padding:24,borderTopLeftRadius:24,borderTopRightRadius:24,alignItems:'center'}}>
            <TouchableOpacity style={{position:'absolute',top:20,right:20,padding:8}} onPress={onClose}>
              <Text style={{color:'rgba(255,255,255,0.6)',fontSize:18}}>✕</Text>
            </TouchableOpacity>
            <Text style={{fontSize:32,marginBottom:8}}>🚀</Text>
            <Text style={{color:'#fff',fontSize:22,fontWeight:'bold',marginBottom:4}}>Upgrade RasoiLink</Text>
            <Text style={{color:'rgba(255,255,255,0.6)',fontSize:14,textAlign:'center'}}>Unlock the full platform</Text>
          </View>
          {message && (
            <View style={{backgroundColor:'#FFF3E0',borderLeftWidth:4,borderLeftColor:ORANGE,padding:12,margin:16,marginBottom:0,borderRadius:8}}>
              <Text style={{color:'#E65100',fontSize:13}}>{message}</Text>
            </View>
          )}
          <ScrollView contentContainerStyle={{padding:16,paddingBottom:40}}>
            {plans.map((plan:any) => (
              <View key={plan.id} style={{borderWidth:plan.highlight?2:1.5,borderColor:plan.highlight?ORANGE:'#E0E0E0',borderRadius:16,padding:20,marginBottom:12}}>
                {plan.highlight && (
                  <View style={{alignSelf:'center',backgroundColor:ORANGE,paddingHorizontal:16,paddingVertical:4,borderRadius:12,marginBottom:8}}>
                    <Text style={{color:'#fff',fontSize:11,fontWeight:'700'}}>Most Popular</Text>
                  </View>
                )}
                <Text style={{fontSize:20,fontWeight:'bold',color:DARK,marginBottom:4}}>{plan.name}</Text>
                <Text style={{fontSize:28,fontWeight:'bold',color:ORANGE,marginBottom:12}}>{plan.price}</Text>
                {plan.features.map((f:string) => (
                  <View key={f} style={{flexDirection:'row',alignItems:'center',marginBottom:6}}>
                    <Text style={{color:'#27AE60',fontSize:16,fontWeight:'bold',marginRight:10}}>✓</Text>
                    <Text style={{fontSize:14,color:'#444'}}>{f}</Text>
                  </View>
                ))}
                <TouchableOpacity
                  style={{backgroundColor:plan.highlight?ORANGE:DARK,padding:14,borderRadius:12,alignItems:'center',marginTop:12,opacity:loading===plan.id?0.6:1}}
                  onPress={()=>handleUpgrade(plan)}
                  disabled={!!loading}
                >
                  {loading===plan.id
                    ?<ActivityIndicator color="#fff"/>
                    :<Text style={{color:'#fff',fontSize:15,fontWeight:'bold'}}>Get {plan.name} — {plan.price}</Text>
                  }
                </TouchableOpacity>
              </View>
            ))}
            <Text style={{textAlign:'center',color:'#999',fontSize:12,marginTop:8}}>Cancel anytime. No contracts.</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function JobsTab({ user }: { user: any }) {
  const [jobs, setJobs]           = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [applying, setApplying]   = useState<string|null>(null);
  const [applied, setApplied]     = useState<Set<string>>(new Set());
  const [scores, setScores]       = useState<Record<string,number|null>>({});

  useEffect(()=>{
    Promise.all([
      api.get('/listings'),
      api.get(`/workers/${user.user_id}/applications`).catch(()=>({ data: { data: [] } })),
    ]).then(([listRes, appRes]) => {
      const lst = listRes.data.data ?? [];
      const appliedIds: string[] = appRes.data.data ?? [];
      setJobs(lst);
      setApplied(new Set(appliedIds));
      setLoading(false);
      Promise.all(
        lst.map((l: any) =>
          api.get(`/listings/${l.listing_id}/score`)
            .then((sr:any) => ({ id: l.listing_id, score: sr.data.data?.score ?? null }))
            .catch(() => ({ id: l.listing_id, score: null }))
        )
      ).then((results: any[]) => {
        const map: Record<string,number|null> = {};
        results.forEach((r:any) => { map[r.id] = r.score; });
        setScores(map);
      });
    }).catch(()=>setLoading(false));
  },[]);

  async function apply(listing_id: string) {
    setApplying(listing_id);
    try {
      await api.post(`/listings/${listing_id}/apply`, {});
      setApplied(s=>new Set([...s, listing_id]));
    } catch(e:any) { alert(e.response?.data?.error??'Failed to apply'); }
    finally { setApplying(null); }
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={ORANGE}/></View>;

  return (
    <ScrollView style={{flex:1}}>
      <Text style={s.sectionTitle}>Active Jobs</Text>
      {jobs.map((job:any) => (
        <View key={job.listing_id} style={[s.card, scores[job.listing_id] != null && scores[job.listing_id]! >= 80 ? {borderLeftColor:GREEN, borderLeftWidth:3} : {}]}>
          <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start'}}>
            <Text style={[s.cardTitle, {flex:1}]}>{job.title}</Text>
            {scores[job.listing_id] != null ? (
              <View style={[s.statusBadge, {backgroundColor:
                scores[job.listing_id]! >= 80 ? GREEN+'22' :
                scores[job.listing_id]! >= 60 ? ORANGE+'22' : '#88888822'
              }]}>
                <Text style={{fontSize:12, fontWeight:'700', color:
                  scores[job.listing_id]! >= 80 ? GREEN :
                  scores[job.listing_id]! >= 60 ? ORANGE : '#888'
                }}>{scores[job.listing_id]}% match</Text>
              </View>
            ) : (
              <View style={[s.statusBadge, {backgroundColor:'#f0f0f0'}]}>
                <Text style={{fontSize:10, color:'#ccc'}}>scoring...</Text>
              </View>
            )}
          </View>
          <Text style={s.cardSub}>{job.restaurant_name} • {job.city}, {job.state}</Text>
          {job.is_boosted && (
            <View style={{backgroundColor:'#FFF3E0',borderRadius:6,paddingHorizontal:8,paddingVertical:3,marginBottom:4,alignSelf:'flex-start'}}>
              <Text style={{fontSize:11,color:'#E65100',fontWeight:'700'}}>🚀 Featured</Text>
            </View>
          )}
          <Text style={s.cardPay}>${Math.round(job.pay_min_cents/100)}–${Math.round(job.pay_max_cents/100)}/week</Text>
          {job.accommodation_provided && <Text style={s.badge}>🏠 Accommodation included</Text>}
          <Text style={s.cardSub}>⭐ Owner trust: {job.owner_trust_score}</Text>
          <TouchableOpacity
            style={[s.btn,{marginTop:10,paddingVertical:8,backgroundColor:applied.has(job.listing_id)?GREEN:ORANGE}]}
            onPress={()=>apply(job.listing_id)}
            disabled={!!applying||applied.has(job.listing_id)}
          >
            {applying===job.listing_id
              ?<ActivityIndicator color="#fff"/>
              :<Text style={s.btnText}>{applied.has(job.listing_id)?'✓ Applied':'Apply Now'}</Text>
            }
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Worker: Chat Tab ─────────────────────────────────────────────────────────
function ChatTab({ user, language }: { user: any; language: string }) {
  const lang = LANGUAGES.find(l=>l.code===language);
  const scrollRef = useRef<ScrollView>(null);
  const GREETING = `Namaste ${user.name.split(' ')[0]}! 🙏 I'm here to help you find the perfect job. What kind of position are you looking for?`;
  const [messages, setMessages] = useState<{role:string;text:string;jobs?:any[]}[]>([
    { role:'assistant', text: GREETING }
  ]);
  const [input, setInput]         = useState('');
  const [sessionId, setSessionId] = useState<string|undefined>();
  const [loading, setLoading]     = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Load most recent chat session on mount, then surface job suggestions if profile is built
  useEffect(() => {
    api.get('/chat/sessions').then(async r => {
      const sessions: any[] = r.data.data ?? [];
      if (sessions.length === 0) return;
      const latest = sessions[0];
      setSessionId(latest.session_id);
      const mr = await api.get(`/chat/sessions/${latest.session_id}/messages`);
      const msgs = (mr.data.data ?? []).map((m: any) => ({ role: m.role, text: m.content_text }));
      if (msgs.length > 0) {
        setMessages(msgs);
        // Profile already built in a previous session — show job suggestions automatically
        showJobSuggestions(msgs);
      }
    }).catch(()=>{}).finally(()=>setHistoryLoading(false));
  }, []);

  async function showJobSuggestions(currentMsgs?: typeof messages) {
    const jobsRes = await api.get('/listings?limit=5').catch(()=>null);
    const jobs: any[] = jobsRes?.data?.data ?? [];
    if (jobs.length === 0) return;
    // Avoid duplicate job cards (don't add if last message already has jobs)
    const existing = currentMsgs ?? messages;
    if (existing.length > 0 && existing[existing.length - 1].jobs) return;
    setMessages(m => [...m, {
      role: 'assistant',
      text: 'Here are the latest open positions that match your profile:',
      jobs,
    }]);
  }

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    if (!historyLoading) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages, loading, historyLoading]);

  async function send() {
    if (!input.trim() || loading) return;
    const msg = input.trim(); setInput('');
    setMessages(m=>[...m,{role:'user',text:msg}]);
    setLoading(true);
    try {
      const res = await api.post('/chat/message', { message: msg, session_id: sessionId, language_code: language });
      setSessionId(res.data.data.session_id);

      // Strip internal update blocks and raw JSON from the displayed message
      const displayText = res.data.data.message
        .replace(/<PROFILE_UPDATE>[\s\S]*?<\/PROFILE_UPDATE>/g, '')
        .replace(/```json[\s\S]*?```/g, '')
        .replace(/\{[\s\S]*?"role_code"[\s\S]*?\}/g, '')
        .trim();
      setMessages(m=>[...m,{role:'assistant',text:displayText}]);

      // Profile was just built — show job suggestions immediately
      if (res.data.data.profile_updated) {
        await showJobSuggestions();
      }
    } catch(e: any) {
      const errMsg = e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? 'Sorry, something went wrong. Please try again.';
      setMessages(m=>[...m,{role:'assistant',text:errMsg}]);
    } finally { setLoading(false); }
  }

  if (historyLoading) return <View style={s.center}><ActivityIndicator color={ORANGE}/></View>;

  return (
    <KeyboardAvoidingView style={{flex:1}} behavior="padding" keyboardVerticalOffset={Platform.OS==='ios'?90:60}>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:12,paddingVertical:6,borderBottomWidth:1,borderColor:'#eee'}}>
        <View style={s.chatLangBadge}>
          <Text style={s.chatLangText}>{lang?.flag} {lang?.native}</Text>
        </View>
        <TouchableOpacity
          style={{backgroundColor:'#E8F5E9',paddingHorizontal:12,paddingVertical:6,borderRadius:20,borderWidth:1,borderColor:GREEN}}
          onPress={()=>showJobSuggestions()}
          disabled={loading}
        >
          <Text style={{color:GREEN,fontSize:12,fontWeight:'700'}}>🔍 Find Jobs for Me</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        ref={scrollRef}
        style={s.chatScroll}
        contentContainerStyle={{padding:12}}
        onContentSizeChange={()=>scrollRef.current?.scrollToEnd({animated:false})}
      >
        {messages.map((m,i)=>(
          <View key={i}>
            <View style={[s.bubble,m.role==='user'?s.userBubble:s.aiBubble]}>
              <Text style={m.role==='user'?s.userText:s.aiText}>{m.text}</Text>
            </View>
            {/* Job suggestion cards shown inline after profile build */}
            {m.jobs && m.jobs.length > 0 && (
              <View style={{marginTop:6,marginBottom:4}}>
                {m.jobs.map((job:any,ji:number)=>(
                  <View key={ji} style={{backgroundColor:'#fff',borderRadius:12,padding:12,marginBottom:8,borderWidth:1,borderColor:'#E8F5E9',elevation:1}}>
                    <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'}}>
                      <Text style={{fontWeight:'700',color:DARK,fontSize:14,flex:1}}>{job.title}</Text>
                      {job.is_boosted && <Text style={{fontSize:11,color:ORANGE,fontWeight:'700'}}>🚀 Featured</Text>}
                    </View>
                    <Text style={{color:'#666',fontSize:12,marginTop:2}}>📍 {job.city}, {job.state}</Text>
                    <Text style={{color:GREEN,fontSize:13,fontWeight:'600',marginTop:4}}>
                      ${Math.round(job.pay_min_cents/100)}–${Math.round(job.pay_max_cents/100)}/week
                    </Text>
                  </View>
                ))}
                <Text style={{fontSize:11,color:'#999',marginBottom:4,textAlign:'center'}}>
                  Go to the Jobs tab to apply →
                </Text>
              </View>
            )}
          </View>
        ))}
        {loading && <Text style={s.typing}>Typing...</Text>}
      </ScrollView>
      <View style={s.chatInputRow}>
        <TextInput
          style={s.chatTextInput}
          placeholder="Type a message..."
          value={input}
          onChangeText={setInput}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <TouchableOpacity style={s.sendBtn} onPress={send}>
          <Text style={{color:'#fff',fontWeight:'bold'}}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Shared: Profile Tab ──────────────────────────────────────────────────────
function ProfileTab({ user, language, onLogout, onLanguageChange }: { user: any; language: string; onLogout: ()=>void; onLanguageChange: (c:string)=>void }) {
  const isOwner = user.user_type==='owner';
  const [showEditor, setShowEditor] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [liveScore, setLiveScore] = useState<string|null>(null);

  useEffect(() => {
    billing.subscription()
      .then(r => setPlan(r.data.data))
      .catch(() => {});
    // Fetch live trust score
    const endpoint = isOwner
      ? `/owners/${user.user_id}/ratings`
      : `/workers/${user.user_id}/ratings`;
    api.get(endpoint)
      .then(r => setLiveScore(r.data.data?.trust_score ?? null))
      .catch(() => {});
  }, []);

  async function openPortal() {
    try {
      const res = await billing.portal('https://rasoilink.com/profile');
      const url = res.data?.data?.url;
      if (url) await Linking.openURL(url);
    } catch {
      setShowUpgrade(true);
    }
  }
  return (
    <ScrollView contentContainerStyle={s.profileContainer}>
      <Text style={{fontSize:60,marginTop:20}}>{isOwner?'🏪':'👤'}</Text>
      <Text style={s.profileName}>{user.name}</Text>
      <Text style={{fontSize:14,color:'#666',marginBottom:24}}>{user.phone}</Text>

      <View style={{width:'100%',marginBottom:16}}>
        <Text style={[s.formLabel,{marginBottom:8}]}>🌐 Language</Text>
        <LanguagePicker current={language} onSelect={async (c)=>{ await TokenStore.set('language',c); onLanguageChange(c); }}/>
      </View>

      {([
        ['Account Type', isOwner?'🏪 Owner':'👨‍🍳 Worker'],
        ['Trust Score', `⭐ ${liveScore ?? user.trust_score ?? '0.0'}`],
        ['Verified', user.is_verified?'✅ Yes':'❌ No'],
        ['Member Since', user.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'],
      ] as [string,string][]).map(([k,v])=>(
        <View key={k} style={s.profileRow}>
          <Text style={s.profileLabel}>{k}</Text>
          <Text style={s.profileValue}>{v}</Text>
        </View>
      ))}
      {!isOwner && (
        <TouchableOpacity
          style={[s.btn, {backgroundColor:ORANGE, width:'100%', marginBottom:12}]}
          onPress={() => setShowEditor(true)}
        >
          <Text style={s.btnText}>✏️ Edit My Profile</Text>
        </TouchableOpacity>
      )}
      {/* Plan card */}
      {plan && (
        <View style={{width:'100%',flexDirection:'row',justifyContent:'space-between',alignItems:'center',backgroundColor:'#FFF8F0',borderRadius:12,padding:16,marginTop:8,marginBottom:8,borderWidth:1,borderColor:'#FFE0B2'}}>
          <View>
            <Text style={{fontSize:12,color:'#888',marginBottom:4}}>Current plan</Text>
            <Text style={{fontSize:16,fontWeight:'bold',color:DARK}}>
              {plan.plan_id==='free'?'🆓 Free':plan.plan_id==='starter'?'⭐ Starter':plan.plan_id==='growth'?'🚀 Growth':plan.plan_id==='worker_boost'?'🔥 Boosted':plan.plan_id}
            </Text>
          </View>
          <View style={{flexDirection:'row',gap:8}}>
            {(plan.plan_id==='free' || plan.plan_id==='starter') && (
              <TouchableOpacity style={{backgroundColor:ORANGE,paddingHorizontal:16,paddingVertical:8,borderRadius:8}} onPress={() => setShowUpgrade(true)}>
                <Text style={{color:'#fff',fontSize:13,fontWeight:'600'}}>{plan.plan_id==='starter'?'→ Growth':'Upgrade'}</Text>
              </TouchableOpacity>
            )}
            {plan.plan_id !== 'free' && (
              <TouchableOpacity style={{backgroundColor:DARK,paddingHorizontal:16,paddingVertical:8,borderRadius:8}} onPress={openPortal}>
                <Text style={{color:'#fff',fontSize:13,fontWeight:'600'}}>Manage</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
      {/* Support */}
      <View style={{width:'100%',marginTop:8,marginBottom:4}}>
        <Text style={[s.formLabel,{marginBottom:10}]}>🆘 Support</Text>
        <TouchableOpacity
          style={{flexDirection:'row',alignItems:'center',backgroundColor:'#25D366',borderRadius:12,padding:16,marginBottom:10}}
          onPress={() => Linking.openURL('https://wa.me/19843197647?text=Hi%20RasoiLink%20support%2C%20I%20need%20help%20with...')}
        >
          <Text style={{fontSize:20,marginRight:10}}>💬</Text>
          <View>
            <Text style={{color:'#fff',fontWeight:'700',fontSize:15}}>WhatsApp Support</Text>
            <Text style={{color:'rgba(255,255,255,0.8)',fontSize:12}}>Chat with us directly</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={{flexDirection:'row',alignItems:'center',backgroundColor:'#F5F5F5',borderRadius:12,padding:16,marginBottom:10}}
          onPress={() => Linking.openURL('mailto:support@rasoilink.com?subject=RasoiLink%20Support')}
        >
          <Text style={{fontSize:20,marginRight:10}}>✉️</Text>
          <View>
            <Text style={{color:DARK,fontWeight:'700',fontSize:15}}>Email Support</Text>
            <Text style={{color:'#666',fontSize:12}}>support@rasoilink.com</Text>
          </View>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={s.logoutBtn} onPress={onLogout}>
        <Text style={{color:'#fff',fontSize:16,fontWeight:'bold'}}>Logout</Text>
      </TouchableOpacity>
      <UpgradeModal
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        userType={user.user_type}
        currentPlan={plan?.plan_id}
      />
      {!isOwner && (
        <Modal visible={showEditor} animationType="slide" onRequestClose={() => setShowEditor(false)}>
          <WorkerProfileEditor user={user} onClose={() => setShowEditor(false)}/>
        </Modal>
      )}
    </ScrollView>
  );
}

// ─── Shared: Tab Bar ──────────────────────────────────────────────────────────
function TabBar({ tabs, active, onChange, color=ORANGE }: { tabs:{key:string;icon:string;label:string}[]; active:string; onChange:(k:string)=>void; color?:string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map(t=>(
        <TouchableOpacity key={t.key} style={s.tabBtn} onPress={()=>onChange(t.key)}>
          <Text style={[s.tabIcon,active===t.key&&{color}]}>{t.icon}</Text>
          <Text style={[s.tabLabel,active===t.key&&{color}]}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}


// ─── Worker: Offers Tab ───────────────────────────────────────────────────────
function OffersTab({ user }: { user: any }) {
  const [offers, setOffers]     = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [responding, setResponding] = useState<string|null>(null);

  // Worker self-terminate (resign)
  const [showResign, setShowResign] = useState<any>(null);
  const [resigning, setResigning]   = useState(false);

  async function resign() {
    if (!showResign?.agreement_id) return;
    setResigning(true);
    try {
      await api.patch(`/agreements/${showResign.agreement_id}/terminate`, {
        reason: 'worker_resigned',
        last_working_date: new Date().toISOString().slice(0, 10),
        notes: 'Worker initiated resignation via app',
      });
      setShowResign(null);
      load();
    } catch (e: any) {
      alert(e.response?.data?.error ?? 'Failed to resign. Please try again.');
    } finally { setResigning(false); }
  }

  function load() {
    setLoading(true);
    api.get(`/workers/${user.user_id}/offers`)
      .then(r => setOffers(r.data.data ?? []))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const [agreement, setAgreement] = useState<any>(null);

  async function respond(offer_id: string, status: string) {
    setResponding(offer_id);
    try {
      // Just mark the offer accepted — the owner creates the agreement with terms
      await api.patch(`/offers/${offer_id}`, { status });
      load();
    } catch(e: any) {
      alert(e.response?.data?.error ?? 'Failed to respond');
    } finally { setResponding(null); }
  }

  async function openAgreement(offer_id: string) {
    setResponding(offer_id);
    try {
      const agRes = await api.get(`/offers/${offer_id}/agreement`);
      setAgreement(agRes.data.data);
    } catch(e: any) {
      alert('Agreement not ready yet — the owner is still preparing the contract.');
    } finally { setResponding(null); }
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={ORANGE}/></View>;

  if (agreement) return (
    <AgreementScreen
      agreement={agreement}
      userType="worker"
      onSign={async () => {
        const res = await api.get(`/offers/${agreement.offer_id}/agreement`);
        setAgreement(res.data.data);
        load(); // refresh offers list so button state updates
      }}
      onClose={() => { setAgreement(null); load(); }}
    />
  );

  return (
    <ScrollView style={{flex:1}}>
      <Text style={s.sectionTitle}>My Offers ({offers.length})</Text>
      {offers.length === 0 && (
        <View style={s.emptyContainer}>
          <Text style={s.emptyIcon}>📭</Text>
          <Text style={s.emptyText}>No offers yet.</Text>
          <Text style={s.emptySubtext}>Apply to jobs and owners will send you offers here.</Text>
        </View>
      )}
      {offers.map((offer: any) => {
        const isPending  = offer.status === 'pending';
        const isAccepted = offer.status === 'accepted';
        const isRejected = offer.status === 'rejected';
        const pay = Math.round(offer.offered_pay_cents / 100);
        const expires = new Date(offer.expires_at).toLocaleDateString();

        return (
          <View key={offer.offer_id} style={[s.card, isAccepted && s.cardAccepted, isRejected && s.cardRejected]}>
            {/* Header */}
            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start'}}>
              <View style={{flex:1}}>
                <Text style={s.cardTitle}>{offer.listing_title}</Text>
                <Text style={s.cardSub}>🏪 {offer.restaurant_name}</Text>
                <Text style={s.cardSub}>👤 {offer.owner_name}</Text>
              </View>
              <View style={[s.statusBadge, {
                backgroundColor: isPending?'#FFF3E0':isAccepted?'#E8F5E9':'#FFEBEE',
                alignSelf:'flex-start'
              }]}>
                <Text style={{
                  fontSize:11, fontWeight:'700',
                  color: isPending?ORANGE:isAccepted?GREEN:'#f44336'
                }}>
                  {offer.status.toUpperCase()}
                </Text>
              </View>
            </View>

            {/* Offer details */}
            <View style={s.offerDetails}>
              <View style={s.offerDetail}>
                <Text style={s.offerDetailLabel}>💰 Weekly Pay</Text>
                <Text style={s.offerDetailValue}>${pay}/week</Text>
              </View>
              <View style={s.offerDetail}>
                <Text style={s.offerDetailLabel}>⏱ Hours</Text>
                <Text style={s.offerDetailValue}>{offer.offered_hours_pw}h/week</Text>
              </View>
              <View style={s.offerDetail}>
                <Text style={s.offerDetailLabel}>📍 Location</Text>
                <Text style={s.offerDetailValue}>{offer.city||'TBD'}, {offer.state}</Text>
              </View>
              <View style={s.offerDetail}>
                <Text style={s.offerDetailLabel}>🏠 Housing</Text>
                <Text style={s.offerDetailValue}>{offer.accommodation_provided?'✅ Included':'❌ Not included'}</Text>
              </View>
            </View>

            {offer.description_en && (
              <Text style={s.offerDesc}>{offer.description_en}</Text>
            )}

            <Text style={s.offerExpiry}>⭐ Owner trust: {offer.owner_trust_score} • Expires {expires}</Text>

            {/* Action buttons */}
            {isPending && (
              <View style={{flexDirection:'row', gap:8, marginTop:12}}>
                <TouchableOpacity
                  style={[s.btn, {flex:1, backgroundColor:'#f44336', paddingVertical:10}]}
                  onPress={() => respond(offer.offer_id, 'rejected')}
                  disabled={responding === offer.offer_id}
                >
                  {responding === offer.offer_id
                    ? <ActivityIndicator color="#fff"/>
                    : <Text style={s.btnText}>✗ Decline</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.btn, {flex:2, backgroundColor:GREEN, paddingVertical:10}]}
                  onPress={() => respond(offer.offer_id, 'accepted')}
                  disabled={responding === offer.offer_id}
                >
                  {responding === offer.offer_id
                    ? <ActivityIndicator color="#fff"/>
                    : <Text style={s.btnText}>✓ Accept Offer</Text>
                  }
                </TouchableOpacity>
              </View>
            )}
            {isAccepted && (
              <View>
                {offer.worker_signed_at ? (
                  <View>
                    <View style={s.acceptedBanner}>
                      <Text style={s.acceptedBannerText}>
                        {offer.owner_signed_at
                          ? '🎉 Agreement fully signed! Both parties have signed.'
                          : '✅ You have signed. Waiting for owner to sign.'}
                      </Text>
                    </View>
                    {/* Resign option — only when both have signed (active employment) */}
                    {offer.owner_signed_at && (
                      <TouchableOpacity
                        style={{marginTop:8, paddingVertical:7, paddingHorizontal:12, borderRadius:8, borderWidth:1, borderColor:'#f44336', alignSelf:'flex-start'}}
                        onPress={() => setShowResign(offer)}
                      >
                        <Text style={{color:'#f44336', fontWeight:'700', fontSize:12}}>📤 Resign / End Employment</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  <>
                    <View style={s.acceptedBanner}>
                      <Text style={s.acceptedBannerText}>🎉 Offer accepted! Review and sign your contract below.</Text>
                    </View>
                    <TouchableOpacity
                      style={[s.btn,{marginTop:8,backgroundColor:DARK,paddingVertical:10}]}
                      onPress={() => openAgreement(offer.offer_id)}
                      disabled={responding === offer.offer_id}
                    >
                      {responding === offer.offer_id
                        ? <ActivityIndicator color="#fff"/>
                        : <Text style={s.btnText}>📄 View & Sign Agreement</Text>
                      }
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}
            {isRejected && (
              <View style={s.rejectedBanner}>
                <Text style={s.rejectedBannerText}>You declined this offer.</Text>
              </View>
            )}
          </View>
        );
      })}

      {/* Resign Confirmation Modal */}
      <Modal visible={!!showResign} transparent animationType="slide" onRequestClose={() => setShowResign(null)}>
        <TouchableOpacity style={{flex:1, justifyContent:'flex-end', backgroundColor:'rgba(0,0,0,0.5)'}} activeOpacity={1} onPress={() => setShowResign(null)}>
        <TouchableOpacity activeOpacity={1} onPress={e => e.stopPropagation?.()}>
          <View style={{backgroundColor:'#fff', borderTopLeftRadius:20, borderTopRightRadius:20, padding:24}}>
            <Text style={{fontSize:18, fontWeight:'bold', color:'#f44336', marginBottom:8}}>📤 Resign from Job</Text>
            <Text style={{fontSize:14, color:'#444', marginBottom:6}}>
              <Text style={{fontWeight:'700'}}>{showResign?.restaurant_name}</Text>
            </Text>
            <Text style={{fontSize:13, color:'#666', marginBottom:24}}>
              This will end your employment effective today. Future pay cycles will be cancelled. This cannot be undone.
            </Text>
            <TouchableOpacity
              style={[s.btn, {backgroundColor:'#f44336', marginBottom:12}]}
              onPress={resign}
              disabled={resigning}
            >
              {resigning ? <ActivityIndicator color="#fff"/> : <Text style={s.btnText}>Confirm Resignation</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowResign(null)} style={{alignItems:'center', paddingVertical:10}}>
              <Text style={{color:'#666', fontSize:14}}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}



// ─── Worker: Pay & Trust Tab ──────────────────────────────────────────────────
function PayTrustTab({ user }: { user: any }) {
  const [pay, setPay]         = useState<any>(null);
  const [ratings, setRatings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<'pay'|'trust'>('pay');
  const [showRateOwner, setShowRateOwner]   = useState<any>(null);
  const [ownerRatingForm, setOwnerRatingForm] = useState({ dim_overall:0, dim_pay_reliability:0, dim_communication:0 });
  const [submittingOwnerRating, setSubmittingOwnerRating] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get(`/workers/${user.user_id}/pay`),
      api.get(`/workers/${user.user_id}/ratings`),
    ]).then(([p, r]) => {
      setPay(p.data.data);
      setRatings(r.data.data);
    }).finally(() => setLoading(false));
  }, []);

  async function confirmPay(cycle_id: string) {
    await api.patch(`/pay/${cycle_id}/confirm`, {});
    const res = await api.get(`/workers/${user.user_id}/pay`);
    setPay(res.data.data);
  }

  async function submitOwnerRating() {
    if (!showRateOwner) return;
    setSubmittingOwnerRating(true);
    try {
      await api.post('/ratings', {
        agreement_id:     showRateOwner.agreement_id,
        rated_id:         showRateOwner.owner_id,
        period_month:     showRateOwner.period_start.slice(0,7),
        rater_type:       'worker',
        dim_overall:       ownerRatingForm.dim_overall,
        dim_pay_reliability: ownerRatingForm.dim_pay_reliability,
        dim_communication: ownerRatingForm.dim_communication,
      });
      setShowRateOwner(null);
      setOwnerRatingForm({ dim_overall:0, dim_pay_reliability:0, dim_communication:0 });
    } catch(e: any) {
      alert(e.response?.data?.error ?? 'Failed to submit rating');
    } finally { setSubmittingOwnerRating(false); }
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={ORANGE}/></View>;

  const statusColor = (st: string) => ({
    worker_confirmed: GREEN,
    owner_confirmed:  '#1565C0',
    scheduled:        '#888',
    late:             '#f44336',
    disputed:         '#E65100',
    resolved:         GREEN,
  }[st] ?? '#888');

  const statusLabel = (st: string) => ({
    worker_confirmed: '✅ Confirmed',
    owner_confirmed:  '📬 Paid — Confirm?',
    scheduled:        '⏳ Scheduled',
    late:             '⚠️ Late',
    disputed:         '🔴 Disputed',
    resolved:         '✅ Resolved',
  }[st] ?? st);

  return (
    <View style={{flex:1}}>
      {/* Sub-tab toggle */}
      <View style={s.subTabBar}>
        <TouchableOpacity style={[s.subTab, tab==='pay' && s.subTabActive]} onPress={() => setTab('pay')}>
          <Text style={[s.subTabText, tab==='pay' && s.subTabTextActive]}>💰 Pay History</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.subTab, tab==='trust' && s.subTabActive]} onPress={() => setTab('trust')}>
          <Text style={[s.subTabText, tab==='trust' && s.subTabTextActive]}>⭐ Trust Score</Text>
        </TouchableOpacity>
      </View>

      {tab === 'pay' && pay && (
        <ScrollView style={{flex:1}}>
          {/* Summary cards */}
          <View style={{padding:16, gap:8}}>
            <View style={s.statsRow}>
              <View style={[s.statCard, {borderLeftColor:GREEN}]}>
                <Text style={s.statNum}>${Math.round(pay.summary.totalEarned/100)}</Text>
                <Text style={s.statLabel}>Total Earned</Text>
              </View>
              <View style={[s.statCard, {borderLeftColor:ORANGE}]}>
                <Text style={s.statNum}>{pay.summary.totalCycles}</Text>
                <Text style={s.statLabel}>Pay Cycles</Text>
              </View>
            </View>
            <View style={s.statsRow}>
              <View style={[s.statCard, {borderLeftColor:'#1565C0'}]}>
                <Text style={s.statNum}>{pay.summary.onTimeCount}</Text>
                <Text style={s.statLabel}>On Time</Text>
              </View>
              <View style={[s.statCard, {borderLeftColor:'#f44336'}]}>
                <Text style={s.statNum}>{pay.summary.lateCount}</Text>
                <Text style={s.statLabel}>Late/Disputed</Text>
              </View>
            </View>
          </View>

          <Text style={s.sectionTitle}>Pay Cycles</Text>
          {pay.cycles.length === 0 && (
            <View style={s.emptyContainer}>
              <Text style={s.emptyIcon}>💸</Text>
              <Text style={s.emptyText}>No pay history yet.</Text>
              <Text style={s.emptySubtext}>Pay cycles appear once you start working.</Text>
            </View>
          )}
          {pay.cycles.map((cycle: any) => (
            <View key={cycle.cycle_id} style={s.card}>
              <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start'}}>
                <View>
                  <Text style={s.cardTitle}>{cycle.restaurant_name}</Text>
                  <Text style={s.cardSub}>
                    {new Date(cycle.period_start).toLocaleDateString('en-US',{month:'short',day:'numeric'})} –{" "}
                    {new Date(cycle.period_end).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                  </Text>
                </View>
                <View style={[s.statusBadge, {backgroundColor: statusColor(cycle.status)+'22'}]}>
                  <Text style={{fontSize:11, fontWeight:'700', color: statusColor(cycle.status)}}>
                    {statusLabel(cycle.status)}
                  </Text>
                </View>
              </View>

              <View style={s.offerDetails}>
                <View style={s.offerDetail}>
                  <Text style={s.offerDetailLabel}>Expected</Text>
                  <Text style={s.offerDetailValue}>${Math.round(cycle.expected_amount_cents/100)}</Text>
                </View>
                <View style={s.offerDetail}>
                  <Text style={s.offerDetailLabel}>Paid</Text>
                  <Text style={[s.offerDetailValue, {color: cycle.owner_amount_paid_cents ? GREEN : '#999'}]}>
                    {cycle.owner_amount_paid_cents ? `$${Math.round(cycle.owner_amount_paid_cents/100)}` : '—'}
                  </Text>
                </View>
                <View style={s.offerDetail}>
                  <Text style={s.offerDetailLabel}>Due Date</Text>
                  <Text style={s.offerDetailValue}>{new Date(cycle.due_date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</Text>
                </View>
                <View style={s.offerDetail}>
                  <Text style={s.offerDetailLabel}>Method</Text>
                  <Text style={s.offerDetailValue}>{cycle.payment_method ?? '—'}</Text>
                </View>
              </View>

              {cycle.status === 'owner_confirmed' && (
                <TouchableOpacity
                  style={[s.btn, {marginTop:10, paddingVertical:8, backgroundColor:GREEN}]}
                  onPress={() => confirmPay(cycle.cycle_id)}
                >
                  <Text style={s.btnText}>✅ Confirm I received this payment</Text>
                </TouchableOpacity>
              )}
              {cycle.status === 'worker_confirmed' && (
                cycle.has_rated
                  ? <Text style={{marginTop:8,fontSize:12,color:GREEN,fontWeight:'600',textAlign:'center'}}>✅ You rated this restaurant</Text>
                  : <TouchableOpacity
                      style={[s.btn, {marginTop:10, paddingVertical:8, backgroundColor:'#FF6B00'}]}
                      onPress={() => setShowRateOwner(cycle)}
                    >
                      <Text style={s.btnText}>⭐ Rate this Restaurant</Text>
                    </TouchableOpacity>
              )}
              {cycle.status === 'late' && (
                <Text style={{marginTop:8, fontSize:12, color:'#f44336', fontWeight:'600'}}>
                  ⚠️ Payment overdue — contact your employer or raise a dispute
                </Text>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {tab === 'trust' && ratings && (
        <ScrollView style={{flex:1}}>
          {/* Trust score hero */}
          <View style={s.trustHero}>
            <Text style={s.trustScore}>{ratings.trust_score ?? '0.0'}</Text>
            <Text style={s.trustLabel}>Trust Score</Text>
            <View style={{flexDirection:'row', gap:4, marginTop:4}}>
              {[1,2,3,4,5].map(i => (
                <Text key={i} style={{fontSize:20, color: i <= Math.round(ratings.trust_score) ? '#FFD700' : '#ddd'}}> ★</Text>
              ))}
            </View>
            {ratings.is_verified && <Text style={{color:GREEN, marginTop:8, fontWeight:'600'}}>✅ Verified Worker</Text>}
            <Text style={{color:'#888', marginTop:4, fontSize:13}}>{ratings.total_ratings} ratings</Text>
          </View>

          {/* Dimension breakdown */}
          {ratings.total_ratings > 0 && (
            <View style={{padding:16}}>
              <Text style={s.sectionTitle}>Score Breakdown</Text>
              {[
                {key:'overall',         label:'Overall',          icon:'⭐'},
                {key:'pay_reliability', label:'Pay Reliability',  icon:'💰'},
                {key:'communication',   label:'Communication',    icon:'💬'},
                {key:'reliability',     label:'Reliability',      icon:'🎯'},
                {key:'skill_level',     label:'Skill Level',      icon:'👨‍🍳'},
                {key:'punctuality',     label:'Punctuality',      icon:'⏰'},
              ].filter(d => ratings.averages[d.key] != null).map(dim => {
                const score = parseFloat(ratings.averages[dim.key]);
                const pct   = (score / 5) * 100;
                return (
                  <View key={dim.key} style={s.dimRow}>
                    <Text style={s.dimIcon}>{dim.icon}</Text>
                    <View style={{flex:1, marginLeft:10}}>
                      <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:4}}>
                        <Text style={s.dimLabel}>{dim.label}</Text>
                        <Text style={s.dimScore}>{ratings.averages[dim.key]}/5</Text>
                      </View>
                      <View style={s.dimBar}>
                        <View style={[s.dimFill, {width:`${pct}%` as any, backgroundColor: score>=4?GREEN:score>=3?ORANGE:'#f44336'}]}/>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Individual ratings */}
          <Text style={s.sectionTitle}>Reviews</Text>
          {ratings.ratings.length === 0 && (
            <View style={s.emptyContainer}>
              <Text style={s.emptyIcon}>💬</Text>
              <Text style={s.emptyText}>No reviews yet.</Text>
              <Text style={s.emptySubtext}>Reviews appear after completing work.</Text>
            </View>
          )}
          {ratings.ratings.map((r: any) => (
            <View key={r.rating_id} style={s.card}>
              <View style={{flexDirection:'row', justifyContent:'space-between'}}>
                <Text style={s.cardTitle}>{r.restaurant_name ?? r.rater_name}</Text>
                <Text style={{fontSize:20, color:'#FFD700'}}>{'★'.repeat(r.dim_overall)}{'☆'.repeat(5-r.dim_overall)}</Text>
              </View>
              <Text style={s.cardSub}>{r.period_month}</Text>
              {r.private_note && <Text style={{marginTop:6, fontSize:13, color:'#555', fontStyle:'italic'}}>" {r.private_note}"</Text>}
            </View>
          ))}
        </ScrollView>
      )}

      {/* Rate Restaurant modal */}
      <Modal visible={!!showRateOwner} transparent animationType="slide">
        <View style={{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(0,0,0,0.5)'}}>
          <View style={{backgroundColor:'#fff',borderRadius:16,padding:24,margin:16}}>
            <Text style={{fontSize:18,fontWeight:'700',marginBottom:4}}>⭐ Rate Restaurant</Text>
            <Text style={{fontSize:13,color:'#666',marginBottom:16}}>{showRateOwner?.restaurant_name}</Text>
            {[
              {key:'dim_overall',          label:'Overall Experience'},
              {key:'dim_pay_reliability',  label:'Pay on Time'},
              {key:'dim_communication',    label:'Communication'},
            ].map(dim => (
              <View key={dim.key} style={{marginBottom:12}}>
                <Text style={{fontSize:13,fontWeight:'600',marginBottom:6}}>{dim.label}</Text>
                <View style={{flexDirection:'row',gap:8}}>
                  {[1,2,3,4,5].map(n => (
                    <TouchableOpacity key={n} onPress={() => setOwnerRatingForm(f => ({...f,[dim.key]:n}))}>
                      <Text style={{fontSize:28,color:(ownerRatingForm as any)[dim.key]>=n?'#FFD700':'#ddd'}}>★</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
            <TouchableOpacity
              style={[s.btn,{marginTop:8,backgroundColor:ORANGE}]}
              onPress={submitOwnerRating}
              disabled={submittingOwnerRating || ownerRatingForm.dim_overall === 0 || ownerRatingForm.dim_communication === 0 || ownerRatingForm.dim_pay_reliability === 0}
            >
              {submittingOwnerRating
                ? <ActivityIndicator color="#fff"/>
                : <Text style={s.btnText}>Submit Rating</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowRateOwner(null)} style={{marginTop:12,alignItems:'center'}}>
              <Text style={{color:'#999'}}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Owner: Browse Workers Tab ────────────────────────────────────────────────
function BrowseWorkersTab({ user }: { user: any }) {
  const [workers, setWorkers]       = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [sending, setSending]       = useState<string|null>(null);
  const [sent, setSent]             = useState<Set<string>>(new Set());
  const [listings, setListings]     = useState<any[]>([]);
  const [selectedListing, setSelectedListing] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState('');
  const [planMeta, setPlanMeta] = useState<any>(null);
  const [showHireFee, setShowHireFee] = useState(false);
  const [hireFeeListingId, setHireFeeListingId] = useState('');
  const [hireFeeListingTitle, setHireFeeListingTitle] = useState('');
  const [hireFeeLoading, setHireFeeLoading] = useState(false);

  // Filters & sort
  const [filters, setFilters] = useState({
    state: '', role_code: '', cuisine: '',
    min_exp: '', max_exp: '',
    min_salary: '', max_salary: '',
    needs_accommodation: 'any',   // 'any' | 'true' | 'false'
    willing_to_relocate: 'any',   // 'any' | 'true'
    work_auth: '',
    sort_by: 'trust_score',
    sort_dir: 'desc',
  });

  function buildQuery(f = filters) {
    const p: Record<string,string> = {};
    if (f.state)               p.state = f.state;
    if (f.role_code)           p.role_code = f.role_code;
    if (f.cuisine)             p.cuisine = f.cuisine;
    if (f.min_exp)             p.min_exp = f.min_exp;
    if (f.max_exp)             p.max_exp = f.max_exp;
    if (f.min_salary)          p.min_salary = f.min_salary;
    if (f.max_salary)          p.max_salary = f.max_salary;
    if (f.needs_accommodation !== 'any') p.needs_accommodation = f.needs_accommodation;
    if (f.willing_to_relocate !== 'any') p.willing_to_relocate = f.willing_to_relocate;
    if (f.work_auth)           p.work_auth = f.work_auth;
    p.sort_by  = f.sort_by;
    p.sort_dir = f.sort_dir;
    const qs = Object.entries(p).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
    return qs ? `?${qs}` : '';
  }

  function load(f = filters, listingId = selectedListing, listingList = listings) {
    setLoading(true);
    Promise.all([
      api.get(`/workers/search${buildQuery(f)}`),
      api.get(`/owners/${user.user_id}/listings`),
    ]).then(([w, l]) => {
      setWorkers(w.data.data ?? []);
      setPlanMeta(w.data.meta ?? null);
      const active = (l.data.data ?? []).filter((x:any) => x.status === 'active');
      setListings(active);
      // On first load, auto-select first listing and apply its role_code filter
      if (active.length > 0 && !listingId) {
        const first = active[0];
        setSelectedListing(first.listing_id);
        if (first.role_code) {
          const updated = { ...f, role_code: first.role_code };
          setFilters(updated);
          api.get(`/workers/search${buildQuery(updated)}`).then(r => setWorkers(r.data.data ?? []));
        }
      }
    }).finally(() => setLoading(false));
  }

  function selectListing(listing: any) {
    setSelectedListing(listing.listing_id);
    // Auto-filter workers by this listing's role_code
    const updated = { ...filters, role_code: listing.role_code ?? '' };
    setFilters(updated);
    setLoading(true);
    api.get(`/workers/search${buildQuery(updated)}`)
      .then(r => { setWorkers(r.data.data ?? []); setPlanMeta(r.data.meta ?? null); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function sendOffer(worker_id: string) {
    if (!selectedListing) { alert('Please select a listing first'); return; }
    setSending(worker_id);
    try {
      await api.post(`/listings/${selectedListing}/offer`, { worker_id });
      setSent(s => new Set([...s, worker_id]));
    } catch(e: any) {
      if (e?.response?.status === 402 && e?.response?.data?.upgrade_required) {
        const lid = e?.response?.data?.listing_id ?? selectedListing;
        setHireFeeListingId(lid);
        setHireFeeListingTitle(listings.find((l:any) => l.listing_id === lid)?.title ?? 'your listing');
        setShowHireFee(true);
      } else {
        alert(e.response?.data?.error ?? 'Failed to send offer');
      }
    } finally { setSending(null); }
  }

  async function payHireFee() {
    setHireFeeLoading(true);
    try {
      const pricesRes = await api.get('/billing/prices');
      const hireFeePrice = pricesRes.data?.data?.hire_fee;
      if (!hireFeePrice) { alert('Could not load pricing. Please try again.'); return; }
      const res = await billing.checkout(
        hireFeePrice,
        'hire_fee',
        'https://rasoilink-production.up.railway.app/health',
        'https://rasoilink-production.up.railway.app/health',
        { listing_id: hireFeeListingId },
      );
      const url = res.data?.data?.url;
      if (url) {
        await Linking.openURL(url);
        setShowHireFee(false);
      }
    } catch(e: any) {
      alert('Could not start checkout: ' + (e?.response?.data?.error ?? e?.message ?? 'Please try again.'));
    } finally { setHireFeeLoading(false); }
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={DARK}/></View>;

  return (
    <View style={{flex:1}}>
      {/* Listing selector */}
      <View style={s.browseHeader}>
        <Text style={s.browseHeaderLabel}>Sending offers for:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginTop:6}}>
          {listings.map((l:any) => (
            <TouchableOpacity
              key={l.listing_id}
              style={[s.listingChip, selectedListing===l.listing_id && s.listingChipActive]}
              onPress={() => selectListing(l)}
            >
              <Text style={[s.listingChipText, selectedListing===l.listing_id && s.listingChipTextActive]}>
                {l.title}
              </Text>
            </TouchableOpacity>
          ))}
          {listings.length === 0 && <Text style={{color:'#f44336', fontSize:13}}>No active listings — post a job first!</Text>}
        </ScrollView>
        {filters.role_code ? (
          <View style={{flexDirection:'row', alignItems:'center', marginTop:6}}>
            <Text style={{fontSize:12, color:'#888'}}>Showing workers matching: </Text>
            <Text style={{fontSize:12, color:ORANGE, fontWeight:'700'}}>{filters.role_code.replace(/_/g,' ')}</Text>
            <TouchableOpacity onPress={() => { const u={...filters,role_code:''}; setFilters(u); load(u,selectedListing); }} style={{marginLeft:8}}>
              <Text style={{fontSize:12, color:'#aaa'}}>✕ clear</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {/* Plan gate banner */}
      {planMeta && !planMeta.contacts_visible && (
        <View style={{backgroundColor:'#FFF3E0',padding:14,flexDirection:'row',justifyContent:'space-between',alignItems:'center',borderBottomWidth:1,borderColor:'#FFE0B2'}}>
          <Text style={{color:'#E65100',fontSize:13,flex:1}}>🔒 Upgrade to contact workers directly</Text>
          <TouchableOpacity
            style={{backgroundColor:'#FF6B00',paddingHorizontal:12,paddingVertical:6,borderRadius:8}}
            onPress={() => { setUpgradeMessage(planMeta.upgrade_message ?? ''); setShowUpgrade(true); }}
          >
            <Text style={{color:'#fff',fontWeight:'bold',fontSize:13}}>Upgrade →</Text>
          </TouchableOpacity>
        </View>
      )}
      {/* Filter bar */}
      <View style={{backgroundColor:'#fff',borderBottomWidth:1,borderColor:'#eee'}}>
        {/* Top row: quick state + toggle */}
        <View style={{flexDirection:'row',alignItems:'center',padding:10,gap:8}}>
          <TextInput
            style={[s.filterInput,{flex:1}]}
            placeholder="State (e.g. NJ)"
            value={filters.state}
            onChangeText={v=>setFilters(p=>({...p,state:v}))}
            onSubmitEditing={()=>load()}
            returnKeyType="search"
            autoCapitalize="characters"
            maxLength={2}
          />
          <TouchableOpacity
            style={{paddingHorizontal:12,paddingVertical:8,borderRadius:8,borderWidth:1,
              borderColor: showFilters ? DARK : '#ccc',
              backgroundColor: showFilters ? DARK : '#fff'}}
            onPress={()=>setShowFilters(p=>!p)}>
            <Text style={{color: showFilters?'#fff':'#555',fontSize:13,fontWeight:'600'}}>
              {showFilters ? 'Hide Filters' : 'Filters ▾'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.btn,{paddingVertical:8,paddingHorizontal:14,backgroundColor:DARK}]} onPress={()=>load()}>
            <Text style={s.btnText}>Search</Text>
          </TouchableOpacity>
        </View>

        {showFilters && (
          <ScrollView style={{maxHeight:420}} contentContainerStyle={{padding:12,paddingTop:4,gap:10}}>
            {/* Role chips */}
            <Text style={[s.formLabel,{marginBottom:4}]}>Role</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{flexDirection:'row',gap:6,paddingBottom:4}}>
                {[
                  {v:'',label:'Any'},
                  {v:'head_chef',label:'Head Chef'},{v:'sous_chef',label:'Sous Chef'},
                  {v:'tandoor_chef',label:'Tandoor Chef'},{v:'biryani_chef',label:'Biryani Chef'},
                  {v:'line_cook',label:'Line Cook'},{v:'pastry_mithai',label:'Pastry/Mithai'},
                  {v:'kitchen_helper',label:'Kitchen Helper'},{v:'dishwasher',label:'Dishwasher'},
                  {v:'manager',label:'Manager'},{v:'cashier',label:'Cashier'},
                  {v:'server',label:'Server'},{v:'host',label:'Host'},
                  {v:'delivery_driver',label:'Delivery Driver'},
                ].map(({v,label})=>(
                  <TouchableOpacity key={v}
                    style={{paddingVertical:6,paddingHorizontal:12,borderRadius:20,borderWidth:1.5,
                      borderColor: filters.role_code===v ? ORANGE : '#ddd',
                      backgroundColor: filters.role_code===v ? '#FFF3E0' : '#fafafa'}}
                    onPress={()=>setFilters(p=>({...p,role_code:v}))}>
                    <Text style={{fontSize:12,color: filters.role_code===v ? ORANGE : '#555', fontWeight: filters.role_code===v?'700':'400'}}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Cuisine chips */}
            <Text style={[s.formLabel,{marginBottom:4}]}>Cuisine Specialization</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{flexDirection:'row',gap:6,paddingBottom:4}}>
                {[
                  {v:'',label:'Any'},
                  {v:'north_indian',label:'North Indian'},{v:'south_indian',label:'South Indian'},
                  {v:'punjabi',label:'Punjabi'},{v:'gujarati',label:'Gujarati'},
                  {v:'maharashtrian',label:'Maharashtrian'},{v:'bengali',label:'Bengali'},
                  {v:'kerala',label:'Kerala'},{v:'hyderabadi',label:'Hyderabadi'},
                  {v:'biryani',label:'Biryani'},{v:'tandoor',label:'Tandoor'},
                  {v:'mughlai',label:'Mughlai'},{v:'street_food',label:'Street Food'},
                  {v:'mithai',label:'Mithai'},{v:'indo_chinese',label:'Indo-Chinese'},
                ].map(({v,label})=>(
                  <TouchableOpacity key={v}
                    style={{paddingVertical:6,paddingHorizontal:12,borderRadius:20,borderWidth:1.5,
                      borderColor: filters.cuisine===v ? ORANGE : '#ddd',
                      backgroundColor: filters.cuisine===v ? '#FFF3E0' : '#fafafa'}}
                    onPress={()=>setFilters(p=>({...p,cuisine:v}))}>
                    <Text style={{fontSize:12,color: filters.cuisine===v ? ORANGE : '#555', fontWeight: filters.cuisine===v?'700':'400'}}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Experience range */}
            <Text style={[s.formLabel,{marginBottom:4}]}>Experience (years)</Text>
            <View style={{flexDirection:'row',gap:8,alignItems:'center'}}>
              <TextInput style={[s.filterInput,{flex:1}]} placeholder="Min" keyboardType="numeric"
                value={filters.min_exp} onChangeText={v=>setFilters(p=>({...p,min_exp:v}))}/>
              <Text style={{color:'#999'}}>–</Text>
              <TextInput style={[s.filterInput,{flex:1}]} placeholder="Max" keyboardType="numeric"
                value={filters.max_exp} onChangeText={v=>setFilters(p=>({...p,max_exp:v}))}/>
            </View>

            {/* Salary range */}
            <Text style={[s.formLabel,{marginBottom:4}]}>Expected Pay ($/week)</Text>
            <View style={{flexDirection:'row',gap:8,alignItems:'center'}}>
              <TextInput style={[s.filterInput,{flex:1}]} placeholder="Min" keyboardType="numeric"
                value={filters.min_salary} onChangeText={v=>setFilters(p=>({...p,min_salary:v}))}/>
              <Text style={{color:'#999'}}>–</Text>
              <TextInput style={[s.filterInput,{flex:1}]} placeholder="Max" keyboardType="numeric"
                value={filters.max_salary} onChangeText={v=>setFilters(p=>({...p,max_salary:v}))}/>
            </View>

            {/* Accommodation */}
            <Text style={[s.formLabel,{marginBottom:4}]}>Needs Accommodation</Text>
            <View style={{flexDirection:'row',gap:8}}>
              {(['any','true','false'] as const).map(v=>(
                <TouchableOpacity key={v}
                  style={{flex:1,paddingVertical:7,borderRadius:8,borderWidth:1,alignItems:'center',
                    borderColor: filters.needs_accommodation===v ? DARK : '#ddd',
                    backgroundColor: filters.needs_accommodation===v ? DARK : '#fafafa'}}
                  onPress={()=>setFilters(p=>({...p,needs_accommodation:v}))}>
                  <Text style={{color: filters.needs_accommodation===v?'#fff':'#555',fontSize:12}}>
                    {v==='any'?'Any':v==='true'?'Yes':'No'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Willing to Relocate */}
            <Text style={[s.formLabel,{marginBottom:4}]}>Willing to Relocate</Text>
            <View style={{flexDirection:'row',gap:8}}>
              {(['any','true'] as const).map(v=>(
                <TouchableOpacity key={v}
                  style={{flex:1,paddingVertical:7,borderRadius:8,borderWidth:1,alignItems:'center',
                    borderColor: filters.willing_to_relocate===v ? DARK : '#ddd',
                    backgroundColor: filters.willing_to_relocate===v ? DARK : '#fafafa'}}
                  onPress={()=>setFilters(p=>({...p,willing_to_relocate:v}))}>
                  <Text style={{color: filters.willing_to_relocate===v?'#fff':'#555',fontSize:12}}>
                    {v==='any'?'Any':'Yes only'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Apply + Reset buttons */}
            <View style={{flexDirection:'row',gap:8,marginTop:4}}>
              <TouchableOpacity
                style={{flex:1,backgroundColor:'#f5f5f5',paddingVertical:10,borderRadius:10,alignItems:'center',borderWidth:1,borderColor:'#ddd'}}
                onPress={()=>{
                  const reset={state:'',role_code:'',cuisine:'',min_exp:'',max_exp:'',
                    min_salary:'',max_salary:'',needs_accommodation:'any',
                    willing_to_relocate:'any',work_auth:'',sort_by:'trust_score',sort_dir:'desc'};
                  setFilters(reset); load(reset);
                }}>
                <Text style={{color:'#f44336',fontWeight:'700',fontSize:13}}>✕ Reset All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{flex:2,backgroundColor:ORANGE,paddingVertical:10,borderRadius:10,alignItems:'center'}}
                onPress={()=>{ load(filters); setShowFilters(false); }}>
                <Text style={{color:'#fff',fontWeight:'700',fontSize:13}}>Apply Filters</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}

        {/* ── Sort bar — always visible ── */}
        <View style={{borderTopWidth:1,borderColor:'#eee',paddingHorizontal:10,paddingVertical:8}}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:6}}>
            <View style={{flexDirection:'row',gap:6,alignItems:'center'}}>
              <Text style={{fontSize:11,color:'#999',marginRight:2}}>Sort:</Text>
              {([
                {v:'trust_score',     label:'⭐ Trust'},
                {v:'years_experience',label:'⏱ Experience'},
                {v:'salary_min_cents',label:'💰 Salary'},
                {v:'profile_completeness', label:'✅ Profile'},
                {v:'updated_at',      label:'🕒 Newest'},
              ] as const).map(({v,label})=>{
                const active = filters.sort_by === v;
                return (
                  <TouchableOpacity key={v}
                    style={{paddingVertical:5,paddingHorizontal:12,borderRadius:20,borderWidth:1,
                      borderColor: active ? DARK : '#ccc',
                      backgroundColor: active ? DARK : '#fff'}}
                    onPress={()=>{ const f={...filters,sort_by:v}; setFilters(f); load(f); }}>
                    <Text style={{color: active?'#fff':'#555',fontSize:12,fontWeight: active?'700':'400'}}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          {/* Direction toggle */}
          <View style={{flexDirection:'row',gap:6}}>
            {([{v:'desc',label:'▼ High → Low'},{v:'asc',label:'▲ Low → High'}] as const).map(({v,label})=>(
              <TouchableOpacity key={v}
                style={{flex:1,paddingVertical:5,borderRadius:8,borderWidth:1,alignItems:'center',
                  borderColor: filters.sort_dir===v ? ORANGE : '#eee',
                  backgroundColor: filters.sort_dir===v ? '#FFF3E0' : '#fafafa'}}
                onPress={()=>{ const f={...filters,sort_dir:v}; setFilters(f); load(f); }}>
                <Text style={{color: filters.sort_dir===v?ORANGE:'#999',fontSize:11,fontWeight:'600'}}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <ScrollView style={{flex:1}}>
        <Text style={s.sectionTitle}>Available Workers ({workers.length})</Text>
        {workers.map((worker:any) => {
          const alreadySent = sent.has(worker.user_id);
          const payMin = Math.round(worker.salary_min_cents/100);
          const payMax = Math.round(worker.salary_max_cents/100);
          return (
            <View key={worker.user_id} style={s.card}>
              {/* Worker header */}
              <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start'}}>
                <View style={{flex:1}}>
                  <View style={{flexDirection:'row', alignItems:'center', gap:8}}>
                    <Text style={s.cardTitle}>{worker.name}</Text>
                    {worker.is_verified && <Text style={{fontSize:12, color:GREEN}}>✅</Text>}
                  </View>
                  <Text style={[s.cardSub, {color:ORANGE, fontWeight:'600'}]}>
                    {worker.role_code?.replace(/_/g,' ').replace(/\b\w/g,(c:string)=>c.toUpperCase())}
                  </Text>
                </View>
                <View style={{alignItems:'flex-end'}}>
                  <Text style={{fontSize:18, fontWeight:'bold', color:DARK}}>⭐ {worker.trust_score}</Text>
                  <Text style={{fontSize:11, color:'#999'}}>{worker.profile_completeness}% complete</Text>
                </View>
              </View>

              {/* Worker details grid */}
              <View style={s.offerDetails}>
                <View style={s.offerDetail}>
                  <Text style={s.offerDetailLabel}>📍 Location</Text>
                  <Text style={s.offerDetailValue}>{worker.current_state}</Text>
                </View>
                <View style={s.offerDetail}>
                  <Text style={s.offerDetailLabel}>⏱ Experience</Text>
                  <Text style={s.offerDetailValue}>{worker.years_experience} years</Text>
                </View>
                <View style={s.offerDetail}>
                  <Text style={s.offerDetailLabel}>💰 Expected</Text>
                  <Text style={s.offerDetailValue}>${payMin}–${payMax}/wk</Text>
                </View>
                <View style={s.offerDetail}>
                  <Text style={s.offerDetailLabel}>🏠 Needs Housing</Text>
                  <Text style={s.offerDetailValue}>{worker.needs_accommodation?'Yes':'No'}</Text>
                </View>
              </View>

              {/* Cuisines */}
              {worker.cuisine_specializations?.length > 0 && (
                <View style={{flexDirection:'row', flexWrap:'wrap', gap:4, marginTop:8}}>
                  {worker.cuisine_specializations.map((c:string) => (
                    <View key={c} style={s.cuisineTag}>
                      <Text style={s.cuisineTagText}>{c.replace(/_/g,' ')}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Willing to relocate */}
              {worker.willing_to_relocate && (
                <Text style={{marginTop:6, fontSize:12, color:GREEN}}>✈️ Willing to relocate</Text>
              )}

              {/* Send offer button */}
              <TouchableOpacity
                style={[s.btn, {marginTop:12, paddingVertical:10,
                  backgroundColor: alreadySent ? GREEN : listings.length===0 ? '#ccc' : DARK}]}
                onPress={() => sendOffer(worker.user_id)}
                disabled={!!sending || alreadySent || listings.length===0}
              >
                {sending === worker.user_id
                  ? <ActivityIndicator color="#fff"/>
                  : <Text style={s.btnText}>{alreadySent ? '✓ Offer Sent' : '📩 Send Offer'}</Text>
                }
              </TouchableOpacity>
            </View>
          );
        })}
        {workers.length === 0 && (
          <View style={s.emptyContainer}>
            <Text style={s.emptyIcon}>🔍</Text>
            <Text style={s.emptyText}>No workers found.</Text>
            <Text style={s.emptySubtext}>Try a different state filter.</Text>
          </View>
        )}
      </ScrollView>
    <Modal visible={showHireFee} animationType="slide" transparent onRequestClose={() => setShowHireFee(false)}>
      <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.55)',justifyContent:'flex-end'}}>
        <View style={{backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,padding:28}}>
          <TouchableOpacity style={{position:'absolute',top:20,right:20,padding:8}} onPress={() => setShowHireFee(false)}>
            <Text style={{fontSize:18,color:'#999'}}>✕</Text>
          </TouchableOpacity>
          <Text style={{fontSize:32,textAlign:'center',marginBottom:12}}>🤝</Text>
          <Text style={{fontSize:22,fontWeight:'bold',color:DARK,textAlign:'center',marginBottom:6}}>One-time Hire Fee</Text>
          <View style={{backgroundColor:'#FFF3E0',borderRadius:10,paddingVertical:8,paddingHorizontal:14,marginBottom:12,alignSelf:'center'}}>
            <Text style={{fontSize:13,color:ORANGE,fontWeight:'700',textAlign:'center'}}>📋 {hireFeeListingTitle}</Text>
          </View>
          <Text style={{fontSize:14,color:'#666',textAlign:'center',lineHeight:20,marginBottom:24}}>
            Pay a one-time $149 fee to unlock sending offers for this listing. Send to any worker — no extra charge.
          </Text>
          <View style={{backgroundColor:'#F8F9FA',borderRadius:12,padding:16,marginBottom:20}}>
            {['Unlimited offers for this listing','Direct contact with matched workers','Only pay when ready to hire'].map(f => (
              <View key={f} style={{flexDirection:'row',alignItems:'center',marginBottom:8}}>
                <Text style={{color:'#27AE60',fontSize:16,fontWeight:'bold',marginRight:10}}>✓</Text>
                <Text style={{fontSize:14,color:'#444'}}>{f}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={{backgroundColor:'#FF6B00',padding:16,borderRadius:12,alignItems:'center',opacity:hireFeeLoading?0.6:1}}
            onPress={payHireFee}
            disabled={hireFeeLoading}
          >
            {hireFeeLoading
              ? <ActivityIndicator color="#fff"/>
              : <Text style={{color:'#fff',fontSize:16,fontWeight:'bold'}}>Pay $149 — Unlock Hiring</Text>
            }
          </TouchableOpacity>
          <Text style={{textAlign:'center',color:'#999',fontSize:12,marginTop:12}}>One-time per listing. No recurring charges.</Text>
        </View>
      </View>
    </Modal>
    <UpgradeModal
      visible={showUpgrade}
      onClose={() => setShowUpgrade(false)}
      userType="owner"
      message={upgradeMessage}
    />
    </View>
  );
}


// ─── Agreement Modal ──────────────────────────────────────────────────────────
function AgreementScreen({ agreement, userType, onSign, onClose }: {
  agreement: any;
  userType: 'worker' | 'owner';
  onSign: () => void;
  onClose: () => void;
}) {
  const [signed, setSigned]   = useState(false);
  const [signing, setSigning] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const isSigned = userType === 'worker'
    ? !!agreement.worker_signed_at
    : !!agreement.owner_signed_at;
  const bothSigned = !!agreement.worker_signed_at && !!agreement.owner_signed_at;
  const pay = Math.round(agreement.agreed_pay_cents / 100);
  const startDate = new Date(agreement.start_date).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

  async function handleSign() {
    setSigning(true);
    try {
      await api.patch(`/agreements/${agreement.agreement_id}/sign`, {});
      setSigned(true);
      onSign();
    } catch(e: any) {
      alert(e.response?.data?.error ?? 'Failed to sign');
    } finally { setSigning(false); }
  }

  return (
    <View style={ag.container}>
      {/* Header */}
      <View style={ag.header}>
        <TouchableOpacity onPress={onClose} style={ag.closeBtn}>
          <Text style={ag.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <Text style={ag.headerTitle}>Employment Agreement</Text>
        <View style={[ag.statusPill, {backgroundColor: bothSigned?'#E8F5E9':'#FFF3E0'}]}>
          <Text style={{fontSize:11,fontWeight:'700',color:bothSigned?GREEN:ORANGE}}>
            {bothSigned ? 'FULLY EXECUTED' : 'PENDING SIGNATURES'}
          </Text>
        </View>
      </View>

      <ScrollView
        style={ag.scroll}
        onScroll={({nativeEvent}) => {
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 40) {
            setScrolled(true);
          }
        }}
        scrollEventThrottle={16}
      >
        {/* Agreement body */}
        <View style={ag.body}>
          <Text style={ag.docTitle}>RASOILINK EMPLOYMENT AGREEMENT</Text>
          <Text style={ag.docSubtitle}>This agreement is entered into between the following parties:</Text>

          <View style={ag.section}>
            <Text style={ag.sectionTitle}>🏪 EMPLOYER</Text>
            <Text style={ag.sectionText}>{agreement.restaurant_name}</Text>
            <Text style={ag.sectionText}>{agreement.restaurant_address}</Text>
            <Text style={ag.sectionText}>{agreement.city}, {agreement.state}</Text>
            <Text style={ag.sectionText}>Represented by: {agreement.owner_name}</Text>
          </View>

          <View style={ag.section}>
            <Text style={ag.sectionTitle}>👨‍🍳 EMPLOYEE</Text>
            <Text style={ag.sectionText}>{agreement.worker_name}</Text>
            <Text style={ag.sectionText}>📞 {agreement.worker_phone}</Text>
          </View>

          <View style={ag.section}>
            <Text style={ag.sectionTitle}>📋 TERMS OF EMPLOYMENT</Text>
            <View style={ag.termRow}>
              <Text style={ag.termLabel}>Position</Text>
              <Text style={ag.termValue}>{agreement.role_code_snapshot?.replace(/_/g,' ').replace(/\b\w/g,(c:string)=>c.toUpperCase())}</Text>
            </View>
            <View style={ag.termRow}>
              <Text style={ag.termLabel}>Start Date</Text>
              <Text style={ag.termValue}>{startDate}</Text>
            </View>
            <View style={ag.termRow}>
              <Text style={ag.termLabel}>Weekly Pay</Text>
              <Text style={[ag.termValue,{color:ORANGE,fontWeight:'700'}]}>${pay} per week</Text>
            </View>
            <View style={ag.termRow}>
              <Text style={ag.termLabel}>Pay Day</Text>
              <Text style={ag.termValue}>{agreement.pay_day?.replace(/\b\w/g,(c:string)=>c.toUpperCase()) ?? 'Friday'}</Text>
            </View>
            <View style={ag.termRow}>
              <Text style={ag.termLabel}>Hours per Week</Text>
              <Text style={ag.termValue}>{agreement.agreed_hours_pw} hours</Text>
            </View>
            <View style={ag.termRow}>
              <Text style={ag.termLabel}>Notice Period</Text>
              <Text style={ag.termValue}>{agreement.notice_period_weeks} weeks</Text>
            </View>
            <View style={ag.termRow}>
              <Text style={ag.termLabel}>Accommodation</Text>
              <Text style={ag.termValue}>{agreement.accommodation_provided ? '✅ Provided' : '❌ Not provided'}</Text>
            </View>
            {agreement.accommodation_provided && agreement.accommodation_address && (
              <View style={ag.termRow}>
                <Text style={ag.termLabel}>Address</Text>
                <Text style={ag.termValue}>{agreement.accommodation_address}</Text>
              </View>
            )}
          </View>

          <View style={ag.section}>
            <Text style={ag.sectionTitle}>⚖️ OBLIGATIONS</Text>
            <Text style={ag.clauseText}>1. The Employer agrees to pay the agreed weekly wage on the specified pay day without delay or deduction without cause.</Text>
            <Text style={ag.clauseText}>2. The Employee agrees to perform their duties professionally and give the agreed notice period before leaving.</Text>
            <Text style={ag.clauseText}>3. Both parties agree to treat each other with respect and dignity at all times.</Text>
            <Text style={ag.clauseText}>4. Any disputes will be mediated through the RasoiLink platform before escalation.</Text>
            <Text style={ag.clauseText}>5. This agreement is governed by the labor laws of the state of {agreement.state}, USA.</Text>
          </View>

          {/* Signature status */}
          <View style={ag.section}>
            <Text style={ag.sectionTitle}>✍️ SIGNATURES</Text>
            <View style={ag.sigRow}>
              <View style={ag.sigBlock}>
                <Text style={ag.sigLabel}>Owner</Text>
                <Text style={ag.sigName}>{agreement.owner_name}</Text>
                {agreement.owner_signed_at
                  ? <Text style={ag.sigDate}>✅ Signed {new Date(agreement.owner_signed_at).toLocaleDateString()}</Text>
                  : <Text style={ag.sigPending}>⏳ Pending</Text>
                }
              </View>
              <View style={ag.sigBlock}>
                <Text style={ag.sigLabel}>Worker</Text>
                <Text style={ag.sigName}>{agreement.worker_name}</Text>
                {agreement.worker_signed_at
                  ? <Text style={ag.sigDate}>✅ Signed {new Date(agreement.worker_signed_at).toLocaleDateString()}</Text>
                  : <Text style={ag.sigPending}>⏳ Pending</Text>
                }
              </View>
            </View>
          </View>

          <Text style={ag.legalNote}>
            By signing this agreement digitally on the RasoiLink platform, both parties acknowledge they have read, understood, and agree to all terms above. This digital signature is legally binding.
          </Text>
        </View>
      </ScrollView>

      {/* Sign button */}
      <View style={ag.footer}>
        {!isSigned && !signed ? (
          <>
            {!scrolled && <Text style={ag.scrollHint}>↓ Scroll to read the full agreement before signing</Text>}
            <TouchableOpacity
              style={[ag.signBtn, !scrolled && ag.signBtnDisabled]}
              onPress={handleSign}
              disabled={signing || !scrolled}
            >
              {signing
                ? <ActivityIndicator color="#fff"/>
                : <Text style={ag.signBtnText}>✍️ Sign Agreement</Text>
              }
            </TouchableOpacity>
          </>
        ) : (
          <View style={ag.signedBanner}>
            <Text style={ag.signedBannerText}>
              {bothSigned || signed
                ? (agreement.worker_signed_at && agreement.owner_signed_at ? '🎉 Agreement fully executed! Both parties have signed.' : '✅ You have signed. Waiting for the other party.')
                : ''}
            </Text>
          </View>
        )}
        <TouchableOpacity style={ag.closeFooterBtn} onPress={onClose}>
          <Text style={ag.closeFooterText}>Close</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}





// ─── Worker: Profile Editor ───────────────────────────────────────────────────
function WorkerProfileEditor({ user, onClose }: { user: any; onClose: () => void }) {
  const ROLES = [
    'assistant_manager','biryani_chef','cashier','curry_chef','delivery_driver',
    'dishwasher','head_chef','host','kitchen_helper','line_cook','manager',
    'owner_operator','pastry_mithai','prep_cook','server','sous_chef','tandoor_chef'
  ];
  const ROLE_LABELS: any = {
    assistant_manager:'Assistant Manager', biryani_chef:'Biryani Chef', cashier:'Cashier',
    curry_chef:'Curry Chef', delivery_driver:'Delivery Driver', dishwasher:'Dishwasher',
    head_chef:'Head Chef', host:'Host/Hostess', kitchen_helper:'Kitchen Helper',
    line_cook:'Line Cook', manager:'Manager', owner_operator:'Owner/Operator',
    pastry_mithai:'Pastry/Mithai', prep_cook:'Prep Cook', server:'Server',
    sous_chef:'Sous Chef', tandoor_chef:'Tandoor Chef',
  };
  const CUISINES = [
    'tandoor','north_indian','south_indian','biryani','punjabi','gujarati',
    'hyderabadi','kerala','chettinad','mughlai','mithai',
  ];
  const CUISINE_LABELS: any = {
    tandoor:'Tandoor', north_indian:'North Indian', south_indian:'South Indian',
    biryani:'Biryani', punjabi:'Punjabi', gujarati:'Gujarati',
    hyderabadi:'Hyderabadi', kerala:'Kerala', chettinad:'Chettinad',
    mughlai:'Mughlai', mithai:'Mithai/Sweets',
  };
  const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
    'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
  const PAY_FREQ = [{value:'weekly',label:'Weekly'},{value:'biweekly',label:'Bi-weekly'},{value:'semimonthly',label:'Semi-monthly'}];
  const WORK_AUTH = [
    {value:'authorized',label:'US Authorized'},{value:'h2b',label:'H2B Visa'},
    {value:'ead',label:'EAD'},{value:'opt',label:'OPT'},{value:'other',label:'Other'},
  ];

  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [form, setForm]         = useState<any>(null);

  useEffect(() => {
    api.get(`/workers/${user.user_id}`)
      .then(r => {
        const p = r.data.data;
        setForm({
          role_code:               p.role_code ?? 'kitchen_helper',
          years_experience:        String(p.years_experience ?? 0),
          cuisine_specializations: p.cuisine_specializations ?? [],
          current_city:            p.current_city ?? '',
          current_state:           p.current_state ?? 'NJ',
          preferred_states:        p.preferred_states ?? [],
          willing_to_relocate:     p.willing_to_relocate ?? true,
          salary_min:              String(Math.round((p.salary_min_cents ?? 60000) / 100)),
          salary_max:              String(Math.round((p.salary_max_cents ?? 80000) / 100)),
          pay_freq_pref:           p.pay_freq_pref ?? 'weekly',
          needs_accommodation:     p.needs_accommodation ?? false,
          work_authorization:      p.work_authorization ?? 'authorized',
          bio_text:                p.bio_text ?? '',
        });
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/workers/${user.user_id}`, {
        role_code:               form.role_code,
        years_experience:        parseInt(form.years_experience) || 0,
        cuisine_specializations: form.cuisine_specializations,
        current_city:            form.current_city,
        current_state:           form.current_state,
        preferred_states:        form.preferred_states,
        willing_to_relocate:     form.willing_to_relocate,
        salary_min_cents:        Math.round(parseFloat(form.salary_min) * 100),
        salary_max_cents:        Math.round(parseFloat(form.salary_max) * 100),
        pay_freq_pref:           form.pay_freq_pref,
        needs_accommodation:     form.needs_accommodation,
        work_authorization:      form.work_authorization,
        bio_text:                form.bio_text,
      });
      alert('Profile updated!');
      onClose();
    } catch(e: any) {
      alert(e.response?.data?.error ?? 'Failed to save');
    } finally { setSaving(false); }
  }

  function toggleArr(arr: string[], val: string) {
    return arr.includes(val) ? arr.filter((x:string) => x !== val) : [...arr, val];
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={ORANGE}/></View>;

  return (
    <View style={{flex:1, backgroundColor:'#FFF8F0'}}>
      {/* Header */}
      <View style={[s.header, {flexDirection:'row', alignItems:'center', justifyContent:'space-between'}]}>
        <TouchableOpacity onPress={onClose}>
          <Text style={{color:'#fff', fontSize:18}}>✕</Text>
        </TouchableOpacity>
        <Text style={s.headerText}>Edit Profile</Text>
        <TouchableOpacity onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" size="small"/> : <Text style={{color:'#fff', fontWeight:'700'}}>Save</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView style={{flex:1}} contentContainerStyle={{padding:16, paddingBottom:40}}>

        {/* Role */}
        <Text style={s.sectionTitle}>👨‍🍳 Your Role</Text>
        <View style={{flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:20}}>
          {ROLES.map(r => (
            <TouchableOpacity
              key={r}
              style={[s.typeBtn, form.role_code===r && s.typeBtnActive]}
              onPress={() => setForm((f:any) => ({...f, role_code: r}))}
            >
              <Text style={[s.typeBtnText, form.role_code===r && s.typeBtnTextActive]}>
                {ROLE_LABELS[r]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Experience */}
        <Text style={s.sectionTitle}>📅 Years of Experience</Text>
        <View style={{flexDirection:'row', gap:8, marginBottom:20, flexWrap:'wrap'}}>
          {['0','1','2','3','4','5','6','7','8','10','12','15','20'].map(y => (
            <TouchableOpacity
              key={y}
              style={[s.typeBtn, form.years_experience===y && s.typeBtnActive, {minWidth:48}]}
              onPress={() => setForm((f:any) => ({...f, years_experience: y}))}
            >
              <Text style={[s.typeBtnText, form.years_experience===y && s.typeBtnTextActive]}>{y}yr</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Cuisines */}
        <Text style={s.sectionTitle}>🍛 Cuisine Specializations</Text>
        <View style={{flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:20}}>
          {CUISINES.map(c => (
            <TouchableOpacity
              key={c}
              style={[s.typeBtn, form.cuisine_specializations.includes(c) && s.typeBtnActive]}
              onPress={() => setForm((f:any) => ({...f, cuisine_specializations: toggleArr(f.cuisine_specializations, c)}))}
            >
              <Text style={[s.typeBtnText, form.cuisine_specializations.includes(c) && s.typeBtnTextActive]}>
                {CUISINE_LABELS[c]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Location */}
        <Text style={s.sectionTitle}>📍 Current Location</Text>
        <TextInput
          style={[s.input, {marginBottom:8}]}
          placeholder="City"
          value={form.current_city}
          onChangeText={v => setForm((f:any) => ({...f, current_city: v}))}
        />
        <View style={{flexDirection:'row', flexWrap:'wrap', gap:6, marginBottom:20}}>
          {STATES.map(st => (
            <TouchableOpacity
              key={st}
              style={[s.typeBtn, form.current_state===st && s.typeBtnActive, {minWidth:44, paddingHorizontal:8}]}
              onPress={() => setForm((f:any) => ({...f, current_state: st}))}
            >
              <Text style={[s.typeBtnText, form.current_state===st && s.typeBtnTextActive, {fontSize:11}]}>{st}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Preferred States */}
        <Text style={s.sectionTitle}>🗺️ Preferred Work States</Text>
        <Text style={{fontSize:12, color:'#888', marginBottom:8}}>Select all states you are willing to work in</Text>
        <View style={{flexDirection:'row', flexWrap:'wrap', gap:6, marginBottom:8}}>
          {STATES.map(st => (
            <TouchableOpacity
              key={st}
              style={[s.typeBtn, form.preferred_states.includes(st) && s.typeBtnActive, {minWidth:44, paddingHorizontal:8}]}
              onPress={() => setForm((f:any) => ({...f, preferred_states: toggleArr(f.preferred_states, st)}))}
            >
              <Text style={[s.typeBtnText, form.preferred_states.includes(st) && s.typeBtnTextActive, {fontSize:11}]}>{st}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={[s.typeBtn, form.willing_to_relocate && s.typeBtnActive, {marginBottom:20, alignSelf:'flex-start'}]}
          onPress={() => setForm((f:any) => ({...f, willing_to_relocate: !f.willing_to_relocate}))}
        >
          <Text style={[s.typeBtnText, form.willing_to_relocate && s.typeBtnTextActive]}>
            {form.willing_to_relocate ? '✅ Willing to Relocate' : '❌ Not Willing to Relocate'}
          </Text>
        </TouchableOpacity>

        {/* Salary */}
        <Text style={s.sectionTitle}>💵 Expected Salary (per week)</Text>
        <View style={{flexDirection:'row', gap:12, marginBottom:20}}>
          <View style={{flex:1}}>
            <Text style={s.formLabel}>Minimum ($)</Text>
            <TextInput
              style={s.input}
              placeholder="600"
              value={form.salary_min}
              onChangeText={v => setForm((f:any) => ({...f, salary_min: v}))}
              keyboardType="numeric"
            />
          </View>
          <View style={{flex:1}}>
            <Text style={s.formLabel}>Maximum ($)</Text>
            <TextInput
              style={s.input}
              placeholder="800"
              value={form.salary_max}
              onChangeText={v => setForm((f:any) => ({...f, salary_max: v}))}
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* Pay Frequency */}
        <Text style={s.sectionTitle}>📆 Pay Frequency Preference</Text>
        <View style={{flexDirection:'row', gap:8, marginBottom:20}}>
          {PAY_FREQ.map(p => (
            <TouchableOpacity
              key={p.value}
              style={[s.typeBtn, form.pay_freq_pref===p.value && s.typeBtnActive, {flex:1}]}
              onPress={() => setForm((f:any) => ({...f, pay_freq_pref: p.value}))}
            >
              <Text style={[s.typeBtnText, form.pay_freq_pref===p.value && s.typeBtnTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Accommodation */}
        <Text style={s.sectionTitle}>🏠 Accommodation</Text>
        <View style={{flexDirection:'row', gap:8, marginBottom:20}}>
          <TouchableOpacity
            style={[s.typeBtn, !form.needs_accommodation && s.typeBtnActive, {flex:1}]}
            onPress={() => setForm((f:any) => ({...f, needs_accommodation: false}))}
          >
            <Text style={[s.typeBtnText, !form.needs_accommodation && s.typeBtnTextActive]}>I have housing</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.typeBtn, form.needs_accommodation && s.typeBtnActive, {flex:1}]}
            onPress={() => setForm((f:any) => ({...f, needs_accommodation: true}))}
          >
            <Text style={[s.typeBtnText, form.needs_accommodation && s.typeBtnTextActive]}>Need accommodation</Text>
          </TouchableOpacity>
        </View>

        {/* Work Authorization */}
        <Text style={s.sectionTitle}>📋 Work Authorization</Text>
        <View style={{flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:20}}>
          {WORK_AUTH.map(w => (
            <TouchableOpacity
              key={w.value}
              style={[s.typeBtn, form.work_authorization===w.value && s.typeBtnActive]}
              onPress={() => setForm((f:any) => ({...f, work_authorization: w.value}))}
            >
              <Text style={[s.typeBtnText, form.work_authorization===w.value && s.typeBtnTextActive]}>{w.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Bio */}
        <Text style={s.sectionTitle}>📝 About Me</Text>
        <TextInput
          style={[s.input, {height:100, textAlignVertical:'top', marginBottom:20}]}
          placeholder="Tell employers about yourself, your experience and what you are looking for..."
          value={form.bio_text}
          onChangeText={v => setForm((f:any) => ({...f, bio_text: v}))}
          multiline
        />

        {/* Save Button */}
        <TouchableOpacity
          style={[s.btn, {backgroundColor: ORANGE, marginBottom:20}]}
          onPress={save}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color="#fff"/>
            : <Text style={s.btnText}>💾 Save Profile</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

// ─── Notifications Panel ──────────────────────────────────────────────────────
function NotificationsPanel({ user, onClose }: { user: any; onClose: () => void }) {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api.get('/notifications')
      .then(r => setData(r.data.data))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function markAllRead() {
    await api.patch('/notifications/read-all', {});
    load();
  }

  async function markRead(id: string) {
    await api.patch(`/notifications/${id}/read`, {});
    load();
  }

  const eventIcon = (type: string) => ({
    new_application:  '👨‍🍳',
    offer_received:   '📩',
    agreement_signed: '✍️',
    pay_sent:         '💰',
    pay_confirmed:    '✅',
    pay_due:          '⚠️',
    pay_late:         '🔴',
  }[type] ?? '🔔');

  return (
    <View style={{flex:1, backgroundColor:'#fff'}}>
      {/* Header */}
      <View style={[s.header, {flexDirection:'row', justifyContent:'space-between', alignItems:'center'}]}>
        <TouchableOpacity onPress={onClose}>
          <Text style={{color:'#fff', fontSize:18}}>✕</Text>
        </TouchableOpacity>
        <Text style={s.headerText}>🔔 Notifications</Text>
        <TouchableOpacity onPress={markAllRead}>
          <Text style={{color:'rgba(255,255,255,0.8)', fontSize:12}}>Mark all read</Text>
        </TouchableOpacity>
      </View>

      {loading && <View style={s.center}><ActivityIndicator color={ORANGE}/></View>}

      {!loading && (
        <ScrollView style={{flex:1}}>
          {data?.notifications.length === 0 && (
            <View style={s.emptyContainer}>
              <Text style={s.emptyIcon}>🔔</Text>
              <Text style={s.emptyText}>No notifications yet.</Text>
              <Text style={s.emptySubtext}>You'll see offers, payments and updates here.</Text>
            </View>
          )}
          {data?.notifications.map((n: any) => {
            const isUnread = n.status === 'sent';
            return (
              <TouchableOpacity
                key={n.notification_id}
                style={[s.notifItem, isUnread && s.notifItemUnread]}
                onPress={() => markRead(n.notification_id)}
              >
                <Text style={s.notifIcon}>{eventIcon(n.event_type)}</Text>
                <View style={{flex:1, marginLeft:12}}>
                  <Text style={[s.notifTitle, isUnread && {fontWeight:'700'}]}>{n.title}</Text>
                  <Text style={s.notifBody}>{n.body}</Text>
                  <Text style={s.notifTime}>
                    {new Date(n.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
                  </Text>
                </View>
                {isUnread && <View style={s.notifDot}/>}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Notification Bell ────────────────────────────────────────────────────────
function NotificationBell({ user }: { user: any }) {
  const [unread, setUnread] = useState(0);
  const [open, setOpen]     = useState(false);

  useEffect(() => {
    function fetchUnread() {
      api.get('/notifications')
        .then(r => setUnread(r.data.data?.unread ?? 0))
        .catch(() => {});
    }
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <TouchableOpacity style={s.bellBtn} onPress={() => setOpen(true)}>
        <Text style={{fontSize:22}}>🔔</Text>
        {unread > 0 && (
          <View style={s.bellBadge}>
            <Text style={s.bellBadgeText}>{unread > 9 ? '9+' : unread}</Text>
          </View>
        )}
      </TouchableOpacity>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <NotificationsPanel user={user} onClose={() => { setOpen(false); setUnread(0); }}/>
      </Modal>
    </>
  );
}

// ─── Owner: Pay Tab ───────────────────────────────────────────────────────────
function OwnerPayTab({ user }: { user: any }) {
  const [pay, setPay]         = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking]       = useState<string|null>(null);
  const [showRating, setShowRating] = useState<any>(null);
  const [ratingForm, setRatingForm] = useState({
    dim_overall: 0, dim_communication: 0, dim_reliability: 0,
    dim_skill_level: 0, dim_punctuality: 0,
  });
  const [submittingRating, setSubmittingRating] = useState(false);
  const [showConfirm, setShowConfirm] = useState<any>(null);
  const [amount, setAmount]   = useState('');
  const [method, setMethod]   = useState('cash');

  function load() {
    setLoading(true);
    api.get(`/owners/${user.user_id}/pay`)
      .then(r => setPay(r.data.data))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function markPaid() {
    if (!showConfirm) return;
    setMarking(showConfirm.cycle_id);
    try {
      await api.patch(`/pay/${showConfirm.cycle_id}/owner-confirm`, {
        amount_cents: Math.round(parseFloat(amount) * 100),
        payment_method: method,
      });
      setShowConfirm(null);
      setAmount('');
      load();
    } catch(e: any) {
      alert(e.response?.data?.error ?? 'Failed to mark as paid');
    } finally { setMarking(null); }
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={DARK}/></View>;

  const statusColor = (st: string) => ({
    worker_confirmed: GREEN,
    owner_confirmed:  '#1565C0',
    scheduled:        '#888',
    late:             '#f44336',
    disputed:         '#E65100',
    resolved:         GREEN,
  }[st] ?? '#888');

  const statusLabel = (st: string) => ({
    worker_confirmed: '✅ Confirmed',
    owner_confirmed:  '📬 Sent',
    scheduled:        '⏳ Due',
    late:             '⚠️ Overdue',
    disputed:         '🔴 Disputed',
    resolved:         '✅ Resolved',
  }[st] ?? st);

  // Pay confirmation modal
  async function submitRating() {
    setSubmittingRating(true);
    try {
      await api.post('/ratings', {
        agreement_id:     showRating.agreement_id,
        rated_id:         showRating.worker_id,
        period_month:     showRating.period_start.slice(0,7),
        rater_type:       'owner',
        dim_overall:       ratingForm.dim_overall,
        dim_communication: ratingForm.dim_communication,
        dim_reliability:   ratingForm.dim_reliability,
        dim_skill_level:   ratingForm.dim_skill_level,
        dim_punctuality:   ratingForm.dim_punctuality,
      });
      setShowRating(null);
      setRatingForm({ dim_overall:0, dim_communication:0, dim_reliability:0, dim_skill_level:0, dim_punctuality:0 });
      load();
    } catch(e: any) {
      alert(e.response?.data?.error ?? 'Failed to submit rating');
    } finally { setSubmittingRating(false); }
  }

  if (showRating) return (
    <ScrollView style={{flex:1}} contentContainerStyle={{padding:24}}>
      <Text style={s.sectionTitle}>Rate Worker</Text>
      <Text style={s.cardSub}>Worker: {showRating.worker_name}</Text>
      <Text style={[s.cardSub, {marginBottom:20}]}>
        Period: {new Date(showRating.period_start).toLocaleDateString()} – {new Date(showRating.period_end).toLocaleDateString()}
      </Text>
      {([
        {key:"dim_overall",       label:"Overall Performance", icon:"⭐"},
        {key:"dim_communication", label:"Communication",       icon:"💬"},
        {key:"dim_reliability",   label:"Reliability",         icon:"🎯"},
        {key:"dim_skill_level",   label:"Skill Level",         icon:"👨‍🍳"},
        {key:"dim_punctuality",   label:"Punctuality",         icon:"⏰"},
      ] as const).map(dim => (
        <View key={dim.key} style={{marginBottom:20}}>
          <Text style={s.formLabel}>{dim.icon} {dim.label}</Text>
          <View style={{flexDirection:"row", gap:8, marginTop:6}}>
            {[1,2,3,4,5].map(star => (
              <TouchableOpacity key={star} onPress={() => setRatingForm(f => ({...f, [dim.key]: star}))} style={{padding:4}}>
                <Text style={{fontSize:32, color: star <= (ratingForm as any)[dim.key] ? "#FFD700" : "#ddd"}}>★</Text>
              </TouchableOpacity>
            ))}
          </View>
          {(ratingForm as any)[dim.key] > 0 && (
            <Text style={{fontSize:12, color:"#888", marginTop:4}}>
              {["","Poor","Fair","Good","Very Good","Excellent"][(ratingForm as any)[dim.key]]}
            </Text>
          )}
        </View>
      ))}
      <View style={{flexDirection:"row", gap:8, marginTop:8}}>
        <TouchableOpacity style={[s.btn, {flex:1, backgroundColor:"#ccc"}]} onPress={() => setShowRating(null)}>
          <Text style={[s.btnText, {color:"#333"}]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btn, {flex:2, backgroundColor: ratingForm.dim_overall===0?"#ccc":DARK}]}
          onPress={submitRating}
          disabled={submittingRating || ratingForm.dim_overall===0}
        >
          {submittingRating ? <ActivityIndicator color="#fff"/> : <Text style={s.btnText}>Submit Rating</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  if (showConfirm) return (
    <View style={{flex:1, padding:24, justifyContent:'center', backgroundColor:'#FFF8F0'}}>
      <Text style={s.sectionTitle}>Mark Pay as Sent</Text>
      <Text style={s.cardSub}>Worker: {showConfirm.worker_name}</Text>
      <Text style={[s.cardSub, {marginBottom:20}]}>
        Period: {new Date(showConfirm.period_start).toLocaleDateString()} – {new Date(showConfirm.period_end).toLocaleDateString()}
      </Text>

      <Text style={s.formLabel}>Amount Paid ($)</Text>
      <TextInput
        style={s.input}
        placeholder={`Expected: $${Math.round(showConfirm.expected_amount_cents/100)}`}
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
      />

      <Text style={s.formLabel}>Payment Method</Text>
      <View style={{flexDirection:'row', gap:8, marginBottom:20}}>
        {['cash','check','zelle','venmo'].map(m => (
          <TouchableOpacity
            key={m}
            style={[s.typeBtn, method===m && s.typeBtnActive, {flex:1}]}
            onPress={() => setMethod(m)}
          >
            <Text style={[s.typeBtnText, method===m && s.typeBtnTextActive]}>
              {m.charAt(0).toUpperCase()+m.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{flexDirection:'row', gap:8}}>
        <TouchableOpacity style={[s.btn, {flex:1, backgroundColor:'#ccc'}]} onPress={() => setShowConfirm(null)}>
          <Text style={[s.btnText, {color:'#333'}]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btn, {flex:2, backgroundColor:GREEN}]}
          onPress={markPaid}
          disabled={!amount || !!marking}
        >
          {marking ? <ActivityIndicator color="#fff"/> : <Text style={s.btnText}>✅ Confirm Payment Sent</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <ScrollView style={{flex:1}}>
      {/* Summary */}
      {pay && (
        <View style={{padding:16}}>
          <View style={s.statsRow}>
            <View style={[s.statCard, {borderLeftColor:GREEN}]}>
              <Text style={s.statNum}>${Math.round((pay.summary.totalPaid??0)/100)}</Text>
              <Text style={s.statLabel}>Total Paid</Text>
            </View>
            <View style={[s.statCard, {borderLeftColor:'#f44336'}]}>
              <Text style={s.statNum}>{pay.summary.pendingCount}</Text>
              <Text style={s.statLabel}>Pending</Text>
            </View>
            <View style={[s.statCard, {borderLeftColor:DARK}]}>
              <Text style={s.statNum}>{pay.summary.totalCycles}</Text>
              <Text style={s.statLabel}>Total</Text>
            </View>
          </View>
        </View>
      )}

      <Text style={s.sectionTitle}>Pay Obligations</Text>
      {pay?.cycles.length === 0 && (
        <View style={s.emptyContainer}>
          <Text style={s.emptyIcon}>💸</Text>
          <Text style={s.emptyText}>No pay cycles yet.</Text>
          <Text style={s.emptySubtext}>Pay cycles are created when agreements are activated.</Text>
        </View>
      )}
      {pay?.cycles.map((cycle: any) => (
        <View key={cycle.cycle_id} style={[s.card,
          cycle.status==='late' && {borderColor:'#f44336', borderWidth:2},
          cycle.status==='scheduled' && {borderColor:ORANGE, borderWidth:1},
        ]}>
          <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start'}}>
            <View style={{flex:1}}>
              <Text style={s.cardTitle}>{cycle.worker_name}</Text>
              <Text style={s.cardSub}>📞 {cycle.worker_phone}</Text>
              <Text style={s.cardSub}>
                {new Date(cycle.period_start).toLocaleDateString('en-US',{month:'short',day:'numeric'})} –{" "}
                {new Date(cycle.period_end).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
              </Text>
            </View>
            <View style={[s.statusBadge, {backgroundColor: statusColor(cycle.status)+'22', alignSelf:'flex-start'}]}>
              <Text style={{fontSize:11, fontWeight:'700', color: statusColor(cycle.status)}}>
                {statusLabel(cycle.status)}
              </Text>
            </View>
          </View>

          <View style={s.offerDetails}>
            <View style={s.offerDetail}>
              <Text style={s.offerDetailLabel}>Expected</Text>
              <Text style={s.offerDetailValue}>${Math.round(cycle.expected_amount_cents/100)}</Text>
            </View>
            <View style={s.offerDetail}>
              <Text style={s.offerDetailLabel}>Paid</Text>
              <Text style={[s.offerDetailValue, {color: cycle.owner_amount_paid_cents?GREEN:'#999'}]}>
                {cycle.owner_amount_paid_cents ? `$${Math.round(cycle.owner_amount_paid_cents/100)}` : '—'}
              </Text>
            </View>
            <View style={s.offerDetail}>
              <Text style={s.offerDetailLabel}>Due</Text>
              <Text style={[s.offerDetailValue, {color: cycle.status==='late'?'#f44336':'#333'}]}>
                {new Date(cycle.due_date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
              </Text>
            </View>
            <View style={s.offerDetail}>
              <Text style={s.offerDetailLabel}>Method</Text>
              <Text style={s.offerDetailValue}>{cycle.payment_method ?? '—'}</Text>
            </View>
          </View>

          {(cycle.status==='scheduled'||cycle.status==='late') && (
            <TouchableOpacity
              style={[s.btn, {marginTop:10, paddingVertical:8, backgroundColor:DARK}]}
              onPress={() => { setShowConfirm(cycle); setAmount(String(Math.round(cycle.expected_amount_cents/100))); }}
            >
              <Text style={s.btnText}>💸 Mark as Paid</Text>
            </TouchableOpacity>
          )}
          {cycle.status==='owner_confirmed' && (
            <Text style={{marginTop:8, fontSize:12, color:'#1565C0', fontWeight:'600'}}>
              📬 Marked as paid — waiting for worker to confirm receipt
            </Text>
          )}
          {cycle.status==='worker_confirmed' && (
            <View>
              <Text style={{marginTop:8, fontSize:12, color:GREEN, fontWeight:'600'}}>
                ✅ Worker confirmed receipt
              </Text>
              {cycle.already_rated ? (
                <View style={[s.btn, {marginTop:8, paddingVertical:8, backgroundColor:'#f0f0f0'}]}>
                  <Text style={[s.btnText, {color:'#999'}]}>⭐ Already Rated</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[s.btn, {marginTop:8, paddingVertical:8, backgroundColor:'#FFD700'}]}
                  onPress={() => setShowRating({...cycle})}
                >
                  <Text style={[s.btnText, {color:DARK}]}>⭐ Rate this Worker</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Owner: Agreements Tab ────────────────────────────────────────────────────
const TERMINATION_REASONS = [
  { value: 'worker_resigned',      label: 'Worker resigned (gave notice)' },
  { value: 'worker_no_show',       label: 'Worker left without notice' },
  { value: 'worker_misconduct',    label: 'Worker misconduct / terminated' },
  { value: 'mutual',               label: 'Mutual agreement' },
  { value: 'contract_ended',       label: 'Contract period ended' },
];

function OwnerAgreementsTab({ user }: { user: any }) {
  const [agreements, setAgreements] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState<any>(null);

  // Termination flow
  const [showTerminate, setShowTerminate]   = useState<any>(null);
  const [termReason, setTermReason]         = useState('worker_resigned');
  const [termDate, setTermDate]             = useState('');
  const [terminating, setTerminating]       = useState(false);

  // Post-termination rating
  const [showRateWorker, setShowRateWorker] = useState<any>(null);
  const [ratingForm, setRatingForm]         = useState({ dim_overall:0, dim_reliability:0, dim_punctuality:0, dim_communication:0, dim_skill_level:0, private_note:'' });
  const [submittingRating, setSubmittingRating] = useState(false);

  function load() {
    setLoading(true);
    api.get(`/owners/${user.user_id}/agreements`)
      .then(r => setAgreements(r.data.data ?? []))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function terminate() {
    if (!showTerminate) return;
    setTerminating(true);
    try {
      await api.patch(`/agreements/${showTerminate.agreement_id}/terminate`, {
        reason: termReason,
        last_working_date: termDate || new Date().toISOString().slice(0,10),
      });
      setShowTerminate(null);
      load();
      // Prompt to rate the worker right after
      setShowRateWorker(showTerminate);
      // Pre-fill low scores if left without notice
      if (termReason === 'worker_no_show') {
        setRatingForm(f => ({ ...f, dim_reliability: 1, dim_punctuality: 1 }));
      } else {
        setRatingForm({ dim_overall:0, dim_reliability:0, dim_punctuality:0, dim_communication:0, dim_skill_level:0, private_note:'' });
      }
    } catch(e: any) {
      alert(e.response?.data?.error ?? 'Failed to terminate');
    } finally { setTerminating(false); }
  }

  async function submitRating() {
    if (!showRateWorker) return;
    setSubmittingRating(true);
    try {
      await api.post('/ratings', {
        agreement_id:      showRateWorker.agreement_id,
        rated_id:          showRateWorker.worker_id,
        period_month:      new Date().toISOString().slice(0,7),
        rater_type:        'owner',
        dim_overall:       ratingForm.dim_overall,
        dim_reliability:   ratingForm.dim_reliability,
        dim_punctuality:   ratingForm.dim_punctuality,
        dim_communication: ratingForm.dim_communication,
        dim_skill_level:   ratingForm.dim_skill_level,
        private_note:      ratingForm.private_note || null,
      });
      setShowRateWorker(null);
    } catch(e: any) {
      alert(e.response?.data?.error ?? 'Failed to submit rating');
    } finally { setSubmittingRating(false); }
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={DARK}/></View>;

  if (selected) return (
    <AgreementScreen
      agreement={selected}
      userType="owner"
      onSign={async () => {
        const res = await api.get(`/offers/${selected.offer_id}/agreement`);
        setSelected(res.data.data);
        load();
      }}
      onClose={() => { setSelected(null); load(); }}
    />
  );

  return (
    <View style={{flex:1}}>
    <ScrollView style={{flex:1}}>
      <Text style={s.sectionTitle}>Agreements ({agreements.length})</Text>
      {agreements.length === 0 && (
        <View style={s.emptyContainer}>
          <Text style={s.emptyIcon}>📄</Text>
          <Text style={s.emptyText}>No agreements yet.</Text>
          <Text style={s.emptySubtext}>Agreements appear here when you accept applicants.</Text>
        </View>
      )}
      {agreements.map((agr: any) => {
        const ownerSigned  = !!agr.owner_signed_at;
        const workerSigned = !!agr.worker_signed_at;
        const bothSigned   = ownerSigned && workerSigned;
        const needsMySign  = !ownerSigned;

        return (
          <TouchableOpacity key={agr.agreement_id} style={[s.card, needsMySign && {borderColor: ORANGE, borderWidth:2}]} onPress={() => setSelected(agr)}>
            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start'}}>
              <View style={{flex:1}}>
                <Text style={s.cardTitle}>{agr.worker_name}</Text>
                <Text style={s.cardSub}>📞 {agr.worker_phone}</Text>
                <Text style={s.cardSub}>🏪 {agr.restaurant_name}</Text>
              </View>
              <View style={[s.statusBadge, {
                backgroundColor: bothSigned?'#E8F5E9': needsMySign?'#FFF3E0':'#E3F2FD',
                alignSelf:'flex-start'
              }]}>
                <Text style={{fontSize:11, fontWeight:'700', color: bothSigned?GREEN: needsMySign?ORANGE:'#1565C0'}}>
                  {bothSigned?'EXECUTED': needsMySign?'SIGN NOW':'WORKER PENDING'}
                </Text>
              </View>
            </View>

            <View style={{flexDirection:'row', gap:8, marginTop:10}}>
              <View style={s.offerDetail}>
                <Text style={s.offerDetailLabel}>💰 Pay</Text>
                <Text style={s.offerDetailValue}>${Math.round(agr.agreed_pay_cents/100)}/wk</Text>
              </View>
              <View style={s.offerDetail}>
                <Text style={s.offerDetailLabel}>⏱ Hours</Text>
                <Text style={s.offerDetailValue}>{agr.agreed_hours_pw}h/wk</Text>
              </View>
            </View>

            <View style={{flexDirection:'row', marginTop:10, gap:16}}>
              <Text style={{fontSize:12, color: ownerSigned?GREEN:'#999'}}>
                {ownerSigned?'✅':'⏳'} You
              </Text>
              <Text style={{fontSize:12, color: workerSigned?GREEN:'#999'}}>
                {workerSigned?'✅':'⏳'} {agr.worker_name.split(' ')[0]}
              </Text>
            </View>

            {needsMySign && (
              <Text style={{marginTop:8, fontSize:12, color:ORANGE, fontWeight:'600'}}>
                Tap to review and sign →
              </Text>
            )}

            {/* End Employment button — only for active (both signed) agreements */}
            {bothSigned && agr.status === 'active' && (
              <TouchableOpacity
                style={{marginTop:12, paddingVertical:8, paddingHorizontal:12, borderRadius:8, borderWidth:1, borderColor:'#f44336', alignSelf:'flex-start'}}
                onPress={(e) => { e.stopPropagation?.(); setShowTerminate(agr); setTermReason('worker_resigned'); setTermDate(''); }}
              >
                <Text style={{color:'#f44336', fontWeight:'700', fontSize:12}}>🔴 End Employment</Text>
              </TouchableOpacity>
            )}

            {agr.status === 'terminated' && (
              <View style={{marginTop:8, backgroundColor:'#FFEBEE', borderRadius:6, padding:8}}>
                <Text style={{fontSize:12, color:'#f44336', fontWeight:'600'}}>⛔ Employment Terminated</Text>
                {agr.last_working_date && <Text style={{fontSize:11, color:'#888', marginTop:2}}>Last working day: {agr.last_working_date}</Text>}
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>

      {/* Termination Modal */}
      <Modal visible={!!showTerminate} transparent animationType="slide" onRequestClose={() => setShowTerminate(null)}>
        <TouchableOpacity style={{flex:1, justifyContent:'flex-end', backgroundColor:'rgba(0,0,0,0.5)'}} activeOpacity={1} onPress={() => setShowTerminate(null)}>
        <TouchableOpacity activeOpacity={1} onPress={e => e.stopPropagation?.()}>
          <View style={{backgroundColor:'#fff', borderTopLeftRadius:20, borderTopRightRadius:20, padding:24, maxHeight:'85%'}}>
            <ScrollView>
              <Text style={{fontSize:18, fontWeight:'bold', color:'#f44336', marginBottom:4}}>🔴 End Employment</Text>
              <Text style={{fontSize:13, color:'#666', marginBottom:20}}>
                Worker: <Text style={{fontWeight:'700', color:'#333'}}>{showTerminate?.worker_name}</Text>
              </Text>

              <Text style={{fontSize:13, fontWeight:'600', color:'#333', marginBottom:8}}>Reason</Text>
              {TERMINATION_REASONS.map(r => (
                <TouchableOpacity
                  key={r.value}
                  style={{flexDirection:'row', alignItems:'center', paddingVertical:10, paddingHorizontal:12, marginBottom:6, borderRadius:8, borderWidth:1.5,
                    borderColor: termReason === r.value ? '#f44336' : '#eee',
                    backgroundColor: termReason === r.value ? '#FFEBEE' : '#fafafa'}}
                  onPress={() => setTermReason(r.value)}
                >
                  <View style={{width:18, height:18, borderRadius:9, borderWidth:2,
                    borderColor: termReason === r.value ? '#f44336' : '#ccc',
                    backgroundColor: termReason === r.value ? '#f44336' : '#fff',
                    marginRight:10}}/>
                  <Text style={{fontSize:13, color: termReason === r.value ? '#f44336' : '#444', fontWeight: termReason === r.value ? '600' : '400'}}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}

              <Text style={{fontSize:13, fontWeight:'600', color:'#333', marginTop:16, marginBottom:6}}>Last Working Date</Text>
              <TextInput
                style={s.input}
                placeholder={`Today: ${new Date().toISOString().slice(0,10)}`}
                value={termDate}
                onChangeText={setTermDate}
                placeholderTextColor="#aaa"
              />
              <Text style={{fontSize:11, color:'#999', marginBottom:16}}>Leave blank to use today's date. Format: YYYY-MM-DD</Text>

              <TouchableOpacity
                style={[s.btn, {backgroundColor:'#f44336', marginBottom:12}]}
                onPress={terminate}
                disabled={terminating}
              >
                {terminating ? <ActivityIndicator color="#fff"/> : <Text style={s.btnText}>Confirm End Employment</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowTerminate(null)} style={{alignItems:'center', paddingVertical:10}}>
                <Text style={{color:'#666', fontSize:14}}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Post-Termination Worker Rating Modal */}
      <Modal visible={!!showRateWorker} transparent animationType="slide" onRequestClose={() => setShowRateWorker(null)}>
        <TouchableOpacity style={{flex:1, justifyContent:'flex-end', backgroundColor:'rgba(0,0,0,0.5)'}} activeOpacity={1} onPress={() => setShowRateWorker(null)}>
        <TouchableOpacity activeOpacity={1} onPress={e => e.stopPropagation?.()}>
          <View style={{backgroundColor:'#fff', borderTopLeftRadius:20, borderTopRightRadius:20, padding:24, maxHeight:'85%'}}>
            <ScrollView>
              <Text style={{fontSize:18, fontWeight:'bold', color:DARK, marginBottom:4}}>⭐ Rate {showRateWorker?.worker_name?.split(' ')[0]}</Text>
              <Text style={{fontSize:13, color:'#666', marginBottom:20}}>Your honest rating helps other owners make better hiring decisions.</Text>

              {([
                { key:'dim_overall',        label:'Overall Performance', emoji:'⭐' },
                { key:'dim_reliability',    label:'Reliability',         emoji:'🔒' },
                { key:'dim_punctuality',    label:'Punctuality',         emoji:'⏰' },
                { key:'dim_communication', label:'Communication',        emoji:'💬' },
                { key:'dim_skill_level',   label:'Skill Level',          emoji:'🍳' },
              ] as const).map(dim => (
                <View key={dim.key} style={{marginBottom:16}}>
                  <Text style={{fontSize:13, fontWeight:'600', color:'#333', marginBottom:8}}>{dim.emoji} {dim.label}</Text>
                  <View style={{flexDirection:'row', gap:8}}>
                    {[1,2,3,4,5].map(n => (
                      <TouchableOpacity
                        key={n}
                        style={{width:44, height:44, borderRadius:22, borderWidth:2, justifyContent:'center', alignItems:'center',
                          borderColor: ratingForm[dim.key] >= n ? ORANGE : '#eee',
                          backgroundColor: ratingForm[dim.key] >= n ? '#FFF3E0' : '#fafafa'}}
                        onPress={() => setRatingForm(f => ({...f, [dim.key]: n}))}
                      >
                        <Text style={{fontSize:16}}>{n <= (ratingForm[dim.key] ?? 0) ? '★' : '☆'}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}

              <Text style={{fontSize:13, fontWeight:'600', color:'#333', marginBottom:6}}>Private Note (optional)</Text>
              <TextInput
                style={[s.input, {height:80, textAlignVertical:'top'}]}
                placeholder="Internal notes — not visible to worker"
                value={ratingForm.private_note}
                onChangeText={t => setRatingForm(f => ({...f, private_note: t}))}
                multiline
                placeholderTextColor="#aaa"
              />

              <TouchableOpacity
                style={[s.btn, {marginTop:8, marginBottom:12}]}
                onPress={submitRating}
                disabled={submittingRating || ratingForm.dim_overall === 0}
              >
                {submittingRating ? <ActivityIndicator color="#fff"/> : <Text style={s.btnText}>Submit Rating</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowRateWorker(null)} style={{alignItems:'center', paddingVertical:10}}>
                <Text style={{color:'#666', fontSize:14}}>Skip for now</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  center:             {flex:1,justifyContent:'center',alignItems:'center'},
  langContainer:      {flex:1,backgroundColor:'#FFF8F0',alignItems:'center',paddingTop:60},
  langLogo:           {fontSize:60},
  langAppName:        {fontSize:28,fontWeight:'bold',color:ORANGE,marginBottom:8},
  langTitle:          {fontSize:20,fontWeight:'bold',color:DARK,marginBottom:4},
  langSubtitle:       {fontSize:13,color:'#888',marginBottom:24,textAlign:'center'},
  langBtn:            {flexDirection:'row',alignItems:'center',backgroundColor:'#fff',borderRadius:16,padding:18,marginBottom:10,borderWidth:2,borderColor:'#F0F0F0'},
  langBtnSelected:    {backgroundColor:ORANGE,borderColor:ORANGE},
  langFlag:           {fontSize:32},
  langNative:         {fontSize:18,fontWeight:'bold',color:DARK},
  langEnglish:        {fontSize:13,color:'#888',marginTop:2},
  langPickerBtn:      {flexDirection:'row',justifyContent:'space-between',alignItems:'center',borderWidth:1,borderColor:'#ddd',borderRadius:10,padding:12,backgroundColor:'#fff'},
  langPickerDropdown: {borderWidth:1,borderColor:'#ddd',borderRadius:10,backgroundColor:'#fff',marginTop:4,overflow:'hidden'},
  langPickerItem:     {flexDirection:'row',justifyContent:'space-between',padding:12,borderBottomWidth:1,borderColor:'#f0f0f0'},
  authContainer:      {flexGrow:1,padding:24,justifyContent:'center',backgroundColor:'#FFF8F0'},
  logo:               {fontSize:60,textAlign:'center'},
  appName:            {fontSize:32,fontWeight:'bold',textAlign:'center',color:ORANGE,marginBottom:4},
  tagline:            {fontSize:13,textAlign:'center',color:'#888',marginBottom:24},
  fieldLabel:         {fontSize:13,fontWeight:'600',color:'#555',alignSelf:'flex-start',marginBottom:4,marginTop:4},
  modeToggle:         {flexDirection:'row',backgroundColor:'#eee',borderRadius:10,padding:4,marginBottom:20},
  modeBtn:            {flex:1,padding:10,borderRadius:8,alignItems:'center'},
  modeBtnActive:      {backgroundColor:'#fff'},
  modeBtnText:        {color:'#999',fontWeight:'600'},
  modeBtnTextActive:  {color:DARK},
  typeToggle:         {flexDirection:'row',gap:8,marginBottom:12},
  typeBtn:            {flex:1,padding:12,borderRadius:10,alignItems:'center',borderWidth:2,borderColor:'#eee'},
  typeBtnActive:      {borderColor:ORANGE,backgroundColor:'#FFF3E0'},
  typeBtnText:        {color:'#999',fontWeight:'600'},
  typeBtnTextActive:  {color:ORANGE},
  input:              {borderWidth:1,borderColor:'#ddd',borderRadius:10,padding:14,marginBottom:12,fontSize:16,backgroundColor:'#fff'},
  btn:                {backgroundColor:ORANGE,padding:14,borderRadius:10,alignItems:'center'},
  btnText:            {color:'#fff',fontSize:15,fontWeight:'bold'},
  error:              {color:'red',marginBottom:8,textAlign:'center'},
  appContainer:       {flex:1,backgroundColor:'#F8F9FA'},
  header:             {backgroundColor:ORANGE,padding:16,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  headerText:         {color:'#fff',fontSize:20,fontWeight:'bold'},
  welcomeText:        {color:'#fff',fontSize:14},
  tabBar:             {flexDirection:'row',borderTopWidth:1,borderColor:'#eee',backgroundColor:'#fff'},
  tabBtn:             {flex:1,alignItems:'center',paddingTop:8},
  tabIcon:            {fontSize:22,color:'#bbb'},
  tabLabel:           {fontSize:11,color:'#bbb',marginTop:2},
  sectionTitle:       {fontSize:18,fontWeight:'bold',paddingHorizontal:16,paddingTop:16,paddingBottom:8,color:'#333'},
  card:               {backgroundColor:'#fff',margin:8,marginHorizontal:16,padding:16,borderRadius:12,borderWidth:1,borderColor:'#F0F0F0'},
  cardTitle:          {fontSize:16,fontWeight:'bold',color:'#333',marginBottom:4},
  cardSub:            {fontSize:13,color:'#666',marginBottom:2},
  cardPay:            {fontSize:15,fontWeight:'bold',color:ORANGE,marginTop:2},
  badge:              {marginTop:6,fontSize:12,color:GREEN},
  statsRow:           {flexDirection:'row',gap:8},
  statCard:           {flex:1,backgroundColor:'#fff',padding:14,borderRadius:12,borderLeftWidth:4,borderWidth:1,borderColor:'#F0F0F0'},
  statNum:            {fontSize:28,fontWeight:'bold',color:DARK},
  statLabel:          {fontSize:12,color:'#666',marginTop:2},
  statusBadge:        {paddingHorizontal:8,paddingVertical:3,borderRadius:6},
  emptyText:          {textAlign:'center',color:'#999',marginTop:40,fontSize:15},
  formLabel:          {fontSize:13,fontWeight:'600',color:'#555',marginBottom:4},
  chatLangBadge:      {backgroundColor:'#FFF3E0',paddingHorizontal:12,paddingVertical:6,borderBottomWidth:1,borderColor:'#FFE0B2',alignItems:'center'},
  chatLangText:       {fontSize:13,color:ORANGE,fontWeight:'600'},
  chatScroll:         {flex:1,backgroundColor:'#F8F9FA'},
  bubble:             {maxWidth:'80%',padding:12,borderRadius:16,marginBottom:8},
  userBubble:         {backgroundColor:ORANGE,alignSelf:'flex-end',borderBottomRightRadius:4},
  aiBubble:           {backgroundColor:'#fff',alignSelf:'flex-start',borderBottomLeftRadius:4,borderWidth:1,borderColor:'#eee'},
  userText:           {color:'#fff',fontSize:14},
  aiText:             {color:'#333',fontSize:14},
  typing:             {color:'#999',fontStyle:'italic',marginLeft:8},
  chatInputRow:       {flexDirection:'row',padding:8,backgroundColor:'#fff',borderTopWidth:1,borderColor:'#eee'},
  chatTextInput:      {flex:1,borderWidth:1,borderColor:'#ddd',borderRadius:20,paddingHorizontal:14,paddingVertical:8,fontSize:14},
  sendBtn:            {backgroundColor:ORANGE,borderRadius:20,paddingHorizontal:16,justifyContent:'center',marginLeft:8},
  profileContainer:   {padding:24,alignItems:'center'},
  profileName:        {fontSize:22,fontWeight:'bold',marginTop:12,color:'#333'},
  profileRow:         {flexDirection:'row',justifyContent:'space-between',width:'100%',paddingVertical:12,borderBottomWidth:1,borderColor:'#eee'},
  profileLabel:       {fontSize:15,color:'#666'},
  profileValue:       {fontSize:15,fontWeight:'600',color:'#333'},
  cardAccepted:       {borderColor:'#A5D6A7', borderWidth:2},
  cardRejected:       {borderColor:'#EF9A9A', borderWidth:2, opacity:0.7},
  offerDetails:       {flexDirection:'row', flexWrap:'wrap', marginTop:12, gap:8},
  offerDetail:        {backgroundColor:'#F8F9FA', borderRadius:8, padding:10, minWidth:'45%', flex:1},
  offerDetailLabel:   {fontSize:11, color:'#888', marginBottom:2},
  offerDetailValue:   {fontSize:14, fontWeight:'700', color:'#333'},
  offerDesc:          {marginTop:10, fontSize:13, color:'#555', lineHeight:18},
  offerExpiry:        {marginTop:8, fontSize:11, color:'#999'},
  acceptedBanner:     {marginTop:12, backgroundColor:'#E8F5E9', borderRadius:8, padding:12},
  acceptedBannerText: {color:'#2E7D32', fontSize:13, fontWeight:'600', textAlign:'center'},
  rejectedBanner:     {marginTop:12, backgroundColor:'#FFEBEE', borderRadius:8, padding:10},
  rejectedBannerText: {color:'#c62828', fontSize:13, textAlign:'center'},
  emptyContainer:     {alignItems:'center', marginTop:60},
  emptyIcon:          {fontSize:50, marginBottom:12},
  browseHeader:       {backgroundColor:'#fff', padding:16, borderBottomWidth:1, borderColor:'#eee'},
  browseHeaderLabel:  {fontSize:12, color:'#888', fontWeight:'600'},
  listingChip:        {paddingHorizontal:14, paddingVertical:8, borderRadius:20, borderWidth:1, borderColor:'#ddd', marginRight:8, backgroundColor:'#fff'},
  listingChipActive:  {backgroundColor:DARK, borderColor:DARK},
  listingChipText:    {fontSize:13, color:'#666'},
  listingChipTextActive:{color:'#fff', fontWeight:'600'},
  filterBar:          {flexDirection:'row', padding:12, gap:8, backgroundColor:'#F8F9FA', borderBottomWidth:1, borderColor:'#eee'},
  filterInput:        {flex:1, borderWidth:1, borderColor:'#ddd', borderRadius:8, paddingHorizontal:12, paddingVertical:8, backgroundColor:'#fff', fontSize:14},
  cuisineTag:         {backgroundColor:'#FFF3E0', paddingHorizontal:8, paddingVertical:3, borderRadius:12},
  cuisineTagText:     {fontSize:11, color:ORANGE},
  bellBtn:          {position:'relative', padding:4},
  bellBadge:        {position:'absolute', top:0, right:0, backgroundColor:'#f44336', borderRadius:8, minWidth:16, height:16, alignItems:'center', justifyContent:'center'},
  bellBadgeText:    {color:'#fff', fontSize:9, fontWeight:'bold'},
  notifItem:        {flexDirection:'row', padding:16, borderBottomWidth:1, borderColor:'#f0f0f0', alignItems:'flex-start'},
  notifItemUnread:  {backgroundColor:'#FFF8F0'},
  notifIcon:        {fontSize:24, width:36},
  notifTitle:       {fontSize:14, color:'#333', marginBottom:2},
  notifBody:        {fontSize:13, color:'#666', lineHeight:18},
  notifTime:        {fontSize:11, color:'#999', marginTop:4},
  notifDot:         {width:8, height:8, borderRadius:4, backgroundColor:ORANGE, marginTop:6},
  subTabBar:        {flexDirection:'row', backgroundColor:'#fff', borderBottomWidth:1, borderColor:'#eee'},
  subTab:           {flex:1, padding:14, alignItems:'center'},
  subTabActive:     {borderBottomWidth:2, borderBottomColor:ORANGE},
  subTabText:       {fontSize:14, color:'#999', fontWeight:'600'},
  subTabTextActive: {color:ORANGE},
  trustHero:        {alignItems:'center', padding:32, backgroundColor:'#fff', borderBottomWidth:1, borderColor:'#eee'},
  trustScore:       {fontSize:64, fontWeight:'bold', color:DARK},
  trustLabel:       {fontSize:14, color:'#888', marginTop:4},
  dimRow:           {flexDirection:'row', alignItems:'center', marginBottom:16},
  dimIcon:          {fontSize:20, width:30},
  dimLabel:         {fontSize:14, color:'#555'},
  dimScore:         {fontSize:14, fontWeight:'700', color:DARK},
  dimBar:           {height:8, backgroundColor:'#f0f0f0', borderRadius:4, overflow:'hidden'},
  dimFill:          {height:8, borderRadius:4},
  emptySubtext:       {fontSize:13, color:'#bbb', textAlign:'center', marginTop:4, paddingHorizontal:40},
  logoutBtn:          {marginTop:32,backgroundColor:'#f44336',padding:16,borderRadius:10,width:'100%',alignItems:'center'},
});

const ag = StyleSheet.create({
  container:      {flex:1, backgroundColor:'#fff'},
  header:         {backgroundColor:DARK, padding:16, paddingTop:50, alignItems:'center'},
  closeBtn:       {position:'absolute', top:50, left:16, padding:8},
  closeBtnText:   {color:'#fff', fontSize:18},
  headerTitle:    {color:'#fff', fontSize:18, fontWeight:'bold', marginBottom:8},
  statusPill:     {paddingHorizontal:12, paddingVertical:4, borderRadius:12},
  scroll:         {flex:1},
  body:           {padding:20},
  docTitle:       {fontSize:18, fontWeight:'bold', textAlign:'center', color:DARK, marginBottom:8},
  docSubtitle:    {fontSize:13, textAlign:'center', color:'#666', marginBottom:24},
  section:        {marginBottom:24, borderBottomWidth:1, borderColor:'#f0f0f0', paddingBottom:16},
  sectionTitle:   {fontSize:13, fontWeight:'800', color:DARK, letterSpacing:1, marginBottom:12},
  sectionText:    {fontSize:14, color:'#444', marginBottom:2},
  termRow:        {flexDirection:'row', justifyContent:'space-between', paddingVertical:8, borderBottomWidth:1, borderColor:'#f8f8f8'},
  termLabel:      {fontSize:14, color:'#888'},
  termValue:      {fontSize:14, fontWeight:'600', color:'#333', textAlign:'right', flex:1, marginLeft:16},
  clauseText:     {fontSize:13, color:'#555', lineHeight:20, marginBottom:8},
  sigRow:         {flexDirection:'row', gap:16},
  sigBlock:       {flex:1, backgroundColor:'#F8F9FA', borderRadius:12, padding:16, alignItems:'center'},
  sigLabel:       {fontSize:11, color:'#888', fontWeight:'600', marginBottom:4},
  sigName:        {fontSize:14, fontWeight:'bold', color:DARK, marginBottom:4, textAlign:'center'},
  sigDate:        {fontSize:12, color:GREEN, fontWeight:'600'},
  sigPending:     {fontSize:12, color:'#999'},
  legalNote:      {fontSize:11, color:'#999', textAlign:'center', lineHeight:16, marginTop:8, marginBottom:40},
  footer:         {padding:16, borderTopWidth:1, borderColor:'#eee', backgroundColor:'#fff'},
  scrollHint:     {textAlign:'center', color:'#999', fontSize:12, marginBottom:8},
  signBtn:        {backgroundColor:DARK, padding:16, borderRadius:12, alignItems:'center', marginBottom:8},
  signBtnDisabled:{backgroundColor:'#ccc'},
  signBtnText:    {color:'#fff', fontSize:16, fontWeight:'bold'},
  signedBanner:   {backgroundColor:'#E8F5E9', borderRadius:12, padding:16, marginBottom:8, alignItems:'center'},
  signedBannerText:{color:'#2E7D32', fontWeight:'600', textAlign:'center'},
  closeFooterBtn: {padding:12, alignItems:'center'},
  closeFooterText:{color:'#999', fontSize:14},
});
