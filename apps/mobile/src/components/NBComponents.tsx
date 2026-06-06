import React, { useRef, useEffect } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, BorderWidth, Shadows } from '../constants/theme';

// ── Neo-Brutalist Card ──────────────────────────────────────
interface CardProps {
  children: React.ReactNode;
  style?: object;
  accentColor?: string;
  noPad?: boolean;
}
export const NBCard = ({ children, style, accentColor, noPad }: CardProps) => (
  <View style={[styles.card, accentColor ? { borderColor: accentColor } : {}, noPad ? { padding: 0 } : {}, style]}>
    {children}
  </View>
);

// ── Tag / Badge ─────────────────────────────────────────────
interface TagProps {
  label: string;
  color?: string;
  textColor?: string;
  style?: object;
}
export const NBTag = ({ label, color = Colors.gold, textColor = Colors.textInverse, style }: TagProps) => (
  <View style={[styles.tag, { backgroundColor: color, borderColor: Colors.border }, style]}>
    <Text style={[styles.tagText, { color: textColor }]}>{label}</Text>
  </View>
);

// ── Button ──────────────────────────────────────────────────
import { TouchableOpacity } from 'react-native';
interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: React.ReactNode;
  style?: object;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}
export const NBButton = ({ label, onPress, variant = 'primary', icon, style, disabled, size = 'md' }: ButtonProps) => {
  const bgMap = {
    primary: Colors.gold,
    secondary: Colors.bgCard,
    ghost: 'transparent',
    danger: Colors.crimson,
  };
  const textMap = {
    primary: Colors.textInverse,
    secondary: Colors.textPrimary,
    ghost: Colors.textPrimary,
    danger: Colors.textPrimary,
  };
  const padMap = { sm: 8, md: 14, lg: 20 };
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
      style={[
        styles.btn,
        {
          backgroundColor: bgMap[variant],
          paddingVertical: padMap[size],
          opacity: disabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      {icon && <View style={{ marginRight: 8 }}>{icon}</View>}
      <Text style={[styles.btnText, { color: textMap[variant] }]}>{label.toUpperCase()}</Text>
    </TouchableOpacity>
  );
};

// ── Section Header ───────────────────────────────────────────
interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}
export const SectionHeader = ({ title, subtitle, right }: SectionHeaderProps) => (
  <View style={styles.sectionHeader}>
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
    </View>
    {right}
  </View>
);

// ── Divider ──────────────────────────────────────────────────
export const NBDivider = ({ color = Colors.border, style }: { color?: string; style?: object }) => (
  <View style={[{ height: BorderWidth.thick, backgroundColor: color, marginVertical: Spacing.sm }, style]} />
);

// ── Loading Pulse ─────────────────────────────────────────────
export const LoadingDots = () => {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const anim = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 300, useNativeDriver: true }),
        ])
      );
    const a1 = anim(dot1, 0);
    const a2 = anim(dot2, 200);
    const a3 = anim(dot3, 400);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []);
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[dot1, dot2, dot3].map((d, i) => (
        <Animated.View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.gold, opacity: d }} />
      ))}
    </View>
  );
};

// ── Empty State ──────────────────────────────────────────────
export const EmptyState = ({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) => (
  <View style={styles.emptyState}>
    <Text style={styles.emptyIcon}>{icon}</Text>
    <Text style={styles.emptyTitle}>{title}</Text>
    {subtitle && <Text style={styles.emptySubtitle}>{subtitle}</Text>}
  </View>
);

// ── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard,
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    ...Shadows.brutal,
  },
  tag: {
    borderWidth: BorderWidth.medium,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  tagText: {
    ...Typography.mono,
    fontSize: 10,
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 1,
  },
  btn: {
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    ...Shadows.brutal,
  },
  btnText: {
    ...Typography.bodyBold,
    fontSize: 12,
    letterSpacing: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: BorderWidth.thick,
    borderBottomColor: Colors.gold,
  },
  sectionTitle: {
    ...Typography.display,
    color: Colors.textPrimary,
    fontSize: 18,
  },
  sectionSubtitle: {
    ...Typography.mono,
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
    gap: Spacing.sm,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyTitle: {
    ...Typography.heading,
    color: Colors.textSecondary,
    fontSize: 16,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  emptySubtitle: {
    ...Typography.body,
    color: Colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
});
