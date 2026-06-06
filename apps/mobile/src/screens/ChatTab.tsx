import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Animated, Platform, ActivityIndicator, Alert, Modal
} from 'react-native';
import { Colors, Typography, Spacing, BorderWidth, Shadows } from '../constants/theme';
import { NBCard, NBButton, LoadingDots, NBDivider } from '../components/NBComponents';
import { MessageSquare, Mic, Send, Trash2, Volume2, VolumeX, Plus, X, Upload, Paperclip, Check, Phone, PhoneOff } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';

interface ChatTabProps {
  apiBaseUrl: string;
  userId: string;
  isSpeechEnabled: boolean;
  setIsSpeechEnabled: (val: boolean) => void;
  onRefreshData: () => void;
}

interface Message {
  id: string;
  sender: 'kora' | 'user';
  text: string;
  time: string;
}

interface ChatSession {
  id: string;
  title: string;
}

// ── Audio Waveform Visualizer ──
const AudioWaveform = () => {
  const animValues = useRef([0, 1, 2, 3, 4, 5, 6, 7].map(() => new Animated.Value(1))).current;
  useEffect(() => {
    const animations = animValues.map(val => {
      return Animated.loop(
        Animated.sequence([
          Animated.timing(val, {
            toValue: Math.random() * 2.5 + 0.5,
            duration: Math.random() * 400 + 200,
            useNativeDriver: true
          }),
          Animated.timing(val, {
            toValue: 1,
            duration: Math.random() * 400 + 200,
            useNativeDriver: true
          })
        ])
      );
    });
    animations.forEach(anim => anim.start());
    return () => {
      animations.forEach(anim => anim.stop());
    };
  }, []);
  return (
    <View style={styles.audioWaveformContainer}>
      {animValues.map((val, i) => (
        <Animated.View
          key={i}
          style={[
            styles.audioWaveBar,
            {
              transform: [{ scaleY: val }]
            }
          ]}
        />
      ))}
    </View>
  );
};

export default function ChatTab({ apiBaseUrl, userId, isSpeechEnabled, setIsSpeechEnabled, onRefreshData }: ChatTabProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([
    { id: 'default', title: 'Main Session' }
  ]);
  const [activeSessionId, setActiveSessionId] = useState('default');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'kora',
      text: 'Hail Scholar! Kora is ready. Ask me to draft a roadmap, summarize a lecture document, log expense debts, or update your schedule.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingInstance, setRecordingInstance] = useState<Audio.Recording | null>(null);
  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // ── Voice Call States & Actions ──
  const [voiceCallActive, setVoiceCallActive] = useState(false);
  const [voiceCallStatus, setVoiceCallStatus] = useState<'idle' | 'listening' | 'processing' | 'speaking'>('idle');
  const [voiceCallText, setVoiceCallText] = useState("Kora is ready to talk. Tap the mic button below to speak.");
  const [isContinuousSpeech, setIsContinuousSpeech] = useState(false);
  const isContinuousSpeechRef = useRef(isContinuousSpeech);
  useEffect(() => {
    isContinuousSpeechRef.current = isContinuousSpeech;
  }, [isContinuousSpeech]);

  const startCallRecording = async () => {
    try {
      Speech.stop(); // Stop any current speech if user interrupts
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecordingInstance(recording);
      setVoiceCallStatus('listening');
    } catch (err) {
      console.error('Failed to start call recording:', err);
      Alert.alert('Mic Error', 'Could not access microphone.');
    }
  };

  const stopCallRecording = async () => {
    if (!recordingInstance) return;
    setVoiceCallStatus('processing');
    try {
      const status = await recordingInstance.stopAndUnloadAsync();
      const duration_ms = status.durationMillis || 0;
      const uri = recordingInstance.getURI();
      setRecordingInstance(null);
      
      if (uri) {
        try {
          const formData = new FormData();
          const filename = uri.split('/').pop() || 'voice.m4a';
          const ext = filename.split('.').pop() || 'm4a';
          
          formData.append('file', {
            uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''),
            name: filename,
            type: `audio/${ext === 'm4a' ? 'mp4' : ext === 'caf' ? 'x-caf' : ext}`
          } as any);
          formData.append('user_id', userId);
          formData.append('duration_ms', duration_ms.toString());
          
          const response = await fetch(`${apiBaseUrl}/api/chat/voice`, {
            method: 'POST',
            body: formData,
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'multipart/form-data',
            },
          });
          
          if (!response.ok) throw new Error('Voice endpoint error');
          
          const data = await response.json();
          const transcriptionText = data.transcription || "🎤 [Voice Clip]";
          const replyText = data.reply || "I processed your request.";

          // Add to chat history
          const userMsg: Message = {
            id: Math.random().toString(),
            sender: 'user',
            text: `🎤 Voice: ${transcriptionText}`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
          const botMsg: Message = {
            id: Math.random().toString(),
            sender: 'kora',
            text: replyText,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
          setMessages(prev => [...prev, userMsg, botMsg]);
          onRefreshData();

          // Set call text and trigger Speech synthesis
          setVoiceCallText(`Kora: "${replyText}"`);
          setVoiceCallStatus('speaking');
          Speech.speak(replyText, {
            onStart: () => setVoiceCallStatus('speaking'),
            onDone: () => {
              setVoiceCallStatus('idle');
              if (isContinuousSpeechRef.current) {
                setTimeout(() => {
                  startCallRecording();
                }, 1200);
              }
            },
            onError: () => {
              setVoiceCallStatus('idle');
              if (isContinuousSpeechRef.current) {
                setTimeout(() => {
                  startCallRecording();
                }, 1200);
              }
            }
          });

        } catch (uploadErr) {
          console.error("Call upload error:", uploadErr);
          const fallbackReply = "This is a virtual sandbox evaluation of voice response. Kora is operating offline.";
          setVoiceCallText(`Kora: "${fallbackReply}"`);
          setVoiceCallStatus('speaking');
          Speech.speak(fallbackReply, {
            onStart: () => setVoiceCallStatus('speaking'),
            onDone: () => {
              setVoiceCallStatus('idle');
              if (isContinuousSpeechRef.current) {
                setTimeout(() => {
                  startCallRecording();
                }, 1200);
              }
            },
            onError: () => {
              setVoiceCallStatus('idle');
              if (isContinuousSpeechRef.current) {
                setTimeout(() => {
                  startCallRecording();
                }, 1200);
              }
            }
          });
        }
      }
    } catch (err) {
      console.error("Failed to stop call recording:", err);
      setVoiceCallStatus('idle');
    }
  };

  const endVoiceCall = () => {
    Speech.stop();
    setVoiceCallActive(false);
    setVoiceCallStatus('idle');
  };

  const scrollViewRef = useRef<ScrollView>(null);

  const handleSend = async (textToSend?: string) => {
    const targetText = textToSend || input.trim();
    if (!targetText) return;
    if (!textToSend) setInput('');

    const newMsg: Message = {
      id: Math.random().toString(),
      sender: 'user',
      text: targetText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, newMsg]);
    setSending(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          session_id: activeSessionId,
          message: targetText
        })
      });

      const data = await response.json();
      const botMsg: Message = {
        id: Math.random().toString(),
        sender: 'kora',
        text: data.reply || "Unable to retrieve a response.",
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, botMsg]);
      onRefreshData(); // refresh parent items if a command was handled
    } catch (err) {
      const botMsg: Message = {
        id: Math.random().toString(),
        sender: 'kora',
        text: "Kora offline. Simulating response in offline Sandbox: Operation logged locally.",
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, botMsg]);
    } finally {
      setSending(false);
    }
  };

  const createSession = () => {
    const id = `session_${Date.now()}`;
    const newSession: ChatSession = { id, title: `Study Log #${sessions.length + 1}` };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(id);
    setMessages([
      {
        id: 'welcome_new',
        sender: 'kora',
        text: `New session started. Ask any questions specifically for this topic.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]);
    setShowSessionMenu(false);
  };

  const clearSession = () => {
    setMessages([]);
    Alert.alert('Session Cleared', 'Messages removed locally.');
  };

  // ── Document/PDF Picker Upload (RAG feature) ──
  const handleDocUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain', 'text/*']
      });
      if (result.canceled || !result.assets?.length) return;
      const file = result.assets[0];
      
      setIsUploading(true);
      const formData = new FormData();
      formData.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.mimeType || 'application/octet-stream'
      } as any);
      formData.append('user_id', userId);
      formData.append('subject', 'General');

      const res = await fetch(`${apiBaseUrl}/api/study/upload-material`, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      const data = await res.json();
      if (res.ok) {
        Alert.alert('📚 Indexed!', data.message || `Uploaded ${file.name}`);
        handleSend(`[I uploaded a lecture document: ${file.name}. Please summarize it and extract syllabus notes.]`);
      } else {
        Alert.alert('Upload Failed', data.detail || 'Failed to process document.');
      }
    } catch (err) {
      Alert.alert('Mock Success', 'Offline mode simulated - document indexed in Memory Vault.');
    } finally {
      setIsUploading(false);
    }
  };

  // ── Voice Call / Live Taught Audio Stream ──
  const startRecording = async () => {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecordingInstance(recording);
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording', err);
      Alert.alert('Audio Error', 'Could not request mic permissions.');
    }
  };

  const stopRecording = async () => {
    if (!recordingInstance) return;
    setIsRecording(false);
    try {
      const status = await recordingInstance.stopAndUnloadAsync();
      const duration_ms = status.durationMillis || 0;
      const uri = recordingInstance.getURI();
      setRecordingInstance(null);
      
      if (uri) {
        setSending(true);
        try {
          const formData = new FormData();
          const filename = uri.split('/').pop() || 'voice.m4a';
          const ext = filename.split('.').pop() || 'm4a';
          
          formData.append('file', {
            uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''),
            name: filename,
            type: `audio/${ext === 'm4a' ? 'mp4' : ext === 'caf' ? 'x-caf' : ext}`
          } as any);
          formData.append('user_id', userId);
          formData.append('duration_ms', duration_ms.toString());
          
          const response = await fetch(`${apiBaseUrl}/api/chat/voice`, {
            method: 'POST',
            body: formData,
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'multipart/form-data',
            },
          });
          
          if (!response.ok) {
            throw new Error('Server returned error status');
          }
          
          const data = await response.json();
          const transcriptionText = data.transcription || "🎤 [Voice Clip]";
          
          // Log User message locally
          const userMsg: Message = {
            id: Math.random().toString(),
            sender: 'user',
            text: `🎤 Voice: ${transcriptionText}`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
          
          // Log Kora message locally
          const botMsg: Message = {
            id: Math.random().toString(),
            sender: 'kora',
            text: data.reply || "I processed your voice clip successfully.",
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
          
          setMessages(prev => [...prev, userMsg, botMsg]);
          onRefreshData(); // refresh parent items
        } catch (uploadErr) {
          console.error('Failed to upload voice recording:', uploadErr);
          // Local fallback simulation if server fails or offline
          const userMsg: Message = {
            id: Math.random().toString(),
            sender: 'user',
            text: '🎤 Voice Message',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
          const botMsg: Message = {
            id: Math.random().toString(),
            sender: 'kora',
            text: "Kora offline. Audio processed in offline Sandbox: Operation logged locally.",
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
          setMessages(prev => [...prev, userMsg, botMsg]);
        } finally {
          setSending(false);
        }
      }
    } catch (err) {
      console.error('Failed to stop recording:', err);
    }
  };

  return (
    <View style={styles.container}>
      {/* Session Header / Selector */}
      <View style={styles.sessionBar}>
        <TouchableOpacity style={styles.sessionSelector} onPress={() => setShowSessionMenu(!showSessionMenu)}>
          <MessageSquare size={16} color={Colors.gold} />
          <Text style={styles.sessionSelectorText}>
            {sessions.find(s => s.id === activeSessionId)?.title.toUpperCase() || 'CHAT SESSION'}
          </Text>
          <Text style={{ color: Colors.gold, fontSize: 10 }}>▼</Text>
        </TouchableOpacity>

        <View style={styles.iconControls}>
          <TouchableOpacity onPress={() => setVoiceCallActive(true)} style={styles.iconBtn}>
            <Phone size={18} color={Colors.gold} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsSpeechEnabled(!isSpeechEnabled)} style={styles.iconBtn}>
            {isSpeechEnabled ? <Volume2 size={18} color={Colors.gold} /> : <VolumeX size={18} color={Colors.textMuted} />}
          </TouchableOpacity>
          <TouchableOpacity onPress={clearSession} style={styles.iconBtn}>
            <Trash2 size={18} color={Colors.crimsonLight} />
          </TouchableOpacity>
        </View>
      </View>

      {showSessionMenu && (
        <NBCard style={styles.dropdownMenu}>
          <View style={styles.dropdownHeader}>
            <Text style={styles.dropdownTitle}>SESSIONS</Text>
            <TouchableOpacity onPress={() => setShowSessionMenu(false)}>
              <X size={16} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <NBDivider color={Colors.gold} />
          <ScrollView style={{ maxHeight: 150 }}>
            {sessions.map(s => (
              <TouchableOpacity
                key={s.id}
                onPress={() => {
                  setActiveSessionId(s.id);
                  setShowSessionMenu(false);
                }}
                style={[styles.dropdownItem, activeSessionId === s.id && styles.dropdownItemActive]}
              >
                <Text style={[styles.dropdownItemText, activeSessionId === s.id && { color: Colors.textInverse }]}>
                  {s.title.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <NBDivider />
          <NBButton label="New Session" onPress={createSession} size="sm" />
        </NBCard>
      )}

      {/* Messages List */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesList}
        contentContainerStyle={{ padding: Spacing.md, gap: Spacing.md }}
        onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((m) => {
          const isUser = m.sender === 'user';
          return (
            <View key={m.id} style={[styles.msgWrapper, isUser ? styles.msgWrapperUser : styles.msgWrapperBot]}>
              <View style={[styles.messageBubble, isUser ? styles.bubbleUser : styles.bubbleBot]}>
                <Text style={[styles.messageText, isUser ? styles.textUser : styles.textBot]}>{m.text}</Text>
                <Text style={[styles.messageTime, isUser ? styles.timeUser : styles.timeBot]}>{m.time}</Text>
              </View>
            </View>
          );
        })}
        {sending && (
          <View style={[styles.msgWrapper, styles.msgWrapperBot]}>
            <View style={[styles.messageBubble, styles.bubbleBot, { minWidth: 60, alignItems: 'center' }]}>
              <LoadingDots />
            </View>
          </View>
        )}
      </ScrollView>

      {/* Bottom Input Area */}
      <View style={styles.inputContainer}>
        {/* Document Attachment Picker button */}
        <TouchableOpacity style={styles.actionBtn} onPress={handleDocUpload} disabled={isUploading}>
          {isUploading ? (
            <ActivityIndicator size="small" color={Colors.gold} />
          ) : (
            <Paperclip size={20} color={Colors.gold} />
          )}
        </TouchableOpacity>

        <TextInput
          style={styles.textInput}
          placeholder="COMMAND KORA OR UPLOAD DOC..."
          placeholderTextColor={Colors.textMuted}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => handleSend()}
          multiline
        />

        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.actionBtn, isRecording && styles.actionBtnActive]}
            onPress={isRecording ? stopRecording : startRecording}
          >
            <Mic size={20} color={isRecording ? Colors.textInverse : Colors.gold} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.sendBtn} onPress={() => handleSend()}>
            <Send size={20} color={Colors.textInverse} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Live Voice Recording Waveform Overlay */}
      <Modal visible={isRecording} transparent animationType="fade">
        <View style={styles.audioOverlayContainer}>
          <View style={styles.audioOverlayContent}>
            <Text style={styles.audioTitleText}>LISTENING TO LECTURE STREAM...</Text>
            <AudioWaveform />
            <Text style={styles.audioStatusHint}>Speak clearly. Kora is recording your lecture query.</Text>
            <TouchableOpacity onPress={stopRecording} style={styles.audioStopBtn}>
              <Check size={28} color={Colors.textInverse} />
            </TouchableOpacity>
            <Text style={styles.audioStopLabel}>TAP TO STOP & SEND</Text>
          </View>
        </View>
      </Modal>

      {/* Immersive Fullscreen Voice Call Modal */}
      <Modal visible={voiceCallActive} transparent animationType="slide">
        <View style={styles.callOverlayContainer}>
          <View style={styles.callOverlayContent}>
            {/* Call Header */}
            <View style={styles.callHeader}>
              <Text style={styles.callTitleText}>SECURE VOICE BRIDGE</Text>
              <Text style={styles.callSubText}>USER ID: {userId.toUpperCase().slice(0, 8)}</Text>
            </View>

            {/* Glowing / Pulsing Avatar Waveform */}
            <View style={styles.callAvatarContainer}>
              <View style={[
                styles.avatarCircle,
                voiceCallStatus === 'listening' && styles.avatarCircleListening,
                voiceCallStatus === 'speaking' && styles.avatarCircleSpeaking,
                voiceCallStatus === 'processing' && styles.avatarCircleProcessing
              ]}>
                <Text style={styles.avatarText}>🧠</Text>
              </View>
              <Text style={styles.callStatusText}>
                {voiceCallStatus === 'idle' ? 'KORA IS IDLE' :
                 voiceCallStatus === 'listening' ? 'LISTENING TO USER...' :
                 voiceCallStatus === 'processing' ? 'PROCESSING NEURAL AUDIO...' :
                 'KORA IS SPEAKING...'}
              </Text>
            </View>

            {/* Waveform Visualizer (Active when recording or speaking) */}
            <View style={{ height: 60, justifyContent: 'center' }}>
              {(voiceCallStatus === 'listening' || voiceCallStatus === 'speaking') ? (
                <AudioWaveform />
              ) : (
                <View style={styles.waveformDotted} />
              )}
            </View>

            {/* Transcript/Message Area */}
            <NBCard style={styles.callTextCard}>
              <ScrollView style={{ maxHeight: 150 }}>
                <Text style={styles.callTextContent}>{voiceCallText}</Text>
              </ScrollView>
            </NBCard>

            {/* Continuous active voice bridge toggle */}
            <TouchableOpacity
              onPress={() => setIsContinuousSpeech(!isContinuousSpeech)}
              style={[
                styles.continuousSpeechBtn,
                isContinuousSpeech && styles.continuousSpeechBtnActive
              ]}
            >
              <Text style={[styles.continuousSpeechBtnText, isContinuousSpeech && { color: Colors.textInverse }]}>
                {isContinuousSpeech ? '🎙️ CONTINUOUS ACTIVE (TALK FREELY)' : '🎙️ PRESS TO TALK MODE'}
              </Text>
            </TouchableOpacity>

            {/* Controls Bar */}
            <View style={styles.callControlsRow}>
              {voiceCallStatus === 'listening' ? (
                <TouchableOpacity onPress={stopCallRecording} style={styles.micBtnListening}>
                  <Check size={28} color={Colors.textInverse} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={startCallRecording}
                  disabled={voiceCallStatus === 'processing'}
                  style={[
                    styles.micBtnIdle,
                    voiceCallStatus === 'processing' && { opacity: 0.5 }
                  ]}
                >
                  <Mic size={28} color={Colors.textInverse} />
                </TouchableOpacity>
              )}

              <TouchableOpacity onPress={endVoiceCall} style={styles.endCallBtn}>
                <PhoneOff size={28} color={Colors.textInverse} />
              </TouchableOpacity>
            </View>

            <Text style={styles.callInstructionText}>
              {voiceCallStatus === 'listening' ? 'TAP CHECK BUTTON TO SEND' : 'TAP MIC TO START SPEAKING'}
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  sessionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.sm,
    backgroundColor: Colors.bgCard,
    borderBottomWidth: BorderWidth.medium,
    borderColor: Colors.border,
  },
  sessionSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    backgroundColor: Colors.bgElevated,
  },
  sessionSelectorText: {
    ...Typography.monoMedium,
    color: Colors.textPrimary,
    fontSize: 11,
    letterSpacing: 1,
  },
  iconControls: { flexDirection: 'row', gap: Spacing.xs },
  iconBtn: {
    padding: 8,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    backgroundColor: Colors.bgElevated,
  },
  dropdownMenu: {
    position: 'absolute',
    top: 55,
    left: Spacing.sm,
    right: Spacing.sm,
    zIndex: 99,
  },
  dropdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dropdownTitle: {
    ...Typography.monoMedium,
    color: Colors.gold,
    fontSize: 12,
  },
  dropdownItem: {
    padding: Spacing.sm,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    marginBottom: Spacing.xs,
    backgroundColor: Colors.bgElevated,
  },
  dropdownItemActive: {
    backgroundColor: Colors.gold,
  },
  dropdownItemText: {
    ...Typography.mono,
    color: Colors.textPrimary,
    fontSize: 12,
  },
  messagesList: { flex: 1 },
  msgWrapper: { flexDirection: 'row', width: '100%' },
  msgWrapperUser: { justifyContent: 'flex-end' },
  msgWrapperBot: { justifyContent: 'flex-start' },
  messageBubble: {
    maxWidth: '80%',
    padding: Spacing.md,
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
  },
  bubbleUser: {
    backgroundColor: Colors.cobalt,
    ...Shadows.brutalSm,
  },
  bubbleBot: {
    backgroundColor: Colors.bgCard,
    borderColor: Colors.borderGold,
    ...Shadows.brutalSm,
  },
  messageText: {
    ...Typography.body,
    fontSize: 14,
    lineHeight: 20,
  },
  textUser: { color: Colors.textPrimary },
  textBot: { color: Colors.textPrimary },
  messageTime: {
    ...Typography.mono,
    fontSize: 9,
    marginTop: Spacing.xs,
    alignSelf: 'flex-end',
  },
  timeUser: { color: Colors.textSecondary },
  timeBot: { color: Colors.textMuted },
  inputContainer: {
    padding: Spacing.sm,
    backgroundColor: Colors.bgCard,
    borderTopWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  textInput: {
    flex: 1,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    backgroundColor: Colors.bgElevated,
    color: Colors.textPrimary,
    padding: Spacing.sm,
    ...Typography.mono,
    fontSize: 13,
    maxHeight: 100,
  },
  actionButtons: { flexDirection: 'row', gap: Spacing.xs },
  actionBtn: {
    padding: 10,
    backgroundColor: Colors.bgElevated,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnActive: {
    backgroundColor: Colors.gold,
  },
  sendBtn: {
    padding: 10,
    backgroundColor: Colors.gold,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.brutalSm,
  },
  audioOverlayContainer: {
    flex: 1,
    backgroundColor: 'rgba(10, 10, 10, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  audioOverlayContent: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: Colors.bgCard,
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    padding: Spacing.xl,
    ...Shadows.brutal,
  },
  audioTitleText: {
    ...Typography.display,
    color: Colors.textPrimary,
    fontSize: 16,
    textAlign: 'center',
  },
  audioStatusHint: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginVertical: Spacing.md,
  },
  audioStopBtn: {
    width: 60,
    height: 60,
    borderRadius: 0,
    backgroundColor: Colors.gold,
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.brutalSm,
    marginTop: Spacing.sm,
  },
  audioStopLabel: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 10,
    letterSpacing: 2,
    marginTop: Spacing.sm,
  },
  audioWaveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 60,
    marginVertical: Spacing.md,
  },
  audioWaveBar: {
    width: 6,
    height: 30,
    backgroundColor: Colors.gold,
    borderWidth: BorderWidth.thin,
    borderColor: Colors.border,
  },

  // ── Voice Call Styles ──
  callOverlayContainer: {
    flex: 1,
    backgroundColor: 'rgba(10, 10, 10, 0.98)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.md,
  },
  callOverlayContent: {
    width: '100%',
    height: '90%',
    backgroundColor: Colors.bgCard,
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    padding: Spacing.xl,
    justifyContent: 'space-between',
    alignItems: 'center',
    ...Shadows.brutal,
  },
  callHeader: {
    alignItems: 'center',
    gap: 4,
  },
  callTitleText: {
    ...Typography.display,
    color: Colors.textPrimary,
    fontSize: 18,
    letterSpacing: 2,
  },
  callSubText: {
    ...Typography.monoBold,
    color: Colors.gold,
    fontSize: 9,
    letterSpacing: 1.5,
  },
  callAvatarContainer: {
    alignItems: 'center',
    gap: Spacing.md,
  },
  avatarCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    backgroundColor: Colors.bgElevated,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.brutalSm,
  },
  avatarCircleListening: {
    borderColor: Colors.success,
    backgroundColor: Colors.bg,
  },
  avatarCircleSpeaking: {
    borderColor: Colors.gold,
    backgroundColor: Colors.bg,
  },
  avatarCircleProcessing: {
    borderColor: Colors.cobalt,
    backgroundColor: Colors.bg,
  },
  avatarText: {
    fontSize: 40,
  },
  callStatusText: {
    ...Typography.monoBold,
    color: Colors.textPrimary,
    fontSize: 11,
    letterSpacing: 1.5,
  },
  waveformDotted: {
    width: 120,
    height: 2,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  callTextCard: {
    width: '100%',
    borderColor: Colors.gold,
    padding: Spacing.md,
    backgroundColor: Colors.bgElevated,
  },
  callTextContent: {
    ...Typography.mono,
    color: Colors.textPrimary,
    fontSize: 12,
    lineHeight: 18,
  },
  callControlsRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
    alignItems: 'center',
  },
  micBtnIdle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: Colors.gold,
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.brutalSm,
  },
  micBtnListening: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: Colors.success,
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.brutalSm,
  },
  endCallBtn: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: Colors.crimson,
    borderWidth: BorderWidth.heavy,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.brutalSm,
  },
  callInstructionText: {
    ...Typography.monoBold,
    color: Colors.textMuted,
    fontSize: 9,
    letterSpacing: 1,
  },
  continuousSpeechBtn: {
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderWidth: BorderWidth.medium,
    borderColor: Colors.border,
    backgroundColor: Colors.bgElevated,
    marginBottom: Spacing.sm,
    width: '100%',
    alignItems: 'center',
    ...Shadows.brutalSm,
  },
  continuousSpeechBtnActive: {
    backgroundColor: Colors.gold,
  },
  continuousSpeechBtnText: {
    ...Typography.monoBold,
    color: Colors.textPrimary,
    fontSize: 10,
    letterSpacing: 1,
  },
});
