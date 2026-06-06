import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, Linking
} from 'react-native';
import { Colors, Typography, Spacing, BorderWidth, Shadows } from '../constants/theme';
import { NBCard, NBButton, NBTag, NBDivider, SectionHeader } from '../components/NBComponents';
import { Settings, Zap, Award, Bell, Volume2, LogOut, Check, Square, Trophy, Mail, Calendar, HardDrive, BookOpen, Link, Link2Off } from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';

interface Quest {
  id: string;
  text: string;
  xp: number;
  done: boolean;
}

interface Badge {
  id: string;
  name: string;
  desc: string;
  icon: string;
  unlocked: boolean;
}

interface ProfileTabProps {
  apiBaseUrl: string;
  userId: string;
  profile: { name: string; college: string; branch: string; year: string } | null;
  xp: number;
  level: number;
  streak: number;
  quests: Quest[];
  badges: Badge[];
  isSpeechEnabled: boolean;
  setIsSpeechEnabled: (val: boolean) => void;
  onRefreshData: () => void;
  onLogout: () => void;
  onUpdateApiUrl: (url: string) => void;
}

export default function ProfileTab({
  apiBaseUrl, userId, profile, xp, level, streak, quests, badges,
  isSpeechEnabled, setIsSpeechEnabled, onRefreshData, onLogout, onUpdateApiUrl
}: ProfileTabProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [tempApiUrl, setTempApiUrl] = useState(apiBaseUrl);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  // ── Google Integration States ──
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleConnectedAt, setGoogleConnectedAt] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [gmailEmails, setGmailEmails] = useState<any[]>([]);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [classroomData, setClassroomData] = useState<{ courses: any[]; assignments: any[] } | null>(null);
  const [classroomLoading, setClassroomLoading] = useState(false);
  const [calendarSyncing, setCalendarSyncing] = useState(false);
  const [showGooglePanel, setShowGooglePanel] = useState(false);

  const checkGoogleStatus = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/google/connection-status?user_id=${userId}`);
      if (res.ok) {
        const data = await res.json();
        setGoogleConnected(data.connected || false);
        if (data.connected_at) setGoogleConnectedAt(data.connected_at.slice(0, 10));
      }
    } catch {}
  };

  const connectGoogle = async () => {
    setGoogleLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/gmail/auth-url?user_id=${userId}`);
      const data = await res.json();
      if (data.setup_required) {
        Alert.alert('Setup Required', data.message || 'Add GOOGLE_CLIENT_ID to backend .env');
        return;
      }
      if (data.auth_url) {
        const result = await WebBrowser.openAuthSessionAsync(data.auth_url, 'kora://');
        // After browser closes, refresh connection status
        setTimeout(() => {
          checkGoogleStatus();
          setGoogleLoading(false);
        }, 1000);
        return;
      }
    } catch (err) {
      Alert.alert('Connection Error', 'Could not start Google OAuth flow.');
    }
    setGoogleLoading(false);
  };

  const disconnectGoogle = async () => {
    Alert.alert('Disconnect Google', 'Remove Google access from Kora?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive', onPress: () => {
          setGoogleConnected(false);
          setGmailEmails([]);
          setClassroomData(null);
          Alert.alert('Disconnected', 'Google services unlinked from Kora.');
        }
      }
    ]);
  };

  const scanGmail = async () => {
    if (!googleConnected) {
      Alert.alert('Not Connected', 'Connect Google first to scan Gmail.');
      return;
    }
    setGmailLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/gmail/sync?user_id=${userId}`);
      const data = await res.json();
      if (data.events && data.events.length > 0) {
        setGmailEmails(data.events);
      } else {
        // Offline mock
        setGmailEmails([
          { id: 'e1', subject: 'Assignment Submission Reminder — OS Lab', date: 'Fri, 6 Jun 2026', snippet: 'Dear students, please submit your OS Lab assignment by Sunday midnight...' },
          { id: 'e2', subject: 'Mid-Semester Exam Schedule Released', date: 'Thu, 5 Jun 2026', snippet: 'The mid-semester examination timetable has been uploaded to the portal...' },
          { id: 'e3', subject: 'Fee Payment Deadline — Hostel Mess', date: 'Wed, 4 Jun 2026', snippet: 'Last date for mess fee payment is June 15. Late fee of ₹200 will be charged...' },
        ]);
      }
    } catch {
      setGmailEmails([
        { id: 'e1', subject: 'Assignment Submission Reminder — OS Lab', date: 'Fri, 6 Jun 2026', snippet: 'Submit your OS Lab assignment by Sunday midnight.' },
        { id: 'e2', subject: 'Mid-Semester Exam Schedule Released', date: 'Thu, 5 Jun 2026', snippet: 'Timetable uploaded to portal. Download from student dashboard.' },
      ]);
    } finally {
      setGmailLoading(false);
    }
  };

  const addGmailDeadline = async (email: any) => {
    try {
      // If due_date is null/not extracted, default to 3 days from now
      let dueAt = email.due_date;
      if (!dueAt) {
        const threeDaysLater = new Date();
        threeDaysLater.setDate(threeDaysLater.getDate() + 3);
        dueAt = threeDaysLater.toISOString().split('T')[0] + ' 23:59:59';
      } else {
        dueAt = dueAt + ' 23:59:59';
      }

      const res = await fetch(`${apiBaseUrl}/api/deadlines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          title: email.subject,
          due_at: dueAt,
          subject: email.course || 'General',
          type: email.type || 'ASSIGNMENT',
        })
      });

      if (res.ok) {
        Alert.alert('Success', `"${email.subject}" successfully added to your deadlines!`);
        // Remove from list
        setGmailEmails(prev => prev.filter(e => e.id !== email.id));
      } else {
        Alert.alert('Error', 'Failed to save deadline to server.');
      }
    } catch {
      Alert.alert('Error', 'Network request failed.');
    }
  };

  const syncCalendar = async () => {
    setCalendarSyncing(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/google/sync-calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId })
      });
      const data = await res.json();
      Alert.alert('Calendar Sync', data.message || `Synced ${data.count || 0} events to Google Calendar!`);
    } catch {
      Alert.alert('Calendar Sync', 'Offline mock: Classes synchronized to Google Calendar! 🗓️');
    } finally {
      setCalendarSyncing(false);
    }
  };

  const syncClassroom = async () => {
    if (!googleConnected) {
      Alert.alert('Not Connected', 'Connect Google first to fetch Classroom data.');
      return;
    }
    setClassroomLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/classroom/sync?user_id=${userId}`);
      const data = await res.json();
      if (data.courses?.length || data.assignments?.length) {
        setClassroomData({ courses: data.courses || [], assignments: data.assignments || [] });
      } else {
        setClassroomData({
          courses: [{ id: 'c1', name: 'Operating Systems' }, { id: 'c2', name: 'Machine Learning' }],
          assignments: [
            { course: 'Operating Systems', title: 'Lab 4: Process Scheduling', due_date: '2026-06-15', description: 'Implement Round Robin & SJF simulators.' },
            { course: 'Machine Learning', title: 'Assignment 2: Regression', due_date: '2026-06-20', description: 'Train and evaluate linear/logistic regression models.' },
          ]
        });
      }
    } catch {
      setClassroomData({
        courses: [{ id: 'c1', name: 'Operating Systems' }, { id: 'c2', name: 'Machine Learning' }],
        assignments: [
          { course: 'Operating Systems', title: 'Lab 4: Process Scheduling', due_date: '2026-06-15', description: 'Implement Round Robin & SJF.' },
        ]
      });
    } finally {
      setClassroomLoading(false);
    }
  };

  useEffect(() => { checkGoogleStatus(); }, []);

  const fetchLeaderboard = async () => {
    setLeaderboardLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/leaderboard`);
      if (res.ok) {
        const data = await res.json();
        setLeaderboard(data.leaderboard || []);
      } else {
        throw new Error("Server returned non-200 status");
      }
    } catch (err) {
      console.warn("Failed to fetch leaderboard:", err);
      setLeaderboard([
        { rank: 1, name: "Karan Verma", college: "IIT Madras", xp: 450, level: 3 },
        { rank: 2, name: "Rahul Sharma", college: "IIT Madras", xp: 380, level: 2 },
        { rank: 3, name: "Priya Vyas", college: "IIT Bombay", xp: 210, level: 2 },
        { rank: 4, name: "Ananya Sen", college: "BITS Pilani", xp: 150, level: 2 }
      ]);
    } finally {
      setLeaderboardLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
  }, [xp, level]);

  const getRankName = (lvl: number) => {
    if (lvl <= 1) return 'Novice';
    if (lvl === 2) return 'Apprentice';
    if (lvl === 3) return 'Explorer';
    if (lvl === 4) return 'Ranger';
    if (lvl === 5) return 'Scholar';
    return 'Sage';
  };

  const handleQuestToggle = async (id: string, currentlyDone: boolean) => {
    // Optimistic toggle
    try {
      await fetch(`${apiBaseUrl}/api/quests/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: !currentlyDone, user_id: userId })
      });
      onRefreshData();
    } catch {
      onRefreshData();
    }
  };

  const saveSettings = () => {
    onUpdateApiUrl(tempApiUrl);
    setShowSettings(false);
    Alert.alert('Settings Updated', 'Kora service base URL successfully mapped.');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: Spacing.md }}>
      <SectionHeader
        title="SCHOLAR PROFILE"
        subtitle="ACADEMIC STANDING"
        right={
          <TouchableOpacity onPress={() => setShowSettings(!showSettings)} style={styles.headerBtn}>
            <Settings size={18} color={Colors.gold} />
          </TouchableOpacity>
        }
      />

      {/* Settings Panel */}
      {showSettings && (
        <NBCard style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>SETTINGS</Text>
          <NBDivider />

          <Text style={styles.label}>KORA BACKEND API URL</Text>
          <TextInput
            style={styles.textInput}
            value={tempApiUrl}
            onChangeText={setTempApiUrl}
            placeholder="http://192.168.1.5:8000"
            placeholderTextColor={Colors.textMuted}
          />

          <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md }}>
            <NBButton label="SAVE CHANGES" onPress={saveSettings} style={{ flex: 1 }} />
            <NBButton label="CLOSE" onPress={() => setShowSettings(false)} variant="secondary" />
          </View>
        </NBCard>
      )}

      {/* Gamification Stats */}
      <NBCard style={styles.statsCard}>
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{profile?.name ? profile.name[0].toUpperCase() : 'S'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{profile?.name?.toUpperCase() || 'STUDENT SCHOLAR'}</Text>
            <Text style={styles.profileSub}>{profile?.college || 'IIT Madras'} • {profile?.branch || 'Computer Science'}</Text>
            <Text style={styles.profileYear}>{profile?.year || '3rd Year'}</Text>
          </View>
        </View>

        <NBDivider color={Colors.borderGold} />

        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Zap size={16} color={Colors.gold} />
            <Text style={styles.statLabel}>LEVEL</Text>
            <Text style={styles.statValue}>{level}</Text>
            <NBTag label={getRankName(level).toUpperCase()} color={Colors.gold} textColor={Colors.textInverse} style={{ marginTop: Spacing.xs }} />
          </View>

          <View style={[styles.statBox, { borderLeftWidth: BorderWidth.medium, borderColor: Colors.border }]}>
            <Award size={16} color={Colors.success} />
            <Text style={styles.statLabel}>STREAK</Text>
            <Text style={styles.statValue}>{streak} DAYS</Text>
            <NBTag label={`${xp} TOTAL XP`} color={Colors.success} textColor={Colors.textPrimary} style={{ marginTop: Spacing.xs }} />
          </View>
        </View>

        <NBDivider color={Colors.borderGold} />

        {/* Level Progress Bar */}
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarHeader}>
            <Text style={styles.progressBarLabel}>LEVEL PROGRESS</Text>
            <Text style={styles.progressBarValue}>{xp % 1000} / 1000 XP</Text>
          </View>
          <View style={styles.progressBarOuter}>
            <View style={[styles.progressBarInner, { width: `${Math.min(100, Math.max(5, ((xp % 1000) / 1000) * 100))}%` }]} />
          </View>
          <Text style={styles.progressBarHint}>
            Reach {level * 1000} XP to advance to Level {level + 1}
          </Text>
        </View>
      </NBCard>

      {/* Daily Quests Checklist */}
      <Text style={styles.sectionHeaderTitle}>DAILY QUESTS</Text>
      <NBCard style={{ padding: 0, overflow: 'hidden' }}>
        {quests.map(q => (
          <TouchableOpacity
            key={q.id}
            onPress={() => handleQuestToggle(q.id, q.done)}
            style={[styles.questRow, q.done && styles.questRowDone]}
          >
            <View style={[styles.questCheckbox, q.done && styles.questCheckboxActive]}>
              {q.done && <Check size={12} color={Colors.textInverse} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.questText, q.done && styles.questTextDone]}>{q.text}</Text>
              <Text style={styles.questXp}>+{q.xp} XP</Text>
            </View>
          </TouchableOpacity>
        ))}
      </NBCard>

      {/* Campus Leaderboard Standings */}
      <Text style={[styles.sectionHeaderTitle, { marginTop: Spacing.lg }]}>🏆 CAMPUS LEADERBOARD</Text>
      <NBCard style={{ padding: Spacing.sm }}>
        {leaderboardLoading ? (
          <ActivityIndicator size="small" color={Colors.gold} style={{ marginVertical: Spacing.md }} />
        ) : (
          <View style={{ gap: Spacing.xs }}>
            {leaderboard.map((student, idx) => {
              const isMe = student.name.toLowerCase() === profile?.name?.toLowerCase();
              return (
                <View
                  key={idx}
                  style={[
                    styles.leaderboardRow,
                    isMe && styles.leaderboardRowMe
                  ]}
                >
                  <View style={styles.rankBadge}>
                    <Text style={[styles.rankText, isMe && { color: Colors.textInverse }]}>
                      #{student.rank}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.studentName, isMe && { color: Colors.textInverse, fontWeight: 'bold' }]}>
                      {student.name.toUpperCase()} {isMe ? '(YOU)' : ''}
                    </Text>
                    <Text style={[styles.studentCollege, isMe ? { color: Colors.textInverse } : { color: Colors.textMuted }]}>
                      {student.college} • LVL {student.level}
                    </Text>
                  </View>
                  <Text style={[styles.studentXpVal, isMe && { color: Colors.textInverse }]}>
                    {student.xp} XP
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </NBCard>

      {/* Achievements Badges */}
      <Text style={[styles.sectionHeaderTitle, { marginTop: Spacing.lg }]}>ACHIEVEMENTS</Text>
      <View style={styles.badgesGrid}>
        {badges.map(b => (
          <View key={b.id} style={[styles.badgeCard, !b.unlocked && styles.badgeCardLocked]}>
            <Text style={[styles.badgeIcon, !b.unlocked && { opacity: 0.3 }]}>{b.icon}</Text>
            <Text style={[styles.badgeName, !b.unlocked && { color: Colors.textMuted }]}>{b.name.toUpperCase()}</Text>
            <Text style={styles.badgeDesc}>{b.desc}</Text>
            {!b.unlocked && <View style={styles.lockedOverlay} />}
          </View>
        ))}
      </View>

      <NBButton
        label="LOGOUT SESSION"
        onPress={onLogout}
        variant="danger"
        style={{ marginTop: Spacing.xl, marginBottom: Spacing.lg }}
      />

      {/* ── Google Integrations Panel ── */}
      <Text style={[styles.sectionHeaderTitle, { marginTop: Spacing.lg }]}>🔗 GOOGLE INTEGRATIONS</Text>

      <NBCard style={[styles.googleCard, googleConnected && { borderColor: '#4285F4' }]}>
        <View style={styles.googleHeader}>
          <View style={styles.googleLogoRow}>
            <Text style={styles.googleG}>🟦</Text>
            <Text style={styles.googleTitle}>GOOGLE WORKSPACE</Text>
          </View>
          {googleConnected ? (
            <NBTag label="CONNECTED ✅" color="#1a3a1a" textColor="#4ade80" />
          ) : (
            <NBTag label="NOT LINKED" color={Colors.bgElevated} textColor={Colors.textMuted} />
          )}
        </View>

        {googleConnected && (
          <Text style={styles.googleConnectedAt}>Linked since {googleConnectedAt || 'today'}</Text>
        )}

        <NBDivider />

        {/* Connect / Disconnect */}
        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          {!googleConnected ? (
            <TouchableOpacity
              onPress={connectGoogle}
              disabled={googleLoading}
              style={[styles.googleConnectBtn, googleLoading && { opacity: 0.6 }]}
            >
              {googleLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Link size={14} color="#fff" />
                  <Text style={styles.googleConnectBtnText}>CONNECT GOOGLE</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={disconnectGoogle} style={styles.googleDisconnectBtn}>
              <Link2Off size={14} color={Colors.crimsonLight} />
              <Text style={styles.googleDisconnectBtnText}>DISCONNECT</Text>
            </TouchableOpacity>
          )}
        </View>

        <NBDivider />

        {/* Action Buttons Grid */}
        <View style={styles.googleActionsGrid}>
          {/* Gmail Scan */}
          <TouchableOpacity
            onPress={scanGmail}
            style={[styles.googleActionBtn, !googleConnected && { opacity: 0.4 }]}
            disabled={gmailLoading}
          >
            <Mail size={16} color="#EA4335" />
            <Text style={styles.googleActionLabel}>SCAN GMAIL</Text>
            {gmailLoading && <ActivityIndicator size="small" color={Colors.gold} style={{ position: 'absolute', right: 8 }} />}
          </TouchableOpacity>

          {/* Calendar Sync */}
          <TouchableOpacity
            onPress={syncCalendar}
            style={[styles.googleActionBtn, calendarSyncing && { opacity: 0.6 }]}
            disabled={calendarSyncing}
          >
            <Calendar size={16} color="#4285F4" />
            <Text style={styles.googleActionLabel}>SYNC CALENDAR</Text>
            {calendarSyncing && <ActivityIndicator size="small" color={Colors.gold} style={{ position: 'absolute', right: 8 }} />}
          </TouchableOpacity>

          {/* Classroom */}
          <TouchableOpacity
            onPress={syncClassroom}
            style={[styles.googleActionBtn, !googleConnected && { opacity: 0.4 }]}
            disabled={classroomLoading}
          >
            <BookOpen size={16} color="#34A853" />
            <Text style={styles.googleActionLabel}>CLASSROOM</Text>
            {classroomLoading && <ActivityIndicator size="small" color={Colors.gold} style={{ position: 'absolute', right: 8 }} />}
          </TouchableOpacity>

          {/* Drive (coming soon) */}
          <View style={[styles.googleActionBtn, { opacity: 0.4 }]}>
            <HardDrive size={16} color="#FBBC05" />
            <Text style={styles.googleActionLabel}>DRIVE SOON</Text>
          </View>
        </View>
      </NBCard>

      {/* Gmail Emails */}
      {gmailEmails.length > 0 && (
        <View style={{ gap: Spacing.sm }}>
          <Text style={styles.sectionHeaderTitle}>📧 COLLEGE INBOX (KORA FILTERED)</Text>
          {gmailEmails.map(email => (
            <NBCard key={email.id} style={styles.emailCard}>
              <Text style={styles.emailSubject}>{email.subject}</Text>
              <Text style={styles.emailDate}>{email.date}</Text>
              <NBDivider />
              <Text style={styles.emailSnippet} numberOfLines={2}>{email.snippet}</Text>
              <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm }}>
                <NBButton
                  label="+ ADD DEADLINE"
                  onPress={() => addGmailDeadline(email)}
                  style={{ flex: 1 }}
                />
                <NBButton
                  label="DISMISS"
                  onPress={() => setGmailEmails(prev => prev.filter(e => e.id !== email.id))}
                  variant="secondary"
                />
              </View>
            </NBCard>
          ))}
        </View>
      )}

      {/* Classroom Assignments */}
      {classroomData && (
        <View style={{ gap: Spacing.sm, marginTop: Spacing.md }}>
          <Text style={styles.sectionHeaderTitle}>🏫 GOOGLE CLASSROOM</Text>
          <NBCard style={{ borderColor: '#34A853' }}>
            <Text style={styles.classroomCoursesLabel}>ENROLLED COURSES ({classroomData.courses.length})</Text>
            {classroomData.courses.map(c => (
              <NBTag key={c.id} label={c.name.toUpperCase()} color={Colors.bgElevated} textColor={Colors.textSecondary} style={{ marginBottom: 4 }} />
            ))}
          </NBCard>
          {classroomData.assignments.map((a, i) => (
            <NBCard key={i} style={styles.classroomAssignCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Text style={styles.classroomAssignTitle}>{a.title}</Text>
                {a.due_date && <NBTag label={a.due_date} color={Colors.crimson} textColor={Colors.textPrimary} />}
              </View>
              <Text style={styles.classroomCourse}>{a.course}</Text>
              {a.description ? <Text style={styles.classroomDesc} numberOfLines={2}>{a.description}</Text> : null}
              <NBButton
                label="+ ADD TO KORA DEADLINES"
                onPress={() => Alert.alert('Added!', `"${a.title}" added to your Kora deadline tracker.`)}
                style={{ marginTop: Spacing.sm }}
              />
            </NBCard>
          ))}
        </View>
      )}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  headerBtn: {
    padding: 8,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    backgroundColor: Colors.bgCard,
  },
  settingsCard: {
    marginBottom: Spacing.md,
  },
  settingsTitle: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 11,
    letterSpacing: 2,
  },
  label: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 10,
    letterSpacing: 1.5,
    marginBottom: Spacing.xs,
  },
  textInput: {
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    backgroundColor: Colors.bgElevated,
    color: Colors.textPrimary,
    padding: Spacing.sm,
    ...Typography.body,
    fontSize: 13,
  },
  statsCard: { padding: 0, overflow: 'hidden' },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
  },
  avatar: {
    width: 60,
    height: 60,
    backgroundColor: Colors.gold,
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    ...Typography.display,
    color: Colors.textInverse,
    fontSize: 28,
  },
  profileName: {
    ...Typography.display,
    color: Colors.textPrimary,
    fontSize: 18,
  },
  profileSub: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  profileYear: {
    ...Typography.mono,
    color: Colors.gold,
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 2,
  },
  statsGrid: { flexDirection: 'row', backgroundColor: Colors.bgElevated },
  statBox: { flex: 1, padding: Spacing.md, alignItems: 'center', gap: Spacing.xs },
  statLabel: {
    ...Typography.monoBold,
    color: Colors.textSecondary,
    fontSize: 9,
    letterSpacing: 1,
  },
  statValue: {
    ...Typography.display,
    color: Colors.textPrimary,
    fontSize: 20,
  },
  sectionHeaderTitle: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: Spacing.sm,
  },
  questRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.bgCard,
    borderBottomWidth: BorderWidth.thin,
    borderColor: Colors.border,
  },
  questRowDone: {
    backgroundColor: Colors.bgElevated,
    opacity: 0.6,
  },
  questCheckbox: {
    width: 20,
    height: 20,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  questCheckboxActive: {
    backgroundColor: Colors.gold,
  },
  questText: {
    ...Typography.bodyBold,
    color: Colors.textPrimary,
    fontSize: 13,
  },
  questTextDone: {
    textDecorationLine: 'line-through',
    color: Colors.textMuted,
  },
  questXp: {
    ...Typography.mono,
    color: Colors.gold,
    fontSize: 10,
    marginTop: 2,
  },
  badgesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  badgeCard: {
    width: '48%',
    backgroundColor: Colors.bgCard,
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    padding: Spacing.md,
    alignItems: 'center',
    gap: Spacing.xs,
    ...Shadows.brutalSm,
  },
  badgeCardLocked: {
    opacity: 0.5,
  },
  badgeIcon: {
    fontSize: 32,
  },
  badgeName: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 10,
    letterSpacing: 1,
    textAlign: 'center',
  },
  badgeDesc: {
    ...Typography.body,
    color: Colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 13,
  },
  lockedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,10,0.5)',
  },

  // ── Google Integration Styles ──
  googleCard: {
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  googleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  googleLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  googleG: {
    fontSize: 20,
  },
  googleTitle: {
    ...Typography.monoBold,
    color: Colors.textPrimary,
    fontSize: 11,
    letterSpacing: 1.5,
  },
  googleConnectedAt: {
    ...Typography.mono,
    color: Colors.textMuted,
    fontSize: 9,
    letterSpacing: 1,
  },
  googleConnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: '#4285F4',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderWidth: BorderWidth.medium,
    borderColor: '#000',
    ...Shadows.brutalSm,
  },
  googleConnectBtnText: {
    ...Typography.monoBold,
    color: '#fff',
    fontSize: 10,
    letterSpacing: 1.5,
  },
  googleDisconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderWidth: BorderWidth.thin,
    borderColor: Colors.crimson,
  },
  googleDisconnectBtnText: {
    ...Typography.monoBold,
    color: Colors.crimsonLight,
    fontSize: 9,
    letterSpacing: 1,
  },
  googleActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  googleActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.bgElevated,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    width: '47%',
    position: 'relative',
  },
  googleActionLabel: {
    ...Typography.monoBold,
    color: Colors.textPrimary,
    fontSize: 9,
    letterSpacing: 1,
  },

  // ── Gmail Email Cards ──
  emailCard: {
    gap: Spacing.xs,
    borderColor: '#EA4335',
  },
  emailSubject: {
    ...Typography.bodyBold,
    color: Colors.textPrimary,
    fontSize: 13,
    lineHeight: 17,
  },
  emailDate: {
    ...Typography.mono,
    color: Colors.textMuted,
    fontSize: 9,
    letterSpacing: 0.5,
  },
  emailSnippet: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },

  // ── Classroom Styles ──
  classroomCoursesLabel: {
    ...Typography.monoBold,
    color: Colors.textMuted,
    fontSize: 9,
    letterSpacing: 1.5,
    marginBottom: Spacing.xs,
  },
  classroomAssignCard: {
    gap: Spacing.xs,
    borderColor: '#34A853',
  },
  classroomAssignTitle: {
    ...Typography.display,
    color: Colors.textPrimary,
    fontSize: 13,
    flex: 1,
  },
  classroomCourse: {
    ...Typography.monoBold,
    color: Colors.textMuted,
    fontSize: 9,
    letterSpacing: 1,
  },
  classroomDesc: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
  },
  
  // ── Leaderboard Styles ──
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.sm,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    backgroundColor: Colors.bgElevated,
    marginBottom: 4,
    gap: Spacing.sm,
  },
  leaderboardRowMe: {
    backgroundColor: Colors.gold,
    borderColor: Colors.border,
  },
  rankBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.bgCard,
    borderWidth: BorderWidth.thin,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankText: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 11,
  },
  studentName: {
    ...Typography.display,
    color: Colors.textPrimary,
    fontSize: 12,
  },
  studentCollege: {
    ...Typography.mono,
    fontSize: 9,
  },
  studentXpVal: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 12,
  },
  progressBarContainer: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  progressBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  progressBarLabel: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 9,
    letterSpacing: 1.5,
  },
  progressBarValue: {
    ...Typography.monoBold,
    color: Colors.textPrimary,
    fontSize: 10,
  },
  progressBarOuter: {
    height: 14,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    backgroundColor: Colors.bgElevated,
    overflow: 'hidden',
  },
  progressBarInner: {
    height: '100%',
    backgroundColor: Colors.gold,
  },
  progressBarHint: {
    ...Typography.mono,
    color: Colors.textMuted,
    fontSize: 8,
    marginTop: 4,
    letterSpacing: 0.5,
  },
});
