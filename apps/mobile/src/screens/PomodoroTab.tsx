import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Alert, ScrollView,
  Vibration
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Colors, Typography, Spacing, BorderWidth, Shadows } from '../constants/theme';
import { NBCard, NBButton, NBDivider, SectionHeader, NBTag } from '../components/NBComponents';
import { Play, Pause, RotateCcw, Coffee, BookOpen, Zap } from 'lucide-react-native';

interface PomodoroTabProps {
  userId: string;
  apiBaseUrl: string;
  streak: number;
  onXpEarned?: (xp: number) => void;
}

type PomodoroMode = 'work' | 'short_break' | 'long_break';

const DURATIONS: Record<PomodoroMode, number> = {
  work: 25 * 60,
  short_break: 5 * 60,
  long_break: 15 * 60,
};

const MODE_LABELS: Record<PomodoroMode, string> = {
  work: 'DEEP FOCUS',
  short_break: 'SHORT BREAK',
  long_break: 'LONG BREAK',
};

const MODE_COLORS: Record<PomodoroMode, string> = {
  work: Colors.gold,
  short_break: Colors.sageLight,
  long_break: Colors.cobaltLight,
};

const RING_SIZE = 240;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE * 2) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export default function PomodoroTab({ userId, apiBaseUrl, streak, onXpEarned }: PomodoroTabProps) {
  const [mode, setMode] = useState<PomodoroMode>('work');
  const [timeLeft, setTimeLeft] = useState(DURATIONS['work']);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionsCompleted, setSessionsCompleted] = useState(0);
  const [todaySessions, setTodaySessions] = useState(0);
  const [currentTask, setCurrentTask] = useState('');
  const [history, setHistory] = useState<{ mode: PomodoroMode; completedAt: string }[]>([]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const totalDuration = DURATIONS[mode];
  const progress = 1 - timeLeft / totalDuration;
  const strokeDashoffset = RING_CIRCUMFERENCE * (1 - progress);

  // Pulse animation when running
  useEffect(() => {
    if (isRunning) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.03, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRunning]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleComplete = useCallback(() => {
    setIsRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
    Vibration.vibrate([400, 200, 400]);

    const completedMode = mode;
    setHistory(prev => [{ mode: completedMode, completedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }, ...prev.slice(0, 9)]);

    if (completedMode === 'work') {
      const newSessions = sessionsCompleted + 1;
      setSessionsCompleted(newSessions);
      setTodaySessions(t => t + 1);
      onXpEarned?.(100);

      // After 4 pomodoros, suggest long break
      if (newSessions % 4 === 0) {
        Alert.alert(
          '🎯 4 Pomodoros Done!',
          'Great focus streak! Take a long break to recharge.',
          [
            { text: 'Long Break (15min)', onPress: () => switchMode('long_break') },
            { text: 'Keep Going', style: 'cancel' },
          ]
        );
      } else {
        Alert.alert(
          '✅ Session Complete!',
          `+100 XP earned. Take a 5-minute break.`,
          [
            { text: 'Short Break', onPress: () => switchMode('short_break') },
            { text: 'Next Focus', onPress: () => switchMode('work') },
          ]
        );
      }

      // Log to backend
      fetch(`${apiBaseUrl}/api/pomodoro/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, task: currentTask, xp: 100 }),
      }).catch(() => {});
    } else {
      Alert.alert('Break Over!', 'Ready to focus again?', [
        { text: "Let's Go!", onPress: () => switchMode('work') },
      ]);
    }
  }, [mode, sessionsCompleted, currentTask, userId, apiBaseUrl]);

  useEffect(() => {
    if (isRunning) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            handleComplete();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning, handleComplete]);

  const switchMode = (newMode: PomodoroMode) => {
    setIsRunning(false);
    setMode(newMode);
    setTimeLeft(DURATIONS[newMode]);
  };

  const toggleTimer = () => setIsRunning(prev => !prev);

  const resetTimer = () => {
    setIsRunning(false);
    setTimeLeft(DURATIONS[mode]);
  };

  const accentColor = MODE_COLORS[mode];

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: Spacing.md, paddingBottom: 32 }}>
      <SectionHeader title="POMODORO TIMER" subtitle="FOCUS ENGINE" />

      {/* Mode Selector */}
      <View style={styles.modeSelectorRow}>
        {(Object.keys(DURATIONS) as PomodoroMode[]).map(m => (
          <TouchableOpacity
            key={m}
            onPress={() => switchMode(m)}
            style={[styles.modeBtn, mode === m && { backgroundColor: MODE_COLORS[m], borderColor: Colors.border }]}
          >
            <Text style={[styles.modeBtnText, mode === m && { color: Colors.textInverse }]}>
              {m === 'work' ? 'FOCUS' : m === 'short_break' ? 'BREAK' : 'LONG'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Timer Ring */}
      <Animated.View style={[styles.ringWrapper, { transform: [{ scale: pulseAnim }] }]}>
        <View style={[styles.ringContainer, { borderColor: accentColor }]}>
          <Svg width={RING_SIZE} height={RING_SIZE} style={styles.svgRing}>
            {/* Background Track */}
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              stroke={Colors.bgElevated}
              strokeWidth={RING_STROKE}
              fill="transparent"
            />
            {/* Progress Arc */}
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              stroke={accentColor}
              strokeWidth={RING_STROKE}
              fill="transparent"
              strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="square"
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            />
          </Svg>

          {/* Center Content */}
          <View style={styles.ringCenter}>
            <Text style={[styles.timerLabel, { color: accentColor }]}>{MODE_LABELS[mode]}</Text>
            <Text style={[styles.timerDigits, { color: accentColor }]}>{formatTime(timeLeft)}</Text>
            <Text style={styles.timerSubtext}>
              {isRunning ? 'FOCUS IN PROGRESS' : timeLeft === DURATIONS[mode] ? 'READY' : 'PAUSED'}
            </Text>
          </View>
        </View>
      </Animated.View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity onPress={resetTimer} style={styles.ctrlBtn}>
          <RotateCcw size={20} color={Colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={toggleTimer}
          style={[styles.playBtn, { backgroundColor: accentColor }]}
        >
          {isRunning
            ? <Pause size={28} color={Colors.textInverse} />
            : <Play size={28} color={Colors.textInverse} />
          }
        </TouchableOpacity>

        <View style={[styles.ctrlBtn, { opacity: 0 }]} />
      </View>

      {/* Stats Row */}
      <NBCard style={{ marginTop: Spacing.lg }}>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Zap size={16} color={Colors.gold} />
            <Text style={styles.statVal}>{sessionsCompleted}</Text>
            <Text style={styles.statLbl}>TOTAL</Text>
          </View>
          <View style={[styles.statItem, { borderLeftWidth: BorderWidth.medium, borderColor: Colors.border }]}>
            <BookOpen size={16} color={Colors.sageLight} />
            <Text style={styles.statVal}>{todaySessions}</Text>
            <Text style={styles.statLbl}>TODAY</Text>
          </View>
          <View style={[styles.statItem, { borderLeftWidth: BorderWidth.medium, borderColor: Colors.border }]}>
            <Coffee size={16} color={Colors.cobaltLight} />
            <Text style={styles.statVal}>{streak}</Text>
            <Text style={styles.statLbl}>STREAK</Text>
          </View>
        </View>
      </NBCard>

      {/* Session History */}
      {history.length > 0 && (
        <View style={{ marginTop: Spacing.md }}>
          <Text style={styles.historyTitle}>SESSION LOG</Text>
          {history.slice(0, 5).map((h, i) => (
            <View key={i} style={styles.historyRow}>
              <View style={[styles.historyDot, { backgroundColor: MODE_COLORS[h.mode] }]} />
              <Text style={styles.historyMode}>{MODE_LABELS[h.mode]}</Text>
              <Text style={styles.historyTime}>{h.completedAt}</Text>
              {h.mode === 'work' && (
                <NBTag label="+100 XP" color={Colors.gold} textColor={Colors.textInverse} />
              )}
            </View>
          ))}
        </View>
      )}

      {/* Consistency Streak Visual */}
      <NBCard style={{ marginTop: Spacing.lg, alignItems: 'center', borderColor: Colors.gold }}>
        <Text style={styles.streakTitle}>🔥 CONSISTENCY STREAK</Text>
        <NBDivider color={Colors.gold} />
        <View style={styles.streakDots}>
          {Array.from({ length: 7 }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.streakDot,
                i < Math.min(streak, 7) && { backgroundColor: Colors.gold, borderColor: Colors.goldDark }
              ]}
            >
              <Text style={[styles.streakDotText, i < Math.min(streak, 7) && { color: Colors.textInverse }]}>
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.streakSubtext}>
          {streak >= 7
            ? '🏆 Perfect week! Keep the fire alive.'
            : `${streak} day${streak !== 1 ? 's' : ''} strong — keep going!`}
        </Text>
      </NBCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  modeSelectorRow: {
    flexDirection: 'row',
    marginBottom: Spacing.lg,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    ...Shadows.brutalSm,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: Colors.bgCard,
    borderRightWidth: BorderWidth.thin,
    borderColor: Colors.border,
  },
  modeBtnText: {
    ...Typography.monoBold,
    color: Colors.textSecondary,
    fontSize: 10,
    letterSpacing: 1,
  },

  ringWrapper: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  ringContainer: {
    width: RING_SIZE + 12,
    height: RING_SIZE + 12,
    borderWidth: BorderWidth.heavy,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bgCard,
    ...Shadows.brutalGold,
  },
  svgRing: {
    position: 'absolute',
  },
  ringCenter: {
    alignItems: 'center',
    gap: 4,
  },
  timerLabel: {
    ...Typography.monoBold,
    fontSize: 10,
    letterSpacing: 2,
  },
  timerDigits: {
    fontFamily: 'JetBrainsMono_700Bold',
    fontSize: 52,
    letterSpacing: 4,
    lineHeight: 60,
  },
  timerSubtext: {
    ...Typography.mono,
    color: Colors.textMuted,
    fontSize: 10,
    letterSpacing: 1.5,
  },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xl,
    marginBottom: Spacing.sm,
  },
  ctrlBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bgCard,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
  },
  playBtn: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    ...Shadows.brutal,
  },

  statsRow: {
    flexDirection: 'row',
    padding: 0,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  statVal: {
    ...Typography.display,
    color: Colors.textPrimary,
    fontSize: 22,
  },
  statLbl: {
    ...Typography.monoBold,
    color: Colors.textMuted,
    fontSize: 9,
    letterSpacing: 1,
  },

  historyTitle: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: Spacing.sm,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 8,
    borderBottomWidth: BorderWidth.thin,
    borderColor: Colors.border,
  },
  historyDot: {
    width: 8,
    height: 8,
    backgroundColor: Colors.textMuted,
  },
  historyMode: {
    ...Typography.mono,
    color: Colors.textSecondary,
    fontSize: 11,
    flex: 1,
  },
  historyTime: {
    ...Typography.mono,
    color: Colors.textMuted,
    fontSize: 10,
  },

  streakTitle: {
    ...Typography.display,
    color: Colors.textPrimary,
    fontSize: 14,
    letterSpacing: 2,
    marginBottom: Spacing.xs,
  },
  streakDots: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  streakDot: {
    width: 36,
    height: 36,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakDotText: {
    ...Typography.monoBold,
    color: Colors.textMuted,
    fontSize: 11,
  },
  streakSubtext: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
  },
});
