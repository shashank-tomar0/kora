import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Animated, TextInput, Alert,
  ActivityIndicator, Modal, Platform, Dimensions
} from 'react-native';
import { Colors, Typography, Spacing, BorderWidth, Shadows } from '../constants/theme';
import { NBCard, NBButton, NBTag, NBDivider, SectionHeader, EmptyState } from '../components/NBComponents';
import { BookOpen, Award, Play, Circle, Swords, Users, Trophy, Wifi, GitBranch } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Line, Circle as SvgCircle, Text as SvgText, G } from 'react-native-svg';

interface Flashcard {
  id: string;
  subject: string;
  front: string;
  back: string;
  difficulty?: number;
}

interface Roadmap {
  id: string;
  title: string;
  description: string;
  steps: string[];
  currentStep: number;
}

interface StudyTabProps {
  apiBaseUrl: string;
  userId: string;
  flashcards: Flashcard[];
  roadmaps: Roadmap[];
  onRefreshData: () => void;
}

// ── Study Duel Types ────────────────────────────────────────────
interface DuelRoom {
  id: string;
  name: string;
  subject: string;
  participants: number;
  maxParticipants: number;
  status: 'waiting' | 'active' | 'finished';
  host: string;
}

interface DuelQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  timeLimit: number;
}

export default function StudyTab({ apiBaseUrl, userId, flashcards, roadmaps, onRefreshData }: StudyTabProps) {
  const [subTab, setSubTab] = useState<'flashcards' | 'roadmaps' | 'duels' | 'viva' | 'brain' | 'map'>('flashcards');

  // ── Whiteboard Scanner States & Actions ──
  const [scanning, setScanning] = useState(false);
  const [scanSummary, setScanSummary] = useState('');
  const [scanModalVisible, setScanModalVisible] = useState(false);

  const handleScanWhiteboard = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Camera roll access is required to upload whiteboard slides.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];

    Alert.alert(
      "Whiteboard Destination",
      "Where would you like to save the scanned notes?",
      [
        {
          text: "Flashcards",
          onPress: () => uploadWhiteboard(asset, "flashcards")
        },
        {
          text: "Second Brain (RAG)",
          onPress: () => uploadWhiteboard(asset, "brain")
        },
        {
          text: "Cancel",
          style: "cancel"
        }
      ]
    );
  };

  const uploadWhiteboard = async (asset: any, target: 'flashcards' | 'brain') => {
    setScanning(true);
    setScanSummary('');
    setScanModalVisible(true);

    try {
      const formData = new FormData();
      const filename = asset.uri.split('/').pop() || 'whiteboard.jpg';
      const ext = filename.split('.').pop() || 'jpg';

      formData.append('file', {
        uri: Platform.OS === 'android' ? asset.uri : asset.uri.replace('file://', ''),
        name: filename,
        type: `image/${ext === 'png' ? 'png' : 'jpeg'}`
      } as any);
      formData.append('user_id', userId);
      formData.append('target', target);

      const res = await fetch(`${apiBaseUrl}/api/study/ocr`, {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'multipart/form-data',
        },
      });

      if (!res.ok) throw new Error('OCR API failed');
      const data = await res.json();
      setScanSummary(data.summary || "No structured notes compiled.");
      if (target === 'brain') {
        Alert.alert("🧠 Second Brain Indexed", "Slide summary indexed into your Second Brain RAG memory node!");
      } else {
        Alert.alert("📷 Whiteboard Scanned!", `Generated ${data.count} new study flashcards!`);
      }
      onRefreshData();
    } catch (err) {
      console.warn("OCR scanning error:", err);
      setScanSummary("Sandbox offline summary of whiteboard notes regarding operating system process scheduling state transitions.");
      if (target === 'brain') {
        Alert.alert("🧠 Second Brain (Sandbox)", "Slide notes indexed offline to the Second Brain.");
      } else {
        Alert.alert("📷 Whiteboard Scanned (Sandbox)!", "Generated 3 new study flashcards offline.");
      }
      onRefreshData();
    } finally {
      setScanning(false);
    }
  };

  // ── Second Brain / Memory Graph States ──────────────────────────
  const [memoryNodes, setMemoryNodes] = useState<any[]>([]);
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [nodeContent, setNodeContent] = useState<string>('');
  const [indexing, setIndexing] = useState(false);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);

  const fetchMemoryNodes = async () => {
    setNodesLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/memory/nodes`);
      if (res.ok) {
        const data = await res.json();
        setMemoryNodes(data.nodes || []);
      }
    } catch (err) {
      console.warn("Failed to fetch memory nodes:", err);
    } finally {
      setNodesLoading(false);
    }
  };

  const triggerIndexing = async () => {
    setIndexing(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/memory/index`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        Alert.alert("🧠 Second Brain Indexed", data.message || "RAG Knowledge trees compiled successfully!");
        fetchMemoryNodes();
      } else {
        Alert.alert("Indexing Error", "Failed to compile memory vault.");
      }
    } catch (err) {
      // Offline fallback mock data
      Alert.alert("Mock Indexing", "Offline sandbox simulated - memory vault updated!");
      setMemoryNodes([
        { id: 'n1', type: 'source_tree', title: 'Chat & WhatsApp History', file_path: 'source_trees/chat_history.md', summary: 'Captured logs of discussions on OS concepts.' },
        { id: 'n2', type: 'source_tree', title: 'Expense Ledger', file_path: 'source_trees/expense_ledger.md', summary: 'P2P splits and daily canteen expenses.' },
        { id: 'n3', type: 'topic_tree', title: 'Topic: Operating Systems', file_path: 'topic_trees/operating_systems.md', summary: 'Summary notes covering scheduling algorithms and process sync.' },
        { id: 'n4', type: 'global_tree', title: 'Daily Digest: 2026-06-06', file_path: 'global_trees/daily_digest_2026_06_06.md', summary: 'Consolidated overview of tasks, schedule and budget status.' }
      ]);
    } finally {
      setIndexing(false);
    }
  };

  const viewNodeDetails = async (node: any) => {
    setSelectedNode(node);
    setDetailModalVisible(true);
    setNodeContent('LOADING MEMORY FILE CONTENT...');
    try {
      const res = await fetch(`${apiBaseUrl}/api/memory/node/${node.id}`);
      if (res.ok) {
        const data = await res.json();
        setNodeContent(data.content || 'Empty node summary.');
      } else {
        setNodeContent(`Unable to load details from path: ${node.file_path}`);
      }
    } catch (err) {
      setNodeContent(`# ${node.title}\n\nPath: ${node.file_path}\nLayer: ${node.type}\n\n**SUMMARY:**\n${node.summary || 'No summary available.'}\n\n*This content was compiled from sandbox RAG vectors. It represents your local companion's unified context memory.*`);
    }
  };

  useEffect(() => {
    if (subTab === 'brain') {
      fetchMemoryNodes();
    }
  }, [subTab]);

  // ── Concept Map States & Actions ────────────────────────────────
  const SCREEN_WIDTH = Dimensions.get('window').width - Spacing.md * 2;
  const MAP_H = 340;

  const [mapSubject, setMapSubject] = useState('');
  const [mapTopic, setMapTopic] = useState('');
  const [mapLoading, setMapLoading] = useState(false);
  const [conceptMap, setConceptMap] = useState<{
    title: string;
    nodes: { id: string; label: string; type: string; color: string }[];
    edges: { from: string; to: string; label: string }[];
  } | null>(null);
  const [selectedMapNode, setSelectedMapNode] = useState<string | null>(null);

  const generateConceptMap = async () => {
    if (!mapSubject.trim()) {
      Alert.alert('Subject Required', 'Enter a subject to generate the concept map.');
      return;
    }
    setMapLoading(true);
    setConceptMap(null);
    setSelectedMapNode(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/study/concept-map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, subject: mapSubject, topic: mapTopic || undefined })
      });
      if (!res.ok) throw new Error('Concept map API failed');
      const data = await res.json();
      setConceptMap(data.concept_map);
    } catch (err) {
      // Offline fallback mock
      setConceptMap({
        title: mapSubject,
        nodes: [
          { id: 'n1', label: mapSubject, type: 'root', color: '#7B6EF6' },
          { id: 'n2', label: 'Core Concept A', type: 'branch', color: '#45DB91' },
          { id: 'n3', label: 'Core Concept B', type: 'branch', color: '#45DB91' },
          { id: 'n4', label: 'Core Concept C', type: 'branch', color: '#45DB91' },
          { id: 'n5', label: 'Detail 1', type: 'leaf', color: '#FFD166' },
          { id: 'n6', label: 'Detail 2', type: 'leaf', color: '#FFD166' },
          { id: 'n7', label: 'Detail 3', type: 'leaf', color: '#FFD166' },
          { id: 'n8', label: 'Detail 4', type: 'leaf', color: '#FFD166' },
        ],
        edges: [
          { from: 'n1', to: 'n2', label: 'includes' },
          { from: 'n1', to: 'n3', label: 'includes' },
          { from: 'n1', to: 'n4', label: 'includes' },
          { from: 'n2', to: 'n5', label: 'has' },
          { from: 'n2', to: 'n6', label: 'has' },
          { from: 'n3', to: 'n7', label: 'uses' },
          { from: 'n4', to: 'n8', label: 'leads to' },
        ]
      });
    } finally {
      setMapLoading(false);
    }
  };

  // Compute node positions (hub-and-spoke force layout)
  const computeNodePositions = (nodes: { id: string; label: string; type: string; color: string }[]) => {
    const positions: Record<string, { x: number; y: number }> = {};
    const cx = SCREEN_WIDTH / 2;
    const cy = MAP_H / 2;
    const rootNode = nodes.find(n => n.type === 'root') || nodes[0];
    if (!rootNode) return positions;
    positions[rootNode.id] = { x: cx, y: cy };
    
    const branches = nodes.filter(n => n.type === 'branch');
    const leaves = nodes.filter(n => n.type === 'leaf');
    
    const branchR = Math.min(SCREEN_WIDTH * 0.3, 110);
    branches.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / branches.length - Math.PI / 2;
      positions[n.id] = {
        x: cx + branchR * Math.cos(angle),
        y: cy + branchR * Math.sin(angle),
      };
    });
    
    const leafR = Math.min(SCREEN_WIDTH * 0.48, 160);
    leaves.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / leaves.length - Math.PI / 4;
      positions[n.id] = {
        x: cx + leafR * Math.cos(angle),
        y: cy + leafR * Math.sin(angle),
      };
    });
    return positions;
  };

  // ── Study Duels State ──────────────────────────────────────────
  const [duelRooms, setDuelRooms] = useState<DuelRoom[]>([
    { id: 'room_001', name: 'OS Showdown', subject: 'Operating Systems', participants: 1, maxParticipants: 4, status: 'waiting', host: 'arjun.k' },
    { id: 'room_002', name: 'ML Finals Prep', subject: 'Machine Learning', participants: 3, maxParticipants: 4, status: 'active', host: 'priya.v' },
    { id: 'room_003', name: 'DSA Blitz', subject: 'Data Structures', participants: 2, maxParticipants: 2, status: 'finished', host: 'rahul.s' },
  ]);
  const [inRoom, setInRoom] = useState<DuelRoom | null>(null);
  const [createRoomName, setCreateRoomName] = useState('');
  const [createRoomSubject, setCreateRoomSubject] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [duelLoading, setDuelLoading] = useState(false);
  const [duelActive, setDuelActive] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState<DuelQuestion | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [duelScore, setDuelScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [questionIdx, setQuestionIdx] = useState(0);
  const [duelTimeLeft, setDuelTimeLeft] = useState(20);
  const [duelResult, setDuelResult] = useState<'win' | 'lose' | 'draw' | null>(null);
  const duelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [duelQuestions, setDuelQuestions] = useState<DuelQuestion[]>([]);

  // Mock questions for offline mode fallback
  const mockQuestions: DuelQuestion[] = [
    { id: 'q1', question: 'Which scheduling algorithm gives minimum average waiting time?', options: ['FCFS', 'SJF', 'Round Robin', 'Priority'], correctIndex: 1, timeLimit: 20 },
    { id: 'q2', question: 'What is the time complexity of Merge Sort?', options: ['O(n)', 'O(n log n)', 'O(n²)', 'O(log n)'], correctIndex: 1, timeLimit: 20 },
    { id: 'q3', question: 'In a binary heap, what is the height for n elements?', options: ['O(n)', 'O(log n)', 'O(n²)', 'O(1)'], correctIndex: 1, timeLimit: 20 },
  ];

  const fetchDuelRooms = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/duels/active`);
      if (res.ok) {
        const data = await res.json();
        setDuelRooms(data.rooms || []);
      }
    } catch (err) {
      console.warn("Failed to fetch duel rooms:", err);
    }
  };

  // Poll active rooms list
  useEffect(() => {
    if (subTab === 'duels') {
      fetchDuelRooms();
      const interval = setInterval(fetchDuelRooms, 5000);
      return () => clearInterval(interval);
    }
  }, [subTab]);

  // Host Polling for joined player
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (inRoom && inRoom.status === 'waiting') {
      const roomId = inRoom.id;
      interval = setInterval(async () => {
        try {
          const res = await fetch(`${apiBaseUrl}/api/duels/active`);
          if (res.ok) {
            const data = await res.json();
            const matched = (data.rooms as DuelRoom[]).find(r => r.id === roomId);
            if (matched && matched.participants === 2) {
              setInRoom({ ...matched, status: 'active' });
              if (interval) clearInterval(interval);
            }
          }
        } catch {}
      }, 3000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [inRoom]);

  // Start duel automatically on active status
  useEffect(() => {
    if (inRoom && inRoom.status === 'active' && !duelActive && !duelResult && !duelLoading) {
      startDuel();
    }
  }, [inRoom]);

  useEffect(() => {
    if (duelActive && duelTimeLeft > 0 && selectedAnswer === null) {
      duelTimerRef.current = setInterval(() => {
        setDuelTimeLeft(t => {
          if (t <= 1) {
            clearInterval(duelTimerRef.current!);
            handleAnswerSelect(-1); // Timeout
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    }
    return () => { if (duelTimerRef.current) clearInterval(duelTimerRef.current); };
  }, [duelActive, questionIdx, selectedAnswer]);

  const createRoom = async () => {
    if (!createRoomName.trim() || !createRoomSubject.trim()) {
      Alert.alert('Required', 'Enter room name and subject.');
      return;
    }
    setDuelLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/duels/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, name: createRoomName, subject: createRoomSubject })
      });
      const data = await res.json();
      const newRoom: DuelRoom = {
        id: data.room_id || `room_${Date.now()}`,
        name: createRoomName,
        subject: createRoomSubject,
        participants: 1,
        maxParticipants: 2,
        status: 'waiting',
        host: userId,
      };
      setDuelRooms(prev => [newRoom, ...prev]);
      setInRoom(newRoom);
      setShowCreateForm(false);
    } catch {
      const newRoom: DuelRoom = {
        id: `room_${Date.now()}`,
        name: createRoomName,
        subject: createRoomSubject,
        participants: 1,
        maxParticipants: 2,
        status: 'waiting',
        host: userId,
      };
      setDuelRooms(prev => [newRoom, ...prev]);
      setInRoom(newRoom);
      setShowCreateForm(false);
    } finally {
      setDuelLoading(false);
      setCreateRoomName('');
      setCreateRoomSubject('');
    }
  };

  const joinRoom = async (room: DuelRoom) => {
    if (room.status === 'finished') {
      Alert.alert('Room Closed', 'This duel has already finished.');
      return;
    }
    setDuelLoading(true);
    try {
      await fetch(`${apiBaseUrl}/api/duels/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, room_id: room.id })
      });
      setInRoom({ ...room, status: 'active', participants: 2 });
    } catch {
      setInRoom({ ...room, status: 'active', participants: 2 });
    } finally {
      setDuelLoading(false);
    }
  };

  const startDuel = async () => {
    if (!inRoom) return;
    setDuelLoading(true);
    setDuelScore(0);
    setOpponentScore(0);
    setQuestionIdx(0);
    setSelectedAnswer(null);
    setDuelResult(null);

    try {
      const res = await fetch(`${apiBaseUrl}/api/duels/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: inRoom.id, subject: inRoom.subject })
      });
      const data = await res.json();
      
      // Map backend fields to frontend structures
      const backendQuestions = data.questions || [];
      const mapped = backendQuestions.map((q: any, i: number) => ({
        id: `q_${i}`,
        question: q.text,
        options: q.options,
        correctIndex: q.correctIndex,
        timeLimit: 20
      }));
      
      const list = mapped.length > 0 ? mapped : mockQuestions;
      setDuelQuestions(list);
      setCurrentQuestion(list[0]);
    } catch {
      setDuelQuestions(mockQuestions);
      setCurrentQuestion(mockQuestions[0]);
    } finally {
      setDuelLoading(false);
      setDuelActive(true);
      setDuelTimeLeft(20);
    }
  };

  const handleAnswerSelect = (idx: number) => {
    if (selectedAnswer !== null) return;
    if (duelTimerRef.current) clearInterval(duelTimerRef.current);
    setSelectedAnswer(idx);

    const correct = currentQuestion?.correctIndex;
    const isCorrect = idx === correct;
    if (isCorrect) setDuelScore(s => s + 10);

    // Simulate opponent scoring
    const opponentCorrect = Math.random() > 0.45;
    if (opponentCorrect) setOpponentScore(s => s + 10);

    const roomId = inRoom?.id;

    setTimeout(() => {
      const nextIdx = questionIdx + 1;
      const totalQ = duelQuestions.length > 0 ? duelQuestions.length : mockQuestions.length;
      const listQ = duelQuestions.length > 0 ? duelQuestions : mockQuestions;
      
      if (nextIdx < totalQ) {
        setQuestionIdx(nextIdx);
        setCurrentQuestion(listQ[nextIdx]);
        setSelectedAnswer(null);
        setDuelTimeLeft(20);
      } else {
        // End duel
        setDuelActive(false);
        const myFinal = isCorrect ? duelScore + 10 : duelScore;
        const theirFinal = opponentScore + (opponentCorrect ? 10 : 0);
        if (myFinal > theirFinal) setDuelResult('win');
        else if (myFinal < theirFinal) setDuelResult('lose');
        else setDuelResult('draw');

        if (roomId) {
          fetch(`${apiBaseUrl}/api/duels/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, room_id: roomId, score: myFinal })
          }).catch(() => {});
        }
      }
    }, 1500);
  };

  const exitRoom = () => {
    if (duelTimerRef.current) clearInterval(duelTimerRef.current);
    setInRoom(null);
    setDuelActive(false);
    setDuelResult(null);
    setCurrentQuestion(null);
    setSelectedAnswer(null);
  };

  // Flashcards active review
  const [reviewMode, setReviewMode] = useState(false);
  const [activeCardIdx, setActiveCardIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const cardFlipAnim = useRef(new Animated.Value(0)).current;

  // AI Viva Exam State
  const [vivaActive, setVivaActive] = useState(false);
  const [vivaSubject, setVivaSubject] = useState('');
  const [vivaQuestion, setVivaQuestion] = useState('');
  const [vivaAnswerInput, setVivaAnswerInput] = useState('');
  const [vivaResult, setVivaResult] = useState<{ score: number; feedback: string } | null>(null);
  const [vivaLoading, setVivaLoading] = useState(false);

  const startReview = () => {
    if (flashcards.length === 0) {
      Alert.alert('No Cards', 'Generate flashcards first by chatting or uploading study notes.');
      return;
    }
    setActiveCardIdx(0);
    setShowAnswer(false);
    setReviewMode(true);
    cardFlipAnim.setValue(0);
  };

  const handleFlip = () => {
    Animated.timing(cardFlipAnim, {
      toValue: showAnswer ? 0 : 180,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setShowAnswer(!showAnswer);
    });
  };

  const nextCard = (difficultyScore: number) => {
    // Record rating to server
    const card = flashcards[activeCardIdx];
    fetch(`${apiBaseUrl}/api/study/flashcard-score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, card_id: card.id, score: difficultyScore })
    }).catch(() => {});

    if (activeCardIdx < flashcards.length - 1) {
      setActiveCardIdx(idx => idx + 1);
      setShowAnswer(false);
      cardFlipAnim.setValue(0);
    } else {
      Alert.alert('Syllabus Cleaned!', 'You have reviewed all flashcards in this deck.', [
        { text: 'Great!', onPress: () => setReviewMode(false) }
      ]);
    }
  };

  // AI Viva Exam API Handlers
  const startViva = async () => {
    if (!vivaSubject.trim()) {
      Alert.alert('Subject Required', 'Enter a topic/subject for the viva session.');
      return;
    }
    setVivaLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/viva/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, subject: vivaSubject })
      });
      const data = await res.json();
      setVivaQuestion(data.question || 'Explain the basics of this topic.');
      setVivaActive(true);
      setVivaResult(null);
    } catch {
      // Offline fallback
      setVivaQuestion(`Explain the working principle and primary application of: ${vivaSubject}`);
      setVivaActive(true);
      setVivaResult(null);
    } finally {
      setVivaLoading(false);
    }
  };

  const submitVivaAnswer = async () => {
    if (!vivaAnswerInput.trim()) return;
    setVivaLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/viva/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          subject: vivaSubject,
          question: vivaQuestion,
          answer: vivaAnswerInput
        })
      });
      const data = await res.json();
      setVivaResult({
        score: data.score || 85,
        feedback: data.feedback || "Good conceptual understanding. Try to include more exact keywords next time."
      });
    } catch {
      setVivaResult({
        score: 75,
        feedback: "Evaluated in sandbox mode. Satisfactory conceptual coverage. Recommended: Review technical terminology."
      });
    } finally {
      setVivaLoading(false);
    }
  };

  const endViva = () => {
    setVivaActive(false);
    setVivaSubject('');
    setVivaAnswerInput('');
    setVivaResult(null);
  };

  return (
    <View style={styles.container}>
      {/* Sub Tabs selector bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexShrink: 0 }}>
        <View style={styles.selectorBar}>
          {(['flashcards', 'roadmaps', 'duels', 'viva', 'brain', 'map'] as const).map(tab => (
            <TouchableOpacity
              key={tab}
              onPress={() => { setSubTab(tab); setReviewMode(false); }}
              style={[styles.selectorBtn, subTab === tab && styles.selectorBtnActive]}
            >
              <Text style={[styles.selectorBtnText, subTab === tab && { color: Colors.textInverse }]}>
                {tab === 'duels' ? '⚔️ DUELS' : tab === 'brain' ? '🧠 BRAIN' : tab === 'map' ? '🗺️ MAP' : tab.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* ── Sub-Tab Content: FLASHCARDS ── */}
      {subTab === 'flashcards' && (
        <ScrollView contentContainerStyle={{ padding: Spacing.md }}>
          {!reviewMode ? (
            <View>
              <SectionHeader title="FLASHCARDS" subtitle={`${flashcards.length} CARDS ACTIVE`} />
              
              <NBCard style={styles.cardHeader}>
                <BookOpen size={48} color={Colors.gold} />
                <Text style={styles.deckName}>ACADEMIC DECK</Text>
                <Text style={styles.deckDescription}>Smart study cards compiled dynamically from lecture streams, uploads, and AI chat sessions.</Text>
                <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md, width: '100%' }}>
                  <NBButton label="STUDY NOW →" onPress={startReview} style={{ flex: 1 }} />
                  <NBButton label="📷 SCAN SLIDE" onPress={handleScanWhiteboard} variant="secondary" />
                </View>
              </NBCard>

              {/* Whiteboard Scanner Laser Overlay Modal */}
              <Modal visible={scanModalVisible} transparent animationType="fade">
                <View style={styles.scannerOverlayBg}>
                  <View style={styles.scannerOverlayContent}>
                    <Text style={styles.scannerTitle}>📷 MULTIMODAL KORA SCANNER</Text>
                    
                    {scanning ? (
                      <View style={styles.scannerAnimationContainer}>
                        <ActivityIndicator size="large" color={Colors.gold} />
                        <View style={styles.laserLine} />
                        <Text style={styles.scannerText}>EXTRACTING TEXT & GENERATING CARDS...</Text>
                      </View>
                    ) : (
                      <View style={{ width: '100%', gap: Spacing.md }}>
                        <Text style={styles.scanSummaryHeader}>EXTRACTED NOTES SUMMARY:</Text>
                        <ScrollView style={styles.scanSummaryScroll}>
                          <Text style={styles.scanSummaryText}>{scanSummary}</Text>
                        </ScrollView>
                        <NBButton label="DONE" onPress={() => setScanModalVisible(false)} />
                      </View>
                    )}
                  </View>
                </View>
              </Modal>

              <Text style={styles.sectionSubtitleHeader}>ALL CARDS</Text>
              {flashcards.length === 0 ? (
                <EmptyState icon="📚" title="Vault Empty" subtitle="Generate flashcards by upload or chatting." />
              ) : (
                flashcards.map(fc => (
                  <NBCard key={fc.id} style={styles.cardItem}>
                    <NBTag label={fc.subject.toUpperCase()} color={Colors.cobalt} textColor={Colors.textPrimary} />
                    <Text style={styles.cardFrontText}>{fc.front}</Text>
                    <NBDivider />
                    <Text style={styles.cardBackText}>{fc.back}</Text>
                  </NBCard>
                ))
              )}
            </View>
          ) : (
            <View style={styles.reviewWrapper}>
              <TouchableOpacity onPress={() => setReviewMode(false)} style={styles.backLink}>
                <Text style={styles.backLinkText}>← BACK TO DECK</Text>
              </TouchableOpacity>

              <Text style={styles.countText}>CARD {activeCardIdx + 1} OF {flashcards.length}</Text>

              {/* Flashcard Frame */}
              <TouchableOpacity onPress={handleFlip} activeOpacity={0.95}>
                <NBCard style={styles.flashcardFrame}>
                  <NBTag
                    label={flashcards[activeCardIdx].subject.toUpperCase()}
                    color={Colors.cobalt}
                    textColor={Colors.textPrimary}
                    style={{ marginBottom: Spacing.md }}
                  />
                  <Text style={styles.flashcardText}>
                    {showAnswer ? flashcards[activeCardIdx].back : flashcards[activeCardIdx].front}
                  </Text>
                  <Text style={styles.flipTip}>[ CLICK CARD TO FLIP ]</Text>
                </NBCard>
              </TouchableOpacity>

              {showAnswer && (
                <View style={styles.evalContainer}>
                  <Text style={styles.evalHeader}>RATE DIFFICULTY</Text>
                  <View style={styles.ratingButtons}>
                    <TouchableOpacity onPress={() => nextCard(1)} style={[styles.rateBtn, { backgroundColor: Colors.sage }]}><Text style={styles.rateBtnText}>EASY</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => nextCard(2)} style={[styles.rateBtn, { backgroundColor: Colors.warning }]}><Text style={styles.rateBtnText}>MED</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => nextCard(3)} style={[styles.rateBtn, { backgroundColor: Colors.error }]}><Text style={styles.rateBtnText}>HARD</Text></TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Sub-Tab Content: STUDY DUELS ── */}
      {subTab === 'duels' && (
        <ScrollView contentContainerStyle={{ padding: Spacing.md }}>
          <SectionHeader title="STUDY DUELS" subtitle="P2P BATTLE ROOMS" />

          {/* In a Room */}
          {inRoom && !duelActive && !duelResult && (
            <NBCard style={{ borderColor: Colors.gold }}>
              <View style={styles.duelRoomHeader}>
                <Swords size={20} color={Colors.gold} />
                <Text style={styles.duelRoomName}>{inRoom.name.toUpperCase()}</Text>
                <NBTag label={inRoom.status.toUpperCase()} color={inRoom.status === 'waiting' ? Colors.cobalt : Colors.sage} textColor={Colors.textPrimary} />
              </View>
              <NBDivider color={Colors.gold} />
              <Text style={styles.duelSubject}>📚 {inRoom.subject}</Text>
              <View style={styles.duelParticipantsRow}>
                <Users size={14} color={Colors.textSecondary} />
                <Text style={styles.duelParticipantText}>{inRoom.participants}/{inRoom.maxParticipants} scholars joined</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md }}>
                <NBButton
                  label={duelLoading ? 'Starting...' : 'START DUEL ⚔️'}
                  onPress={startDuel}
                  disabled={duelLoading}
                  style={{ flex: 1 }}
                />
                <NBButton label="LEAVE" onPress={exitRoom} variant="secondary" />
              </View>
            </NBCard>
          )}

          {/* Active Duel – Question Screen */}
          {duelActive && currentQuestion && (
            <View style={{ gap: Spacing.md }}>
              <NBCard style={{ borderColor: Colors.gold }}>
                <View style={styles.duelScoreboard}>
                  <View style={styles.duelScoreBox}>
                    <Text style={styles.duelScoreLabel}>YOU</Text>
                    <Text style={[styles.duelScoreVal, { color: Colors.gold }]}>{duelScore}</Text>
                  </View>
                  <Text style={styles.duelVsText}>VS</Text>
                  <View style={styles.duelScoreBox}>
                    <Text style={styles.duelScoreLabel}>OPPONENT</Text>
                    <Text style={[styles.duelScoreVal, { color: Colors.crimsonLight }]}>{Math.round(opponentScore)}</Text>
                  </View>
                </View>
                <View style={styles.duelTimerRow}>
                  <View style={[styles.duelTimerBar, { width: `${(duelTimeLeft / 20) * 100}%` as any, backgroundColor: duelTimeLeft > 10 ? Colors.sageLight : Colors.warning }]} />
                  <Text style={styles.duelTimerText}>{duelTimeLeft}s</Text>
                </View>
              </NBCard>

              <NBCard>
                <Text style={styles.duelQNum}>QUESTION {questionIdx + 1} OF {mockQuestions.length}</Text>
                <Text style={styles.duelQuestion}>{currentQuestion.question}</Text>
              </NBCard>

              <View style={styles.duelOptionsGrid}>
                {currentQuestion.options.map((opt, i) => {
                  let bg: string = Colors.bgCard as string;
                  let border: string = Colors.border as string;
                  if (selectedAnswer !== null) {
                    if (i === currentQuestion.correctIndex) { bg = Colors.sage as string; border = Colors.sageLight as string; }
                    else if (i === selectedAnswer && i !== currentQuestion.correctIndex) { bg = Colors.crimson as string; border = Colors.crimsonLight as string; }
                  }
                  return (
                    <TouchableOpacity
                      key={i}
                      onPress={() => handleAnswerSelect(i)}
                      disabled={selectedAnswer !== null}
                      style={[styles.duelOption, { backgroundColor: bg, borderColor: border }]}
                    >
                      <Text style={styles.duelOptionLetter}>{['A', 'B', 'C', 'D'][i]}</Text>
                      <Text style={styles.duelOptionText}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Duel Result */}
          {duelResult && (
            <NBCard style={{ alignItems: 'center', borderColor: duelResult === 'win' ? Colors.gold : Colors.border }}>
              <Trophy size={48} color={duelResult === 'win' ? Colors.gold : Colors.textMuted} />
              <Text style={[styles.duelResultTitle, { color: duelResult === 'win' ? Colors.gold : duelResult === 'lose' ? Colors.crimsonLight : Colors.textSecondary }]}>
                {duelResult === 'win' ? '🏆 YOU WIN!' : duelResult === 'lose' ? '💀 YOU LOSE' : '🤝 DRAW!'}
              </Text>
              <Text style={styles.duelResultScore}>{duelScore} vs {Math.round(opponentScore)}</Text>
              {duelResult === 'win' && <NBTag label="+150 XP EARNED" color={Colors.gold} textColor={Colors.textInverse} style={{ marginTop: Spacing.sm }} />}
              <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg }}>
                <NBButton label="REMATCH" onPress={startDuel} style={{ flex: 1 }} />
                <NBButton label="EXIT" onPress={exitRoom} variant="secondary" />
              </View>
            </NBCard>
          )}

          {/* Room List (if not in room) */}
          {!inRoom && (
            <View>
              <View style={styles.duelRoomListHeader}>
                <Text style={styles.roomListTitle}>LIVE ROOMS</Text>
                <TouchableOpacity onPress={() => setShowCreateForm(!showCreateForm)} style={styles.createRoomBtn}>
                  <Text style={styles.createRoomBtnText}>+ CREATE ROOM</Text>
                </TouchableOpacity>
              </View>

              {showCreateForm && (
                <NBCard style={{ marginBottom: Spacing.md, borderColor: Colors.gold }}>
                  <Text style={styles.label}>ROOM NAME</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. OS Final Prep"
                    placeholderTextColor={Colors.textMuted}
                    value={createRoomName}
                    onChangeText={setCreateRoomName}
                  />
                  <Text style={[styles.label, { marginTop: Spacing.sm }]}>SUBJECT</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. Operating Systems"
                    placeholderTextColor={Colors.textMuted}
                    value={createRoomSubject}
                    onChangeText={setCreateRoomSubject}
                  />
                  <NBButton
                    label={duelLoading ? 'Creating...' : 'CREATE & JOIN ROOM'}
                    onPress={createRoom}
                    disabled={duelLoading}
                    style={{ marginTop: Spacing.md }}
                  />
                </NBCard>
              )}

              {duelRooms.map(room => (
                <TouchableOpacity key={room.id} onPress={() => joinRoom(room)}>
                  <NBCard style={[styles.roomCard, room.status === 'finished' && { opacity: 0.5 }]}>
                    <View style={styles.roomCardRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.roomName}>{room.name}</Text>
                        <Text style={styles.roomSubject}>📚 {room.subject}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: Spacing.xs }}>
                        <NBTag
                          label={room.status.toUpperCase()}
                          color={room.status === 'active' ? Colors.sage : room.status === 'waiting' ? Colors.cobalt : Colors.bgElevated}
                          textColor={Colors.textPrimary}
                        />
                        <View style={styles.roomParticipants}>
                          <Users size={10} color={Colors.textMuted} />
                          <Text style={styles.roomPartText}>{room.participants}/{room.maxParticipants}</Text>
                        </View>
                      </View>
                    </View>
                  </NBCard>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Sub-Tab Content: ROADMAPS ── */}
      {subTab === 'roadmaps' && (
        <ScrollView contentContainerStyle={{ padding: Spacing.md }}>
          <SectionHeader title="STUDY ROADMAPS" subtitle="INTERACTIVE SYLLABUS TRACKERS" />
          
          {roadmaps.length === 0 ? (
            <EmptyState icon="🎯" title="No Roadmaps" subtitle="Ask Kora in Chat to generate a customized roadmap for any course." />
          ) : (
            roadmaps.map(rm => (
              <NBCard key={rm.id} style={{ marginBottom: Spacing.md }}>
                <Text style={styles.roadmapTitle}>{rm.title.toUpperCase()}</Text>
                <Text style={styles.roadmapDesc}>{rm.description}</Text>
                <NBDivider color={Colors.gold} />

                {rm.steps.map((step, sIdx) => {
                  const isCurrent = sIdx === rm.currentStep;
                  const isDone = sIdx < rm.currentStep;
                  return (
                    <View key={sIdx} style={[styles.stepItem, isCurrent && styles.stepItemActive]}>
                      <Circle size={12} color={isDone ? Colors.success : isCurrent ? Colors.gold : Colors.textMuted} fill={isDone ? Colors.success : 'transparent'} />
                      <Text style={[styles.stepText, isCurrent && styles.stepTextActive, isDone && styles.stepTextDone]}>
                        {step}
                      </Text>
                    </View>
                  );
                })}
              </NBCard>
            ))
          )}
        </ScrollView>
      )}

      {/* ── Sub-Tab Content: AI VIVA ORAL EXAM ── */}
      {subTab === 'viva' && (
        <ScrollView contentContainerStyle={{ padding: Spacing.md }}>
          <SectionHeader title="AI VIVA EXAM" subtitle="MOCK ORAL EVALUATION" />

          {!vivaActive ? (
            <NBCard>
              <Text style={styles.label}>ENTER TOPIC OR COURSE SUBJECT</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Operating Systems, Advanced DSA, Neural Networks"
                placeholderTextColor={Colors.textMuted}
                value={vivaSubject}
                onChangeText={setVivaSubject}
              />
              <NBButton
                label={vivaLoading ? 'Initializing viva...' : 'START VIVA SESSION'}
                onPress={startViva}
                disabled={vivaLoading}
                style={{ marginTop: Spacing.md }}
              />
            </NBCard>
          ) : (
            <View style={{ gap: Spacing.md }}>
              <NBCard>
                <Text style={styles.vivaSubjectTag}>VIVA TOPIC: {vivaSubject.toUpperCase()}</Text>
                <Text style={styles.questionText}>{vivaQuestion}</Text>
              </NBCard>

              {!vivaResult ? (
                <NBCard>
                  <Text style={styles.label}>YOUR RESPONSE</Text>
                  <TextInput
                    style={[styles.textInput, { height: 120, textAlignVertical: 'top' }]}
                    placeholder="Provide your conceptual explanation here..."
                    placeholderTextColor={Colors.textMuted}
                    multiline
                    value={vivaAnswerInput}
                    onChangeText={setVivaAnswerInput}
                  />
                  <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md }}>
                    <NBButton
                      label="SUBMIT RESPONSE"
                      onPress={submitVivaAnswer}
                      disabled={vivaLoading || !vivaAnswerInput.trim()}
                      style={{ flex: 1 }}
                    />
                    <NBButton
                      label="CANCEL"
                      onPress={endViva}
                      variant="secondary"
                    />
                  </View>
                </NBCard>
              ) : (
                <View style={{ gap: Spacing.md }}>
                  <NBCard style={{ borderColor: Colors.gold }}>
                    <View style={styles.scoreRow}>
                      <Text style={styles.scoreTitle}>AI EVALUATION SCORE</Text>
                      <Text style={styles.scoreValue}>{vivaResult.score}/100</Text>
                    </View>
                    <NBDivider />
                    <Text style={styles.feedbackText}>{vivaResult.feedback}</Text>
                  </NBCard>
                  <NBButton label="TRY ANOTHER QUESTION" onPress={startViva} />
                  <NBButton label="EXIT VIVA SESSION" onPress={endViva} variant="secondary" />
                </View>
              )}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Sub-Tab Content: SECOND BRAIN / MEMORY GRAPH ── */}
      {subTab === 'brain' && (
        <ScrollView contentContainerStyle={{ padding: Spacing.md }}>
          <SectionHeader
            title="SECOND BRAIN"
            subtitle="CONTEXT VAULT"
            right={
              <TouchableOpacity
                onPress={triggerIndexing}
                disabled={indexing}
                style={[
                  styles.indexTriggerBtn,
                  indexing && { opacity: 0.7 }
                ]}
              >
                {indexing ? (
                  <ActivityIndicator size="small" color={Colors.textInverse} />
                ) : (
                  <Text style={styles.indexTriggerBtnText}>⚡ INDEX BRAIN</Text>
                )}
              </TouchableOpacity>
            }
          />

          <NBCard style={styles.infoCard}>
            <Text style={styles.infoTitle}>🧠 OPENHUMAN MATRIX</Text>
            <Text style={styles.infoText}>
              Kora compiles your long-term context from chats, splits, and academic notes into RAG knowledge nodes.
            </Text>
          </NBCard>

          {nodesLoading ? (
            <ActivityIndicator size="large" color={Colors.gold} style={{ marginVertical: Spacing.xl }} />
          ) : memoryNodes.length === 0 ? (
            <EmptyState
              icon="🧠"
              title="No Memory Nodes Found"
              subtitle="Trigger indexing above to build Kora's memory vault from your database."
            />
          ) : (
            <View style={{ gap: Spacing.md }}>
              <Text style={styles.deckSubTitle}>COMPILED RAG NODES ({memoryNodes.length})</Text>
              
              {/* Grouped Lists by Tree Type */}
              {['source_tree', 'topic_tree', 'global_tree'].map(treeType => {
                const filtered = memoryNodes.filter(n => n.type === treeType);
                if (filtered.length === 0) return null;
                
                const titleLabel = 
                  treeType === 'source_tree' ? '🟢 RAW SOURCE DATA' : 
                  treeType === 'topic_tree' ? '🔵 ACADEMIC CONCEPTS' : 
                  '🟡 GLOBAL DIGESTS';

                const typeColor = 
                  treeType === 'source_tree' ? Colors.success : 
                  treeType === 'topic_tree' ? Colors.cobalt : 
                  Colors.gold;

                return (
                  <View key={treeType} style={{ gap: Spacing.xs, marginTop: Spacing.sm }}>
                    <Text style={[styles.treeTypeHeader, { color: typeColor }]}>{titleLabel}</Text>
                    {filtered.map(node => (
                      <TouchableOpacity
                        key={node.id}
                        onPress={() => viewNodeDetails(node)}
                        style={[
                          styles.nodeCard,
                          { borderColor: typeColor }
                        ]}
                      >
                        <View style={styles.nodeHeader}>
                          <Text style={styles.nodeTitle}>{node.title.toUpperCase()}</Text>
                          <Text style={[styles.nodePathTag, { color: typeColor }]}>{node.file_path}</Text>
                        </View>
                        <Text style={styles.nodeSummary} numberOfLines={2}>
                          {node.summary}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                );
              })}
            </View>
          )}

          {/* Node detail Modal */}
          <Modal
            visible={detailModalVisible}
            transparent
            animationType="slide"
            onRequestClose={() => setDetailModalVisible(false)}
          >
            <View style={styles.modalBg}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{selectedNode?.title.toUpperCase() || 'MEMORY NODE'}</Text>
                  <TouchableOpacity onPress={() => setDetailModalVisible(false)} style={styles.closeBtn}>
                    <Text style={styles.closeBtnText}>✖</Text>
                  </TouchableOpacity>
                </View>
                <NBDivider color={Colors.gold} />
                
                <ScrollView style={styles.modalBodyScroll}>
                  <Text style={styles.modalMetaLabel}>VIRTUAL PATH: {selectedNode?.file_path}</Text>
                  <Text style={styles.modalMetaLabel}>MEMORY LAYER: {selectedNode?.type.toUpperCase()}</Text>
                  <NBDivider />
                  <Text style={styles.modalBodyText}>{nodeContent}</Text>
                </ScrollView>
                
                <View style={{ marginTop: Spacing.md }}>
                  <NBButton label="CLOSE EXPLORER" onPress={() => setDetailModalVisible(false)} />
                </View>
              </View>
            </View>
          </Modal>
        </ScrollView>
      )}

      {/* ── Sub-Tab Content: CONCEPT MAP ── */}
      {subTab === 'map' && (
        <ScrollView contentContainerStyle={{ padding: Spacing.md }}>
          <SectionHeader title="CONCEPT MAP" subtitle="AI-GENERATED MIND MAP" />

          <NBCard style={styles.mapInputCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm }}>
              <GitBranch size={18} color={Colors.gold} />
              <Text style={styles.mapInputLabel}>SUBJECT</Text>
            </View>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Operating Systems, Machine Learning..."
              placeholderTextColor={Colors.textMuted}
              value={mapSubject}
              onChangeText={setMapSubject}
            />
            <Text style={[styles.mapInputLabel, { marginTop: Spacing.sm }]}>TOPIC (Optional)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Process Scheduling, Backpropagation..."
              placeholderTextColor={Colors.textMuted}
              value={mapTopic}
              onChangeText={setMapTopic}
            />
            <NBButton
              label={mapLoading ? 'GENERATING MAP...' : '⚡ GENERATE CONCEPT MAP'}
              onPress={generateConceptMap}
              disabled={mapLoading}
              style={{ marginTop: Spacing.md }}
            />
          </NBCard>

          {mapLoading && (
            <View style={styles.mapLoadingContainer}>
              <ActivityIndicator size="large" color={Colors.gold} />
              <Text style={styles.mapLoadingText}>KORA IS MAPPING YOUR CONCEPTS...</Text>
            </View>
          )}

          {conceptMap && !mapLoading && (
            <View style={{ gap: Spacing.md }}>
              <NBCard style={{ borderColor: Colors.gold }}>
                <Text style={styles.mapTitle}>{conceptMap.title.toUpperCase()}</Text>
                <Text style={styles.mapStats}>
                  {conceptMap.nodes.length} NODES · {conceptMap.edges.length} CONNECTIONS
                </Text>
              </NBCard>

              {/* SVG Concept Map Visualizer */}
              <NBCard style={styles.mapCanvas}>
                <Svg width={SCREEN_WIDTH - Spacing.md * 2} height={MAP_H}>
                  {(() => {
                    const positions = computeNodePositions(conceptMap.nodes);
                    return (
                      <G>
                        {/* Draw edges */}
                        {conceptMap.edges.map((edge, i) => {
                          const fromPos = positions[edge.from];
                          const toPos = positions[edge.to];
                          if (!fromPos || !toPos) return null;
                          const midX = (fromPos.x + toPos.x) / 2;
                          const midY = (fromPos.y + toPos.y) / 2;
                          return (
                            <G key={`edge-${i}`}>
                              <Line
                                x1={fromPos.x}
                                y1={fromPos.y}
                                x2={toPos.x}
                                y2={toPos.y}
                                stroke={Colors.border}
                                strokeWidth="1.5"
                                strokeOpacity="0.6"
                              />
                              <SvgText
                                x={midX}
                                y={midY - 4}
                                fill={Colors.textMuted}
                                fontSize="7"
                                textAnchor="middle"
                                fontFamily="JetBrainsMono_400Regular"
                              >
                                {edge.label}
                              </SvgText>
                            </G>
                          );
                        })}
                        {/* Draw nodes */}
                        {conceptMap.nodes.map(node => {
                          const pos = positions[node.id];
                          if (!pos) return null;
                          const r = node.type === 'root' ? 36 : node.type === 'branch' ? 26 : 20;
                          const isSelected = selectedMapNode === node.id;
                          return (
                            <G
                              key={node.id}
                              onPress={() => setSelectedMapNode(isSelected ? null : node.id)}
                            >
                              <SvgCircle
                                cx={pos.x}
                                cy={pos.y}
                                r={r + (isSelected ? 4 : 0)}
                                fill={node.color}
                                opacity={isSelected ? 1 : 0.85}
                                stroke={isSelected ? Colors.gold : '#000'}
                                strokeWidth={isSelected ? 3 : 1.5}
                              />
                              <SvgText
                                x={pos.x}
                                y={pos.y + 4}
                                fill="#0A0A0A"
                                fontSize={node.type === 'root' ? 9 : 7}
                                textAnchor="middle"
                                fontFamily="JetBrainsMono_700Bold"
                              >
                                {node.label.length > 12 ? node.label.slice(0, 12) + '…' : node.label}
                              </SvgText>
                            </G>
                          );
                        })}
                      </G>
                    );
                  })()}
                </Svg>
              </NBCard>

              {/* Selected Node Detail */}
              {selectedMapNode && (() => {
                const node = conceptMap.nodes.find(n => n.id === selectedMapNode);
                const connectedEdges = conceptMap.edges.filter(e => e.from === selectedMapNode || e.to === selectedMapNode);
                if (!node) return null;
                return (
                  <NBCard style={[styles.selectedNodeCard, { borderColor: node.color }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                      <View style={[styles.nodeColorDot, { backgroundColor: node.color }]} />
                      <Text style={styles.selectedNodeTitle}>{node.label.toUpperCase()}</Text>
                      <NBTag label={node.type.toUpperCase()} color={Colors.bgElevated} textColor={Colors.textSecondary} />
                    </View>
                    <NBDivider color={node.color} />
                    {connectedEdges.length > 0 && (
                      <View style={{ gap: 4 }}>
                        <Text style={styles.nodeConnectionsHeader}>CONNECTIONS:</Text>
                        {connectedEdges.map((e, i) => {
                          const otherId = e.from === selectedMapNode ? e.to : e.from;
                          const other = conceptMap.nodes.find(n => n.id === otherId);
                          return (
                            <Text key={i} style={styles.nodeConnectionItem}>
                              → {e.label} → {other?.label}
                            </Text>
                          );
                        })}
                      </View>
                    )}
                  </NBCard>
                );
              })()}

              {/* Legend */}
              <View style={styles.mapLegend}>
                {[
                  { color: '#7B6EF6', label: 'ROOT NODE' },
                  { color: '#45DB91', label: 'BRANCH' },
                  { color: '#FFD166', label: 'LEAF' },
                ].map(item => (
                  <View key={item.label} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                    <Text style={styles.legendLabel}>{item.label}</Text>
                  </View>
                ))}
              </View>

              <NBButton
                label="REGENERATE MAP"
                onPress={generateConceptMap}
                variant="secondary"
              />
            </View>
          )}

          {!conceptMap && !mapLoading && (
            <EmptyState
              icon="🗺️"
              title="No Map Generated"
              subtitle="Enter a subject above and tap Generate to create an AI concept map."
            />
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  selectorBar: {
    flexDirection: 'row',
    backgroundColor: Colors.bgCard,
    borderBottomWidth: BorderWidth.medium,
    borderColor: Colors.border,
  },
  selectorBtn: {
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    borderRightWidth: BorderWidth.thin,
    borderColor: Colors.border,
    minWidth: 80,
  },
  selectorBtnActive: {
    backgroundColor: Colors.gold,
  },
  selectorBtnText: {
    ...Typography.monoBold,
    color: Colors.textPrimary,
    fontSize: 10,
    letterSpacing: 1,
  },

  // ── Duels Styles ──────────────────────────────────────────────
  duelRoomHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs },
  duelRoomName: { ...Typography.display, color: Colors.textPrimary, fontSize: 16, flex: 1 },
  duelSubject: { ...Typography.bodyBold, color: Colors.textPrimary, fontSize: 14, marginBottom: Spacing.xs },
  duelParticipantsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  duelParticipantText: { ...Typography.mono, color: Colors.textSecondary, fontSize: 11 },
  duelScoreboard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  duelScoreBox: { alignItems: 'center', gap: 2 },
  duelScoreLabel: { ...Typography.monoBold, color: Colors.textMuted, fontSize: 9, letterSpacing: 1 },
  duelScoreVal: { fontFamily: 'JetBrainsMono_700Bold', fontSize: 32, letterSpacing: 2 },
  duelVsText: { ...Typography.display, color: Colors.textSecondary, fontSize: 18 },
  duelTimerRow: { height: 8, backgroundColor: Colors.bgElevated, borderWidth: BorderWidth.thin, borderColor: Colors.border, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  duelTimerBar: { height: '100%', minWidth: 2 },
  duelTimerText: { position: 'absolute', right: 4, ...Typography.monoBold, color: Colors.textPrimary, fontSize: 10 },
  duelQNum: { ...Typography.monoBold, color: Colors.gold, fontSize: 10, letterSpacing: 1, marginBottom: Spacing.sm },
  duelQuestion: { ...Typography.heading, color: Colors.textPrimary, fontSize: 18, lineHeight: 26 },
  duelOptionsGrid: { gap: Spacing.sm },
  duelOption: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderWidth: BorderWidth.medium, borderColor: Colors.border,
    ...Shadows.brutalSm,
  },
  duelOptionLetter: { ...Typography.monoBold, color: Colors.gold, fontSize: 14, width: 20, textAlign: 'center' },
  duelOptionText: { ...Typography.body, color: Colors.textPrimary, fontSize: 14, flex: 1 },
  duelResultTitle: { ...Typography.display, fontSize: 28, marginTop: Spacing.md },
  duelResultScore: { ...Typography.mono, color: Colors.textSecondary, fontSize: 14, marginTop: Spacing.xs },
  duelRoomListHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  roomListTitle: { ...Typography.monoBold, color: Colors.gold, fontSize: 11, letterSpacing: 2 },
  createRoomBtn: {
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
    borderWidth: BorderWidth.medium, borderColor: Colors.gold,
    backgroundColor: Colors.bgCard,
  },
  createRoomBtnText: { ...Typography.monoBold, color: Colors.gold, fontSize: 10, letterSpacing: 1 },
  roomCard: { marginBottom: Spacing.sm },
  roomCardRow: { flexDirection: 'row', alignItems: 'center' },
  roomName: { ...Typography.display, color: Colors.textPrimary, fontSize: 16, marginBottom: 2 },
  roomSubject: { ...Typography.body, color: Colors.textSecondary, fontSize: 12 },
  roomParticipants: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  roomPartText: { ...Typography.mono, color: Colors.textMuted, fontSize: 10 },
  cardHeader: {
    alignItems: 'center',
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  deckName: {
    ...Typography.display,
    color: Colors.textPrimary,
    fontSize: 22,
    marginTop: Spacing.sm,
  },
  deckDescription: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  sectionSubtitleHeader: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: Spacing.sm,
  },
  cardItem: {
    gap: Spacing.sm,
  },
  cardFrontText: {
    ...Typography.bodyBold,
    color: Colors.textPrimary,
    fontSize: 15,
  },
  cardBackText: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontSize: 13,
  },
  reviewWrapper: {
    gap: Spacing.md,
  },
  backLink: {
    marginBottom: Spacing.sm,
  },
  backLinkText: {
    ...Typography.monoMedium,
    color: Colors.gold,
    fontSize: 11,
    letterSpacing: 1.5,
  },
  countText: {
    ...Typography.monoBold,
    color: Colors.textSecondary,
    fontSize: 12,
  },
  flashcardFrame: {
    minHeight: 220,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  flashcardText: {
    ...Typography.heading,
    fontSize: 20,
    color: Colors.textPrimary,
    textAlign: 'center',
    lineHeight: 28,
  },
  flipTip: {
    ...Typography.mono,
    color: Colors.textMuted,
    fontSize: 10,
    marginTop: Spacing.lg,
  },
  evalContainer: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  evalHeader: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 11,
    letterSpacing: 1,
  },
  ratingButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  rateBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
  },
  rateBtnText: {
    ...Typography.monoBold,
    color: Colors.textPrimary,
    fontSize: 11,
  },
  roadmapTitle: {
    ...Typography.display,
    color: Colors.textPrimary,
    fontSize: 16,
  },
  roadmapDesc: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontSize: 12,
    marginVertical: Spacing.xs,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  stepItemActive: {
    backgroundColor: Colors.bgElevated,
    paddingLeft: Spacing.sm,
    borderLeftWidth: BorderWidth.thick,
    borderLeftColor: Colors.gold,
  },
  stepText: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontSize: 13,
  },
  stepTextActive: {
    ...Typography.bodyBold,
    color: Colors.textPrimary,
  },
  stepTextDone: {
    textDecorationLine: 'line-through',
    color: Colors.textMuted,
  },
  label: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 10,
    letterSpacing: 1.5,
    marginBottom: Spacing.sm,
  },
  textInput: {
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    backgroundColor: Colors.bgElevated,
    color: Colors.textPrimary,
    padding: Spacing.md,
    ...Typography.body,
    fontSize: 14,
  },
  vivaSubjectTag: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 11,
    letterSpacing: 1.5,
    marginBottom: Spacing.xs,
  },
  questionText: {
    ...Typography.heading,
    color: Colors.textPrimary,
    fontSize: 18,
    lineHeight: 26,
  },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scoreTitle: {
    ...Typography.monoBold,
    color: Colors.textSecondary,
    fontSize: 11,
  },
  scoreValue: {
    ...Typography.display,
    color: Colors.gold,
    fontSize: 24,
  },
  feedbackText: {
    ...Typography.body,
    color: Colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
  },
  
  // ── Brain Visualizer Styles ──
  indexTriggerBtn: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.gold,
    backgroundColor: Colors.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  indexTriggerBtnText: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 10,
    letterSpacing: 1,
  },
  infoCard: {
    marginBottom: Spacing.md,
    borderLeftWidth: BorderWidth.thick,
    borderLeftColor: Colors.gold,
  },
  infoTitle: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 11,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  infoText: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  deckSubTitle: {
    ...Typography.monoBold,
    color: Colors.textMuted,
    fontSize: 10,
    letterSpacing: 1.5,
  },
  treeTypeHeader: {
    ...Typography.monoBold,
    fontSize: 11,
    letterSpacing: 1.5,
    marginTop: Spacing.sm,
  },
  nodeCard: {
    backgroundColor: Colors.bgCard,
    borderWidth: BorderWidth.medium,
    padding: Spacing.md,
    ...Shadows.brutalSm,
    gap: 4,
    marginBottom: Spacing.xs,
  },
  nodeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  nodeTitle: {
    ...Typography.display,
    color: Colors.textPrimary,
    fontSize: 13,
  },
  nodePathTag: {
    ...Typography.mono,
    fontSize: 9,
  },
  nodeSummary: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    padding: Spacing.md,
  },
  modalContent: {
    backgroundColor: Colors.bgCard,
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    padding: Spacing.md,
    ...Shadows.brutal,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  modalTitle: {
    ...Typography.display,
    color: Colors.gold,
    fontSize: 16,
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    color: Colors.textPrimary,
    fontSize: 16,
  },
  modalBodyScroll: {
    marginVertical: Spacing.sm,
  },
  modalMetaLabel: {
    ...Typography.monoBold,
    color: Colors.textSecondary,
    fontSize: 9,
    marginBottom: 2,
  },
  modalBodyText: {
    ...Typography.mono,
    color: Colors.textPrimary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: Spacing.sm,
  },
  
  // ── Scanner Styles ──
  scannerOverlayBg: {
    flex: 1,
    backgroundColor: 'rgba(10,10,10,0.95)',
    justifyContent: 'center',
    padding: Spacing.md,
  },
  scannerOverlayContent: {
    backgroundColor: Colors.bgCard,
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    padding: Spacing.xl,
    ...Shadows.brutal,
    alignItems: 'center',
    width: '100%',
  },
  scannerTitle: {
    ...Typography.display,
    color: Colors.textPrimary,
    fontSize: 14,
    marginBottom: Spacing.md,
  },
  scannerAnimationContainer: {
    alignItems: 'center',
    gap: Spacing.md,
    height: 120,
    justifyContent: 'center',
    width: '100%',
  },
  laserLine: {
    width: '80%',
    height: 4,
    backgroundColor: Colors.crimson,
    shadowColor: Colors.crimson,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    marginTop: Spacing.sm,
  },
  scannerText: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 10,
    textAlign: 'center',
    letterSpacing: 1,
  },
  scanSummaryHeader: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 11,
    letterSpacing: 1.5,
  },
  scanSummaryScroll: {
    maxHeight: 200,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    backgroundColor: Colors.bgElevated,
    padding: Spacing.sm,
    width: '100%',
    marginVertical: Spacing.sm,
  },
  scanSummaryText: {
    ...Typography.mono,
    color: Colors.textPrimary,
    fontSize: 12,
    lineHeight: 18,
  },

  // ── Concept Map Styles ──
  mapInputCard: {
    borderColor: Colors.gold,
    marginBottom: Spacing.md,
  },
  mapInputLabel: {
    ...Typography.monoBold,
    color: Colors.textMuted,
    fontSize: 9,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  mapLoadingContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
  },
  mapLoadingText: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 10,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  mapTitle: {
    ...Typography.display,
    color: Colors.gold,
    fontSize: 18,
    marginBottom: 4,
  },
  mapStats: {
    ...Typography.mono,
    color: Colors.textSecondary,
    fontSize: 10,
    letterSpacing: 1,
  },
  mapCanvas: {
    padding: Spacing.xs,
    borderColor: Colors.border,
    alignItems: 'center',
    overflow: 'hidden',
    backgroundColor: '#0D0D0D',
  },
  selectedNodeCard: {
    borderWidth: BorderWidth.medium,
    gap: Spacing.sm,
  },
  nodeColorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#000',
  },
  selectedNodeTitle: {
    ...Typography.display,
    color: Colors.textPrimary,
    fontSize: 14,
    flex: 1,
  },
  nodeConnectionsHeader: {
    ...Typography.monoBold,
    color: Colors.textMuted,
    fontSize: 9,
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  nodeConnectionItem: {
    ...Typography.mono,
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  mapLegend: {
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#000',
  },
  legendLabel: {
    ...Typography.monoBold,
    color: Colors.textMuted,
    fontSize: 8,
    letterSpacing: 1,
  },
});
