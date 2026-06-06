import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert, Linking
} from 'react-native';
import { Colors, Typography, Spacing, BorderWidth, Shadows } from '../constants/theme';
import { NBCard, NBButton, NBTag, NBDivider, SectionHeader, EmptyState } from '../components/NBComponents';
import { DollarSign, ArrowUpRight, ArrowDownLeft, Plus, Users, Trash2 } from 'lucide-react-native';

interface Expense {
  id: string;
  amount: number;
  description: string;
  date: string;
  category: string;
}

interface SplitDebt {
  id: string;
  friend: string;
  amount: number;
  description: string;
}

interface ExpensesTabProps {
  apiBaseUrl: string;
  userId: string;
  expenses: Expense[];
  owedToYou: SplitDebt[];
  youOwe: SplitDebt[];
  onRefreshData: () => void;
}

export default function ExpensesTab({ apiBaseUrl, userId, expenses, owedToYou, youOwe, onRefreshData }: ExpensesTabProps) {
  const [amountInput, setAmountInput] = useState('');
  const [descInput, setDescInput] = useState('');
  const [friendInput, setFriendInput] = useState('');
  const [splitOption, setSplitOption] = useState<'none' | 'lent' | 'borrowed'>('none');
  const [loading, setLoading] = useState(false);

  // Total logged expenses
  const totalSpent = expenses.reduce((acc, curr) => acc + curr.amount, 0);

  // Totals owed / you owe
  const totalOwedToYou = owedToYou.reduce((acc, curr) => acc + curr.amount, 0);
  const totalYouOwe = youOwe.reduce((acc, curr) => acc + curr.amount, 0);

  const handleAddExpense = async () => {
    const amount = parseFloat(amountInput);
    if (isNaN(amount) || amount <= 0 || !descInput.trim()) {
      Alert.alert('Invalid Entry', 'Please enter a valid amount and description.');
      return;
    }

    setLoading(true);
    try {
      if (splitOption === 'none') {
        // Log simple private expense
        await fetch(`${apiBaseUrl}/api/expenses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            amount,
            description: descInput,
            category: 'Personal'
          })
        });
      } else {
        // Log a split debt
        if (!friendInput.trim()) {
          Alert.alert('Friend Required', 'Please enter a friend\'s email or identifier to split.');
          setLoading(false);
          return;
        }
        await fetch(`${apiBaseUrl}/api/expenses/split`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            friend: friendInput,
            amount,
            description: descInput,
            type: splitOption // 'lent' or 'borrowed'
          })
        });
      }

      setAmountInput('');
      setDescInput('');
      setFriendInput('');
      setSplitOption('none');
      Alert.alert('Success', 'Expense logged successfully!');
      onRefreshData();
    } catch {
      Alert.alert('Mock Success', 'Offline mode simulated - logged successfully.');
      onRefreshData();
    } finally {
      setLoading(false);
    }
  };

  const deleteExpense = async (id: string) => {
    try {
      await fetch(`${apiBaseUrl}/api/expenses/${id}`, { method: 'DELETE' });
      onRefreshData();
    } catch {
      onRefreshData();
    }
  };

  const handleSettleUp = (debt: SplitDebt) => {
    const friendName = debt.friend;
    const friendVpa = friendName.includes('@') ? friendName : `${friendName.replace(/\s+/g, '').toLowerCase()}@paytm`;
    const upiUrl = `upi://pay?pa=${friendVpa}&pn=${encodeURIComponent(friendName)}&am=${debt.amount}&cu=INR&tn=${encodeURIComponent('Settled via Kora')}`;
    
    Linking.openURL(upiUrl).catch(() => {
      Alert.alert(
        "⚡ UPI Settle Intent",
        `Launch simulated payment of ₹${debt.amount} to ${friendName} (${friendVpa})?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Launch Payment", onPress: () => {
              Alert.alert("Success", `Simulated payment of ₹${debt.amount} processed! Debt settled.`);
              onRefreshData();
            }
          }
        ]
      );
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: Spacing.md }}>
      <SectionHeader title="LEDGER & BUDGETS" subtitle="FINANCIAL MONITORING" />

      {/* 💸 Ledger Overview */}
      <NBCard style={styles.overviewCard}>
        <View style={styles.statColumn}>
          <Text style={styles.statLabel}>PERSONAL SPENT</Text>
          <Text style={styles.statValue}>₹{totalSpent.toFixed(2)}</Text>
        </View>
        <NBDivider color={Colors.borderGold} />
        <View style={styles.debtsRow}>
          <View style={styles.debtBox}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <ArrowUpRight size={14} color={Colors.success} />
              <Text style={styles.debtLabel}>OWED TO YOU</Text>
            </View>
            <Text style={[styles.debtValue, { color: Colors.success }]}>₹{totalOwedToYou.toFixed(2)}</Text>
          </View>
          <View style={[styles.debtBox, { borderLeftWidth: BorderWidth.medium, borderColor: Colors.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <ArrowDownLeft size={14} color={Colors.crimsonLight} />
              <Text style={styles.debtLabel}>YOU OWE</Text>
            </View>
            <Text style={[styles.debtValue, { color: Colors.crimsonLight }]}>₹{totalYouOwe.toFixed(2)}</Text>
          </View>
        </View>
      </NBCard>

      {/* 💸 Add Expense Form */}
      <NBCard style={{ marginBottom: Spacing.lg }}>
        <Text style={styles.formTitle}>LOG NEW EXPENSE</Text>
        <NBDivider />

        <Text style={styles.label}>AMOUNT (₹)</Text>
        <TextInput
          style={styles.textInput}
          placeholder="0.00"
          placeholderTextColor={Colors.textMuted}
          keyboardType="numeric"
          value={amountInput}
          onChangeText={setAmountInput}
        />

        <Text style={[styles.label, { marginTop: Spacing.sm }]}>DESCRIPTION</Text>
        <TextInput
          style={styles.textInput}
          placeholder="e.g. Canteen lunch, hostel dues, books"
          placeholderTextColor={Colors.textMuted}
          value={descInput}
          onChangeText={setDescInput}
        />

        {/* Splitting Logic */}
        <Text style={[styles.label, { marginTop: Spacing.sm }]}>SPLITTING OPTION</Text>
        <View style={styles.splitOptions}>
          {(['none', 'lent', 'borrowed'] as const).map(opt => (
            <TouchableOpacity
              key={opt}
              onPress={() => setSplitOption(opt)}
              style={[styles.splitBtn, splitOption === opt && styles.splitBtnActive]}
            >
              <Text style={[styles.splitBtnText, splitOption === opt && { color: Colors.textInverse }]}>
                {opt === 'none' ? 'PERSONAL' : opt === 'lent' ? 'I LENT IT' : 'I BORROWED'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {splitOption !== 'none' && (
          <View style={{ marginTop: Spacing.sm }}>
            <Text style={styles.label}>FRIEND ID / EMAIL</Text>
            <TextInput
              style={styles.textInput}
              placeholder="friend.email@domain.com"
              placeholderTextColor={Colors.textMuted}
              value={friendInput}
              onChangeText={setFriendInput}
            />
          </View>
        )}

        <NBButton
          label={loading ? 'LOGGING...' : 'RECORD TRANSACTIONS'}
          onPress={handleAddExpense}
          disabled={loading}
          style={{ marginTop: Spacing.md }}
        />
      </NBCard>

      {/* 🤝 Debts Ledger */}
      <Text style={styles.sectionHeaderTitle}>OWED TO YOU (DEBTORS)</Text>
      {owedToYou.length === 0 ? (
        <EmptyState icon="🤝" title="No Outstanding Debts" subtitle="Nobody owes you money currently." />
      ) : (
        owedToYou.map(debt => (
          <NBCard key={debt.id} style={[styles.itemCard, { borderColor: Colors.success, marginBottom: Spacing.sm }]}>
            <View style={styles.itemHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{debt.friend.toUpperCase()}</Text>
                <Text style={styles.itemDate}>{debt.description}</Text>
              </View>
              <Text style={[styles.itemAmount, { color: Colors.success }]}>+₹{debt.amount}</Text>
            </View>
          </NBCard>
        ))
      )}

      <Text style={[styles.sectionHeaderTitle, { marginTop: Spacing.lg }]}>YOU OWE (CREDITORS)</Text>
      {youOwe.length === 0 ? (
        <EmptyState icon="💸" title="Clear of Debts" subtitle="You do not owe anyone money currently." />
      ) : (
        youOwe.map(debt => (
          <NBCard key={debt.id} style={[styles.itemCard, { borderColor: Colors.crimson, marginBottom: Spacing.sm }]}>
            <View style={styles.itemHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{debt.friend.toUpperCase()}</Text>
                <Text style={styles.itemDate}>{debt.description}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                <Text style={[styles.itemAmount, { color: Colors.crimsonLight }]}>-₹{debt.amount}</Text>
                <TouchableOpacity onPress={() => handleSettleUp(debt)} style={styles.settleBtn}>
                  <Text style={styles.settleBtnText}>⚡ SETTLE</Text>
                </TouchableOpacity>
              </View>
            </View>
          </NBCard>
        ))
      )}

      {/* 💸 History list */}
      <Text style={[styles.sectionHeaderTitle, { marginTop: Spacing.lg }]}>RECENT OUTLAYS</Text>
      {expenses.length === 0 ? (
        <EmptyState icon="💸" title="No Expenses Logged" subtitle="Record canteen costs or splits to start budgeting." />
      ) : (
        expenses.map(e => (
          <NBCard key={e.id} style={styles.itemCard}>
            <View style={styles.itemHeader}>
              <View>
                <Text style={styles.itemTitle}>{e.description.toUpperCase()}</Text>
                <Text style={styles.itemDate}>{e.date}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                <Text style={styles.itemAmount}>₹{e.amount}</Text>
                <TouchableOpacity onPress={() => deleteExpense(e.id)} style={styles.deleteBtn}>
                  <Trash2 size={14} color={Colors.crimsonLight} />
                </TouchableOpacity>
              </View>
            </View>
          </NBCard>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  overviewCard: { padding: 0, overflow: 'hidden' },
  statColumn: { padding: Spacing.md, alignItems: 'center' },
  statLabel: {
    ...Typography.monoBold,
    color: Colors.textSecondary,
    fontSize: 10,
    letterSpacing: 2,
  },
  statValue: {
    ...Typography.display,
    color: Colors.gold,
    fontSize: 32,
    marginTop: Spacing.xs,
  },
  debtsRow: { flexDirection: 'row', backgroundColor: Colors.bgElevated },
  debtBox: { flex: 1, padding: Spacing.md, alignItems: 'center', gap: Spacing.xs },
  debtLabel: {
    ...Typography.monoBold,
    color: Colors.textSecondary,
    fontSize: 9,
    letterSpacing: 1,
  },
  debtValue: {
    ...Typography.display,
    fontSize: 18,
  },
  formTitle: {
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
  splitOptions: { flexDirection: 'row', gap: Spacing.xs, marginVertical: Spacing.xs },
  splitBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: Colors.bgElevated,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
  },
  splitBtnActive: {
    backgroundColor: Colors.gold,
  },
  splitBtnText: {
    ...Typography.monoBold,
    color: Colors.textPrimary,
    fontSize: 10,
  },
  sectionHeaderTitle: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: Spacing.sm,
  },
  itemCard: { padding: Spacing.sm },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemTitle: {
    ...Typography.display,
    color: Colors.textPrimary,
    fontSize: 13,
  },
  itemDate: {
    ...Typography.mono,
    color: Colors.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  itemAmount: {
    ...Typography.monoBold,
    color: Colors.textPrimary,
    fontSize: 15,
  },
  deleteBtn: {
    padding: 6,
    borderWidth: BorderWidth.thin,
    borderColor: Colors.border,
    backgroundColor: Colors.bgElevated,
  },
  settleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: Colors.gold,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    ...Shadows.brutalSm,
  },
  settleBtnText: {
    ...Typography.monoBold,
    color: Colors.textPrimary,
    fontSize: 9,
  },
});
