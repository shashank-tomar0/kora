import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, BorderWidth, Shadows } from '../constants/theme';
import { NBCard, NBButton, NBDivider, SectionHeader } from '../components/NBComponents';

interface OnboardingScreenProps {
  apiBaseUrl: string;
  userId: string;
  onComplete: (profile: UserProfile) => void;
}

export interface UserProfile {
  name: string;
  college: string;
  branch: string;
  year: string;
}

const COLLEGES = ['IIT Madras', 'IIT Bombay', 'IIT Delhi', 'IIT Kharagpur', 'NIT Trichy', 'VIT Vellore', 'BITS Pilani', 'Other'];
const BRANCHES = ['Computer Science', 'Electronics & Comm', 'Mechanical', 'Civil', 'Electrical', 'Data Science', 'Chemical', 'Other'];
const YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year', 'PG – 1st Year', 'PG – 2nd Year'];

export default function OnboardingScreen({ apiBaseUrl, userId, onComplete }: OnboardingScreenProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [college, setCollege] = useState('');
  const [branch, setBranch] = useState('');
  const [year, setYear] = useState('');
  const [loading, setLoading] = useState(false);

  const steps = ['name', 'college', 'branch', 'year'];
  const stepTitles = ['WHAT\'S YOUR\nNAME?', 'YOUR\nCOLLEGE?', 'YOUR\nBRANCH?', 'WHICH\nYEAR?'];

  const handleNext = async () => {
    if (step < steps.length - 1) {
      setStep(s => s + 1);
      return;
    }
    // Final step – submit
    if (!name || !college || !branch || !year) {
      Alert.alert('Incomplete', 'Please fill all fields.');
      return;
    }
    setLoading(true);
    const profile: UserProfile = { name, college, branch, year };
    try {
      await fetch(`${apiBaseUrl}/api/users/${userId}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
    } catch { /* proceed anyway */ }
    finally { setLoading(false); }
    onComplete(profile);
  };

  const canNext = [
    name.trim().length > 0,
    college.length > 0,
    branch.length > 0,
    year.length > 0,
  ][step];

  return (
    <SafeAreaView style={styles.safe}>
      {/* Progress Bar */}
      <View style={styles.progressBar}>
        {steps.map((_, i) => (
          <View
            key={i}
            style={[styles.progressSegment, { backgroundColor: i <= step ? Colors.gold : Colors.bgElevated }]}
          />
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {step > 0 && (
          <TouchableOpacity onPress={() => setStep(s => s - 1)} style={styles.backBtn}>
            <Text style={styles.backText}>← BACK</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.stepLabel}>STEP {step + 1} OF {steps.length}</Text>
        <Text style={styles.title}>{stepTitles[step]}</Text>
        <NBDivider color={Colors.gold} style={{ marginVertical: Spacing.lg }} />

        {/* STEP 0 – Name */}
        {step === 0 && (
          <NBCard>
            <Text style={styles.inputLabel}>FULL NAME</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Arjun Sharma"
              placeholderTextColor={Colors.textMuted}
              value={name}
              onChangeText={setName}
              autoFocus
              autoCapitalize="words"
            />
          </NBCard>
        )}

        {/* STEP 1 – College */}
        {step === 1 && (
          <View style={{ gap: Spacing.sm }}>
            {COLLEGES.map(c => (
              <TouchableOpacity
                key={c}
                onPress={() => setCollege(c)}
                style={[styles.optionCard, college === c && styles.optionCardSelected]}
              >
                <Text style={[styles.optionText, college === c && { color: Colors.textInverse }]}>{c}</Text>
                {college === c && <Text style={styles.checkMark}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* STEP 2 – Branch */}
        {step === 2 && (
          <View style={{ gap: Spacing.sm }}>
            {BRANCHES.map(b => (
              <TouchableOpacity
                key={b}
                onPress={() => setBranch(b)}
                style={[styles.optionCard, branch === b && styles.optionCardSelected]}
              >
                <Text style={[styles.optionText, branch === b && { color: Colors.textInverse }]}>{b}</Text>
                {branch === b && <Text style={styles.checkMark}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* STEP 3 – Year */}
        {step === 3 && (
          <View style={{ gap: Spacing.sm }}>
            {YEARS.map(y => (
              <TouchableOpacity
                key={y}
                onPress={() => setYear(y)}
                style={[styles.optionCard, year === y && styles.optionCardSelected]}
              >
                <Text style={[styles.optionText, year === y && { color: Colors.textInverse }]}>{y}</Text>
                {year === y && <Text style={styles.checkMark}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        )}

        <NBButton
          label={loading ? 'Setting up...' : step === steps.length - 1 ? 'Enter Kora →' : 'Next →'}
          onPress={handleNext}
          disabled={!canNext || loading}
          size="lg"
          style={{ marginTop: Spacing.xl }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  progressBar: {
    flexDirection: 'row',
    gap: 4,
    padding: Spacing.md,
    paddingBottom: 0,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  container: {
    padding: Spacing.xl,
    gap: 0,
  },
  backBtn: { marginBottom: Spacing.lg },
  backText: {
    fontFamily: 'JetBrainsMono_500Medium',
    color: Colors.gold,
    fontSize: 12,
    letterSpacing: 2,
  },
  stepLabel: {
    fontFamily: 'JetBrainsMono_400Regular',
    color: Colors.textMuted,
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: Spacing.sm,
  },
  title: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 40,
    color: Colors.textPrimary,
    letterSpacing: 2,
    textTransform: 'uppercase',
    lineHeight: 46,
  },
  inputLabel: {
    fontFamily: 'JetBrainsMono_700Bold',
    color: Colors.gold,
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: Spacing.sm,
  },
  input: {
    fontFamily: 'DMSans_500Medium',
    color: Colors.textPrimary,
    fontSize: 22,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    backgroundColor: Colors.bgElevated,
    padding: Spacing.md,
  },
  optionCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.bgCard,
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    padding: Spacing.md,
    ...Shadows.brutalSm,
  },
  optionCardSelected: {
    backgroundColor: Colors.gold,
    borderColor: Colors.border,
    ...Shadows.brutal,
  },
  optionText: {
    fontFamily: 'DMSans_500Medium',
    color: Colors.textPrimary,
    fontSize: 15,
  },
  checkMark: {
    fontFamily: 'JetBrainsMono_700Bold',
    color: Colors.textInverse,
    fontSize: 16,
  },
});
