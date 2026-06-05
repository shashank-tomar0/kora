import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, Calendar, CheckSquare, Wallet, User, 
  Send, Camera, Mic, Plus, Check, Trash2, ArrowUpRight, 
  BookOpen, HelpCircle, AlertCircle, RefreshCw, Smartphone, 
  FileText, LogOut, ChevronRight, Zap, Map, Paperclip, QrCode, Wifi
} from 'lucide-react';

const API_BASE = 'http://localhost:8000';

function App() {
  const [sessionState, setSessionState] = useState('loading');
  const [userId, setUserId] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [onboardData, setOnboardData] = useState({ college: '', branch: '', year: '1' });
  const [activeTab, setActiveTab] = useState('chat');
  const [apiStatus, setApiStatus] = useState('connecting');
  const [liveTime, setLiveTime] = useState(
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
  
  // App Data States
  const [messages, setMessages] = useState([
    { 
      id: 'welcome', 
      sender: 'kora', 
      text: 'Good morning! I am Kora. Forward a WhatsApp message, snap a photo of a timetable/receipt, or type anything to begin managing your student life.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [schedule, setSchedule] = useState([]);
  const [deadlines, setDeadlines] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [flashcards, setFlashcards] = useState([]);
  const [roadmaps, setRoadmaps] = useState([]);
  const [streak, setStreak] = useState(0);
  const [heatmap, setHeatmap] = useState([]);
  const [waQr, setWaQr] = useState(null);
  const [waConnected, setWaConnected] = useState(false);
  
  // Input UI States
  const [inputValue, setInputValue] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorBanner, setErrorBanner] = useState(null);
  
  // Flashcard review state
  const [currentCardIdx, setCurrentCardIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const receiptInputRef = useRef(null);
  const pdfInputRef = useRef(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Live clock
  useEffect(() => {
    const clockInterval = setInterval(() => {
      setLiveTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }, 30000);
    return () => clearInterval(clockInterval);
  }, []);

  // Fetch DB data on start
  const fetchData = async (uid = userId) => {
    if (!uid) return;
    try {
      setApiStatus('connecting');
      // Fetch schedule
      const resSched = await fetch(`${API_BASE}/api/schedule?user_id=${uid}`);
      if (!resSched.ok) throw new Error('Failed to load schedule');
      const dataSched = await resSched.json();
      setSchedule(dataSched);

      // Fetch deadlines
      const resDead = await fetch(`${API_BASE}/api/deadlines?user_id=${uid}`);
      const dataDead = await resDead.json();
      setDeadlines(dataDead);

      // Fetch expenses
      const resExp = await fetch(`${API_BASE}/api/expenses?user_id=${uid}`);
      const dataExp = await resExp.json();
      setExpenses(dataExp);

      // Fetch flashcards
      const resFlash = await fetch(`${API_BASE}/api/flashcards?user_id=${uid}`);
      const dataFlash = await resFlash.json();
      setFlashcards(dataFlash);

      // Fetch roadmaps
      const resRoad = await fetch(`${API_BASE}/api/roadmaps?user_id=${uid}`);
      if (resRoad.ok) {
        const dataRoad = await resRoad.json();
        setRoadmaps(dataRoad);
      }

      // Fetch streak heatmap
      const resHeat = await fetch(`${API_BASE}/api/study/streak-heatmap?user_id=${uid}`);
      if (resHeat.ok) {
        const dataHeat = await resHeat.json();
        setStreak(dataHeat.streak || 0);
        setHeatmap(dataHeat.heatmap || []);
      }

      // Fetch WhatsApp QR status
      try {
        const resWa = await fetch(`${API_BASE}/api/whatsapp/qr`);
        if (resWa.ok) {
          const dataWa = await resWa.json();
          setWaConnected(dataWa.connected);
          setWaQr(dataWa.qr || null);
        }
      } catch (_) {}

      setApiStatus('connected');
      setErrorBanner(null);
    } catch (err) {
      console.error(err);
      setApiStatus('error');
      setErrorBanner('Could not connect to FastAPI server. Please check if your backend is running on http://localhost:8000.');
    }
  };

  // Pre-load chat history from API on first mount
  const loadChatHistory = async (uid = userId) => {
    if (!uid) return;
    try {
      const res = await fetch(`${API_BASE}/api/chat/history?user_id=${uid}`);
      if (res.ok) {
        const history = await res.json();
        if (history && history.length > 0) {
          const mapped = history.map((m, i) => ({
            id: `history-${i}`,
            sender: m.sender,
            text: m.text,
            time: m.time
          }));
          setMessages(mapped);
        }
      }
    } catch (_) {}
  };

  useEffect(() => {
    const savedUserId = localStorage.getItem('kora_user_id');
    const savedProfile = localStorage.getItem('kora_user_profile');
    if (savedUserId && savedProfile) {
      setUserId(savedUserId);
      setUserProfile(JSON.parse(savedProfile));
      const profile = JSON.parse(savedProfile);
      if (profile.onboarded) {
        setSessionState('dashboard');
        fetchData(savedUserId);
        loadChatHistory(savedUserId);
      } else {
        setSessionState('onboarding');
      }
    } else {
      setSessionState('login');
    }
  }, []);

  // Handle Text Send
  const handleSendMessage = async (textToSend = null) => {
    const text = textToSend || inputValue;
    if (!text.trim()) return;

    // Add user message
    const userMsg = {
      id: uuid(),
      sender: 'user',
      text: text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, userMsg]);
    if (!textToSend) setInputValue('');

    // Add loading indicator
    const loadingId = 'loading-' + uuid();
    setMessages(prev => [...prev, { id: loadingId, sender: 'kora', text: '...', isLoading: true }]);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, message: text })
      });
      const data = await res.json();

      // Remove loading indicator & add response
      setMessages(prev => prev.filter(m => m.id !== loadingId));
      setMessages(prev => [...prev, {
        id: uuid(),
        sender: 'kora',
        text: data.reply,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);

      // Refresh data lists in case actions occurred
      fetchData();
    } catch (err) {
      setMessages(prev => prev.filter(m => m.id !== loadingId));
      setMessages(prev => [...prev, {
        id: uuid(),
        sender: 'kora',
        text: 'Error connecting to the AI brain. Is your server key configured?',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    }
  };

  // Handle image upload (receipt/timetable OCR)
  const handleImageUpload = async (event, type = null) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setErrorBanner(null);

    // Add user visual indicator
    const userMsg = {
      id: uuid(),
      sender: 'user',
      text: `Uploaded image: ${file.name}`,
      file: URL.createObjectURL(file),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, userMsg]);

    const formData = new FormData();
    formData.append('file', file);
    if (type) formData.append('doc_type', type);
    if (userId) formData.append('user_id', userId);

    try {
      const res = await fetch(`${API_BASE}/api/ingest/image`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      setMessages(prev => [...prev, {
        id: uuid(),
        sender: 'kora',
        text: data.message,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);

      // Reload databases
      fetchData();
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, {
        id: uuid(),
        sender: 'kora',
        text: 'Failed to process image. Make sure GEMINI_API_KEY is set in backend environment.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (receiptInputRef.current) receiptInputRef.current.value = '';
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };

  // Mark Deadline Done
  const markDeadlineDone = async (id) => {
    try {
      await fetch(`${API_BASE}/api/deadlines/${id}/complete?user_id=${userId}`, { method: 'POST' });
      fetchData();
    } catch (err) {
      console.error('Error marking deadline done:', err);
    }
  };

  // Delete Expense
  const deleteExpenseItem = async (id) => {
    try {
      await fetch(`${API_BASE}/api/expenses/${id}?user_id=${userId}`, { method: 'DELETE' });
      fetchData();
    } catch (err) {
      console.error('Error deleting expense:', err);
    }
  };

  // Handle PDF/Circular upload
  const handlePdfUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    const userMsg = {
      id: uuid(),
      sender: 'user',
      text: `📎 Uploaded: ${file.name}`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, userMsg]);
    const formData = new FormData();
    formData.append('file', file);
    if (userId) formData.append('user_id', userId);
    try {
      const res = await fetch(`${API_BASE}/api/ingest/pdf`, { method: 'POST', body: formData });
      const data = await res.json();
      setMessages(prev => [...prev, {
        id: uuid(), sender: 'kora',
        text: data.message || 'PDF processed successfully!',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
      fetchData();
    } catch (err) {
      setMessages(prev => [...prev, {
        id: uuid(), sender: 'kora',
        text: 'Failed to process PDF. Make sure backend is running.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    } finally {
      setIsUploading(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };

  // Toggle roadmap step
  const toggleRoadmapStep = async (roadmapId, stepIdx) => {
    try {
      await fetch(`${API_BASE}/api/roadmaps/${roadmapId}/toggle/${stepIdx}?user_id=${userId}`, { method: 'POST' });
      fetchData();
    } catch (err) {
      console.error('Error toggling step:', err);
    }
  };

  // Review Flashcard
  const reviewCard = async (cardId, rating) => {
    const formData = new FormData();
    formData.append('rating', rating);
    if (userId) formData.append('user_id', userId);
    try {
      await fetch(`${API_BASE}/api/flashcards/${cardId}/review`, {
        method: 'POST',
        body: formData
      });
      setShowAnswer(false);
      if (currentCardIdx < flashcards.length - 1) {
        setCurrentCardIdx(prev => prev + 1);
      } else {
        setCurrentCardIdx(0);
      }
      fetchData();
    } catch (err) {
      console.error('Error reviewing card:', err);
    }
  };

  const uuid = () => Math.random().toString(36).substring(2, 15);
  const getDayName = (dayIndex) => {
    return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][dayIndex];
  };
  const totalSpent = expenses.reduce((sum, item) => sum + item.amount, 0);

  // Compute real spending by day of week from expenses
  const spendingByDay = (() => {
    const dayTotals = [0, 0, 0, 0, 0, 0, 0]; // Mon-Sun
    expenses.forEach(exp => {
      const d = new Date(exp.transacted_at);
      const dow = (d.getDay() + 6) % 7; // convert JS Sun=0 to Mon=0
      dayTotals[dow] += exp.amount;
    });
    const maxVal = Math.max(...dayTotals, 1);
    return dayTotals.map(v => Math.max(8, Math.round((v / maxVal) * 60)));
  })();


  const handleGoogleAuth = async (email, name, avatar) => {
    setSessionState('loading');
    try {
      const res = await fetch(`${API_BASE}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, avatar_url: avatar })
      });
      const data = await res.json();
      localStorage.setItem('kora_user_id', data.user_id);
      localStorage.setItem('kora_user_profile', JSON.stringify(data));
      setUserId(data.user_id);
      setUserProfile(data);
      if (data.onboarded) {
        setSessionState('dashboard');
        fetchData(data.user_id);
        loadChatHistory(data.user_id);
      } else {
        setSessionState('onboarding');
      }
    } catch (err) {
      console.error(err);
      setSessionState('login');
      setErrorBanner('Auth failed. Is backend running?');
    }
  };

  const submitOnboarding = async () => {
    setSessionState('loading');
    try {
      await fetch(`${API_BASE}/api/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, ...onboardData, name: userProfile.name })
      });
      const updatedProfile = { ...userProfile, ...onboardData, onboarded: true };
      localStorage.setItem('kora_user_profile', JSON.stringify(updatedProfile));
      setUserProfile(updatedProfile);
      setSessionState('dashboard');
      fetchData(userId);
      loadChatHistory(userId);
    } catch (err) {
      console.error(err);
      setSessionState('onboarding');
    }
  };

  if (sessionState === 'loading') {
    return (
      <div className="dashboard-container flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-full border-t-2 border-indigo-500 animate-spin"></div>
          <p className="text-zinc-500 font-mono text-xs uppercase tracking-widest">Booting Kora Engine...</p>
        </div>
      </div>
    );
  }

  if (sessionState === 'login') {
    return (
      <div className="dashboard-container flex items-center justify-center">
        <div className="card-premium w-96 p-8 flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center font-bold text-2xl text-white mb-6 shadow-xl shadow-indigo-500/20">
            K
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Welcome to Kora</h1>
          <p className="text-xs text-zinc-400 mb-8">Sign in to sync your timetable, milestones, and expenses across devices.</p>
          
          <div className="space-y-3 w-full">
            <button 
              onClick={() => handleGoogleAuth('arjun.sharma.iitm@gmail.com', 'Arjun Sharma', '')}
              className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 rounded-xl transition text-sm text-white"
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-orange-500 to-amber-500 flex items-center justify-center font-bold text-[10px]">A</div>
              <div className="flex-1 text-left">Arjun Sharma (Demo)</div>
            </button>
            <button 
              onClick={() => handleGoogleAuth('karan.verma.cs@iitm.ac.in', 'Karan Verma', '')}
              className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 rounded-xl transition text-sm text-white"
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-blue-500 to-cyan-500 flex items-center justify-center font-bold text-[10px]">K</div>
              <div className="flex-1 text-left">Karan Verma (Demo)</div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (sessionState === 'onboarding') {
    return (
      <div className="dashboard-container flex items-center justify-center">
        <div className="card-premium w-96 p-8">
          <h1 className="text-xl font-bold text-white mb-1">Almost there!</h1>
          <p className="text-xs text-zinc-400 mb-6">Let's set up your academic profile.</p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] uppercase font-mono text-zinc-500 mb-1">College</label>
              <input 
                type="text"
                value={onboardData.college}
                onChange={e => setOnboardData({...onboardData, college: e.target.value})}
                placeholder="e.g. IIT Madras"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-mono text-zinc-500 mb-1">Branch</label>
              <input 
                type="text"
                value={onboardData.branch}
                onChange={e => setOnboardData({...onboardData, branch: e.target.value})}
                placeholder="e.g. Computer Science"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-mono text-zinc-500 mb-1">Year</label>
              <input 
                type="number"
                value={onboardData.year}
                onChange={e => setOnboardData({...onboardData, year: parseInt(e.target.value)})}
                min="1" max="5"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button 
              onClick={submitOnboarding}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2.5 font-bold text-sm transition mt-2"
            >
              Complete Setup
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      {/* Background blobs */}
      <div className="glow-blob glow-purple"></div>
      <div className="glow-blob glow-orange"></div>

      {/* Phone Simulator Pane */}
      <div className="phone-pane">
        <div className="smartphone-frame">
          {/* Dynamic Island Status bar */}
          <div className="dynamic-island">
            <span className="dynamic-island-time">{liveTime}</span>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            </div>
            <div className="dynamic-island-status">
              <span>5G</span>
              <div className="w-4 h-2 border border-white/40 rounded-sm p-0.5 flex items-center justify-start">
                <div className="w-full h-full bg-white rounded-2xs"></div>
              </div>
            </div>
          </div>
          
          <div className="phone-screen animate-fade-in">
            {errorBanner && (
              <div className="bg-red-950/80 border-b border-red-500/30 px-4 py-2 flex items-center gap-2 z-50">
                <AlertCircle size={14} className="text-red-500 shrink-0" />
                <span className="text-[10px] text-red-200 leading-tight">{errorBanner}</span>
              </div>
            )}

            {/* TAB CONTENT: CHAT */}
            {activeTab === 'chat' && (
              <div className="flex-1 flex flex-col overflow-hidden bg-black">
                {/* Chat Header */}
                <div className="px-5 py-4 border-b border-zinc-900 flex justify-between items-center bg-zinc-950/30 backdrop-blur-md">
                  <div>
                    <h2 className="text-[10px] font-bold text-white flex items-center gap-1.5 uppercase tracking-widest font-mono">
                      KORA <Zap size={11} className="text-indigo-400 fill-indigo-400" />
                    </h2>
                    <p className="text-[9px] text-zinc-500">Student AI Staff</p>
                  </div>
                  <span className="text-[8px] text-indigo-400 bg-indigo-950/40 px-2 py-0.5 rounded-full border border-indigo-900/30 font-mono">GEMINI CORE</span>
                </div>

                {/* Messages Log Container */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                  {messages.length === 1 && (
                    <div className="py-6 flex flex-col items-center justify-center text-center animate-fade-in">
                      <div className="orb-box">
                        <div className="orb-ring-solid"></div>
                        <div className="orb-ring-dashed"></div>
                        <div className="orb-glow-inner"></div>
                      </div>
                      
                      <h2 className="editorial-title text-xl mb-1 mt-4">Good morning, Arjun</h2>
                      <p className="text-[11px] text-zinc-500 max-w-xs px-6">
                        Timetables, receipts, assignments, mess bills — I am here to run your student life.
                      </p>
                    </div>
                  )}

                  {messages.map((msg, i) => {
                    if (msg.id === 'welcome' && messages.length === 1) return null;
                    return (
                      <div key={msg.id || i} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'} animate-fade-in-up`}>
                        <div className={`chat-message-bubble ${msg.sender === 'user' ? 'user' : 'kora'}`}>
                          {msg.file && (
                            <img src={msg.file} alt="Upload" className="rounded-lg mb-2 max-w-full h-40 object-cover" />
                          )}
                          {msg.isLoading ? (
                            <div className="flex gap-1 py-1">
                              <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce"></div>
                              <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce delay-100"></div>
                              <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce delay-200"></div>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap">{msg.text}</p>
                          )}
                        </div>
                        <span className="text-[8px] text-zinc-600 mt-1 px-1 font-mono">{msg.time}</span>
                      </div>
                    );
                  })}
                  {isUploading && (
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500 py-2">
                      <RefreshCw size={12} className="animate-spin text-indigo-400" />
                      <span>Extracting details via Gemini Vision...</span>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Suggestions Pills */}
                <div className="pill-container">
                  <button 
                    onClick={() => handleSendMessage("What do I have scheduled for tomorrow?")}
                    className="suggestion-pill"
                  >
                    📅 Schedule tomorrow
                  </button>
                  <button 
                    onClick={() => handleSendMessage("Log expense of 150 rupees at canteen for lunch")}
                    className="suggestion-pill"
                  >
                    ☕ Canteen ₹150
                  </button>
                  <button 
                    onClick={() => handleSendMessage("Review my syllabus and generate study cards")}
                    className="suggestion-pill"
                  >
                    🧠 Flashcards
                  </button>
                  <button 
                    onClick={() => handleSendMessage("What are my pending deadlines this week?")}
                    className="suggestion-pill"
                  >
                    ⏰ This week
                  </button>
                </div>

                {/* Input Bar wrapper */}
                <div className="input-bar-wrap">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    title="Scan Timetable"
                    className="input-bar-btn"
                  >
                    <Calendar size={14} />
                  </button>
                  <button 
                    onClick={() => receiptInputRef.current?.click()}
                    title="Scan Receipt"
                    className="input-bar-btn"
                  >
                    <Wallet size={14} />
                  </button>
                  <button
                    onClick={() => pdfInputRef.current?.click()}
                    title="Upload PDF / Circular"
                    className="input-bar-btn"
                  >
                    <Paperclip size={14} />
                  </button>
                  
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={(e) => handleImageUpload(e, 'timetable')} 
                    accept="image/*" 
                    className="hidden" 
                  />
                  <input 
                    type="file" 
                    ref={receiptInputRef} 
                    onChange={(e) => handleImageUpload(e, 'receipt')} 
                    accept="image/*" 
                    className="hidden" 
                  />
                  <input
                    type="file"
                    ref={pdfInputRef}
                    onChange={handlePdfUpload}
                    accept=".pdf,image/*"
                    className="hidden"
                  />

                  <input 
                    type="text" 
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="Ask Kora, scan timetables, receipts..." 
                    className="flex-1 bg-transparent border-none text-white text-xs focus:outline-none placeholder-zinc-500"
                  />

                  {inputValue.trim() ? (
                    <button 
                      onClick={() => handleSendMessage()}
                      className="input-bar-btn input-bar-btn-send"
                    >
                      <Send size={12} />
                    </button>
                  ) : (
                    <button 
                      onMouseDown={() => {
                        setIsRecording(true);
                        setInputValue('Recording speech...');
                      }}
                      onMouseUp={() => {
                        setIsRecording(false);
                        setInputValue('');
                        handleSendMessage("What classes do I have tomorrow?"); 
                      }}
                      className={`input-bar-btn ${isRecording ? 'bg-red-600 text-white animate-pulse' : ''}`}
                    >
                      <Mic size={14} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: SCHEDULE */}
            {activeTab === 'schedule' && (
              <div className="flex-1 flex flex-col overflow-hidden bg-black px-5 py-4">
                <div className="flex justify-between items-center mb-4">
                  <h1 className="editorial-title text-xl">Timetable</h1>
                  <span className="text-[10px] font-mono text-zinc-500">{schedule.length} active classes</span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                  {schedule.length === 0 ? (
                    <div className="h-60 border border-dashed border-zinc-800 rounded-2xl flex flex-col items-center justify-center p-6 text-center">
                      <Calendar className="text-zinc-700 mb-2" size={32} />
                      <p className="text-xs text-zinc-400 mb-2">No timetable scanned yet</p>
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
                      >
                        Upload Timetable Photo
                      </button>
                    </div>
                  ) : (
                    [0,1,2,3,4,5,6].map(dayIdx => {
                      const dayClasses = schedule.filter(c => c.day_of_week === dayIdx);
                      if (dayClasses.length === 0) return null;
                      return (
                        <div key={dayIdx} className="space-y-2">
                          <h3 className="label-secondary text-[9px]">{getDayName(dayIdx)}</h3>
                          <div className="space-y-2">
                            {dayClasses.map((item, idx) => (
                              <div key={item.id || idx} className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-3 flex justify-between items-center backdrop-blur-md">
                                <div>
                                  <div className="text-xs font-bold text-white">{item.subject}</div>
                                  <div className="text-[9px] text-zinc-500 mt-0.5">{item.title} • {item.room || 'Room TBA'}</div>
                                </div>
                                <div className="text-right">
                                  <span className="text-[9px] font-mono font-bold text-indigo-400 bg-indigo-950/20 px-2 py-0.5 rounded-full border border-indigo-900/30">
                                    {item.time_start} - {item.time_end}
                                  </span>
                                  {item.professor && <div className="text-[8px] text-zinc-600 mt-1">{item.professor}</div>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: DEADLINES */}
            {activeTab === 'deadlines' && (
              <div className="flex-1 flex flex-col overflow-hidden bg-black px-5 py-4">
                <div className="flex justify-between items-center mb-4">
                  <h1 className="editorial-title text-xl">Deadlines</h1>
                  <span className="text-[9px] text-zinc-500 font-mono bg-zinc-900 px-2 py-0.5 rounded-full">
                    {deadlines.filter(d => d.status === 'PENDING').length} pending
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {deadlines.length === 0 ? (
                    <div className="h-60 border border-dashed border-zinc-800 rounded-2xl flex flex-col items-center justify-center p-6 text-center animate-fade-in">
                      <CheckSquare className="text-indigo-400/40 mb-3" size={32} />
                      <h2 className="text-white text-xs font-semibold mb-1">All caught up!</h2>
                      <p className="text-[10px] text-zinc-500">No active student tasks or assignment deadlines.</p>
                    </div>
                  ) : (
                    deadlines.map((item, idx) => {
                      const isPending = item.status === 'PENDING';
                      return (
                        <div 
                          key={item.id || idx} 
                          className={`border rounded-xl p-3 flex items-start gap-3 transition ${
                            isPending 
                              ? 'bg-zinc-900/40 border-zinc-800/80 hover:border-zinc-700' 
                              : 'bg-zinc-950/20 border-zinc-950 text-zinc-600'
                          }`}
                        >
                          <button 
                            onClick={() => isPending && markDeadlineDone(item.id)}
                            className={`w-4.5 h-4.5 rounded-md border flex items-center justify-center mt-0.5 transition shrink-0 ${
                              isPending 
                                ? 'border-zinc-700 hover:border-zinc-500 bg-zinc-950' 
                                : 'border-emerald-600/30 bg-emerald-950/30 text-emerald-500'
                            }`}
                          >
                            {!isPending && <Check size={10} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className={`text-xs font-bold ${isPending ? 'text-white' : 'line-through text-zinc-600'}`}>{item.title}</div>
                            <div className="flex items-center gap-2 mt-1">
                              {item.subject && (
                                <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase ${isPending ? 'bg-indigo-950/40 text-indigo-400 border border-indigo-900/30' : 'bg-zinc-900 text-zinc-600'}`}>
                                  {item.subject}
                                </span>
                              )}
                              <span className="text-[8px] text-zinc-500">
                                Due {new Date(item.due_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: EXPENSES */}
            {activeTab === 'expenses' && (
              <div className="flex-1 flex flex-col overflow-hidden bg-black px-5 py-4">
                <h1 className="editorial-title text-xl mb-4">Expenses</h1>
                
                {/* Premium Fintech Card (Mesh Gradient) */}
                <div className="fintech-gradient-card mb-4">
                  <div className="flex justify-between items-start">
                    <span className="text-[9px] text-white/70 uppercase tracking-widest font-mono">Monthly Budget Ledger</span>
                    <span className="text-[9px] bg-white/20 text-white px-2 py-0.5 rounded-full font-bold">+15% saved</span>
                  </div>
                  <div className="text-2xl font-bold font-mono mt-2 text-white">₹{totalSpent.toFixed(2)}</div>
                  <div className="mt-4">
                    <div className="flex justify-between text-[8px] text-white/80 mb-1">
                      <span>Total monthly limit: ₹8,000</span>
                      <span>{((totalSpent/8000)*100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-black/30 rounded-full overflow-hidden">
                      <div className="h-full bg-white rounded-full" style={{ width: `${Math.min((totalSpent/8000)*100, 100)}%` }}></div>
                    </div>
                  </div>
                </div>

                {/* Premium Custom Analytics Bar Graph — real DB data */}
                <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-3 mb-4">
                  <span className="label-secondary text-[8px]">Weekly Spending</span>
                  
                  <div className="flex items-end justify-between h-16 mt-3 px-2">
                    {['M','T','W','T','F','S','S'].map((day, i) => {
                      const today = (new Date().getDay() + 6) % 7;
                      const isToday = i === today;
                      return (
                        <div key={i} className="flex flex-col items-center gap-1.5">
                          <div 
                            className={`graph-column${isToday ? ' active' : ''}`} 
                            style={{ height: `${spendingByDay[i]}px` }}
                            title={`₹${expenses.filter(e => (new Date(e.transacted_at).getDay()+6)%7===i).reduce((s,e)=>s+e.amount,0).toFixed(0)}`}
                          ></div>
                          <span className={`text-[8px] font-mono ${isToday ? 'text-zinc-300 font-bold' : 'text-zinc-500'}`}>{day}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-between items-center mb-3">
                  <h3 className="label-secondary text-[8px]">Recent Expenses</h3>
                  <button 
                    onClick={() => receiptInputRef.current?.click()}
                    className="text-[9px] text-indigo-400 flex items-center gap-1 hover:text-white"
                  >
                    <Plus size={10} /> Scan Receipt
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {expenses.length === 0 ? (
                    <div className="h-28 border border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center p-6 text-center">
                      <Wallet className="text-zinc-700 mb-1" size={20} />
                      <p className="text-[10px] text-zinc-500">No expenses logged yet</p>
                    </div>
                  ) : (
                    expenses.map((item, idx) => (
                      <div key={item.id || idx} className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-3 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-lg bg-black border border-zinc-800 flex items-center justify-center text-xs">
                            {item.category === 'CANTEEN' ? '🍔' : item.category === 'MESS' ? '🍲' : item.category === 'BOOKS' ? '📚' : '🛒'}
                          </div>
                          <div>
                            <div className="text-xs font-bold text-white">{item.merchant}</div>
                            <div className="text-[9px] text-zinc-500 mt-0.5">
                              {item.category} • {new Date(item.transacted_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold font-mono text-zinc-100">₹{item.amount}</span>
                          <button 
                            onClick={() => deleteExpenseItem(item.id)}
                            className="text-zinc-600 hover:text-red-500 transition"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: STUDY */}
            {activeTab === 'study' && (
              <div className="flex-1 flex flex-col overflow-hidden bg-black px-5 py-4">
                <div className="flex justify-between items-center mb-3">
                  <h1 className="editorial-title text-xl">Study Deck</h1>
                  {streak > 0 && (
                    <span className="text-[9px] font-mono text-amber-400 bg-amber-950/30 border border-amber-900/30 px-2 py-0.5 rounded-full">
                      🔥 {streak}d streak
                    </span>
                  )}
                </div>

                {flashcards.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-zinc-800 rounded-2xl">
                    <BookOpen size={32} className="text-zinc-700 mb-2" />
                    <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
                      Create flashcards by uploading study notes circulars, or typing summaries in chat.
                    </p>
                    <button 
                      onClick={() => handleSendMessage("Generate study flashcards for Data Structures")}
                      className="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-white text-xs font-semibold transition"
                    >
                      Ask Kora to Generate Deck
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col justify-between">
                    <div className="text-[9px] font-mono text-zinc-500 mb-2 text-center">
                      Card {currentCardIdx + 1} of {flashcards.length}
                    </div>

                    <div 
                      onClick={() => setShowAnswer(!showAnswer)}
                      className="flex-1 min-h-[200px] border border-zinc-800 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer relative select-none bg-gradient-to-br from-zinc-900/60 to-zinc-950/60 backdrop-blur-md shadow-xl transition-all duration-300 hover:border-zinc-700"
                    >
                      {!showAnswer ? (
                        <div>
                          <span className="text-[8px] uppercase tracking-widest text-indigo-400 font-bold font-mono bg-indigo-950/40 px-2 py-0.5 border border-indigo-900/30 rounded-full mb-4 inline-block">
                            {flashcards[currentCardIdx]?.subject || 'GENERAL'}
                          </span>
                          <h2 className="text-xs font-bold text-zinc-100 leading-relaxed mt-3">
                            {flashcards[currentCardIdx]?.front}
                          </h2>
                          <div className="text-[9px] text-zinc-600 mt-4">Tap to reveal answer</div>
                        </div>
                      ) : (
                        <div>
                          <span className="text-[8px] uppercase tracking-widest text-emerald-400 font-bold font-mono bg-emerald-950/40 px-2 py-0.5 border border-emerald-900/30 rounded-full mb-4 inline-block">
                            ANSWER
                          </span>
                          <p className="text-xs text-zinc-300 leading-relaxed font-light mt-3">
                            {flashcards[currentCardIdx]?.back}
                          </p>
                          <div className="text-[9px] text-zinc-600 mt-4">Tap to flip back</div>
                        </div>
                      )}
                    </div>

                    {showAnswer ? (
                      <div className="mt-3 flex gap-2">
                        <button 
                          onClick={() => reviewCard(flashcards[currentCardIdx].id, 1)}
                          className="flex-1 py-2 rounded-xl text-red-400 border border-red-900/30 hover:bg-red-900/20 text-[10px] font-bold transition"
                        >
                          Hard (1d)
                        </button>
                        <button 
                          onClick={() => reviewCard(flashcards[currentCardIdx].id, 2)}
                          className="flex-1 py-2 rounded-xl text-amber-400 border border-amber-900/30 hover:bg-amber-900/20 text-[10px] font-bold transition"
                        >
                          Medium (3d)
                        </button>
                        <button 
                          onClick={() => reviewCard(flashcards[currentCardIdx].id, 3)}
                          className="flex-1 py-2 rounded-xl text-emerald-400 border border-emerald-900/30 hover:bg-emerald-900/20 text-[10px] font-bold transition"
                        >
                          Easy (7d)
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3 h-[38px]"></div>
                    )}
                  </div>
                )}

                {/* Mini heatmap strip */}
                {heatmap.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-zinc-900">
                    <div className="text-[8px] text-zinc-600 font-mono mb-2">30-DAY REVIEW HEATMAP</div>
                    <div className="flex gap-1 flex-wrap">
                      {heatmap.map((day, i) => (
                        <div
                          key={i}
                          title={`${day.date}: ${day.count} reviews`}
                          className="w-3 h-3 rounded-sm"
                          style={{
                            background: day.count === 0 
                              ? 'rgba(255,255,255,0.04)' 
                              : day.count < 3 
                              ? 'rgba(99,70,255,0.4)' 
                              : day.count < 6 
                              ? 'rgba(99,70,255,0.7)' 
                              : 'rgba(99,70,255,1)'
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: ROADMAP */}
            {activeTab === 'roadmap' && (
              <div className="flex-1 flex flex-col overflow-hidden bg-black px-5 py-4">
                <div className="flex justify-between items-center mb-4">
                  <h1 className="editorial-title text-xl">Roadmaps</h1>
                  <button
                    onClick={() => pdfInputRef.current?.click()}
                    className="text-[9px] text-indigo-400 flex items-center gap-1 hover:text-white"
                  >
                    <Plus size={10} /> Upload Circular
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                  {roadmaps.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-zinc-800 rounded-2xl">
                      <Map size={32} className="text-zinc-700 mb-2" />
                      <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
                        Upload a syllabus PDF or circular to auto-generate a study roadmap.
                      </p>
                      <button
                        onClick={() => pdfInputRef.current?.click()}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
                      >
                        Upload Circular / Syllabus
                      </button>
                    </div>
                  ) : (
                    roadmaps.map((rm) => (
                      <div key={rm.id} className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-4">
                        <div className="text-xs font-bold text-white mb-1">{rm.title}</div>
                        <div className="text-[9px] text-zinc-500 mb-3">{rm.description}</div>
                        <div className="space-y-2">
                          {(rm.steps || []).map((step, idx) => (
                            <button
                              key={idx}
                              onClick={() => toggleRoadmapStep(rm.id, idx)}
                              className="w-full flex items-start gap-2 text-left"
                            >
                              <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 transition ${
                                step.checked
                                  ? 'bg-emerald-600 border-emerald-600'
                                  : 'border-zinc-700 bg-zinc-950'
                              }`}>
                                {step.checked && <Check size={10} className="text-white" />}
                              </div>
                              <div>
                                <div className={`text-[11px] font-semibold ${
                                  step.checked ? 'line-through text-zinc-600' : 'text-zinc-200'
                                }`}>{step.title}</div>
                                {step.description && (
                                  <div className="text-[9px] text-zinc-600 mt-0.5">{step.description}</div>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: WHATSAPP QR */}
            {activeTab === 'whatsapp' && (
              <div className="flex-1 flex flex-col overflow-hidden bg-black px-5 py-4">
                <h1 className="editorial-title text-xl mb-4">WhatsApp Bridge</h1>
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
                  {waConnected ? (
                    <>
                      <div className="w-16 h-16 rounded-full bg-emerald-950/40 border border-emerald-800/40 flex items-center justify-center">
                        <Wifi size={28} className="text-emerald-400" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-emerald-400 mb-1">WhatsApp Connected</div>
                        <div className="text-[10px] text-zinc-500">Kora is receiving your WhatsApp forwards. Messages sent on WA will be processed automatically.</div>
                      </div>
                    </>
                  ) : waQr ? (
                    <>
                      <div className="text-xs text-zinc-400 mb-2">Scan with WhatsApp to connect:</div>
                      <div className="bg-white p-3 rounded-2xl">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(waQr)}`}
                          alt="WhatsApp QR Code"
                          className="w-44 h-44"
                        />
                      </div>
                      <div className="text-[9px] text-zinc-600">Open WhatsApp → Linked Devices → Link a Device</div>
                    </>
                  ) : (
                    <>
                      <QrCode size={40} className="text-zinc-700" />
                      <div className="text-xs text-zinc-500">Start the WhatsApp bridge service to see QR code.<br/>Run: <code className="font-mono text-indigo-400">cd apps/wa-bridge && node index.js</code></div>
                      <button
                        onClick={fetchData}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-white text-xs font-semibold transition"
                      >
                        <RefreshCw size={12} /> Check Status
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Bottom Tab Bar */}
            <div className="phone-tabbar">
              <button 
                onClick={() => setActiveTab('chat')} 
                className={`tab-item ${activeTab === 'chat' ? 'active' : ''}`}
              >
                <MessageSquare size={15} />
                <span>Chat</span>
              </button>
              <button 
                onClick={() => setActiveTab('schedule')} 
                className={`tab-item ${activeTab === 'schedule' ? 'active' : ''}`}
              >
                <Calendar size={15} />
                <span>Timetable</span>
              </button>
              <button 
                onClick={() => setActiveTab('deadlines')} 
                className={`tab-item ${activeTab === 'deadlines' ? 'active' : ''}`}
              >
                <CheckSquare size={15} />
                <span>Tasks</span>
              </button>
              <button 
                onClick={() => setActiveTab('expenses')} 
                className={`tab-item ${activeTab === 'expenses' ? 'active' : ''}`}
              >
                <Wallet size={15} />
                <span>Spend</span>
              </button>
              <button 
                onClick={() => setActiveTab('study')} 
                className={`tab-item ${activeTab === 'study' ? 'active' : ''}`}
              >
                <BookOpen size={15} />
                <span>Study</span>
              </button>
              <button 
                onClick={() => setActiveTab('roadmap')} 
                className={`tab-item ${activeTab === 'roadmap' ? 'active' : ''}`}
              >
                <Map size={15} />
                <span>Roadmap</span>
              </button>
              <button 
                onClick={() => setActiveTab('whatsapp')} 
                className={`tab-item ${activeTab === 'whatsapp' ? 'active' : ''}`}
              >
                <Wifi size={15} />
                <span>WA</span>
              </button>
            </div>
            
            <div className="home-indicator"></div>
          </div>
        </div>
      </div>

      {/* Laptop Muscle Dashboard Pane */}
      <div className="laptop-pane animate-fade-in">
        {/* Dashboard Top Header Bar */}
        <div className="dashboard-header">
          <div className="dashboard-title-box">
            <div className="dashboard-logo font-mono">K</div>
            <div>
              <h1 className="text-sm font-bold text-white flex items-center gap-2">
                KORA <span className="text-[9px] uppercase font-mono tracking-widest text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded-full border border-zinc-800">Workspace</span>
              </h1>
              <p className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">Laptop Muscle Engine • Local Node</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 backdrop-blur-md text-[10px] font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span className="text-zinc-300">SQLite Active</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 backdrop-blur-md text-[10px] font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
              <span className="text-zinc-300">Gemini 1.5 Active</span>
            </div>
            <button 
              onClick={fetchData}
              className="p-2 rounded-xl bg-zinc-900/50 border border-zinc-800/80 hover:bg-zinc-800 text-zinc-400 hover:text-white transition backdrop-blur-md"
              title="Refresh Engine Data"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {/* Dashboard Layout Double Panel (Sidebar + Main Workspace) */}
        <div className="dashboard-body-split">
          {/* Dashboard Left Sidebar Control Panel */}
          <div className="dashboard-sidebar">
            <div className="space-y-6">
              <div>
                <span className="sidebar-section-title">Main Actions</span>
                <div className="space-y-1">
                  <button className="sidebar-action-btn active">
                    <span className="flex items-center gap-2"><Zap size={13} /> Active Agent Loop</span>
                    <ChevronRight size={12} />
                  </button>
                  <button 
                    onClick={() => handleSendMessage("Summarize my current week status")}
                    className="sidebar-action-btn"
                  >
                    <span className="flex items-center gap-2"><MessageSquare size={13} /> Ask Weekly status</span>
                    <ChevronRight size={12} />
                  </button>
                  <button 
                    onClick={() => handleSendMessage("Log canteen food expense of 200 rupees")}
                    className="sidebar-action-btn"
                  >
                    <span className="flex items-center gap-2"><Wallet size={13} /> Log expense</span>
                    <ChevronRight size={12} />
                  </button>
                </div>
              </div>

              <div>
                <span className="sidebar-section-title">Knowledge Graph</span>
                <div className="mt-2 space-y-1">
                  <div className="px-3 py-2 text-zinc-500 text-[10px] leading-relaxed bg-zinc-900/20 border border-zinc-900 rounded-lg">
                    🧠 <b>Data Nodes:</b> Student → Course → Marks → Attendance index are actively connected.
                  </div>
                </div>
              </div>
            </div>

            {/* Profile bottom card */}
            <div className="p-3 bg-zinc-900/20 border border-zinc-900 rounded-xl flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-orange-500 to-amber-500 flex items-center justify-center font-bold text-white text-sm shadow">
                A
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white truncate">Arjun</div>
                <div className="text-[9px] text-zinc-500 font-mono truncate">IIT CS • Year 3</div>
              </div>
            </div>
          </div>

          {/* Dashboard Main Scrollable Body - structured in a multi-column clean layout */}
          <div className="dashboard-workspace">
            {/* Top Stat Row */}
            <div className="grid grid-cols-3 gap-5 shrink-0">
              <div className="card-premium">
                <div className="dashboard-title-sub mb-1">Total Weekly Lectures</div>
                <div className="text-xl font-bold font-mono text-zinc-100">{schedule.length} classes</div>
                <span className="text-[10px] text-indigo-400">OCR layout analysis fully synced</span>
              </div>
              <div className="card-premium">
                <div className="dashboard-title-sub mb-1">Active Milestones</div>
                <div className="text-xl font-bold font-mono text-zinc-100">{deadlines.filter(d => d.status === 'PENDING').length} uncompleted</div>
                <span className="text-[10px] text-emerald-400">Proactive alerts active</span>
              </div>
              <div className="card-premium">
                <div className="dashboard-title-sub mb-1">Monthly Spent ledger</div>
                <div className="text-xl font-bold font-mono text-zinc-100">₹{totalSpent.toFixed(2)}</div>
                <span className="text-[10px] text-amber-500 font-mono">Cap remaining: ₹{(8000 - totalSpent).toFixed(2)}</span>
              </div>
            </div>

            {/* Main Double Column Workspace Grid (Left content: timetable/ledger, Right content: milestones/reviews) */}
            <div className="grid grid-cols-3 gap-6 flex-1 overflow-hidden min-h-0">
              {/* Left double panel scroll (timetable & ledger) */}
              <div className="col-span-2 space-y-6 overflow-y-auto pr-1">
                {/* TIMETABLE SECTION */}
                <div className="card-premium flex flex-col">
                  <div className="flex justify-between items-center mb-4 border-b border-zinc-900 pb-3">
                    <h2 className="editorial-title text-base font-bold text-white flex items-center gap-2">
                      <Calendar size={16} className="text-indigo-400" /> Timetable Calendar
                    </h2>
                    <span className="text-[9px] font-mono text-zinc-500 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-900">Weekly recurrences</span>
                  </div>

                  <div className="space-y-3">
                    {schedule.length === 0 ? (
                      <div className="text-zinc-650 italic text-xs py-8 text-center">
                        No schedule elements imported. Scan a timetable from the mobile client to sync here.
                      </div>
                    ) : (
                      schedule.map((item, i) => (
                        <div key={item.id || i} className="grid-col-lecture flex justify-between items-center">
                          <div>
                            <span className="text-[9px] font-mono text-indigo-400 font-bold uppercase mr-2 bg-indigo-950/20 px-1.5 py-0.5 rounded border border-indigo-900/30">
                              {getDayName(item.day_of_week).substring(0, 3)}
                            </span>
                            <span className="text-xs font-bold text-zinc-100">{item.subject}</span>
                            <div className="text-[10px] text-zinc-500 mt-1 pl-[38px]">{item.title} • {item.room || 'TBA'}</div>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] font-mono text-zinc-300 font-bold">{item.time_start} - {item.time_end}</span>
                            {item.professor && <div className="text-[9px] text-zinc-650 mt-1">{item.professor}</div>}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* TRANSACTIONS SECTION */}
                <div className="card-premium flex flex-col">
                  <div className="flex justify-between items-center mb-4 border-b border-zinc-900 pb-3">
                    <h2 className="editorial-title text-base font-bold text-white flex items-center gap-2">
                      <Wallet size={16} className="text-amber-500" /> Transaction ledger
                    </h2>
                    <span className="text-[9px] font-mono text-zinc-500">Real-time sync</span>
                  </div>

                  <table className="table-premium">
                    <thead>
                      <tr>
                        <th>Merchant</th>
                        <th>Category</th>
                        <th>Amount</th>
                        <th>Date</th>
                        <th className="text-right">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.map((exp, i) => (
                        <tr key={exp.id || i}>
                          <td className="font-semibold text-zinc-200">{exp.merchant}</td>
                          <td>
                            <span className="px-2 py-0.5 bg-zinc-900/80 border border-zinc-800 text-[9px] rounded-full text-zinc-400 uppercase font-mono">
                              {exp.category}
                            </span>
                          </td>
                          <td className="font-mono font-bold text-zinc-100">₹{exp.amount}</td>
                          <td className="text-[10px] text-zinc-500 font-mono">{new Date(exp.transacted_at).toLocaleDateString()}</td>
                          <td className="text-right font-mono text-[9px] text-zinc-500 uppercase">{exp.source}</td>
                        </tr>
                      ))}
                      {expenses.length === 0 && (
                        <tr>
                          <td colSpan={5} className="text-center py-12 text-zinc-650 italic">No ledger items recorded.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Right column scroll (milestones & memory index deck) */}
              <div className="col-span-1 space-y-6 overflow-y-auto pr-1">
                {/* Milestones list */}
                <div className="card-premium">
                  <div className="flex justify-between items-center mb-3 border-b border-zinc-900 pb-2">
                    <h2 className="editorial-title text-sm font-bold text-zinc-200">Assignment Milestones</h2>
                  </div>
                  <div className="space-y-2">
                    {deadlines.length === 0 ? (
                      <div className="text-zinc-600 italic text-xs py-4 text-center">No pending assignments logged.</div>
                    ) : (
                      deadlines.map((item, i) => (
                        <div key={item.id || i} className="flex justify-between items-center p-2.5 bg-zinc-950/40 border border-zinc-900 rounded-lg">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.status === 'DONE' ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                            <span className={`text-[11px] font-bold truncate ${item.status === 'DONE' ? 'text-zinc-500 line-through' : 'text-zinc-300'}`}>{item.title}</span>
                          </div>
                          <span className="text-[8px] text-zinc-500 font-mono shrink-0">Due {new Date(item.due_at).toLocaleDateString()}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Review Deck Status */}
                <div className="card-premium">
                  <h2 className="editorial-title text-sm font-bold text-zinc-200 mb-3 border-b border-zinc-900 pb-2">Memory Deck Status</h2>
                  <div className="space-y-2 text-xs text-zinc-400">
                    <div className="flex justify-between">
                      <span>Total study cards:</span>
                      <span className="font-bold text-white font-mono">{flashcards.length} cards</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Due for review:</span>
                      <span className="font-bold text-indigo-400 font-mono">{flashcards.filter(c => new Date(c.next_review_at) <= new Date()).length} cards</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Study streak:</span>
                      <span className="font-bold text-amber-400 font-mono">{streak > 0 ? `🔥 ${streak} days` : '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Active roadmaps:</span>
                      <span className="font-bold text-emerald-400 font-mono">{roadmaps.length}</span>
                    </div>
                  </div>
                  {heatmap.length > 0 && (
                    <div className="mt-4">
                      <div className="text-[8px] text-zinc-600 font-mono mb-2 uppercase tracking-wider">30-Day Heatmap</div>
                      <div className="flex gap-1 flex-wrap">
                        {heatmap.map((day, i) => (
                          <div
                            key={i}
                            title={`${day.date}: ${day.count} reviews`}
                            style={{
                              width: 10, height: 10, borderRadius: 2,
                              background: day.count === 0
                                ? 'rgba(255,255,255,0.04)'
                                : day.count < 3
                                ? 'rgba(99,70,255,0.4)'
                                : day.count < 6
                                ? 'rgba(99,70,255,0.7)'
                                : 'rgba(99,70,255,1)'
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="text-[9px] text-zinc-500 leading-normal bg-zinc-950/40 p-2.5 border border-zinc-900 rounded-lg mt-4">
                    Spaced Repetition engine schedules cards based on SM-2 recall difficulty ratings.
                  </div>
                </div>

                {/* Roadmaps Widget */}
                {roadmaps.length > 0 && (
                  <div className="card-premium">
                    <h2 className="editorial-title text-sm font-bold text-zinc-200 mb-3 border-b border-zinc-900 pb-2">Study Roadmaps</h2>
                    <div className="space-y-4">
                      {roadmaps.map((rm) => {
                        const total = rm.steps?.length || 0;
                        const done = rm.steps?.filter(s => s.checked)?.length || 0;
                        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                        return (
                          <div key={rm.id}>
                            <div className="flex justify-between items-center mb-1.5">
                              <div className="text-[11px] font-bold text-zinc-300">{rm.title}</div>
                              <span className="text-[9px] font-mono text-indigo-400">{done}/{total}</span>
                            </div>
                            <div className="w-full h-1.5 bg-zinc-900 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #8E7CFF, #6346FF)' }}
                              />
                            </div>
                            <div className="mt-2 space-y-1">
                              {rm.steps?.slice(0, 4).map((step, idx) => (
                                <div key={idx} className={`text-[10px] flex items-center gap-1.5 ${
                                  step.checked ? 'text-zinc-600 line-through' : 'text-zinc-400'
                                }`}>
                                  <div className={`w-1 h-1 rounded-full ${
                                    step.checked ? 'bg-emerald-500' : 'bg-zinc-600'
                                  }`} />
                                  {step.title}
                                </div>
                              ))}
                              {(rm.steps?.length || 0) > 4 && (
                                <div className="text-[9px] text-zinc-600">+{rm.steps.length - 4} more steps</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
