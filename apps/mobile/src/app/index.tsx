import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity, Platform, LogBox
} from 'react-native';

LogBox.ignoreLogs([
  'expo-notifications: Android Push notifications',
  '[expo-av]: Expo AV has been deprecated',
]);

import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts } from 'expo-font';
import {
  DMSans_400Regular, DMSans_500Medium, DMSans_700Bold
} from '@expo-google-fonts/dm-sans';
import {
  SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold
} from '@expo-google-fonts/space-grotesk';
import {
  JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold
} from '@expo-google-fonts/jetbrains-mono';
import {
  CormorantGaramond_400Regular, CormorantGaramond_500Medium, CormorantGaramond_700Bold
} from '@expo-google-fonts/cormorant-garamond';
import { MessageSquare, BookOpen, DollarSign, Calendar, User, Zap, Timer, Bell } from 'lucide-react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

import { Colors, Typography, Spacing, BorderWidth, Shadows } from '../constants/theme';
import AuthScreen from '../screens/AuthScreen';
import OnboardingScreen, { UserProfile } from '../screens/OnboardingScreen';
import ChatTab from '../screens/ChatTab';
import StudyTab from '../screens/StudyTab';
import ExpensesTab from '../screens/ExpensesTab';
import ScheduleTab from '../screens/ScheduleTab';
import ProfileTab from '../screens/ProfileTab';
import PomodoroTab from '../screens/PomodoroTab';

const API_DEFAULT = 'http://192.168.1.5:8000';

// ── Push Notification Configuration ────────────────────────────
// SDK 54 / expo-notifications 0.32.x: all 5 fields required for foreground display
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,   // Required SDK 53+ — shows heads-up banner
    shouldShowList: true,     // Required SDK 53+ — shows in notification tray
  }),
});

// Android 8+ requires a notification channel for notifications to appear.
// This runs once at startup — safe to call multiple times (idempotent).
async function setupAndroidChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('kora-default', {
      name: 'Kora Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#C9A84C',
      sound: 'default',
      description: 'Deadline reminders, study alerts, and Kora messages',
    });
  }
}
setupAndroidChannel();

async function registerForPushNotifications(): Promise<string | null> {
  try {
    // SDK 53+: Push notifications removed from Expo Go on Android.
    // Remote tokens only work in development builds or production.
    // Local notifications (scheduleNotificationAsync) still work in Expo Go.
    if (!Device.isDevice) {
      console.log('[Kora] Not a physical device — skipping push token registration.');
      return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;

    // getExpoPushTokenAsync requires an EAS projectId — skip gracefully in dev
    // without EAS config to avoid the "failed to download remote update" error
    try {
      const Constants = (await import('expo-constants')).default;
      const projectId = Constants.expoConfig?.extra?.eas?.projectId
        ?? Constants.easConfig?.projectId;
      if (!projectId) {
        // No EAS project configured — local notifications still work fine
        console.log('[Kora] No EAS projectId found — skipping remote push token registration.');
        return null;
      }
      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      return tokenData.data;
    } catch (tokenErr) {
      // Push token fetch failed (no network / no EAS) — safe to ignore in dev
      console.log('[Kora] Push token fetch skipped:', tokenErr);
      return null;
    }
  } catch {
    return null;
  }
}

export default function App() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular, DMSans_500Medium, DMSans_700Bold,
    SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold,
    CormorantGaramond_400Regular, CormorantGaramond_500Medium, CormorantGaramond_700Bold
  });

  const [appState, setAppState] = useState<'loading' | 'auth' | 'onboarding' | 'main'>('loading');
  const [apiBaseUrl, setApiBaseUrl] = useState(API_DEFAULT);
  const [userId, setUserId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [unreadNotifs, setUnreadNotifs] = useState(2);

  // Bottom Nav
  const [activeTab, setActiveTab] = useState<'chat' | 'study' | 'pomodoro' | 'expenses' | 'schedule' | 'profile'>('chat');

  // Gamification & Data States
  const [xp, setXp] = useState(120);
  const [level, setLevel] = useState(1);
  const [streak, setStreak] = useState(3);
  const [isSpeechEnabled, setIsSpeechEnabled] = useState(true);

  // Mock / Fetched Data Lists
  const [schedule, setSchedule] = useState([
    { id: 'c1', day: 0, subject: 'Computer Science 101', time: '09:00 AM - 10:30 AM', room: 'CS102' },
    { id: 'c2', day: 1, subject: 'Engineering Mathematics', time: '11:00 AM - 12:30 PM', room: 'LH-3' },
    { id: 'c3', day: 2, subject: 'Data Structures Lab', time: '02:00 PM - 05:00 PM', room: 'Lab-A' },
  ]);
  const [deadlines, setDeadlines] = useState([
    { id: 'd1', subject: 'Data Structures', title: 'Lab Assignment #4', due: 'Tonight 11:59 PM' },
    { id: 'd2', subject: 'Mathematics', title: 'Mid-term Quiz prep', due: 'June 10' }
  ]);
  const [expenses, setExpenses] = useState([
    { id: 'e1', amount: 120, description: 'Canteen Coffee & Snacks', date: 'Today', category: 'Food' },
    { id: 'e2', amount: 450, description: 'Syllabus Xerox Copy', date: 'Yesterday', category: 'Study' }
  ]);
  const [owedToYou, setOwedToYou] = useState([
    { id: 's1', friend: 'karan.verma@iitm.ac.in', amount: 150, description: 'Canteen lunch' }
  ]);
  const [youOwe, setYouOwe] = useState([
    { id: 's2', friend: 'rahul.s@iitm.ac.in', amount: 80, description: 'Auto ride split' }
  ]);
  const [flashcards, setFlashcards] = useState([
    { id: 'f1', subject: 'Operating Systems', front: 'What is a Semaphore?', back: 'A variable or abstract data type used to control access to a common resource by multiple processes in a concurrent system.' },
    { id: 'f2', subject: 'Machine Learning', front: 'Define Bias-Variance Tradeoff', back: 'The conflict in trying to simultaneously minimize bias error (underfitting) and variance error (overfitting) when training models.' }
  ]);
  const [roadmaps, setRoadmaps] = useState([
    {
      id: 'r1',
      title: 'Operating Systems Syllabus',
      description: 'Core concepts required for mid-semester exams.',
      steps: ['Processes & Threads', 'CPU Scheduling Alg', 'Deadlocks avoidance', 'Memory Management & Paging', 'Virtual Memory & File Systems'],
      currentStep: 2
    }
  ]);
  const [quests, setQuests] = useState([
    { id: 'q1', text: '📚 Review 5 Flashcards', xp: 50, done: false },
    { id: 'q2', text: '🥗 Log meals under ₹150', xp: 30, done: true },
    { id: 'q3', text: '⏱️ Complete Pomodoro session', xp: 100, done: false },
  ]);
  const [badges, setBadges] = useState([
    { id: 'b1', name: 'Early Bird', desc: 'Study before 6 AM', icon: '🦉', unlocked: false },
    { id: 'b2', name: 'Second Brain', desc: 'Index 5 Whiteboard scans to RAG', icon: '🧠', unlocked: true },
    { id: 'b3', name: 'Debt Free', desc: 'Settle all outstanding debts', icon: '💸', unlocked: false },
    { id: 'b4', name: 'Attendance Master', desc: 'Maintain 100% attendance in course', icon: '🏆', unlocked: false }
  ]);

  const notifListenerRef = useRef<any>(null);

  useEffect(() => {
    loadCachedSession();
  }, []);

  // Register push notifications when entering main app
  useEffect(() => {
    if (appState === 'main' && !pushToken) {
      registerForPushNotifications().then(token => {
        if (token) {
          setPushToken(token);
          // Register token with backend
          fetch(`${apiBaseUrl}/api/users/${userId}/push-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          }).catch(() => {});
        }
      });

      // Listen for incoming notifications
      notifListenerRef.current = Notifications.addNotificationReceivedListener(_notification => {
        setUnreadNotifs(prev => prev + 1);
      });
    }
    return () => {
      if (notifListenerRef.current) {
        notifListenerRef.current.remove();
      }
    };
  }, [appState, userId]);

  const scheduleDeadlineNotification = async (title: string, dueDate: string) => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '⏰ Deadline Alert',
          body: `${title} is due: ${dueDate}`,
          sound: true,
          data: { type: 'deadline' },
          // Android: must reference the channel we created at startup
          ...(Platform.OS === 'android' ? { channelId: 'kora-default' } : {}),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 2, repeats: false },
      });
    } catch {}
  };

  const loadCachedSession = async () => {
    try {
      const cachedUserId = await AsyncStorage.getItem('kora_user_id');
      const cachedEmail = await AsyncStorage.getItem('kora_email');
      const cachedProfile = await AsyncStorage.getItem('kora_profile');
      const cachedApi = await AsyncStorage.getItem('kora_api_url');

      if (cachedApi) setApiBaseUrl(cachedApi);

      if (cachedUserId) {
        setUserId(cachedUserId);
        setUserEmail(cachedEmail || '');
        if (cachedProfile) {
          setProfile(JSON.parse(cachedProfile));
          setAppState('main');
        } else {
          setAppState('onboarding');
        }
      } else {
        setAppState('auth');
      }
    } catch {
      setAppState('auth');
    }
  };

  const handleLoginSuccess = async (uId: string, email: string) => {
    setUserId(uId);
    setUserEmail(email);
    await AsyncStorage.setItem('kora_user_id', uId);
    await AsyncStorage.setItem('kora_email', email);

    // Check if profile exists on server
    try {
      const res = await fetch(`${apiBaseUrl}/api/users/${uId}/profile`);
      if (res.ok) {
        const data = await res.json();
        if (data.name) {
          setProfile(data);
          await AsyncStorage.setItem('kora_profile', JSON.stringify(data));
          setAppState('main');
          return;
        }
      }
    } catch {}
    setAppState('onboarding');
  };

  const handleOnboardingComplete = async (userProfile: UserProfile) => {
    setProfile(userProfile);
    await AsyncStorage.setItem('kora_profile', JSON.stringify(userProfile));
    setAppState('main');
  };

  const handleLogout = async () => {
    await AsyncStorage.clear();
    setUserId('');
    setUserEmail('');
    setProfile(null);
    setAppState('auth');
  };

  const fetchAppData = async () => {
    if (!userId) return;
    try {
      // Sync stats, lists from backend
      const res = await fetch(`${apiBaseUrl}/api/users/${userId}/dashboard`);
      if (res.ok) {
        const data = await res.json();
        if (data.schedule) setSchedule(data.schedule);
        if (data.deadlines) setDeadlines(data.deadlines);
        if (data.expenses) setExpenses(data.expenses);
        if (data.flashcards) setFlashcards(data.flashcards);
        if (data.roadmaps) setRoadmaps(data.roadmaps);
        if (data.xp) setXp(data.xp);
        if (data.level) setLevel(data.level);
        if (data.streak) setStreak(data.streak);
        if (data.owedToYou) setOwedToYou(data.owedToYou);
        if (data.youOwe) setYouOwe(data.youOwe);
        if (data.quests) setQuests(data.quests);
      }
    } catch {}
  };

  const handleUpdateApiUrl = async (newUrl: string) => {
    setApiBaseUrl(newUrl);
    await AsyncStorage.setItem('kora_api_url', newUrl);
  };

  if (!fontsLoaded || appState === 'loading') {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={Colors.gold} />
        <Text style={styles.loadingText}>RESTING CYCLES...</Text>
      </View>
    );
  }

  if (appState === 'auth') {
    return <AuthScreen apiBaseUrl={apiBaseUrl} onLoginSuccess={handleLoginSuccess} />;
  }

  if (appState === 'onboarding') {
    return <OnboardingScreen apiBaseUrl={apiBaseUrl} userId={userId} onComplete={handleOnboardingComplete} />;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.appContainer}>
        {/* Global Neo-Brutalist Top Dashboard Header */}
        <View style={styles.dashboardHeader}>
          <View style={styles.headerLeft}>
            <Text style={styles.brandTitle}>KORA</Text>
            <Text style={styles.brandSubtitle}>AI COMPANION</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.headerStatBadge}>
              <Zap size={14} color={Colors.gold} fill={Colors.gold} />
              <Text style={styles.headerStatText}>{streak}D</Text>
            </View>
            <View style={[styles.headerStatBadge, { borderColor: Colors.success }]}>
              <Text style={[styles.headerStatText, { color: Colors.success }]}>{xp} XP</Text>
            </View>
            <TouchableOpacity
              style={[styles.headerStatBadge, { borderColor: unreadNotifs > 0 ? Colors.gold : Colors.border }]}
              onPress={() => {
                setUnreadNotifs(0);
                Alert.alert('🔔 Notifications', 'No new alerts right now. Deadlines and quest reminders will appear here.');
              }}
            >
              <Bell size={14} color={unreadNotifs > 0 ? Colors.gold : Colors.textMuted} />
              {unreadNotifs > 0 && (
                <Text style={[styles.headerStatText, { color: Colors.gold }]}>{unreadNotifs}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Tab Router Switch */}
        <View style={{ flex: 1 }}>
          {activeTab === 'chat' && (
            <ChatTab
              apiBaseUrl={apiBaseUrl}
              userId={userId}
              isSpeechEnabled={isSpeechEnabled}
              setIsSpeechEnabled={setIsSpeechEnabled}
              onRefreshData={fetchAppData}
            />
          )}
          {activeTab === 'study' && (
            <StudyTab
              apiBaseUrl={apiBaseUrl}
              userId={userId}
              flashcards={flashcards}
              roadmaps={roadmaps}
              onRefreshData={fetchAppData}
            />
          )}
          {activeTab === 'pomodoro' && (
            <PomodoroTab
              userId={userId}
              apiBaseUrl={apiBaseUrl}
              streak={streak}
              onXpEarned={(earned) => setXp(prev => prev + earned)}
            />
          )}
          {activeTab === 'expenses' && (
            <ExpensesTab
              apiBaseUrl={apiBaseUrl}
              userId={userId}
              expenses={expenses}
              owedToYou={owedToYou}
              youOwe={youOwe}
              onRefreshData={fetchAppData}
            />
          )}
          {activeTab === 'schedule' && (
            <ScheduleTab
              apiBaseUrl={apiBaseUrl}
              userId={userId}
              schedule={schedule}
              deadlines={deadlines}
              onRefreshData={fetchAppData}
            />
          )}
          {activeTab === 'profile' && (
            <ProfileTab
              apiBaseUrl={apiBaseUrl}
              userId={userId}
              profile={profile}
              xp={xp}
              level={level}
              streak={streak}
              quests={quests}
              badges={badges}
              isSpeechEnabled={isSpeechEnabled}
              setIsSpeechEnabled={setIsSpeechEnabled}
              onRefreshData={fetchAppData}
              onLogout={handleLogout}
              onUpdateApiUrl={handleUpdateApiUrl}
            />
          )}
        </View>

        {/* Bottom Tab Navigation Bar */}
        <View style={styles.bottomNav}>
          <TouchableOpacity
            style={[styles.navItem, activeTab === 'chat' && styles.navItemActive]}
            onPress={() => setActiveTab('chat')}
          >
            <MessageSquare size={18} color={activeTab === 'chat' ? Colors.textInverse : Colors.gold} />
            <Text style={[styles.navText, activeTab === 'chat' && { color: Colors.textInverse }]}>CHAT</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navItem, activeTab === 'study' && styles.navItemActive]}
            onPress={() => setActiveTab('study')}
          >
            <BookOpen size={18} color={activeTab === 'study' ? Colors.textInverse : Colors.gold} />
            <Text style={[styles.navText, activeTab === 'study' && { color: Colors.textInverse }]}>STUDY</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navItem, activeTab === 'pomodoro' && styles.navItemActive]}
            onPress={() => setActiveTab('pomodoro')}
          >
            <Timer size={18} color={activeTab === 'pomodoro' ? Colors.textInverse : Colors.gold} />
            <Text style={[styles.navText, activeTab === 'pomodoro' && { color: Colors.textInverse }]}>FOCUS</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navItem, activeTab === 'expenses' && styles.navItemActive]}
            onPress={() => setActiveTab('expenses')}
          >
            <DollarSign size={18} color={activeTab === 'expenses' ? Colors.textInverse : Colors.gold} />
            <Text style={[styles.navText, activeTab === 'expenses' && { color: Colors.textInverse }]}>SPLIT</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navItem, activeTab === 'schedule' && styles.navItemActive]}
            onPress={() => setActiveTab('schedule')}
          >
            <Calendar size={18} color={activeTab === 'schedule' ? Colors.textInverse : Colors.gold} />
            <Text style={[styles.navText, activeTab === 'schedule' && { color: Colors.textInverse }]}>CAL</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navItem, activeTab === 'profile' && styles.navItemActive]}
            onPress={() => setActiveTab('profile')}
          >
            <User size={18} color={activeTab === 'profile' ? Colors.textInverse : Colors.gold} />
            <Text style={[styles.navText, activeTab === 'profile' && { color: Colors.textInverse }]}>ME</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    backgroundColor: Colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
  },
  loadingText: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 12,
    letterSpacing: 2,
  },
  appContainer: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  dashboardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.bgCard,
    borderBottomWidth: BorderWidth.heavy,
    borderColor: Colors.border,
  },
  headerLeft: {
    gap: 2,
  },
  brandTitle: {
    ...Typography.display,
    color: Colors.textPrimary,
    fontSize: 22,
    letterSpacing: 4,
    lineHeight: 24,
  },
  brandSubtitle: {
    ...Typography.mono,
    color: Colors.gold,
    fontSize: 8,
    letterSpacing: 2,
  },
  headerRight: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  headerStatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    backgroundColor: Colors.bgElevated,
  },
  headerStatText: {
    ...Typography.monoBold,
    color: Colors.textPrimary,
    fontSize: 10,
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: Colors.bgCard,
    borderTopWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    paddingBottom: Platform.OS === 'ios' ? 12 : 0,
  },
  navItem: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRightWidth: BorderWidth.thin,
    borderColor: Colors.border,
  },
  navItemActive: {
    backgroundColor: Colors.gold,
  },
  navText: {
    ...Typography.monoBold,
    color: Colors.textSecondary,
    fontSize: 9,
    letterSpacing: 0.5,
  },
});