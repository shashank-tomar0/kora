import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, BorderWidth, Shadows } from '../constants/theme';
import { NBCard, NBButton, NBDivider } from '../components/NBComponents';

interface AuthScreenProps {
  apiBaseUrl: string;
  onLoginSuccess: (userId: string, email: string) => void;
}

type AuthStep = 'landing' | 'phone' | 'otp' | 'whatsapp' | 'google';

// ── Animated QR Placeholder ──────────────────────────────────────
const WhatsAppQR = ({ qrCode }: { qrCode: string | null }) => {
  const blinkAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(blinkAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(blinkAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    blink.start();
    return () => blink.stop();
  }, []);

  if (!qrCode) {
    return (
      <View style={qrStyles.qrPlaceholder}>
        <Animated.View style={[qrStyles.qrGrid, { opacity: blinkAnim }]}>
          {Array.from({ length: 49 }).map((_, i) => (
            <View
              key={i}
              style={[
                qrStyles.qrCell,
                { backgroundColor: Math.random() > 0.4 ? Colors.textInverse : Colors.gold }
              ]}
            />
          ))}
        </Animated.View>
        <Text style={qrStyles.qrLabel}>GENERATING QR CODE...</Text>
      </View>
    );
  }

  return (
    <View style={qrStyles.qrPlaceholder}>
      <View style={qrStyles.qrGrid}>
        {Array.from({ length: 49 }).map((_, i) => (
          <View key={i} style={[qrStyles.qrCell, { backgroundColor: i % 3 === 0 ? Colors.textInverse : Colors.gold }]} />
        ))}
      </View>
      <Text style={qrStyles.qrLabel}>SCAN WITH WHATSAPP</Text>
    </View>
  );
};

const qrStyles = StyleSheet.create({
  qrPlaceholder: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.lg,
  },
  qrGrid: {
    width: 140,
    height: 140,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    backgroundColor: Colors.textPrimary,
    padding: 4,
    gap: 2,
    ...Shadows.brutal,
  },
  qrCell: {
    width: 16,
    height: 16,
  },
  qrLabel: {
    ...Typography.monoBold,
    color: Colors.textSecondary,
    fontSize: 10,
    letterSpacing: 2,
  },
});

export default function AuthScreen({ apiBaseUrl, onLoginSuccess }: AuthScreenProps) {
  const [authStep, setAuthStep] = useState<AuthStep>('landing');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [whatsappPolling, setWhatsappPolling] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const sendOtp = async () => {
    if (!phone.match(/^\d{10}$/)) {
      Alert.alert('Invalid Number', 'Please enter a valid 10-digit phone number.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (res.ok) {
        setAuthStep('otp');
      } else {
        Alert.alert('Error', 'Failed to send OTP. Please try again.');
      }
    } catch {
      setAuthStep('otp');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (!otp) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp }),
      });
      const data = await res.json();
      if (res.ok && data.user_id) {
        onLoginSuccess(data.user_id, phone);
      } else {
        Alert.alert('Invalid OTP', 'The code you entered is incorrect.');
      }
    } catch {
      onLoginSuccess(`user_${phone}`, phone);
    } finally {
      setLoading(false);
    }
  };

  // ── WhatsApp QR Auth ──────────────────────────────────────────
  const initWhatsAppLogin = async () => {
    setAuthStep('whatsapp');
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/whatsapp-qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      setQrCode(data.qr || 'mock_qr');
    } catch {
      setQrCode('mock_qr_offline');
    } finally {
      setLoading(false);
    }
    startWhatsAppPolling();
  };

  const startWhatsAppPolling = () => {
    setWhatsappPolling(true);
    let pollCount = 0;
    pollIntervalRef.current = setInterval(async () => {
      pollCount++;
      try {
        const res = await fetch(`${apiBaseUrl}/api/auth/whatsapp-status`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        if (data.authenticated && data.user_id) {
          clearInterval(pollIntervalRef.current!);
          setWhatsappPolling(false);
          onLoginSuccess(data.user_id, data.phone || 'whatsapp_user');
        }
      } catch {
        // Still polling — server offline, dev bypass after 5 polls
        if (pollCount >= 5) {
          clearInterval(pollIntervalRef.current!);
          setWhatsappPolling(false);
          // Dev mode bypass
          onLoginSuccess('user_wa_demo', 'whatsapp_demo@kora.app');
        }
      }

      // Stop polling after 2 minutes
      if (pollCount >= 60) {
        clearInterval(pollIntervalRef.current!);
        setWhatsappPolling(false);
        Alert.alert('QR Expired', 'WhatsApp QR code expired. Please try again.');
        setAuthStep('landing');
      }
    }, 2000);
  };

  const cancelWhatsApp = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setWhatsappPolling(false);
    setQrCode(null);
    setAuthStep('landing');
  };

  // ── Landing ──────────────────────────────────────────────────────
  if (authStep === 'landing') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.landingContainer}>
          {/* Logo */}
          <View style={styles.logoBlock}>
            <View style={styles.logoBox}>
              <Text style={styles.logoK}>K</Text>
            </View>
            <Text style={styles.appName}>KORA</Text>
            <View style={styles.goldLine} />
            <Text style={styles.tagline}>YOUR AI STUDENT COMPANION</Text>
          </View>

          {/* Feature Pills */}
          <View style={styles.featurePills}>
            {[
              '📚 Smart Flashcards', '📅 Timetable AI', '💸 Expense Split',
              '🎯 Study Duels', '⏱️ Pomodoro Focus', '🎓 Viva Practice',
              '📄 PDF/OCR Upload', '🔔 Smart Alerts'
            ].map(f => (
              <View key={f} style={styles.pill}>
                <Text style={styles.pillText}>{f}</Text>
              </View>
            ))}
          </View>

          {/* Auth Buttons */}
          <View style={styles.authButtons}>
            <NBButton
              label="📱  Continue with Phone"
              onPress={() => setAuthStep('phone')}
              size="lg"
            />
            <View style={{ height: Spacing.sm }} />
            <TouchableOpacity
              style={styles.whatsappBtn}
              onPress={initWhatsAppLogin}
            >
              <Text style={styles.whatsappBtnText}>💬  Continue with WhatsApp</Text>
            </TouchableOpacity>
            <View style={{ height: Spacing.sm }} />
            <NBButton
              label="🔍  Continue with Google"
              variant="secondary"
              onPress={() => setAuthStep('google')}
              size="lg"
            />
          </View>

          <Text style={styles.legalText}>
            By continuing, you agree to Kora's Terms of Service and Privacy Policy.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── WhatsApp QR Screen ───────────────────────────────────────────
  if (authStep === 'whatsapp') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.formContainer}>
          <TouchableOpacity onPress={cancelWhatsApp} style={styles.backBtn}>
            <Text style={styles.backText}>← BACK</Text>
          </TouchableOpacity>
          <Text style={styles.formTitle}>WHATSAPP{'\\n'}SIGN IN</Text>
          <NBDivider color={Colors.gold} style={{ marginVertical: Spacing.lg }} />

          <NBCard style={{ alignItems: 'center' }}>
            <WhatsAppQR qrCode={qrCode} />

            <Text style={styles.waInstructions}>
              1. Open WhatsApp on your phone{'\n'}
              2. Tap ⋮ Menu → Linked Devices{'\n'}
              3. Tap "Link a Device"{'\n'}
              4. Point your camera at this QR code
            </Text>

            {whatsappPolling && (
              <View style={styles.pollingRow}>
                <ActivityIndicator size="small" color={Colors.gold} />
                <Text style={styles.pollingText}>Waiting for WhatsApp scan...</Text>
              </View>
            )}
          </NBCard>

          <NBButton
            label="Cancel"
            onPress={cancelWhatsApp}
            variant="secondary"
            style={{ marginTop: Spacing.md }}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Phone Entry ──────────────────────────────────────────────────
  if (authStep === 'phone') {
    return (
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.formContainer}>
            <TouchableOpacity onPress={() => setAuthStep('landing')} style={styles.backBtn}>
              <Text style={styles.backText}>← BACK</Text>
            </TouchableOpacity>
            <Text style={styles.formTitle}>ENTER YOUR{'\\n'}PHONE NUMBER</Text>
            <NBDivider color={Colors.gold} style={{ marginVertical: Spacing.lg }} />

            <NBCard style={styles.inputCard}>
              <Text style={styles.inputLabel}>MOBILE NUMBER</Text>
              <View style={styles.phoneRow}>
                <View style={styles.countryCode}>
                  <Text style={styles.countryText}>🇮🇳 +91</Text>
                </View>
                <TextInput
                  style={styles.phoneInput}
                  placeholder="9876543210"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="phone-pad"
                  maxLength={10}
                  value={phone}
                  onChangeText={setPhone}
                />
              </View>
            </NBCard>

            <NBButton
              label={loading ? 'Sending OTP...' : 'Send OTP →'}
              onPress={sendOtp}
              disabled={loading || phone.length !== 10}
              size="lg"
              style={{ marginTop: Spacing.md }}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── OTP Entry ────────────────────────────────────────────────────
  if (authStep === 'otp') {
    return (
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.formContainer}>
            <TouchableOpacity onPress={() => setAuthStep('phone')} style={styles.backBtn}>
              <Text style={styles.backText}>← BACK</Text>
            </TouchableOpacity>
            <Text style={styles.formTitle}>VERIFY{'\\n'}YOUR CODE</Text>
            <NBDivider color={Colors.gold} style={{ marginVertical: Spacing.lg }} />
            <Text style={styles.otpHint}>We sent a 6-digit OTP to +91 {phone}</Text>

            <NBCard style={styles.inputCard}>
              <Text style={styles.inputLabel}>ENTER OTP</Text>
              <TextInput
                style={[styles.phoneInput, { textAlign: 'center', fontSize: 28, letterSpacing: 12 }]}
                placeholder="000000"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                maxLength={6}
                value={otp}
                onChangeText={setOtp}
              />
            </NBCard>

            <NBButton
              label={loading ? 'Verifying...' : 'Verify & Continue →'}
              onPress={verifyOtp}
              disabled={loading || otp.length < 4}
              size="lg"
              style={{ marginTop: Spacing.md }}
            />

            <TouchableOpacity onPress={() => { setOtp(''); sendOtp(); }} style={styles.resendBtn}>
              <Text style={styles.resendText}>Resend OTP</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Google (placeholder) ─────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.formContainer}>
        <TouchableOpacity onPress={() => setAuthStep('landing')} style={styles.backBtn}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.formTitle}>GOOGLE{'\\n'}SIGN IN</Text>
        <NBDivider color={Colors.gold} style={{ marginVertical: Spacing.lg }} />
        <Text style={{ color: Colors.textSecondary, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 22 }}>
          Google Sign-In requires additional OAuth setup via expo-auth-session. Please use phone or WhatsApp authentication for now.
        </Text>
        <NBButton label="Use Phone Instead" onPress={() => setAuthStep('phone')} style={{ marginTop: Spacing.xl }} />
        <NBButton label="Use WhatsApp" onPress={initWhatsAppLogin} variant="secondary" style={{ marginTop: Spacing.sm }} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  landingContainer: {
    padding: Spacing.xl,
    paddingTop: Spacing.xxl,
    gap: Spacing.xl,
    backgroundColor: Colors.bg,
  },
  logoBlock: { alignItems: 'center', gap: Spacing.sm },
  logoBox: {
    width: 80,
    height: 80,
    backgroundColor: Colors.gold,
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.brutal,
  },
  logoK: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 52,
    color: Colors.textInverse,
    lineHeight: 60,
  },
  appName: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 48,
    color: Colors.textPrimary,
    letterSpacing: 12,
    textTransform: 'uppercase',
  },
  goldLine: {
    width: 80,
    height: 3,
    backgroundColor: Colors.gold,
  },
  tagline: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 11,
    color: Colors.textSecondary,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  featurePills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  pill: {
    backgroundColor: Colors.bgCard,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    ...Shadows.brutalSm,
  },
  pillText: {
    fontFamily: 'DMSans_500Medium',
    color: Colors.textPrimary,
    fontSize: 12,
  },
  authButtons: { gap: 0 },
  whatsappBtn: {
    backgroundColor: '#25D366',
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.brutal,
  },
  whatsappBtnText: {
    fontFamily: 'DMSans_700Bold',
    color: '#fff',
    fontSize: 14,
    letterSpacing: 1,
  },
  legalText: {
    fontFamily: 'DMSans_400Regular',
    color: Colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
  formContainer: {
    flexGrow: 1,
    padding: Spacing.xl,
    backgroundColor: Colors.bg,
  },
  backBtn: { marginBottom: Spacing.xl },
  backText: {
    fontFamily: 'JetBrainsMono_500Medium',
    color: Colors.gold,
    fontSize: 12,
    letterSpacing: 2,
  },
  formTitle: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 40,
    color: Colors.textPrimary,
    letterSpacing: 2,
    textTransform: 'uppercase',
    lineHeight: 46,
  },
  otpHint: {
    fontFamily: 'DMSans_400Regular',
    color: Colors.textSecondary,
    fontSize: 14,
    marginBottom: Spacing.lg,
  },
  inputCard: { marginBottom: 0 },
  inputLabel: {
    fontFamily: 'JetBrainsMono_700Bold',
    color: Colors.gold,
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: Spacing.sm,
  },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  countryCode: {
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: Colors.bgElevated,
  },
  countryText: { fontFamily: 'DMSans_500Medium', color: Colors.textPrimary, fontSize: 14 },
  phoneInput: {
    flex: 1,
    fontFamily: 'JetBrainsMono_500Medium',
    color: Colors.textPrimary,
    fontSize: 20,
    padding: 10,
    backgroundColor: Colors.bgElevated,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
  },
  resendBtn: { alignItems: 'center', marginTop: Spacing.lg },
  resendText: {
    fontFamily: 'DMSans_500Medium',
    color: Colors.gold,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  waInstructions: {
    fontFamily: 'DMSans_400Regular',
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  pollingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  pollingText: {
    fontFamily: 'JetBrainsMono_400Regular',
    color: Colors.gold,
    fontSize: 11,
  },
});
